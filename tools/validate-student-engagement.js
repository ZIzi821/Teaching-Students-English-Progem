const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const app = JSON.parse(read("miniprogram", "app.json"));
const backend = read("cloudfunctions", "quickstartFunctions", "index.js");
const engagementSource = read("cloudfunctions", "quickstartFunctions", "studentEngagement.js");
const engagementLogic = require(path.join(root, "cloudfunctions", "quickstartFunctions", "studentEngagement"));
const homeJs = read("miniprogram", "pages", "index", "index.js");
const homeWxml = read("miniprogram", "pages", "index", "index.wxml");
const homeWxss = read("miniprogram", "pages", "index", "index.wxss");
const detailJs = read("miniprogram", "pages", "student-detail", "index.js");
const detailWxml = read("miniprogram", "pages", "student-detail", "index.wxml");
const tabbarJs = read("miniprogram", "components", "student-tabbar", "index.js");
const tabbarWxml = read("miniprogram", "components", "student-tabbar", "index.wxml");
const achievementJs = read("miniprogram", "engagement", "pages", "achievements", "index.js");
const achievementWxml = read("miniprogram", "engagement", "pages", "achievements", "index.wxml");
const managerJs = read("miniprogram", "engagement", "pages", "manager", "index.js");
const managerWxml = read("miniprogram", "engagement", "pages", "manager", "index.wxml");
const workbenchJs = read("miniprogram", "pages", "teacher-workbench", "index.js");
const workbenchWxml = read("miniprogram", "pages", "teacher-workbench", "index.wxml");
const reminderJs = read("miniprogram", "engagement", "pages", "reminders", "index.js");
const reminderWxml = read("miniprogram", "engagement", "pages", "reminders", "index.wxml");

const engagementPackage = (app.subpackages || app.subPackages || [])
  .find((subpackage) => subpackage.root === "engagement");
assert(engagementPackage, "Student engagement subpackage is not registered");
assert(engagementPackage.pages.includes("pages/achievements/index"), "Achievement page is not registered");
assert(engagementPackage.pages.includes("pages/reminders/index"), "Teacher reminder page is not registered");
assert(engagementPackage.pages.includes("pages/manager/index"), "Teacher engagement manager is not registered");
assert.strictEqual(
  app.usingComponents && app.usingComponents["student-tabbar"],
  "/components/student-tabbar/index",
  "Student tab bar must be globally registered"
);
assert.strictEqual(
  app.usingComponents && app.usingComponents["ket-score-trend"],
  "/components/ket-score-trend/index",
  "KET score trend must be shared by the achievement and review surfaces"
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

["listStudentReminders", "saveStudentReminder", "withdrawStudentReminder", "getStudentEngagement", "getTeacherEngagementManager", "saveStudentPkEligibility", "savePkChallengeProfile", "deletePkChallengeProfile"].forEach((action) => {
  assert(backend.includes(`case "${action}"`), `Cloud action ${action} is missing`);
});
assert(backend.includes('"studentReminders"'), "studentReminders collection is not initialized");
assert(backend.includes('"pkChallengeProfiles"'), "pkChallengeProfiles collection is not initialized");
assert(backend.includes("studentEngagement.buildReminderActivities"), "Custom reminders are not merged into student dynamics");
assert(backend.includes('identity.role !== "student" || !identity.student'), "Teacher preview read-state protection changed unexpectedly");
assert(reminderJs.includes('type: "saveStudentReminder"'), "Teacher reminder editor cannot publish or edit");
assert(reminderJs.includes('type: "withdrawStudentReminder"'), "Teacher reminder editor cannot withdraw");
assert(reminderWxml.includes("微信订阅消息由课后任务页单独开启"), "Reminder UI must explain the subscription-message entry");
assert(detailJs.includes("goStudentReminders"), "Student management has no reminder entry handler");
assert(detailWxml.includes("给学生的动态提醒"), "Student management has no reminder entry");
assert(homeJs.includes("this.data.isTeacherPreview") && homeJs.includes("Promise.resolve()"), "Teacher preview must not persist student read state");
assert(homeWxml.includes('class="teacher-homework-dismiss" hover-class="notice-action-pressed"'), "Dismiss-all dynamics action is not visibly interactive");
assert(homeWxml.includes('class="teacher-homework-link" hover-class="notice-action-pressed"'), "Per-dynamic action is not visibly interactive");
assert(homeWxss.includes("background: #4f9275") && homeWxss.includes("border: 2rpx solid #4c8a70"), "Dynamic actions must keep the highlighted pill treatment");
assert(workbenchJs.includes("/engagement/pages/manager/index") && workbenchWxml.includes("成就与 PK 管理"), "Teacher workbench has no engagement manager entry");
assert(managerJs.includes('type: "saveStudentPkEligibility"'), "Teacher cannot control real-student PK participation");
assert(managerJs.includes('type: "savePkChallengeProfile"') && managerJs.includes('type: "deletePkChallengeProfile"'), "Teacher cannot manage challenge participants");
assert(managerWxml.includes("真实学生的 PK 分由本周可核验学习积分按 1:1 生成"), "Teacher manager does not explain the fair real-student score rule");
assert(managerWxml.includes("挑战选手") && achievementWxml.includes("挑战选手"), "Challenge participants are not clearly labelled on both sides");
assert(achievementWxml.includes("本周学习积分按 1:1 形成 PK 分"), "Student page does not explain the relationship between points and PK score");
assert(achievementWxml.includes("ket-score-trend") && engagementSource.includes("ketScoreTrend"), "Student achievements do not include the reviewed KET four-dimension trend");
assert(achievementWxml.includes("student.lessonTemplateKey === 'molly_oral_ket' || dashboard.ketScoreTrend.hasData"), "Students without KET learning or reviewed scores should not receive an irrelevant empty trend card");
assert(engagementLogic.buildAchievements({ recordedLessonCount: 40 }, {}).some((item) => item.id === "lesson_forty" && item.unlocked), "Forty-lesson achievement is missing");

assert.strictEqual(engagementLogic.POINT_RULES.vocabularyDailyCap, 30, "Vocabulary daily cap changed unexpectedly");
assert.strictEqual(engagementLogic.POINT_RULES.frenchDailyCap, 10, "French daily cap changed unexpectedly");
assert(engagementLogic.buildStudentScore && engagementLogic.buildEngagementDashboard, "Tested engagement aggregators are missing");
const emptyStudentDashboard = engagementLogic.buildEngagementDashboard({
  currentStudentId: "new-student",
  participants: [{ student: { _id: "new-student", name: "新学生", status: "在读" }, records: {} }],
});
assert(emptyStudentDashboard && emptyStudentDashboard.ketScoreTrend && !emptyStudentDashboard.ketScoreTrend.hasData, "New students without history must receive a stable empty dashboard and KET trend");

console.log("Student engagement validation passed: lesson milestones, teacher-managed opt-in PK, fair verified scores, labelled challenge participants, and read-only preview.");
