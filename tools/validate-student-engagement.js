const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const app = JSON.parse(read("miniprogram", "app.json"));
const backend = read("cloudfunctions", "quickstartFunctions", "index.js");
const engagementLogic = require(path.join(root, "cloudfunctions", "quickstartFunctions", "studentEngagement"));
const homeJs = read("miniprogram", "pages", "index", "index.js");
const homeWxml = read("miniprogram", "pages", "index", "index.wxml");
const detailJs = read("miniprogram", "pages", "student-detail", "index.js");
const detailWxml = read("miniprogram", "pages", "student-detail", "index.wxml");
const tabbarJs = read("miniprogram", "components", "student-tabbar", "index.js");
const tabbarWxml = read("miniprogram", "components", "student-tabbar", "index.wxml");
const achievementJs = read("miniprogram", "engagement", "pages", "achievements", "index.js");
const achievementWxml = read("miniprogram", "engagement", "pages", "achievements", "index.wxml");
const reminderJs = read("miniprogram", "engagement", "pages", "reminders", "index.js");
const reminderWxml = read("miniprogram", "engagement", "pages", "reminders", "index.wxml");

const engagementPackage = (app.subpackages || app.subPackages || [])
  .find((subpackage) => subpackage.root === "engagement");
assert(engagementPackage, "Student engagement subpackage is not registered");
assert(engagementPackage.pages.includes("pages/achievements/index"), "Achievement page is not registered");
assert(engagementPackage.pages.includes("pages/reminders/index"), "Teacher reminder page is not registered");
assert.strictEqual(
  app.usingComponents && app.usingComponents["student-tabbar"],
  "/components/student-tabbar/index",
  "Student tab bar must be globally registered"
);
assert(!app.tabBar, "Native tab bar would mix teacher and student identities");

["学习", "成就"].forEach((label) => assert(tabbarWxml.includes(label), `Student tab bar is missing ${label}`));
assert(tabbarJs.includes('achievements: "/engagement/pages/achievements/index"'), "Student tab bar does not route to achievements");
assert(tabbarJs.includes("mode=teacherPreview") && tabbarJs.includes("previewStudentId="), "Student tab bar does not preserve teacher preview identity");
assert(homeWxml.includes('<student-tabbar') && homeWxml.includes('wx:if="{{isStudent}}"'), "Student home does not render the student-only tab bar");
assert(homeWxml.includes('current="learning"'), "Student home does not highlight learning");
assert(achievementWxml.includes('current="achievements"'), "Achievement page does not highlight achievements");
assert(achievementWxml.includes("真实学生成就页"), "Teacher preview is not identified on achievements");
assert(achievementJs.includes('type: "getStudentEngagement"'), "Achievement page does not load protected engagement data");
assert(!achievementJs.includes("save") && !achievementJs.includes("claim"), "Achievement page must not expose a point-claim write path");

["listStudentReminders", "saveStudentReminder", "withdrawStudentReminder", "getStudentEngagement"].forEach((action) => {
  assert(backend.includes(`case "${action}"`), `Cloud action ${action} is missing`);
});
assert(backend.includes('"studentReminders"'), "studentReminders collection is not initialized");
assert(backend.includes("studentEngagement.buildReminderActivities"), "Custom reminders are not merged into student dynamics");
assert(backend.includes('identity.role !== "student" || !identity.student'), "Teacher preview read-state protection changed unexpectedly");
assert(reminderJs.includes('type: "saveStudentReminder"'), "Teacher reminder editor cannot publish or edit");
assert(reminderJs.includes('type: "withdrawStudentReminder"'), "Teacher reminder editor cannot withdraw");
assert(reminderWxml.includes("小程序内提醒，不是微信消息推送"), "Reminder UI must state the in-app-only boundary");
assert(detailJs.includes("goStudentReminders"), "Student management has no reminder entry handler");
assert(detailWxml.includes("给学生的动态提醒"), "Student management has no reminder entry");
assert(homeJs.includes("this.data.isTeacherPreview") && homeJs.includes("Promise.resolve()"), "Teacher preview must not persist student read state");

assert.strictEqual(engagementLogic.POINT_RULES.vocabularyDailyCap, 30, "Vocabulary daily cap changed unexpectedly");
assert.strictEqual(engagementLogic.POINT_RULES.frenchDailyCap, 10, "French daily cap changed unexpectedly");
assert(engagementLogic.buildStudentScore && engagementLogic.buildEngagementDashboard, "Tested engagement aggregators are missing");

console.log("Student engagement validation passed: teacher reminders, read-only preview, verified points, achievements, masked weekly PK, and two student tabs.");
