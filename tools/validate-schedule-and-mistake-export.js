const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const appJson = JSON.parse(read("miniprogram/app.json"));
const backend = read("cloudfunctions/quickstartFunctions/index.js");
const cloudPackage = JSON.parse(read("cloudfunctions/quickstartFunctions/package.json"));
const schedule = require(path.join(root, "cloudfunctions", "quickstartFunctions", "schedule"));
const scheduleService = read("cloudfunctions/quickstartFunctions/scheduleService.js");
const scheduleCalendar = require(path.join(root, "miniprogram", "utils", "scheduleCalendar"));
const schedulePageJs = read("miniprogram/schedule/pages/index/index.js");
const schedulePageWxml = read("miniprogram/schedule/pages/index/index.wxml");
const homePageJs = read("miniprogram/pages/index/index.js");
const homePageWxml = read("miniprogram/pages/index/index.wxml");
const mistakeWorkflow = read("cloudfunctions/quickstartFunctions/mistakeExport.js");
const mistakeService = read("cloudfunctions/quickstartFunctions/mistakeExportService.js");
const mistakeDocx = read("cloudfunctions/quickstartFunctions/mistakeExportDocx.js");
const mistakeMarkdown = read("cloudfunctions/quickstartFunctions/mistakeExportMarkdown.js");
const mistakePageJs = read("miniprogram/mistake-export/pages/index/index.js");
const mistakePageWxml = read("miniprogram/mistake-export/pages/index/index.wxml");
const addMistakeJs = read("miniprogram/pages/add-mistake/index.js");
const addMistakeWxml = read("miniprogram/pages/add-mistake/index.wxml");
const mistakeDetailWxml = read("miniprogram/pages/mistake-detail/index.wxml");
const batchMistakeJs = read("miniprogram/pages/batch-import-mistakes/index.js");
const batchMistakeWxml = read("miniprogram/pages/batch-import-mistakes/index.wxml");
const localMistakeServer = read("tools/local-mistake-importer/server.js");
const studentDetailJs = read("miniprogram/pages/student-detail/index.js");
const studentDetailWxml = read("miniprogram/pages/student-detail/index.wxml");
const lessonTemplates = require(path.join(root, "miniprogram", "utils", "lessonTemplates"));
const addLessonWxml = read("miniprogram/pages/add-lesson/index.wxml");
const lessonDetailWxml = read("miniprogram/pages/lesson-detail/index.wxml");

const findSubpackage = (name) => (appJson.subpackages || []).find((item) => item.name === name);
assert(findSubpackage("schedule"), "Schedule subpackage is not registered");
assert(findSubpackage("mistakeExport"), "Mistake export subpackage is not registered");

assert.deepStrictEqual(
  schedule.DEFAULT_WEEKLY_EVENTS.map((item) => `${item.weekday}:${item.startMinute}-${item.endMinute}`),
  ["2:840-1020", "3:660-780", "4:720-840", "2:1020-1080"],
  "Seeded Monash/home blocks changed unexpectedly"
);
assert.strictEqual(schedule.DEFAULT_STUDENT_SCHEDULE_TEMPLATES.length, 8, "Fixed student timetable must contain eight weekly lessons");
assert.deepStrictEqual(
  schedule.DEFAULT_STUDENT_SCHEDULE_TEMPLATES.map((item) => `${item.studentName}:${item.weekday}:${item.startMinute}-${item.endMinute}`),
  [
    "Molly:1:1080-1125", "Molly:2:1200-1245", "Molly:3:1080-1125", "Molly:4:1080-1125",
    "Molly:5:1080-1125", "冯嘉文:1:1200-1240", "冯嘉文:3:1200-1240", "冯嘉文:5:1200-1240",
  ],
  "Molly or Feng Jiawen fixed lesson times changed unexpectedly"
);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "Molly" }), 45);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "冯嘉文" }), 40);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "徐浩成" }), 60);
assert.strictEqual(schedule.EARLIEST_MINUTE, 9 * 60, "Schedule bookings must not start before 09:00");
assert.strictEqual(schedule.isStudentBookingEnabled({ _id: "active-student" }), true);
assert.strictEqual(schedule.isStudentBookingEnabled({ _id: "hidden-student", teacherHidden: true }), false);
assert(scheduleService.includes("withoutDocumentId(source)"), "Schedule seeds must not write _id inside document data");
assert(mistakeService.includes("withoutDocumentId(current)"), "Mistake export updates must not write queried _id back into document data");
["getWeeklySchedule", "createScheduleBooking", "saveTeacherScheduleBlock", "updateScheduleEvent", "cancelScheduleEvent", "setScheduleDayAvailability", "setFixedStudentScheduleEnabled", "saveFixedStudentSchedule"].forEach((action) => {
  assert(backend.includes(`case "${action}"`), `Missing schedule cloud action: ${action}`);
});
assert(
  scheduleService.includes(".filter((item) => schedule.isStudentLessonEvent(item)")
    && scheduleService.includes('String(item.studentId || "") === String(student._id || "")'),
  "Parent schedule must filter out every other student and teacher event"
);
assert(scheduleService.includes('source: "teacher_booking"'), "Teacher-created student schedule source is missing");
assert(scheduleService.includes("canManageEvent") && scheduleService.includes("expectedVersion"), "Schedule edit permissions or optimistic concurrency are missing");
assert(scheduleService.includes("rangesOverlap"), "Schedule conflict detection is missing");
assert(scheduleService.includes("SCHEDULE_AVAILABILITY_ID") && scheduleService.includes("enforceBookingOpen"), "Closed weekdays are not enforced atomically");
assert(scheduleService.includes('enforceBookingOpen: false'), "Teacher-created temporary lessons should remain available on legacy closed weekdays");
assert(scheduleService.includes("currentVersion !== expectedVersion"), "Schedule availability updates must reject stale versions");
assert(schedulePageWxml.includes("每周上课日程"), "Schedule page heading is missing");
assert(schedulePageWxml.includes("学生临时课程") && schedulePageWxml.includes("保存修改"), "Teacher temporary lesson or editable schedule UI is missing");
assert(schedulePageWxml.includes("家长看到的一样") && schedulePageWxml.includes("只显示当前孩子自己的课程"), "Parent and teacher-preview read-only copy is missing");
assert(!schedulePageWxml.includes("空白时段均可预约") && !schedulePageWxml.includes("预约上课"), "Parent schedule still suggests self-booking");
assert(
  schedulePageWxml.includes("长期固定上课时间")
    && schedulePageWxml.includes("openFixedScheduleForm")
    && schedulePageWxml.includes("onFixedScheduleDayToggle")
    && schedulePageWxml.includes("submitFixedStudentSchedule"),
  "Teacher per-student fixed timetable editor is missing"
);
assert(schedulePageJs.includes("buildFixedScheduleStudents") && schedulePageJs.includes('type: "saveFixedStudentSchedule"'), "Fixed timetable is not grouped by student or cannot be saved");
assert(scheduleService.includes("normalizeFixedStudentScheduleEntries") && scheduleService.includes("SCHEDULE_VERSION_CONFLICT"), "Fixed timetable validation or optimistic concurrency is missing");
assert(schedulePageWxml.includes("item.dateLabel"), "Current-week month/day labels are missing");
assert(schedulePageJs.includes("buildScheduleDays") && schedulePageJs.includes("TIMELINE_START_MINUTE = 9 * 60"), "Schedule does not use the rolling seven-day window or 09:00 timeline");
assert(schedulePageWxml.includes('start="09:00"') && schedulePageWxml.includes('start="09:05"'), "Schedule time pickers still allow pre-09:00 times");
assert(schedulePageWxml.includes("这一天没有安排课程"), "Read-only schedule empty state is misleading");
assert(backend.includes("buildTeacherScheduleActivities"), "Student schedule bookings are missing from teacher activities");
assert(homePageJs.includes('activityType.indexOf("schedule_")') && homePageWxml.includes("item.actionLabel"), "Teacher schedule activity navigation is missing");
const calendarDays = scheduleCalendar.buildScheduleDays(new Date(2026, 9, 9, 12));
assert.deepStrictEqual(calendarDays.map((item) => item.weekday), [4, 5, 6, 7, 1, 2, 3], "Schedule rolling-date window does not cross weeks correctly");
assert.strictEqual(calendarDays[1].fullLabel, "周五 · 10月9日", "Schedule rolling-date labels are incorrect");

["getMistakeExportWorkspace", "createMistakeExport"].forEach((action) => {
  assert(backend.includes(`case "${action}"`), `Missing mistake export cloud action: ${action}`);
});
assert(backend.includes('"mistakeExports"'), "Mistake export history collection is not registered");
assert.strictEqual(cloudPackage.dependencies.docx, "9.6.1", "DOCX dependency is missing or changed");
assert(mistakeWorkflow.includes("startLessonId") && mistakeWorkflow.includes("endLessonId"), "Export range is not based on stable lesson IDs");
assert((mistakeService.match(/await ensureTeacher\(\)/g) || []).length >= 2, "Mistake export endpoints are not teacher-only");
assert(mistakeWorkflow.includes("mistakeIds") && mistakeService.includes("includedLessonIds"), "Export history does not persist exact coverage IDs");
assert(mistakeService.includes('item.status === "ready"'), "Failed or generating exports can affect deduplication");
assert(mistakeService.includes("cloud.uploadFile") && !mistakeService.includes("downloadMistakeImages"), "Text-only export should upload documents without downloading mistake images");
assert(!mistakeDocx.includes("ImageRun") && !mistakeMarkdown.includes("questionImageFileId"), "Mistake exports still depend on removed question images");
assert(!backend.includes('case "checkUploadedImage"') && !backend.includes("english-mistake-images"), "Removed mistake-image cloud action or path still exists");
assert(!addMistakeJs.includes("chooseImage") && !addMistakeWxml.includes("题目图片"), "Direct mistake entry still uploads images");
assert(!mistakeDetailWxml.includes("questionImage") && !mistakeDetailWxml.includes("对应截图"), "Mistake detail still renders linked images");
assert(!batchMistakeJs.includes("chooseImages") && !batchMistakeJs.includes("sourceImageName") && !batchMistakeWxml.includes("选择题目截图"), "Batch mistake import still accepts images");
assert(!localMistakeServer.includes('pathname === "/api/image"'), "Local mistake importer still serves image data");
assert(mistakeDocx.includes("第一部分：错题题目") && mistakeDocx.includes("第二部分：答案与解析"), "DOCX does not separate questions from answers");
assert(mistakeMarkdown.includes("第一部分：错题题目") && mistakeMarkdown.includes("第二部分：答案与解析"), "Markdown does not separate questions from answers");
assert(mistakePageJs.includes("showMenu: true"), "Generated DOCX cannot be forwarded or saved from WeChat");
assert(mistakePageJs.includes("copyMarkdownFromPath") && mistakePageJs.includes("shareFileMessage"), "Markdown cannot be copied or forwarded");
assert(mistakePageJs.includes("排除以前已导出的错题（推荐）"), "Recommended precise deduplication choice is missing");
assert(studentDetailJs.includes("goMistakeExport") && studentDetailWxml.includes("导出错题汇总"), "Teacher student-detail entry is missing");

const coaching = lessonTemplates.findTemplate("vocabulary_coaching");
assert.strictEqual(coaching.requiresLessonNo, false, "Vocabulary coaching still requires a lesson number");
assert.strictEqual(coaching.showPostLessonRecord, false, "Vocabulary coaching still requires a post-lesson record");
assert(addLessonWxml.includes("本次上课时长（分钟）"), "New vocabulary coaching lessons cannot record minutes");
assert(lessonDetailWxml.includes("不生成课后整理"), "Vocabulary coaching edit flow does not explain the no-record rule");

[
  [schedulePageJs, schedulePageWxml, "schedule"],
  [mistakePageJs, mistakePageWxml, "mistake export"],
].forEach(([pageJs, pageWxml, label]) => {
  const handlers = Array.from(pageWxml.matchAll(/(?:bind|catch)(?:tap|input|change)="([A-Za-z0-9_]+)"/g))
    .map((match) => match[1]);
  handlers.forEach((handler) => {
    assert(new RegExp(`\\n\\s*${handler}\\s*\\(`).test(pageJs), `Missing ${label} handler: ${handler}`);
  });
});

console.log("schedule and mistake export validation passed");
