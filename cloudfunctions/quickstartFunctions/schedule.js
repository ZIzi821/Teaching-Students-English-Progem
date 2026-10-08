const MINUTE_STEP = 5;
const EARLIEST_MINUTE = 6 * 60;
const LATEST_MINUTE = 23 * 60;
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
    return { valid: false, message: "时间需在 06:00–23:00 内，且结束时间晚于开始时间" };
  }
  return {
    valid: true,
    weekday: safeWeekday,
    startMinute: safeStart,
    endMinute: safeEnd,
    durationMinutes: safeEnd - safeStart,
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
      .filter((item) => item && item.eventType === "lesson_booking" && item.studentId)
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

module.exports = {
  DEFAULT_WEEKLY_EVENTS,
  EARLIEST_MINUTE,
  LATEST_MINUTE,
  MINUTE_STEP,
  STUDENT_COLOR_KEYS,
  assignStudentColorKeys,
  buildBookingRange,
  decorateEvent,
  formatMinute,
  getDefaultBookingDurationMinutes,
  isStudentBookingEnabled,
  getStudentColorKey,
  normalizeWeekday,
  parseTime,
  rangesOverlap,
  sortEvents,
  validateTimeRange,
};
