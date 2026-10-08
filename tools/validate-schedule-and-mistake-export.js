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
const mistakeWorkflow = read("cloudfunctions/quickstartFunctions/mistakeExport.js");
const mistakeService = read("cloudfunctions/quickstartFunctions/mistakeExportService.js");
const mistakeDocx = read("cloudfunctions/quickstartFunctions/mistakeExportDocx.js");
const mistakeMarkdown = read("cloudfunctions/quickstartFunctions/mistakeExportMarkdown.js");
const mistakePageJs = read("miniprogram/mistake-export/pages/index/index.js");
const mistakePageWxml = read("miniprogram/mistake-export/pages/index/index.wxml");
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
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "Molly" }), 45);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "冯嘉文" }), 40);
assert.strictEqual(schedule.getDefaultBookingDurationMinutes({ name: "徐浩成" }), 60);
assert.strictEqual(schedule.isStudentBookingEnabled({ _id: "active-student" }), true);
assert.strictEqual(schedule.isStudentBookingEnabled({ _id: "hidden-student", teacherHidden: true }), false);
assert(scheduleService.includes("withoutDocumentId(source)"), "Schedule seeds must not write _id inside document data");
assert(mistakeService.includes("withoutDocumentId(current)"), "Mistake export updates must not write queried _id back into document data");
["getWeeklySchedule", "createScheduleBooking", "saveTeacherScheduleBlock", "updateScheduleEvent", "cancelScheduleEvent"].forEach((action) => {
  assert(backend.includes(`case "${action}"`), `Missing schedule cloud action: ${action}`);
});
assert(scheduleService.includes('title: "已有课程"'), "Other students' bookings are not privacy-masked");
assert(scheduleService.includes('source: identity.role === "teacher" ? "teacher_booking" : "parent"'), "Teacher proxy booking is missing");
assert(scheduleService.includes("canManageEvent") && scheduleService.includes("expectedVersion"), "Schedule edit permissions or optimistic concurrency are missing");
assert(scheduleService.includes("rangesOverlap"), "Schedule conflict detection is missing");
assert(schedulePageWxml.includes("每周上课日程"), "Schedule page heading is missing");
assert(schedulePageWxml.includes("帮学生预约") && schedulePageWxml.includes("保存修改"), "Teacher proxy booking or editable schedule UI is missing");
assert(schedulePageWxml.includes("item.dateLabel"), "Current-week month/day labels are missing");
const calendarDays = scheduleCalendar.buildWeekDays(new Date(2026, 9, 8, 12));
assert.strictEqual(calendarDays[3].fullLabel, "周四 · 10月8日", "Schedule current-week date calculation is incorrect");

["getMistakeExportWorkspace", "createMistakeExport"].forEach((action) => {
  assert(backend.includes(`case "${action}"`), `Missing mistake export cloud action: ${action}`);
});
assert(backend.includes('"mistakeExports"'), "Mistake export history collection is not registered");
assert.strictEqual(cloudPackage.dependencies.docx, "9.6.1", "DOCX dependency is missing or changed");
assert(mistakeWorkflow.includes("startLessonId") && mistakeWorkflow.includes("endLessonId"), "Export range is not based on stable lesson IDs");
assert((mistakeService.match(/await ensureTeacher\(\)/g) || []).length >= 2, "Mistake export endpoints are not teacher-only");
assert(mistakeWorkflow.includes("mistakeIds") && mistakeService.includes("includedLessonIds"), "Export history does not persist exact coverage IDs");
assert(mistakeService.includes('item.status === "ready"'), "Failed or generating exports can affect deduplication");
assert(mistakeService.includes("cloud.downloadFile") && mistakeService.includes("cloud.uploadFile"), "Export images or DOCX are not transferred through cloud storage");
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
