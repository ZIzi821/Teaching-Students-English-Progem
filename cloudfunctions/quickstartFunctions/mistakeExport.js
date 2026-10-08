const EXPORT_SELECTION_MODES = Object.freeze(["all", "range"]);
const EXPORT_EXCLUDE_POLICIES = Object.freeze(["none", "exported_mistakes", "exported_lessons"]);

const getTimestamp = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.getTime === "function") return Number(value.getTime()) || 0;
  if (Number.isFinite(Number(value._seconds))) return Number(value._seconds) * 1000;
  if (Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  return 0;
};

const getCreatedTime = (item = {}) => (
  Number(item.createdAtMs)
  || getTimestamp(item.createdAt)
  || Number(item.updatedAtMs)
  || getTimestamp(item.updatedAt)
  || 0
);

const sortLessons = (lessons = []) => lessons.slice().sort((left, right) => (
  String(left.lessonDate || "").localeCompare(String(right.lessonDate || ""))
  || getCreatedTime(left) - getCreatedTime(right)
  || String(left._id || "").localeCompare(String(right._id || ""))
));

const resolveLessonSelection = (lessons = [], selection = {}) => {
  const sorted = sortLessons(lessons.filter((item) => item && item._id && item.deleting !== true));
  const mode = EXPORT_SELECTION_MODES.includes(selection.mode) ? selection.mode : "all";
  if (mode === "all") return { mode, lessons: sorted };
  const startLessonId = String(selection.startLessonId || "").trim();
  const endLessonId = String(selection.endLessonId || "").trim();
  const startIndex = sorted.findIndex((item) => item._id === startLessonId);
  const endIndex = sorted.findIndex((item) => item._id === endLessonId);
  if (startIndex < 0 || endIndex < 0) {
    const err = new Error("所选课程范围已经变化，请刷新后重新选择");
    err.code = "INVALID_EXPORT_RANGE";
    throw err;
  }
  if (startIndex > endIndex) {
    const err = new Error("起始课程不能晚于结束课程");
    err.code = "INVALID_EXPORT_RANGE";
    throw err;
  }
  return {
    mode,
    startLessonId,
    endLessonId,
    lessons: sorted.slice(startIndex, endIndex + 1),
  };
};

const getReadyHistory = (history = []) => history.filter((item) => (
  item && item.status === "ready"
));

const getExportedIdSets = (history = []) => {
  const lessonIds = new Set();
  const mistakeIds = new Set();
  getReadyHistory(history).forEach((item) => {
    (item.includedLessonIds || item.lessonIds || []).forEach((id) => lessonIds.add(String(id)));
    (item.mistakeIds || []).forEach((id) => mistakeIds.add(String(id)));
  });
  return { lessonIds, mistakeIds };
};

const buildExportPlan = ({ lessons = [], mistakes = [], history = [], selection = {}, excludePolicy = "none" }) => {
  const policy = EXPORT_EXCLUDE_POLICIES.includes(excludePolicy) ? excludePolicy : "none";
  const resolved = resolveLessonSelection(lessons, selection);
  const selectedLessonIds = resolved.lessons.map((item) => String(item._id));
  const selectedSet = new Set(selectedLessonIds);
  const exported = getExportedIdSets(history);
  const includedLessons = policy === "exported_lessons"
    ? resolved.lessons.filter((item) => !exported.lessonIds.has(String(item._id)))
    : resolved.lessons;
  const eligibleLessonIds = includedLessons.map((item) => String(item._id));
  const includedSet = new Set(eligibleLessonIds);
  const lessonOrder = new Map(eligibleLessonIds.map((id, index) => [id, index]));
  const selectedMistakes = mistakes.filter((item) => item && item._id && selectedSet.has(String(item.lessonId)));
  const eligibleMistakes = selectedMistakes.filter((item) => (
    includedSet.has(String(item.lessonId))
    && (policy !== "exported_mistakes" || !exported.mistakeIds.has(String(item._id)))
  ));
  eligibleMistakes.sort((left, right) => (
    Number(lessonOrder.get(String(left.lessonId))) - Number(lessonOrder.get(String(right.lessonId)))
    || getCreatedTime(left) - getCreatedTime(right)
    || String(left._id || "").localeCompare(String(right._id || ""))
  ));
  const exportedLessonSet = new Set(eligibleMistakes.map((item) => String(item.lessonId)));
  const exportedLessons = includedLessons.filter((item) => exportedLessonSet.has(String(item._id)));
  const includedLessonIds = exportedLessons.map((item) => String(item._id));
  return {
    selectionMode: resolved.mode,
    startLessonId: resolved.startLessonId || (resolved.lessons[0] && resolved.lessons[0]._id) || "",
    endLessonId: resolved.endLessonId || (resolved.lessons[resolved.lessons.length - 1] && resolved.lessons[resolved.lessons.length - 1]._id) || "",
    excludePolicy: policy,
    selectedLessonIds,
    eligibleLessonIds,
    includedLessonIds,
    lessons: exportedLessons,
    mistakes: eligibleMistakes,
    mistakeIds: eligibleMistakes.map((item) => String(item._id)),
    excludedLessonCount: resolved.lessons.length - includedLessons.length,
    excludedMistakeCount: selectedMistakes.length - eligibleMistakes.length,
  };
};

const formatLessonLabel = (lesson = {}) => {
  const details = [String(lesson.lessonDate || "").trim()];
  if (String(lesson.lessonNo || "").trim()) details.push(`第 ${String(lesson.lessonNo).trim()} 节`);
  if (Number(lesson.durationMinutes) > 0) details.push(`${Math.trunc(Number(lesson.durationMinutes))} 分钟`);
  const title = String(lesson.title || "英语课").trim();
  return `${details.filter(Boolean).join(" · ")}${details.some(Boolean) ? " · " : ""}${title}`;
};

module.exports = {
  EXPORT_EXCLUDE_POLICIES,
  EXPORT_SELECTION_MODES,
  buildExportPlan,
  formatLessonLabel,
  getCreatedTime,
  getExportedIdSets,
  resolveLessonSelection,
  sortLessons,
};
