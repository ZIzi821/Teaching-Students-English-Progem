const MINUTE_STEP = 5;
const EARLIEST_MINUTE = 9 * 60;
const LATEST_MINUTE = 23 * 60;
const WEEKDAY_LABELS = Object.freeze(["周一", "周二", "周三", "周四", "周五", "周六", "周日"]);
const STUDENT_COLOR_KEYS = Object.freeze([
  "sage",
  "rose",
  "sky",
  "violet",
  "amber",
  "mint",
  "coral",
  "indigo",
]);

const DEFAULT_WEEKLY_EVENTS = Object.freeze([
  {
    _id: "schedule_default_monash_ads1002",
    eventType: "fixed_class",
    weekday: 2,
    startMinute: 14 * 60,
    endMinute: 17 * 60,
    title: "ADS1002 Workshop",
    publicTitle: "MONASH · ADS1002 Workshop",
    note: "MONASH 课程",
    colorKey: "monash",
    source: "monash_seed",
  },
  {
    _id: "schedule_default_monash_fit1055",
    eventType: "fixed_class",
    weekday: 3,
    startMinute: 11 * 60,
    endMinute: 13 * 60,
    title: "FIT1055 Applied",
    publicTitle: "MONASH · FIT1055 Applied",
    note: "MONASH 课程",
    colorKey: "monash",
    source: "monash_seed",
  },
  {
    _id: "schedule_default_monash_fit1008",
    eventType: "fixed_class",
    weekday: 4,
    startMinute: 12 * 60,
    endMinute: 14 * 60,
    title: "FIT1008 Applied",
    publicTitle: "MONASH · FIT1008 Applied",
    note: "MONASH 课程",
    colorKey: "monash",
    source: "monash_seed",
  },
  {
    _id: "schedule_default_teacher_home",
    eventType: "teacher_busy",
    weekday: 2,
    startMinute: 17 * 60,
    endMinute: 18 * 60,
    title: "回家",
    publicTitle: "回家",
    note: "回家",
    colorKey: "teacher",
    source: "teacher_seed",
  },
]);

const DEFAULT_STUDENT_SCHEDULE_TEMPLATES = Object.freeze([
  { id: "molly-mon-1800", studentName: "Molly", weekday: 1, startMinute: 18 * 60, endMinute: 18 * 60 + 45 },
  { id: "molly-tue-2000", studentName: "Molly", weekday: 2, startMinute: 20 * 60, endMinute: 20 * 60 + 45 },
  { id: "molly-wed-1800", studentName: "Molly", weekday: 3, startMinute: 18 * 60, endMinute: 18 * 60 + 45 },
  { id: "molly-thu-1800", studentName: "Molly", weekday: 4, startMinute: 18 * 60, endMinute: 18 * 60 + 45 },
  { id: "molly-fri-1800", studentName: "Molly", weekday: 5, startMinute: 18 * 60, endMinute: 18 * 60 + 45 },
  { id: "fengjiawen-mon-2000", studentName: "冯嘉文", weekday: 1, startMinute: 20 * 60, endMinute: 20 * 60 + 40 },
  { id: "fengjiawen-wed-2000", studentName: "冯嘉文", weekday: 3, startMinute: 20 * 60, endMinute: 20 * 60 + 40 },
  { id: "fengjiawen-fri-2000", studentName: "冯嘉文", weekday: 5, startMinute: 20 * 60, endMinute: 20 * 60 + 40 },
]);

const pad2 = (value) => String(value).padStart(2, "0");

const formatMinute = (value) => {
  const minute = Math.max(0, Math.trunc(Number(value) || 0));
  return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
};

const parseTime = (value) => {
  const matched = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
};

const normalizeWeekday = (value) => {
  const weekday = Number(value);
  return Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 ? weekday : 0;
};

const normalizeClosedWeekdays = (values = []) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .map(normalizeWeekday)
    .filter(Boolean)
)).sort((left, right) => left - right);

const isWeekdayBookingOpen = (closedWeekdays, weekday) => {
  const safeWeekday = normalizeWeekday(weekday);
  return Boolean(safeWeekday && !normalizeClosedWeekdays(closedWeekdays).includes(safeWeekday));
};

const buildWeekdayAvailability = (closedWeekdays = []) => {
  const closed = new Set(normalizeClosedWeekdays(closedWeekdays));
  return WEEKDAY_LABELS.map((label, index) => ({
    weekday: index + 1,
    label,
    bookingOpen: !closed.has(index + 1),
    statusLabel: closed.has(index + 1) ? "暂停预约" : "开放预约",
  }));
};

const validateTimeRange = ({ weekday, startMinute, endMinute }) => {
  const safeWeekday = normalizeWeekday(weekday);
  const safeStart = Number(startMinute);
  const safeEnd = Number(endMinute);
  if (!safeWeekday) return { valid: false, message: "请选择周一到周日" };
  if (!Number.isInteger(safeStart) || !Number.isInteger(safeEnd)) {
    return { valid: false, message: "请填写完整的开始和结束时间" };
  }
  if (safeStart % MINUTE_STEP || safeEnd % MINUTE_STEP) {
    return { valid: false, message: "时间请按 5 分钟为单位填写" };
  }
  if (safeStart < EARLIEST_MINUTE || safeEnd > LATEST_MINUTE || safeEnd <= safeStart) {
    return { valid: false, message: "时间需在 09:00–23:00 内，且结束时间晚于开始时间" };
  }
  return {
    valid: true,
    weekday: safeWeekday,
    startMinute: safeStart,
    endMinute: safeEnd,
    durationMinutes: safeEnd - safeStart,
  };
};

const normalizeFixedStudentScheduleEntries = (entries = []) => {
  if (!Array.isArray(entries) || entries.length !== 7) {
    return { valid: false, message: "请完整设置周一到周日" };
  }
  const seenWeekdays = new Set();
  const normalized = [];
  for (let index = 0; index < entries.length; index += 1) {
    const source = entries[index] || {};
    const weekday = normalizeWeekday(source.weekday);
    if (!weekday || seenWeekdays.has(weekday) || typeof source.enabled !== "boolean") {
      return { valid: false, message: "每个星期只能设置一次" };
    }
    const range = validateTimeRange({
      weekday,
      startMinute: parseTime(source.startTime),
      endMinute: parseTime(source.endTime),
    });
    if (!range.valid) {
      return { valid: false, message: `${WEEKDAY_LABELS[weekday - 1]}：${range.message}` };
    }
    const eventId = String(source.eventId || "").trim();
    const expectedVersion = Number(source.expectedVersion) || 0;
    if (eventId && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
      return { valid: false, message: "固定课表信息已变化，请刷新后重试" };
    }
    seenWeekdays.add(weekday);
    normalized.push({
      ...range,
      enabled: source.enabled,
      eventId,
      expectedVersion,
    });
  }
  return {
    valid: true,
    entries: normalized.sort((left, right) => left.weekday - right.weekday),
  };
};

const rangesOverlap = (left, right) => (
  Number(left.startMinute) < Number(right.endMinute)
  && Number(right.startMinute) < Number(left.endMinute)
);

const getDefaultBookingDurationMinutes = (student = {}) => {
  const stored = Number(student.bookingDurationMinutes);
  if (Number.isInteger(stored) && stored >= 20 && stored <= 180 && stored % MINUTE_STEP === 0) {
    return stored;
  }
  const name = `${student.name || ""} ${student.nickname || ""}`.trim().toLowerCase();
  if (name.includes("molly")) return 45;
  if (name.includes("冯嘉文")) return 40;
  if (name.includes("徐浩成")) return 60;
  return 60;
};

const isStudentBookingEnabled = (student = {}) => Boolean(
  student && student._id && student.teacherHidden !== true
);

const isStudentLessonEvent = (event = {}) => (
  event.eventType === "lesson_booking" || event.eventType === "fixed_student_lesson"
);

const buildDefaultStudentScheduleEvents = (students = []) => {
  const studentByName = new Map();
  (students || []).filter(isStudentBookingEnabled).forEach((student) => {
    const name = String(student.name || student.nickname || "").trim().toLowerCase();
    if (name && !studentByName.has(name)) studentByName.set(name, student);
  });
  return DEFAULT_STUDENT_SCHEDULE_TEMPLATES.map((template) => {
    const student = studentByName.get(String(template.studentName || "").trim().toLowerCase());
    if (!student) return null;
    const name = student.name || student.nickname || template.studentName;
    return {
      _id: `schedule_fixed_${template.id}`,
      eventType: "fixed_student_lesson",
      fixedTemplateId: template.id,
      scheduleKind: "fixed_student",
      weekday: template.weekday,
      startMinute: template.startMinute,
      endMinute: template.endMinute,
      durationMinutes: template.endMinute - template.startMinute,
      title: `${name}英语课`,
      publicTitle: `${name}英语课`,
      note: "每周固定上课时间",
      studentId: student._id,
      studentNameSnapshot: name,
      colorKey: getStudentColorKey(student),
      source: "fixed_student_seed",
    };
  }).filter(Boolean);
};

const canManageScheduleEvent = ({
  actorRole,
  actorStudentId = "",
  mode = "",
  previewStudentId = "",
  event = {},
} = {}) => {
  if (actorRole === "teacher") {
    return mode !== "teacherPreview";
  }
  return false;
};

const hashString = (value) => {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

const getStudentColorKey = (student = {}) => {
  const stored = String(student.scheduleColorKey || "");
  if (STUDENT_COLOR_KEYS.includes(stored)) return stored;
  const seed = student._id || student.name || student.nickname || "student";
  return STUDENT_COLOR_KEYS[hashString(seed) % STUDENT_COLOR_KEYS.length];
};

const assignStudentColorKeys = (events = []) => {
  const studentIds = Array.from(new Set(
    events
      .filter((item) => item && isStudentLessonEvent(item) && item.studentId)
      .map((item) => String(item.studentId))
  )).sort();
  return new Map(studentIds.map((studentId, index) => [
    studentId,
    STUDENT_COLOR_KEYS[index % STUDENT_COLOR_KEYS.length],
  ]));
};

const buildBookingRange = (student, weekday, startTime) => {
  const startMinute = parseTime(startTime);
  const durationMinutes = getDefaultBookingDurationMinutes(student);
  return validateTimeRange({
    weekday,
    startMinute,
    endMinute: Number(startMinute) + durationMinutes,
  });
};

const sortEvents = (events = []) => events.slice().sort((left, right) => (
  Number(left.weekday) - Number(right.weekday)
  || Number(left.startMinute) - Number(right.startMinute)
  || Number(left.endMinute) - Number(right.endMinute)
  || String(left._id || "").localeCompare(String(right._id || ""))
));

const decorateEvent = (event = {}) => ({
  ...event,
  startTime: formatMinute(event.startMinute),
  endTime: formatMinute(event.endMinute),
  timeLabel: `${formatMinute(event.startMinute)}–${formatMinute(event.endMinute)}`,
  durationMinutes: Math.max(0, Number(event.endMinute) - Number(event.startMinute)),
});

const buildTeacherScheduleActivities = ({
  events = [],
  students = [],
  viewedThroughAtMs = 0,
  nowMs = Date.now(),
} = {}) => {
  const cutoffAtMs = Math.max(
    Math.max(0, Number(viewedThroughAtMs) || 0),
    Math.max(0, Number(nowMs) || Date.now()) - 30 * 24 * 60 * 60 * 1000
  );
  const studentById = new Map((students || []).map((student) => [String(student._id || ""), student]));
  return (events || []).map((event) => {
    if (!event || event.eventType !== "lesson_booking") return null;
    const createdAtMs = Math.max(0, Number(event.createdAtMs) || 0);
    const updatedAtMs = Math.max(0, Number(event.updatedAtMs) || 0);
    let activityType = "";
    let activityText = "";
    let activityAtMs = 0;
    if (event.status === "cancelled") {
      if (event.cancelledByRole !== "student") return null;
      activityType = "schedule_cancelled";
      activityText = "取消了每周上课预约";
      activityAtMs = Math.max(0, Number(event.cancelledAtMs) || updatedAtMs);
    } else if (event.editedByRole === "student" && updatedAtMs > createdAtMs) {
      activityType = "schedule_updated";
      activityText = "修改了每周上课预约";
      activityAtMs = updatedAtMs;
    } else if (event.createdByRole === "student") {
      activityType = "schedule_booking";
      activityText = "预约了每周上课时间";
      activityAtMs = createdAtMs;
    }
    if (!activityType || activityAtMs <= cutoffAtMs) return null;
    const weekday = normalizeWeekday(event.weekday);
    const student = studentById.get(String(event.studentId || ""));
    return {
      _id: `schedule:${event._id || event.clientRequestId || activityAtMs}:${activityType}:${activityAtMs}`,
      studentId: String(event.studentId || ""),
      studentName: String(student && (student.name || student.nickname) || event.studentNameSnapshot || "学生"),
      activityType,
      title: `${WEEKDAY_LABELS[weekday - 1] || "每周"} ${formatMinute(event.startMinute)}–${formatMinute(event.endMinute)}`,
      activityText,
      activityAtMs,
    };
  }).filter(Boolean).sort((left, right) => right.activityAtMs - left.activityAtMs);
};

module.exports = {
  DEFAULT_STUDENT_SCHEDULE_TEMPLATES,
  DEFAULT_WEEKLY_EVENTS,
  EARLIEST_MINUTE,
  LATEST_MINUTE,
  MINUTE_STEP,
  STUDENT_COLOR_KEYS,
  WEEKDAY_LABELS,
  assignStudentColorKeys,
  buildDefaultStudentScheduleEvents,
  buildBookingRange,
  buildTeacherScheduleActivities,
  buildWeekdayAvailability,
  canManageScheduleEvent,
  decorateEvent,
  formatMinute,
  getDefaultBookingDurationMinutes,
  isStudentBookingEnabled,
  isStudentLessonEvent,
  isWeekdayBookingOpen,
  getStudentColorKey,
  normalizeClosedWeekdays,
  normalizeFixedStudentScheduleEntries,
  normalizeWeekday,
  parseTime,
  rangesOverlap,
  sortEvents,
  validateTimeRange,
};
