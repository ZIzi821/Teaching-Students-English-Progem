const assert = require("assert");
const schedule = require("../schedule");

assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "Molly" }), 45);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "冯嘉文" }), 40);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "徐浩成" }), 60);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "新学生", bookingDurationMinutes: 50 }), 50);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "徐浩成", bookingDurationMinutes: 55 }), 55);
assert.strictEqual(schedule.isStudentBookingEnabled({ _id: "xu", name: "徐浩成" }), true);
assert.strictEqual(schedule.isStudentBookingEnabled({ _id: "ren", name: "任轩楠", teacherHidden: true }), false);

assert.deepStrictEqual(
  schedule.buildBookingRange({ name: "Molly" }, 1, "16:00"),
  { valid: true, weekday: 1, startMinute: 960, endMinute: 1005, durationMinutes: 45 }
);
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
const assignedColors = schedule.assignStudentColorKeys([
  { eventType: "lesson_booking", studentId: "student-b" },
  { eventType: "lesson_booking", studentId: "student-a" },
  { eventType: "lesson_booking", studentId: "student-b" },
]);
assert.strictEqual(assignedColors.size, 2);
assert.notStrictEqual(assignedColors.get("student-a"), assignedColors.get("student-b"));

console.log("schedule tests passed");
