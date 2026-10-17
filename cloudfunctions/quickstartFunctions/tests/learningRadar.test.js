const assert = require("assert");
const learningRadar = require("../learningRadar");

assert.deepStrictEqual(learningRadar.validatePlanConfiguration(), []);
assert.strictEqual(learningRadar.normalizeObservationStatus("暂未掌握"), "not_yet");
assert.strictEqual(learningRadar.normalizeObservationStatus("暂时不会"), "not_yet");

const emptyMolly = learningRadar.buildLearningRadar({
  student: { lessonTemplateKey: "molly_oral_ket" },
});
assert.strictEqual(emptyMolly.available, true);
assert.strictEqual(emptyMolly.lessonDurationMinutes, 45);
assert.strictEqual(emptyMolly.currentStage.stageId, "molly_stage_1");
assert.strictEqual(emptyMolly.evidenceSummary.assessedSkillCount, 0);
assert.strictEqual(emptyMolly.dimensions[0].score, null);
assert.strictEqual(emptyMolly.dimensions[0].state, "unassessed");
assert.strictEqual(emptyMolly.prepSuggestion.totalMinutes, 45);
assert(!Object.prototype.hasOwnProperty.call(emptyMolly.currentStage, "recommendedWeeks"));
assert(emptyMolly.skillCatalog.some((item) => item.skillId === "molly_s4_picture_story"));

const oneLesson = learningRadar.buildLearningRadar({
  student: { lessonTemplateKey: "molly_oral_ket" },
  lessons: [{
    _id: "lesson-1",
    lessonDate: "2026-10-01",
    learningObservations: [{
      skillId: "molly_s1_self_intro",
      content: "30 秒自我介绍",
      status: "独立完成",
    }],
  }],
});
const oneLessonSkill = oneLesson.skills.find((item) => item.skillId === "molly_s1_self_intro");
assert.strictEqual(oneLessonSkill.score, 100);
assert.strictEqual(oneLessonSkill.state, "insufficient");
assert.strictEqual(oneLessonSkill.teacherLessonCount, 1);

const twoLessons = learningRadar.buildLearningRadar({
  student: { lessonTemplateKey: "molly_oral_ket" },
  lessons: [
    {
      _id: "lesson-2",
      lessonDate: "2026-10-08",
      learningObservations: [{
        skillId: "molly_s1_self_intro",
        content: "30 秒自我介绍",
        status: "独立完成",
      }],
    },
    {
      _id: "lesson-1",
      lessonDate: "2026-10-01",
      learningObservations: [{
        skillId: "molly_s1_self_intro",
        content: "个人信息表达",
        status: "独立完成",
      }],
    },
  ],
});
const stableSkill = twoLessons.skills.find((item) => item.skillId === "molly_s1_self_intro");
assert.strictEqual(stableSkill.state, "stable");
assert.strictEqual(stableSkill.independentLessonCount, 2);

const repeatedDifficulty = learningRadar.buildLearningRadar({
  student: { lessonTemplateKey: "molly_oral_ket" },
  lessons: [
    {
      _id: "lesson-2",
      lessonDate: "2026-10-08",
      learningObservations: [{
        skillId: "molly_s1_be_have_like",
        content: "I am / I have / I like",
        status: "暂时不会",
      }],
    },
    {
      _id: "lesson-1",
      lessonDate: "2026-10-01",
      learningObservations: [{
        skillId: "molly_s1_be_have_like",
        content: "I am / I have / I like",
        status: "暂未掌握",
      }],
    },
  ],
});
const difficultSkill = repeatedDifficulty.skills.find((item) => item.skillId === "molly_s1_be_have_like");
assert.strictEqual(difficultSkill.latestTwoNotYet, true);
assert.strictEqual(difficultSkill.state, "priority");
assert(repeatedDifficulty.priorities[0].priorityScore >= 70);
assert.strictEqual(repeatedDifficulty.prepSuggestion.focusType, "grammar");
assert.strictEqual(repeatedDifficulty.prepSuggestion.totalMinutes, 45);

const mollyPlan = learningRadar.getPlanByKey("molly_oral_ket");
const mollyStageOne = mollyPlan.stages[0];
const coreSkillIds = mollyStageOne.skills.filter((item) => item.core).map((item) => item.skillId);
const readyMolly = learningRadar.buildLearningRadar({
  student: { lessonTemplateKey: "molly_oral_ket" },
  lessons: ["2026-10-08", "2026-10-01"].map((lessonDate, index) => ({
    _id: `ready-${index}`,
    lessonDate,
    learningObservations: coreSkillIds.map((skillId) => ({
      skillId,
      content: "阶段达标观察",
      status: "独立完成",
    })),
  })),
});
assert.strictEqual(readyMolly.stageReadiness.eligibleForTeacherConfirmation, true);
assert.strictEqual(readyMolly.stageReadiness.teacherConfirmationRequired, true);
assert.strictEqual(readyMolly.stageReadiness.nextStageId, "molly_stage_2");

const automatedOnly = learningRadar.buildLearningRadar({
  student: {
    lessonTemplateKey: "feng_beginner",
    learningPlan: { planKey: "feng_beginner", currentStageId: "feng_stage_2" },
  },
  quizSessions: [
    {
      _id: "quiz-1",
      completedAtMs: 100,
      results: [
        { questionType: "wordToMeaning", answerMode: "choice", correct: true },
        { questionType: "meaningToWord", answerMode: "choice", correct: true },
      ],
    },
    {
      _id: "quiz-2",
      completedAtMs: 200,
      results: [
        { questionType: "wordToMeaning", answerMode: "choice", correct: true },
        { questionType: "meaningToWord", answerMode: "choice", correct: true },
      ],
    },
  ],
});
const automatedSkill = automatedOnly.skills.find((item) => item.skillId === "feng_s2_listen_point");
assert.strictEqual(automatedSkill.score, 100);
assert.strictEqual(automatedSkill.state, "basic");
assert.strictEqual(automatedSkill.teacherLessonCount, 0);
assert.strictEqual(automatedOnly.stageReadiness.eligibleForTeacherConfirmation, false);
assert.strictEqual(automatedOnly.lessonDurationMinutes, 40);
assert.strictEqual(automatedOnly.prepSuggestion.totalMinutes, 40);
const inactiveDimension = automatedOnly.dimensions.find((item) => item.dimensionId === "foundation");
assert.strictEqual(inactiveDimension.active, false);
assert.strictEqual(inactiveDimension.score, null);
assert.strictEqual(inactiveDimension.state, "inactive");

const balancedMolly = learningRadar.buildLearningRadar({
  student: { lessonTemplateKey: "molly_oral_ket" },
  lessons: [
    { _id: "mix-1", lessonDate: "2026-10-10", lessonFocusType: "speaking" },
    { _id: "mix-2", lessonDate: "2026-10-09", lessonFocusType: "speaking" },
    { _id: "mix-3", lessonDate: "2026-10-08", lessonFocusType: "grammar" },
  ],
});
assert.strictEqual(balancedMolly.prepSuggestion.focusType, "input");

const changedStage = learningRadar.normalizeLearningPlan({
  lessonTemplateKey: "feng_beginner",
  learningPlan: {
    planKey: "feng_beginner",
    currentStageId: "feng_stage_4",
    teacherPinnedSkillIds: ["feng_s4_like_this", "unknown"],
  },
});
assert.strictEqual(changedStage.currentStageId, "feng_stage_4");
assert.deepStrictEqual(changedStage.teacherPinnedSkillIds, ["feng_s4_like_this"]);

const previousStageEvidence = learningRadar.buildLearningRadar({
  student: {
    lessonTemplateKey: "molly_oral_ket",
    learningPlan: { planKey: "molly_oral_ket", currentStageId: "molly_stage_2" },
  },
  lessons: [{
    _id: "old-stage-lesson",
    lessonDate: "2026-09-01",
    learningObservations: [{
      skillId: "molly_s1_self_intro",
      content: "第一阶段自我介绍",
      status: "独立完成",
    }],
  }],
});
assert.strictEqual(previousStageEvidence.evidenceSummary.assessedSkillCount, 0);
assert.strictEqual(previousStageEvidence.evidenceSummary.unlinkedObservationCount, 0);

console.log("learningRadar.test.js: passed");
