const DAY_MS = 24 * 60 * 60 * 1000;
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_HOMEWORK_DUE_DAYS = 7;
const HOMEWORK_LIST_GROUPS = Object.freeze({
  returned: "returned",
  overdue: "overdue",
  today: "today",
  upcoming: "upcoming",
  noDeadline: "noDeadline",
  awaitingReview: "awaitingReview",
  completed: "completed",
});

const toSafeCount = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const getDefaultLessonPackageSize = (student) => {
  const name = `${(student && student.name) || ""} ${(student && student.nickname) || ""}`
    .trim()
    .toLowerCase();
  if (name.includes("molly")) return 5;
  if (name.includes("冯嘉文")) return 3;
  return 0;
};

const getLessonPackageSize = (student) => {
  const stored = Number(student && student.lessonPackageSize);
  if (Number.isInteger(stored) && stored >= 0 && stored <= 100) return stored;
  return getDefaultLessonPackageSize(student);
};

const buildLessonProgress = (student = {}) => {
  const plannedLessonCount = toSafeCount(student.plannedLessonCount);
  const completedLessonCount = toSafeCount(student.completedLessonCount);
  const progressPercent = plannedLessonCount
    ? Math.min(100, Math.round((completedLessonCount / plannedLessonCount) * 100))
    : 0;
  const lessonPackageSize = getLessonPackageSize(student);
  const remainingLessonCount = plannedLessonCount
    ? Math.max(0, plannedLessonCount - completedLessonCount)
    : 0;
  const lessonReminderThreshold = lessonPackageSize >= 5
    ? 2
    : lessonPackageSize > 0 ? 1 : 0;
  const showProgressMarker = plannedLessonCount > 0
    && lessonReminderThreshold > 0
    && lessonReminderThreshold < plannedLessonCount;
  const progressMarkerPercent = showProgressMarker
    ? Math.max(0, Math.min(100, Math.round(
      ((plannedLessonCount - lessonReminderThreshold) / plannedLessonCount) * 100
    )))
    : 0;
  let progressTone = plannedLessonCount > 0 ? "normal" : "unset";
  if (plannedLessonCount > 0 && remainingLessonCount === 0) progressTone = "complete";
  else if (
    plannedLessonCount > 0
    && lessonReminderThreshold > 0
    && remainingLessonCount <= lessonReminderThreshold
  ) progressTone = "near-end";

  return {
    plannedLessonCount,
    completedLessonCount,
    progressPercent,
    progressText: `${completedLessonCount} / ${plannedLessonCount}`,
    lessonPackageSize,
    remainingLessonCount,
    lessonReminderThreshold,
    showProgressMarker,
    progressMarkerPercent,
    progressTone,
  };
};

const parseDay = (day) => {
  const matched = String(day || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const date = Number(matched[3]);
  const serial = Date.UTC(year, month - 1, date);
  const check = new Date(serial);
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== date
  ) return null;
  return { year, month, date, serial };
};

const formatDay = (serial) => {
  const date = new Date(serial);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

const addDays = (day, count) => {
  const parsed = parseDay(day);
  if (!parsed) return "";
  return formatDay(parsed.serial + Number(count || 0) * DAY_MS);
};

const formatHongKongDay = (timestamp) => {
  const date = new Date(Number(timestamp) + HONG_KONG_OFFSET_MS);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

const getHomeworkDueDate = (lesson) => {
  if (!lesson || lesson.recordingTaskEnabled !== true) return "";
  const dueDays = Number(lesson.homeworkDueDays);
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > MAX_HOMEWORK_DUE_DAYS) return "";
  return addDays(lesson.lessonDate, dueDays);
};

const getHongKongDayEndMs = (day) => {
  const parsed = parseDay(day);
  if (!parsed) return 0;
  const startAtMs = parsed.serial - HONG_KONG_OFFSET_MS;
  return startAtMs + DAY_MS - 1;
};

const isLateHomeworkSubmission = (lesson, submittedAtMs) => {
  const dueDate = getHomeworkDueDate(lesson);
  const dueAtMs = getHongKongDayEndMs(dueDate);
  return Boolean(dueAtMs && Number(submittedAtMs || 0) > dueAtMs);
};

const buildHomeworkDeadlineState = (lesson, now = Date.now(), firstSubmittedAtMs) => {
  const homeworkDueDate = getHomeworkDueDate(lesson);
  const submittedAtMs = Number(
    firstSubmittedAtMs === undefined
      ? lesson && lesson.homeworkFirstSubmittedAtMs
      : firstSubmittedAtMs
  ) || 0;
  if (!homeworkDueDate) {
    return {
      homeworkDueDate: "",
      homeworkDueAtMs: 0,
      homeworkDueStatus: "none",
      homeworkDueLabel: "",
      homeworkHasSubmission: submittedAtMs > 0,
      homeworkSubmittedOnTime: false,
      homeworkSubmittedLate: false,
      homeworkSubmissionTimingLabel: "",
    };
  }

  const today = parseDay(formatHongKongDay(now));
  const due = parseDay(homeworkDueDate);
  const daysUntilDue = today && due ? Math.round((due.serial - today.serial) / DAY_MS) : 0;
  let homeworkDueStatus = "today";
  let homeworkDueLabel = "当天截止";
  if (daysUntilDue > 0) {
    homeworkDueStatus = "upcoming";
    homeworkDueLabel = `距截止还有 ${daysUntilDue} 天`;
  } else if (daysUntilDue < 0) {
    homeworkDueStatus = "overdue";
    homeworkDueLabel = `已逾期 ${Math.abs(daysUntilDue)} 天`;
  }
  const homeworkDueAtMs = getHongKongDayEndMs(homeworkDueDate);
  const homeworkHasSubmission = submittedAtMs > 0;
  const homeworkSubmittedLate = Boolean(submittedAtMs && submittedAtMs > homeworkDueAtMs);
  return {
    homeworkDueDate,
    homeworkDueAtMs,
    homeworkDueStatus,
    homeworkDueLabel,
    homeworkHasSubmission,
    homeworkSubmittedOnTime: homeworkHasSubmission && !homeworkSubmittedLate,
    homeworkSubmittedLate,
    homeworkSubmissionTimingLabel: homeworkSubmittedLate ? "逾期提交" : "",
  };
};

const getHomeworkListGroup = (lesson = {}, completed = false) => {
  if (completed) return HOMEWORK_LIST_GROUPS.completed;
  if (String(lesson.homeworkTeacherReviewStatus || "") === "incomplete") {
    return HOMEWORK_LIST_GROUPS.returned;
  }
  const hasSubmission = lesson.homeworkHasSubmission === true
    || Number(lesson.homeworkFirstSubmittedAtMs || 0) > 0;
  if (hasSubmission) return HOMEWORK_LIST_GROUPS.awaitingReview;
  const dueStatus = String(lesson.homeworkDueStatus || "none");
  if (dueStatus === "overdue") return HOMEWORK_LIST_GROUPS.overdue;
  if (dueStatus === "today") return HOMEWORK_LIST_GROUPS.today;
  if (dueStatus === "upcoming") return HOMEWORK_LIST_GROUPS.upcoming;
  return HOMEWORK_LIST_GROUPS.noDeadline;
};

const buildHomeworkListGrouping = ({ pendingLessons = [], completedLessons = [] } = {}) => {
  const groups = Object.keys(HOMEWORK_LIST_GROUPS).reduce((result, key) => {
    result[HOMEWORK_LIST_GROUPS[key]] = [];
    return result;
  }, {});
  const decoratedPendingLessons = (Array.isArray(pendingLessons) ? pendingLessons : []).map((lesson) => {
    const homeworkListGroup = getHomeworkListGroup(lesson, false);
    const decorated = Object.assign({}, lesson, { homeworkListGroup });
    groups[homeworkListGroup].push(decorated);
    return decorated;
  });
  const decoratedCompletedLessons = (Array.isArray(completedLessons) ? completedLessons : []).map((lesson) => {
    const decorated = Object.assign({}, lesson, {
      homeworkListGroup: HOMEWORK_LIST_GROUPS.completed,
    });
    groups[HOMEWORK_LIST_GROUPS.completed].push(decorated);
    return decorated;
  });
  const actionableCount = groups.returned.length
    + groups.overdue.length
    + groups.today.length
    + groups.upcoming.length
    + groups.noDeadline.length;
  return {
    pendingLessons: decoratedPendingLessons,
    completedLessons: decoratedCompletedLessons,
    groups,
    summary: {
      actionableCount,
      awaitingReviewCount: groups.awaitingReview.length,
      urgentCount: groups.returned.length + groups.overdue.length + groups.today.length,
      pendingCount: decoratedPendingLessons.length,
      completedCount: decoratedCompletedLessons.length,
      totalCount: decoratedPendingLessons.length + decoratedCompletedLessons.length,
    },
  };
};

module.exports = {
  DAY_MS,
  HOMEWORK_LIST_GROUPS,
  MAX_HOMEWORK_DUE_DAYS,
  addDays,
  buildHomeworkDeadlineState,
  buildHomeworkListGrouping,
  buildLessonProgress,
  formatHongKongDay,
  getDefaultLessonPackageSize,
  getHomeworkDueDate,
  getHongKongDayEndMs,
  getHomeworkListGroup,
  getLessonPackageSize,
  isLateHomeworkSubmission,
};
