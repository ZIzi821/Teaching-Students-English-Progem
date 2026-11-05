const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const appConfig = JSON.parse(read("miniprogram/app.json"));
const plans = JSON.parse(read("cloudfunctions/quickstartFunctions/data/learning-plans.json"));
const learningRadar = require(path.join(root, "cloudfunctions/quickstartFunctions/learningRadar"));

assert.deepStrictEqual(learningRadar.validatePlanConfiguration(), []);

const insightsPackage = (appConfig.subpackages || []).find((item) => item.root === "insights");
assert(insightsPackage, "insights subpackage is missing");
assert(
  (insightsPackage.pages || []).includes("pages/learning-radar/index"),
  "learning radar page is missing from insights subpackage"
);

const mollyPlan = plans.plans.find((item) => item.planKey === "molly_oral_ket");
const fengPlan = plans.plans.find((item) => item.planKey === "feng_beginner");
assert(mollyPlan && mollyPlan.lessonDurationMinutes === 45, "Molly prep must use 45 minutes");
assert(fengPlan && fengPlan.lessonDurationMinutes === 40, "Feng prep must use 40 minutes");
assert.strictEqual(JSON.stringify(plans).includes("recommendedWeeks"), false, "fixed week counts must not be exposed");

const cloudIndex = read("cloudfunctions/quickstartFunctions/index.js");
assert(cloudIndex.includes('case "getStudentLearningRadar"'), "radar read API is missing");
assert(cloudIndex.includes('case "updateStudentLearningPlan"'), "learning plan update API is missing");
assert(cloudIndex.includes("confirmStageChange !== true"), "teacher stage confirmation guard is missing");

const detailPage = read("miniprogram/pages/student-detail/index.wxml");
assert(detailPage.includes("<learning-plan"), "student detail plan tab is missing");
assert(detailPage.includes("下节课建议"), "student detail prep summary is missing");

const radarPage = read("miniprogram/insights/pages/learning-radar/index.wxml");
assert(radarPage.includes("<learning-plan"), "legacy radar route must render the shared learning plan");
const planMarkup = read("miniprogram/components/learning-plan/index.wxml");
assert(read("miniprogram/components/learning-plan/index.js").includes("还没观察"), "unobserved skills must be shown without a score");
assert(planMarkup.includes("阶段切换由老师结合达标建议确认"), "teacher confirmation notice is missing");
assert(!planMarkup.includes("总周数"), "fixed total weeks must not be displayed");
assert(!/priorityScore|coveragePercent|confidenceLabel/.test(planMarkup), "internal radar scores must stay out of the teacher view");

const lessonDetail = read("miniprogram/pages/lesson-detail/index.js");
assert(lessonDetail.includes('"暂时不会"'), "child-safe observation label is missing");
assert(lessonDetail.includes("onObservationSkillChange"), "structured skill observation editor is missing");

console.log("validate-learning-radar.js: passed");
