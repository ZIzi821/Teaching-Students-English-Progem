const assert = require("assert");
const schedule = require("../schedule");
const scheduleCalendar = require("../../../miniprogram/utils/scheduleCalendar");

assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "Molly" }), 45);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "冯嘉文" }), 40);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "徐浩成" }), 60);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "新学生", bookingDurationMinutes: 50 }), 50);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "徐浩成", bookingDurationMinutes: 55 }), 55);
assert.strictEqual(schedule.isStudentBookingEnabled({ _id: "xu", name: "徐浩成" }), true);
assert.strictEqual(schedule.isStudentBookingEnabled({ _id: "ren", name: "任轩楠", teacherHidden: true }), false);
assert.deepStrictEqual(schedule.normalizeClosedWeekdays([5, "2", 5, 0, 8]), [2, 5]);
assert.strictEqual(schedule.isWeekdayBookingOpen([2, 5], 2), false);
assert.strictEqual(schedule.isWeekdayBookingOpen([2, 5], 3), true);
assert.deepStrictEqual(
  schedule.buildWeekdayAvailability([5]).map((item) => item.bookingOpen),
  [true, true, true, true, false, true, true]
);
assert.strictEqual(schedule.canManageScheduleEvent({ actorRole: "teacher", event: { eventType: "teacher_busy" } }), true);
assert.strictEqual(schedule.canManageScheduleEvent({
  actorRole: "teacher",
  mode: "teacherPreview",
  previewStudentId: "molly",
  event: { eventType: "lesson_booking", studentId: "molly" },
}), false);
assert.strictEqual(schedule.canManageScheduleEvent({
  actorRole: "teacher",
  mode: "teacherPreview",
  previewStudentId: "molly",
  event: { eventType: "lesson_booking", studentId: "feng" },
}), false);
assert.strictEqual(schedule.canManageScheduleEvent({
  actorRole: "student",
  actorStudentId: "molly",
  event: { eventType: "lesson_booking", studentId: "molly" },
}), false);
assert.strictEqual(schedule.canManageScheduleEvent({
  actorRole: "student",
  actorStudentId: "molly",
  event: { eventType: "lesson_booking", studentId: "feng" },
}), false);

assert.deepStrictEqual(
  schedule.buildBookingRange({ name: "Molly" }, 1, "16:00"),
  { valid: true, weekday: 1, startMinute: 960, endMinute: 1005, durationMinutes: 45 }
);
assert.strictEqual(schedule.DEFAULT_STUDENT_SCHEDULE_TEMPLATES.length, 8);
assert.deepStrictEqual(
  schedule.DEFAULT_STUDENT_SCHEDULE_TEMPLATES.map((item) => `${item.studentName}:${item.weekday}:${item.startMinute}-${item.endMinute}`),
  [
    "Molly:1:1080-1125",
    "Molly:2:1200-1245",
    "Molly:3:1080-1125",
    "Molly:4:1080-1125",
    "Molly:5:1080-1125",
    "冯嘉文:1:1200-1240",
    "冯嘉文:3:1200-1240",
    "冯嘉文:5:1200-1240",
  ]
);
const fixedStudentEvents = schedule.buildDefaultStudentScheduleEvents([
  { _id: "molly", name: "Molly" },
  { _id: "feng", name: "冯嘉文" },
  { _id: "hidden", name: "任轩楠", teacherHidden: true },
]);
assert.strictEqual(fixedStudentEvents.length, 8);
assert(fixedStudentEvents.every((item) => item.eventType === "fixed_student_lesson"));
assert(fixedStudentEvents.every((item) => item.studentId === "molly" || item.studentId === "feng"));
assert.strictEqual(schedule.isStudentLessonEvent({ eventType: "fixed_student_lesson" }), true);
assert.strictEqual(schedule.isStudentLessonEvent({ eventType: "lesson_booking" }), true);
assert.strictEqual(schedule.buildBookingRange({ name: "冯嘉文" }, 2, "19:30").endMinute, 1210);
assert.strictEqual(schedule.buildBookingRange({ name: "徐浩成" }, 6, "20:00").endMinute, 1260);

assert.strictEqual(
  schedule.rangesOverlap(
    { startMinute: 17 * 60, endMinute: 17 * 60 + 45 },
    { startMinute: 17 * 60 + 40, endMinute: 18 * 60 + 20 }
  ),
  true,
  "partially overlapping lessons must conflict"
);
assert.strictEqual(
  schedule.rangesOverlap(
    { startMinute: 17 * 60, endMinute: 18 * 60 },
    { startMinute: 18 * 60, endMinute: 18 * 60 + 45 }
  ),
  false,
  "adjacent half-open time ranges must remain bookable"
);

assert.strictEqual(schedule.DEFAULT_WEEKLY_EVENTS.length, 4);
assert.deepStrictEqual(
  schedule.DEFAULT_WEEKLY_EVENTS.map((item) => `${item.weekday}:${item.startMinute}-${item.endMinute}`),
  ["2:840-1020", "3:660-780", "4:720-840", "2:1020-1080"]
);
assert.strictEqual(schedule.validateTimeRange({ weekday: 2, startMinute: 1001, endMinute: 1060 }).valid, false);
assert.strictEqual(schedule.validateTimeRange({ weekday: 2, startMinute: 1080, endMinute: 1080 }).valid, false);
assert.strictEqual(schedule.validateTimeRange({ weekday: 2, startMinute: 8 * 60 + 55, endMinute: 9 * 60 + 55 }).valid, false);
assert.strictEqual(schedule.validateTimeRange({ weekday: 2, startMinute: 9 * 60, endMinute: 9 * 60 + 5 }).valid, true);
const assignedColors = schedule.assignStudentColorKeys([
  { eventType: "fixed_student_lesson", studentId: "student-b" },
  { eventType: "lesson_booking", studentId: "student-a" },
  { eventType: "lesson_booking", studentId: "student-b" },
]);
assert.strictEqual(assignedColors.size, 2);
assert.notStrictEqual(assignedColors.get("student-a"), assignedColors.get("student-b"));

const activityNow = new Date(2026, 9, 8, 12, 0, 0).getTime();
const scheduleActivities = schedule.buildTeacherScheduleActivities({
  nowMs: activityNow,
  students: [{ _id: "molly", name: "Molly" }],
  events: [
    {
      _id: "booking-created",
      eventType: "lesson_booking",
      status: "active",
      studentId: "molly",
      studentNameSnapshot: "Molly",
      weekday: 5,
      startMinute: 16 * 60,
      endMinute: 16 * 60 + 45,
      createdByRole: "student",
      createdAtMs: activityNow - 1000,
      updatedAtMs: activityNow - 1000,
    },
    {
      _id: "booking-teacher",
      eventType: "lesson_booking",
      status: "active",
      studentId: "molly",
      weekday: 6,
      startMinute: 16 * 60,
      endMinute: 16 * 60 + 45,
      createdByRole: "teacher",
      createdAtMs: activityNow - 900,
    },
    {
      _id: "booking-updated",
      eventType: "lesson_booking",
      status: "active",
      studentId: "molly",
      weekday: 6,
      startMinute: 18 * 60,
      endMinute: 18 * 60 + 45,
      createdByRole: "student",
      createdAtMs: activityNow - 6000,
      editedByRole: "student",
      updatedAtMs: activityNow - 750,
    },
    {
      _id: "booking-cancelled",
      eventType: "lesson_booking",
      status: "cancelled",
      studentId: "molly",
      weekday: 7,
      startMinute: 10 * 60,
      endMinute: 10 * 60 + 45,
      createdByRole: "student",
      createdAtMs: activityNow - 5000,
      cancelledByRole: "student",
      cancelledAtMs: activityNow - 500,
      updatedAtMs: activityNow - 500,
    },
  ],
});
assert.deepStrictEqual(
  scheduleActivities.map((item) => item.activityType),
  ["schedule_cancelled", "schedule_updated", "schedule_booking"]
);
assert.strictEqual(scheduleActivities[2].studentName, "Molly");
assert.strictEqual(scheduleActivities[2].title, "周五 16:00–16:45");
assert.deepStrictEqual(
  schedule.buildTeacherScheduleActivities({
    nowMs: activityNow,
    viewedThroughAtMs: activityNow - 600,
    students: [{ _id: "molly", name: "Molly" }],
    events: [
      {
        _id: "already-viewed",
        eventType: "lesson_booking",
        status: "active",
        studentId: "molly",
        weekday: 5,
        startMinute: 960,
        endMinute: 1005,
        createdByRole: "student",
        createdAtMs: activityNow - 1000,
      },
    ],
  }),
  []
);

const fridayWindow = scheduleCalendar.buildScheduleDays(new Date(2026, 9, 9, 12, 0, 0));
assert.deepStrictEqual(
  fridayWindow.map((item) => item.dateLabel),
  ["10月8日", "10月9日", "10月10日", "10月11日", "10月12日", "10月13日", "10月14日"]
);
assert.deepStrictEqual(fridayWindow.map((item) => item.weekday), [4, 5, 6, 7, 1, 2, 3]);
assert.strictEqual(fridayWindow[0].isYesterday, true);
assert.strictEqual(fridayWindow[1].fullLabel, "周五 · 10月9日");
assert.strictEqual(fridayWindow[1].isToday, true);

console.log("schedule tests passed");
