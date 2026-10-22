const LEARNING_PLAN_CONFIG = require("./data/learning-plans.json");

const STATUS_DEFINITIONS = Object.freeze({
  independent: { score: 100, label: "独立完成" },
  prompted: { score: 60, label: "提示后完成" },
  not_yet: { score: 20, label: "暂时不会" },
});
const STATUS_ALIASES = Object.freeze({
  independent: "independent",
  prompted: "prompted",
  not_yet: "not_yet",
  "独立完成": "independent",
  "提示后完成": "prompted",
  "暂时不会": "not_yet",
  "暂未掌握": "not_yet",
});
const SOURCE_WEIGHTS = Object.freeze({
  teacher_observation: 1,
  ket_assessment: 0.9,
  recording_feedback: 0.85,
  quiz_input: 0.8,
  mistake_review: 0.55,
  quiz_choice: 0.55,
});
const RECENCY_WEIGHTS = Object.freeze([1, 0.8, 0.6, 0.4]);
const SKILL_STATE_META = Object.freeze({
  stable: { label: "稳定独立", tone: "stable" },
  basic: { label: "基本掌握", tone: "basic" },
  consolidating: { label: "继续巩固", tone: "consolidating" },
  priority: { label: "优先复习", tone: "priority" },
  insufficient: { label: "证据不足", tone: "insufficient" },
  unassessed: { label: "待观察", tone: "unassessed" },
  inactive: { label: "本阶段未启用", tone: "inactive" },
});
const FOCUS_LABELS = Object.freeze({
  speaking: "口语表达",
  grammar: "语法运用",
  input: "听读与表达",
  ket: "KET 基础与复习",
  foundation: "字母、数字与书写",
  vocabulary: "主题词汇与听辨",
  phonics: "拼读与认词",
  oral: "句型口语",
  reading: "短阅读与衔接",
});

const asText = (value) => String(value || "").trim();
const roundScore = (value) => Math.round(Number(value || 0));
const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const unique = (items) => Array.from(new Set((items || []).filter(Boolean)));

const normalizeObservationStatus = (value) => STATUS_ALIASES[asText(value)] || "prompted";

const getPlans = () => LEARNING_PLAN_CONFIG.plans || [];

const getPlanByKey = (planKey) => getPlans().find((plan) => plan.planKey === asText(planKey)) || null;

const getPlanByTemplateKey = (templateKey) => (
  getPlans().find((plan) => plan.templateKey === asText(templateKey)) || null
);

const getPlanForStudent = (student = {}) => {
  const templatePlan = getPlanByTemplateKey(student.lessonTemplateKey);
  const savedPlan = getPlanByKey(student.learningPlan && student.learningPlan.planKey);
  if (templatePlan) return templatePlan;
  if (!asText(student.lessonTemplateKey) && savedPlan) return savedPlan;
  return null;
};

const getAllSkills = (plan) => (plan && plan.stages || []).reduce((result, stage) => (
  result.concat((stage.skills || []).map((skill) => Object.assign({}, skill, {
    stageId: stage.stageId,
    stageLabel: stage.stageLabel,
    stageTitle: stage.stageTitle,
  })))
), []);

const normalizeLearningPlan = (student = {}, plan = getPlanForStudent(student)) => {
  if (!plan) return null;
  const source = student.learningPlan && typeof student.learningPlan === "object"
    ? student.learningPlan
    : {};
  const validStageIds = (plan.stages || []).map((stage) => stage.stageId);
  const allSkillIds = new Set(getAllSkills(plan).map((skill) => skill.skillId));
  const currentStageId = validStageIds.includes(source.currentStageId)
    ? source.currentStageId
    : validStageIds[0];
  const teacherPinnedSkillIds = unique(source.teacherPinnedSkillIds)
    .filter((skillId) => allSkillIds.has(skillId))
    .slice(0, 12);
  const stageHistory = (Array.isArray(source.stageHistory) ? source.stageHistory : [])
    .slice(-20)
    .map((item) => ({
      fromStageId: asText(item && item.fromStageId),
      toStageId: asText(item && item.toStageId),
      changedAtMs: Math.max(0, Number(item && item.changedAtMs) || 0),
    }))
    .filter((item) => validStageIds.includes(item.toStageId));
  return {
    planKey: plan.planKey,
    planVersion: LEARNING_PLAN_CONFIG.version,
    currentStageId,
    stageStartedAtMs: Math.max(0, Number(source.stageStartedAtMs) || 0),
    teacherPinnedSkillIds,
    stageHistory,
  };
};

const getDocumentTime = (document = {}) => {
  const numericCandidates = [
    document.reviewedAtMs,
    document.completedAtMs,
    document.submittedAtMs,
    document.createdAtMs,
    document.updatedAtMs,
    document.startedAtMs,
  ];
  for (const candidate of numericCandidates) {
    const value = Number(candidate || 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const lessonDay = asText(document.lessonDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(lessonDay)) {
    const parsed = Date.parse(`${lessonDay}T12:00:00+08:00`);
    if (Number.isFinite(parsed)) return parsed;
  }
  const createdAt = document.createdAt;
  if (createdAt && typeof createdAt.getTime === "function") return createdAt.getTime();
  if (createdAt && Number.isFinite(Number(createdAt.$date))) return Number(createdAt.$date);
  return 0;
};

const getStageContext = (student) => {
  const plan = getPlanForStudent(student);
  if (!plan) return null;
  const learningPlan = normalizeLearningPlan(student, plan);
  const stageIndex = Math.max(0, plan.stages.findIndex((stage) => stage.stageId === learningPlan.currentStageId));
  const stage = plan.stages[stageIndex] || plan.stages[0];
  const dimensionById = new Map((plan.dimensions || []).map((dimension) => [dimension.dimensionId, dimension]));
  const skills = (stage.skills || []).map((skill) => Object.assign({}, skill, {
    dimensionLabel: (dimensionById.get(skill.dimensionId) || {}).label || skill.dimensionId,
  }));
  return {
    plan,
    learningPlan,
    stage,
    stageIndex,
    nextStage: plan.stages[stageIndex + 1] || null,
    skills,
    skillById: new Map(skills.map((skill) => [skill.skillId, skill])),
    allSkillIds: new Set(getAllSkills(plan).map((skill) => skill.skillId)),
  };
};

const canUseEvidenceMode = (skill, mode) => (
  !Array.isArray(skill.evidenceModes) || skill.evidenceModes.includes(mode)
);

const collectEvidence = (context, sources = {}) => {
  const evidenceBySkillId = new Map(context.skills.map((skill) => [skill.skillId, []]));
  let unlinkedObservationCount = 0;
  const addEvidence = (skillId, item) => {
    const skill = context.skillById.get(skillId);
    if (!skill || !canUseEvidenceMode(skill, item.sourceType)) return;
    evidenceBySkillId.get(skillId).push(Object.assign({}, item, {
      value: clampScore(item.value),
      sourceWeight: SOURCE_WEIGHTS[item.sourceType] || 0.5,
    }));
  };

  (Array.isArray(sources.lessons) ? sources.lessons : []).forEach((lesson, lessonIndex) => {
    const lessonTime = getDocumentTime(lesson) || (Date.now() - lessonIndex);
    const lessonId = asText(lesson._id) || `lesson:${asText(lesson.lessonDate) || lessonIndex}`;
    (Array.isArray(lesson.learningObservations) ? lesson.learningObservations : []).forEach((observation) => {
      const skillId = asText(observation && observation.skillId);
      if (!skillId || !context.allSkillIds.has(skillId)) {
        if (asText(observation && observation.content)) unlinkedObservationCount += 1;
        return;
      }
      if (!context.skillById.has(skillId)) return;
      const statusCode = normalizeObservationStatus(observation.status);
      addEvidence(skillId, {
        sourceType: "teacher_observation",
        sourceLabel: "课堂结构化观察",
        value: STATUS_DEFINITIONS[statusCode].score,
        statusCode,
        statusLabel: STATUS_DEFINITIONS[statusCode].label,
        isTeacherObservation: true,
        isIndependent: statusCode === "independent",
        isNotYet: statusCode === "not_yet",
        occasionId: lessonId,
        occurredAt: lessonTime,
        lessonDate: asText(lesson.lessonDate),
        note: asText(observation.note || observation.content),
      });
    });
  });

  (Array.isArray(sources.ketSessions) ? sources.ketSessions : []).forEach((session, sessionIndex) => {
    if (session.status !== "reviewed" || !session.assessment) return;
    const assessment = session.assessment;
    const numeric = (field) => {
      const value = Number(assessment[field]);
      return Number.isFinite(value) ? value : null;
    };
    const average = (values) => {
      const usable = values.filter((value) => value !== null);
      return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
    };
    const byDimension = {
      grammar_application: average([numeric("grammarVocabulary")]),
      pronunciation_interaction: average([numeric("pronunciation"), numeric("interactiveCommunication")]),
      oral_output: average([numeric("interactiveCommunication"), numeric("globalAchievement")]),
      ket_task: average([
        numeric("grammarVocabulary"),
        numeric("pronunciation"),
        numeric("interactiveCommunication"),
        numeric("globalAchievement"),
      ]),
    };
    context.skills.forEach((skill) => {
      const score = byDimension[skill.dimensionId];
      if (score === null || score === undefined) return;
      addEvidence(skill.skillId, {
        sourceType: "ket_assessment",
        sourceLabel: "KET 教师评分",
        value: score * 20,
        occasionId: asText(session.lessonId) || asText(session._id) || `ket:${sessionIndex}`,
        occurredAt: getDocumentTime(session),
        note: asText(assessment.nextFocus || assessment.comment),
      });
    });
  });

  (Array.isArray(sources.quizSessions) ? sources.quizSessions : []).forEach((session, sessionIndex) => {
    const results = Array.isArray(session.results) ? session.results : [];
    const isInputResult = (item) => item && (
      item.answerMode === "input" || ["letterGap", "spelling"].includes(item.questionType)
    );
    const groups = {
      quiz_choice: results.filter((item) => item && !isInputResult(item) && (
        item.answerMode === "choice" || ["wordToMeaning", "meaningToWord"].includes(item.questionType)
      )),
      quiz_input: results.filter(isInputResult),
    };
    Object.keys(groups).forEach((mode) => {
      const answers = groups[mode];
      if (!answers.length) return;
      const score = answers.filter((item) => item.correct === true).length / answers.length * 100;
      context.skills.forEach((skill) => {
        addEvidence(skill.skillId, {
          sourceType: mode,
          sourceLabel: mode === "quiz_input" ? "输入与拼写练习" : "选择与配对练习",
          value: score,
          occasionId: `quiz:${asText(session._id) || session.completedAtMs || sessionIndex}:${mode}`,
          occurredAt: getDocumentTime(session),
          note: `${answers.length} 题，正确 ${answers.filter((item) => item.correct === true).length} 题`,
        });
      });
    });
  });

  (Array.isArray(sources.submissions) ? sources.submissions : []).forEach((submission, submissionIndex) => {
    if (!["朗读正确", "需要重录"].includes(submission.status)) return;
    context.skills.forEach((skill) => {
      addEvidence(skill.skillId, {
        sourceType: "recording_feedback",
        sourceLabel: "录音教师反馈",
        value: submission.status === "朗读正确" ? 100 : 20,
        occasionId: asText(submission.lessonId) || asText(submission._id) || `recording:${submissionIndex}`,
        occurredAt: getDocumentTime(submission),
        note: asText(submission.teacherFeedbackNote || submission.teacherFeedback),
      });
    });
  });

  (Array.isArray(sources.mistakes) ? sources.mistakes : []).forEach((mistake, mistakeIndex) => {
    const skillId = asText(mistake.learningSkillId || mistake.skillId);
    if (!context.skillById.has(skillId)) return;
    const reviewStatus = asText(mistake.reviewStatus || mistake.status);
    addEvidence(skillId, {
      sourceType: "mistake_review",
      sourceLabel: "错题复习",
      value: reviewStatus === "已掌握" ? 100 : reviewStatus === "已复习" ? 60 : 20,
      occasionId: asText(mistake.lessonId) || asText(mistake._id) || `mistake:${mistakeIndex}`,
      occurredAt: getDocumentTime(mistake),
      note: asText(mistake.analysis || mistake.questionText),
    });
  });

  return { evidenceBySkillId, unlinkedObservationCount };
};

const summarizeOccasions = (events) => {
  const grouped = new Map();
  events.forEach((event, index) => {
    const key = event.occasionId || `evidence:${index}`;
    const current = grouped.get(key) || {
      occasionId: key,
      occurredAt: 0,
      lessonDate: "",
      weightedScore: 0,
      totalWeight: 0,
      sources: [],
      hasTeacherObservation: false,
      isIndependent: false,
      isNotYet: false,
    };
    current.occurredAt = Math.max(current.occurredAt, Number(event.occurredAt || 0));
    current.lessonDate = event.lessonDate || current.lessonDate;
    current.weightedScore += event.value * event.sourceWeight;
    current.totalWeight += event.sourceWeight;
    current.sources.push(event.sourceLabel);
    current.hasTeacherObservation = current.hasTeacherObservation || event.isTeacherObservation === true;
    current.isIndependent = current.isIndependent || event.isIndependent === true;
    current.isNotYet = current.isNotYet || event.isNotYet === true;
    grouped.set(key, current);
  });
  return Array.from(grouped.values())
    .map((occasion) => Object.assign({}, occasion, {
      score: occasion.totalWeight ? occasion.weightedScore / occasion.totalWeight : 0,
      sources: unique(occasion.sources),
    }))
    .sort((left, right) => right.occurredAt - left.occurredAt);
};

const determineSkillState = ({ evidenceCount, score, independentLessonCount, latestTwoNotYet }) => {
  if (!evidenceCount) return "unassessed";
  if (evidenceCount < 2) return "insufficient";
  if (latestTwoNotYet || score < 45) return "priority";
  if (score >= 85 && independentLessonCount >= 2) return "stable";
  if (score >= 70) return "basic";
  return "consolidating";
};

const buildSkillMetrics = (context, evidenceBySkillId) => context.skills.map((skill) => {
  const events = (evidenceBySkillId.get(skill.skillId) || [])
    .slice()
    .sort((left, right) => right.occurredAt - left.occurredAt);
  const occasions = summarizeOccasions(events).slice(0, RECENCY_WEIGHTS.length);
  let numerator = 0;
  let denominator = 0;
  occasions.forEach((occasion, index) => {
    const weight = RECENCY_WEIGHTS[index];
    numerator += occasion.score * weight;
    denominator += weight;
  });
  const score = denominator ? roundScore(numerator / denominator) : null;
  const teacherOccasions = occasions.filter((occasion) => occasion.hasTeacherObservation);
  const teacherLessonCount = teacherOccasions.length;
  const independentLessonCount = teacherOccasions.filter((occasion) => occasion.isIndependent).length;
  const latestTeacherOccasions = teacherOccasions.slice(0, 2);
  const latestTwoNotYet = latestTeacherOccasions.length === 2
    && latestTeacherOccasions.every((occasion) => occasion.isNotYet && !occasion.isIndependent);
  const state = determineSkillState({
    evidenceCount: occasions.length,
    score,
    independentLessonCount,
    latestTwoNotYet,
  });
  const latestTeacherEvent = events.find((event) => event.isTeacherObservation);
  const confidence = teacherLessonCount >= 2
    ? "high"
    : occasions.length >= 2 ? "medium" : occasions.length ? "low" : "none";
  return Object.assign({}, skill, {
    score,
    barPercent: score === null ? 0 : Math.max(4, score),
    state,
    stateLabel: SKILL_STATE_META[state].label,
    stateTone: SKILL_STATE_META[state].tone,
    evidenceCount: occasions.length,
    teacherLessonCount,
    independentLessonCount,
    latestTwoNotYet,
    confidence,
    confidenceLabel: confidence === "high" ? "课堂证据充分" : confidence === "medium" ? "已有多次证据" : confidence === "low" ? "仅 1 次证据" : "尚未观察",
    lastObservedAtMs: occasions.length ? occasions[0].occurredAt : 0,
    lastTeacherStatusCode: latestTeacherEvent ? latestTeacherEvent.statusCode : "",
    lastTeacherStatusLabel: latestTeacherEvent ? latestTeacherEvent.statusLabel : "",
    recentEvidence: occasions.map((occasion) => ({
      occasionId: occasion.occasionId,
      occurredAt: occasion.occurredAt,
      lessonDate: occasion.lessonDate,
      score: roundScore(occasion.score),
      sources: occasion.sources,
    })),
  });
});

const getAggregateState = (score, assessedCount, hasPriority) => {
  if (!assessedCount) return "unassessed";
  if (hasPriority || score < 45) return "priority";
  if (score >= 85) return "stable";
  if (score >= 70) return "basic";
  return "consolidating";
};

const buildDimensions = (context, skillMetrics) => (context.plan.dimensions || []).map((dimension) => {
  const dimensionSkills = skillMetrics.filter((skill) => skill.dimensionId === dimension.dimensionId);
  const assessed = dimensionSkills.filter((skill) => skill.score !== null);
  const totalWeight = assessed.reduce((sum, skill) => sum + Number(skill.weight || 1), 0);
  const score = totalWeight
    ? roundScore(assessed.reduce((sum, skill) => sum + skill.score * Number(skill.weight || 1), 0) / totalWeight)
    : null;
  const hasPriority = dimensionSkills.some((skill) => skill.core && skill.state === "priority");
  const state = dimensionSkills.length
    ? getAggregateState(score, assessed.length, hasPriority)
    : "inactive";
  return Object.assign({}, dimension, {
    active: dimensionSkills.length > 0,
    score,
    barPercent: score === null ? 0 : Math.max(4, score),
    state,
    stateLabel: SKILL_STATE_META[state].label,
    stateTone: SKILL_STATE_META[state].tone,
    assessedSkillCount: assessed.length,
    totalSkillCount: dimensionSkills.length,
    evidenceCount: dimensionSkills.reduce((sum, skill) => sum + skill.evidenceCount, 0),
    coverageLabel: !dimensionSkills.length
      ? "当前阶段暂不安排这一维度"
      : assessed.length ? `${assessed.length}/${dimensionSkills.length} 项已有证据` : "尚未记录本阶段证据",
    skills: dimensionSkills,
  });
});

const buildPriorities = (skillMetrics, learningPlan, lessons = []) => {
  const pinned = new Set(learningPlan.teacherPinnedSkillIds || []);
  const lessonOrder = (Array.isArray(lessons) ? lessons : [])
    .slice()
    .sort((left, right) => getDocumentTime(right) - getDocumentTime(left));
  const lessonRankById = new Map(lessonOrder.map((lesson, index) => [asText(lesson._id), index]));
  return skillMetrics.map((skill) => {
    if (skill.score === null || (skill.state === "stable" && !pinned.has(skill.skillId))) return null;
    const masteryGap = Math.min(40, Math.max(0, roundScore((100 - skill.score) * 0.4)));
    const repeatedDifficulty = skill.latestTwoNotYet ? 25 : skill.state === "priority" ? 15 : 0;
    const coreWeight = skill.core ? 15 : 0;
    const lastLessonId = skill.recentEvidence.length ? skill.recentEvidence[0].occasionId : "";
    const lessonsSincePractice = lessonRankById.has(lastLessonId) ? lessonRankById.get(lastLessonId) : 0;
    const staleWeight = lessonsSincePractice >= 5 ? 10 : lessonsSincePractice >= 3 ? 5 : 0;
    const transferGap = skill.teacherLessonCount === 0 && skill.evidenceCount >= 2 ? 10 : 0;
    const pinWeight = pinned.has(skill.skillId) ? 10 : 0;
    const priorityScore = Math.min(100, masteryGap + repeatedDifficulty + coreWeight + staleWeight + transferGap + pinWeight);
    const reasons = [];
    if (pinned.has(skill.skillId)) reasons.push("老师已设为重点");
    if (skill.latestTwoNotYet) reasons.push("最近两次课堂仍需重新建立");
    else if (skill.state === "priority") reasons.push("当前掌握度偏低");
    else if (skill.state === "consolidating") reasons.push("仍需要提示或更多巩固");
    if (transferGap) reasons.push("练习结果还需转化为课堂独立表现");
    if (skill.core) reasons.push("属于当前阶段核心能力");
    return {
      skillId: skill.skillId,
      label: skill.label,
      dimensionId: skill.dimensionId,
      dimensionLabel: skill.dimensionLabel,
      focusType: skill.focusType,
      score: skill.score,
      state: skill.state,
      stateLabel: skill.stateLabel,
      priorityScore,
      pinned: pinned.has(skill.skillId),
      reason: reasons.join("；") || "建议继续观察",
    };
  }).filter(Boolean).sort((left, right) => (
    right.priorityScore - left.priorityScore
    || Number(right.pinned) - Number(left.pinned)
    || left.score - right.score
  ));
};

const buildObservationNeeds = (skillMetrics, learningPlan) => {
  const pinned = new Set(learningPlan.teacherPinnedSkillIds || []);
  return skillMetrics
    .filter((skill) => ["unassessed", "insufficient"].includes(skill.state))
    .sort((left, right) => (
      Number(pinned.has(right.skillId)) - Number(pinned.has(left.skillId))
      || Number(right.core) - Number(left.core)
      || left.label.localeCompare(right.label, "zh-CN")
    ))
    .map((skill) => ({
      skillId: skill.skillId,
      label: skill.label,
      dimensionLabel: skill.dimensionLabel,
      focusType: skill.focusType,
      core: skill.core,
      evidenceCount: skill.evidenceCount,
      pinned: pinned.has(skill.skillId),
      reason: skill.evidenceCount
        ? "目前只有 1 次证据，需要在另一节课再次观察"
        : "尚未记录结构化课堂证据",
    }));
};

const buildStageReadiness = (context, skillMetrics) => {
  const coreSkills = skillMetrics.filter((skill) => skill.core);
  const allCoreHaveTwoLessons = coreSkills.length > 0
    && coreSkills.every((skill) => skill.teacherLessonCount >= 2);
  const allCoreScored = coreSkills.every((skill) => skill.score !== null);
  const coreAverage = allCoreScored && coreSkills.length
    ? roundScore(coreSkills.reduce((sum, skill) => sum + skill.score, 0) / coreSkills.length)
    : null;
  const stableCount = coreSkills.filter((skill) => skill.state === "stable").length;
  const stableRate = coreSkills.length ? Math.round(stableCount / coreSkills.length * 100) : 0;
  const noPriorityCore = !coreSkills.some((skill) => skill.state === "priority");
  const criteria = [
    { key: "two_lessons", label: "每个核心能力至少有 2 节不同课堂证据", passed: allCoreHaveTwoLessons },
    { key: "core_average", label: "核心能力综合表现达到 80", passed: coreAverage !== null && coreAverage >= 80 },
    { key: "stable_rate", label: "至少 70% 核心能力达到稳定独立", passed: stableRate >= 70 },
    { key: "no_priority", label: "没有仍需优先复习的核心能力", passed: noPriorityCore },
  ];
  const eligibleForTeacherConfirmation = criteria.every((item) => item.passed);
  return {
    eligibleForTeacherConfirmation,
    teacherConfirmationRequired: true,
    isFinalStage: !context.nextStage,
    nextStageId: context.nextStage ? context.nextStage.stageId : "",
    nextStageLabel: context.nextStage ? `${context.nextStage.stageLabel} · ${context.nextStage.stageTitle}` : "",
    coreAverage,
    stableRate,
    stableCount,
    coreSkillCount: coreSkills.length,
    statusLabel: eligibleForTeacherConfirmation
      ? context.nextStage
        ? "已满足能力条件，等待老师确认进入下一阶段"
        : "当前阶段能力条件已达标，可由老师决定后续专项"
      : "继续按当前阶段目标教学与收集证据",
    criteria,
  };
};

const inferLessonFocusType = (lesson, skillById) => {
  const explicit = asText(lesson.lessonFocusType);
  if (FOCUS_LABELS[explicit]) return explicit;
  const targetIds = unique([].concat(
    lesson.skillTargetIds || [],
    (lesson.learningObservations || []).map((item) => item && item.skillId)
  ));
  const focusCounts = {};
  targetIds.forEach((skillId) => {
    const skill = skillById.get(skillId);
    if (!skill || !skill.focusType) return;
    focusCounts[skill.focusType] = (focusCounts[skill.focusType] || 0) + 1;
  });
  const counted = Object.keys(focusCounts).sort((left, right) => focusCounts[right] - focusCounts[left])[0];
  if (counted) return counted;
  if (asText(lesson.ketSkill) || ["ket_official", "ket_mock"].includes(lesson.recordingTaskType)) return "ket";
  if (asText(lesson.oralTopic) || asText(lesson.independentOutput)) return "speaking";
  return "";
};

const chooseMollyFocus = (context, skillMetrics, priorities, observationNeeds, lessons) => {
  const urgent = priorities.find((item) => item.pinned || item.priorityScore >= 70);
  const recentLessons = (Array.isArray(lessons) ? lessons : [])
    .slice()
    .sort((left, right) => getDocumentTime(right) - getDocumentTime(left))
    .slice(0, 5);
  const targetMix = { speaking: 2, grammar: 1, input: 1, ket: 1 };
  const actualMix = { speaking: 0, grammar: 0, input: 0, ket: 0 };
  recentLessons.forEach((lesson) => {
    const focus = inferLessonFocusType(lesson, context.skillById);
    if (Object.prototype.hasOwnProperty.call(actualMix, focus)) actualMix[focus] += 1;
  });
  const order = ["speaking", "grammar", "input", "ket"];
  const balancedFocus = order.slice().sort((left, right) => (
    (targetMix[right] - actualMix[right]) - (targetMix[left] - actualMix[left])
    || order.indexOf(left) - order.indexOf(right)
  ))[0];
  const focusType = urgent ? urgent.focusType : balancedFocus;
  const priorityIds = priorities.filter((item) => item.focusType === focusType).map((item) => item.skillId);
  const needIds = observationNeeds.filter((item) => item.focusType === focusType).map((item) => item.skillId);
  const targetSkill = skillMetrics.find((skill) => skill.skillId === priorityIds[0])
    || skillMetrics.find((skill) => skill.skillId === needIds[0])
    || skillMetrics.find((skill) => skill.focusType === focusType && skill.core)
    || skillMetrics[0];
  return {
    focusType,
    targetSkill,
    mix: { target: targetMix, recent: actualMix, countedLessonCount: recentLessons.length },
    reason: urgent
      ? `优先处理：${urgent.reason}`
      : `按最近 5 节已标记课程补齐 ${FOCUS_LABELS[balancedFocus]} 的课程配比`,
  };
};

const getMollyBlocks = (focusType, targetLabel) => {
  const blocks = {
    grammar: [
      [5, "复习", "复现上一节课中能直接用于口语的句子"],
      [12, "例句讲解", `只讲 1 个核心点：${targetLabel}`],
      [10, "控制练习", "用选择、排序、纠错或替换确认理解"],
      [13, "情景迁移", "把语法放进问答、对话或看图表达"],
      [5, "出口检查", "用三档观察结果记录是否能独立使用"],
    ],
    input: [
      [5, "旧知激活", "复习主题词和上一节目标句"],
      [8, "任务预热", "看题目与关键词，预测要听或读的信息"],
      [12, "分段听读", `围绕“${targetLabel}”完成两轮信息提取`],
      [15, "表达迁移", "用找到的信息完成口头回答或 3–5 句表达"],
      [5, "出口检查", "记录信息提取与表达是否需要提示"],
    ],
    ket: [
      [5, "口语热身", "用熟悉问题快速进入完整句回答"],
      [8, "题型方法", "只讲本次小题型的任务要求和一步方法"],
      [12, "示范拆解", `示范并拆解：${targetLabel}`],
      [15, "限量练习", "完成一轮 KET 风格任务，不做整套刷题"],
      [5, "反馈记录", "保留一条优点、一条下次重点和三档观察"],
    ],
    speaking: [
      [5, "热身复现", "用熟悉问答复现上一节的完整句"],
      [8, "语言输入", `示范本节目标：${targetLabel}`],
      [12, "引导练习", "用图片、词卡或替换框架完成多轮开口"],
      [15, "情景输出", "减少提示，完成对话、看图或连续表达"],
      [5, "出口检查", "记录独立完成、提示后完成或暂时不会"],
    ],
  };
  return (blocks[focusType] || blocks.speaking).map((item) => ({
    minutes: item[0],
    title: item[1],
    detail: item[2],
  }));
};

const chooseFengFocus = (context, skillMetrics, priorities, observationNeeds) => {
  const firstPriority = priorities[0];
  const firstNeed = observationNeeds[0];
  const targetSkill = skillMetrics.find((skill) => skill.skillId === (firstPriority && firstPriority.skillId))
    || skillMetrics.find((skill) => skill.skillId === (firstNeed && firstNeed.skillId))
    || skillMetrics.find((skill) => skill.core)
    || skillMetrics[0];
  return {
    focusType: targetSkill ? targetSkill.focusType : "foundation",
    targetSkill,
    mix: null,
    reason: firstPriority
      ? `优先处理：${firstPriority.reason}`
      : firstNeed ? firstNeed.reason : "继续巩固当前阶段核心目标",
  };
};

const getFengContentLimit = (stageId) => {
  if (["feng_stage_0", "feng_stage_1"].includes(stageId)) return "最多安排 3–4 个重点字母和 1–2 个数字";
  if (stageId === "feng_stage_2") return "最多增加 2 个新单词，其余时间复习旧词";
  if (stageId === "feng_stage_3") return "最多增加 2 个拼读词，其余时间做听辨与配对";
  if (["feng_stage_4", "feng_stage_5"].includes(stageId)) return "只练 1 个句型或 1 个语法意识点";
  return "只设 1 个主要任务，围绕同一目标完成复习、听辨和表达";
};

const buildPrepSuggestion = (context, skillMetrics, priorities, observationNeeds, lessons) => {
  const isMolly = context.plan.planKey === "molly_oral_ket";
  const choice = isMolly
    ? chooseMollyFocus(context, skillMetrics, priorities, observationNeeds, lessons)
    : chooseFengFocus(context, skillMetrics, priorities, observationNeeds);
  const targetSkill = choice.targetSkill || context.skills[0];
  const stillNeedsEvidence = !targetSkill
    || targetSkill.teacherLessonCount < 2
    || ["unassessed", "insufficient", "consolidating", "priority"].includes(targetSkill.state);
  const contentRule = isMolly
    ? choice.focusType === "grammar"
      ? `本节只处理 1 个语法核心点。${stillNeedsEvidence ? "未稳定前不切换到新的语法点。" : "已稳定后，下次才考虑切换新点。"}`
      : "先复现再扩展；如果仍需要提示，本节不增加同类新结构。"
    : `${stillNeedsEvidence ? "最近证据尚未稳定，本节先不加新内容；" : "达到独立后才少量加入新内容；"}${getFengContentLimit(context.stage.stageId)}。`;
  const blocks = isMolly
    ? getMollyBlocks(choice.focusType, targetSkill ? targetSkill.label : context.stage.goal)
    : [
      { minutes: 5, title: "旧内容复现", detail: "用听、指、说快速确认上节内容" },
      { minutes: 8, title: "示范与理解", detail: `用图片、实物或卡片示范：${targetSkill ? targetSkill.label : context.stage.goal}` },
      { minutes: 10, title: "听辨或认读", detail: "先理解和指认，逐步形成记忆" },
      { minutes: 10, title: "引导练习", detail: "通过配对、排序、动作或替换反复练习" },
      { minutes: 5, title: "独立尝试", detail: "逐步减少提示，观察能否独立完成" },
      { minutes: 2, title: "记录结果", detail: "记录独立完成、提示后完成或暂时不会" },
    ];
  return {
    durationMinutes: context.plan.lessonDurationMinutes,
    totalMinutes: blocks.reduce((sum, block) => sum + block.minutes, 0),
    focusType: choice.focusType,
    focusLabel: FOCUS_LABELS[choice.focusType] || "当前阶段重点",
    title: `${FOCUS_LABELS[choice.focusType] || "阶段巩固"}：${targetSkill ? targetSkill.label : context.stage.stageTitle}`,
    targetSkillId: targetSkill ? targetSkill.skillId : "",
    targetSkillLabel: targetSkill ? targetSkill.label : "",
    reason: choice.reason,
    contentRule,
    blocks,
    observationOptions: ["独立完成", "提示后完成", "暂时不会"],
    evidencePrompt: targetSkill
      ? `课末请记录“${targetSkill.label}”属于哪一档，并写一句具体表现。`
      : "课末请记录一项具体表现。",
    recentMix: choice.mix,
  };
};

const buildLearningRadar = (input = {}) => {
  const student = input.student || {};
  const context = getStageContext(student);
  if (!context) {
    return {
      available: false,
      reason: "当前课程模板尚未配置阶段学习计划",
    };
  }
  const collected = collectEvidence(context, input);
  const skillMetrics = buildSkillMetrics(context, collected.evidenceBySkillId);
  const dimensions = buildDimensions(context, skillMetrics);
  const priorities = buildPriorities(skillMetrics, context.learningPlan, input.lessons);
  const observationNeeds = buildObservationNeeds(skillMetrics, context.learningPlan);
  const stageReadiness = buildStageReadiness(context, skillMetrics);
  const prepSuggestion = buildPrepSuggestion(
    context,
    skillMetrics,
    priorities,
    observationNeeds,
    input.lessons
  );
  const assessedSkillCount = skillMetrics.filter((skill) => skill.score !== null).length;
  const topPriority = priorities[0] || observationNeeds[0] || null;
  const dimensionLabelById = new Map((context.plan.dimensions || []).map((dimension) => (
    [dimension.dimensionId, dimension.label]
  )));
  return {
    available: true,
    algorithmVersion: "learning-radar-v1",
    planVersion: LEARNING_PLAN_CONFIG.version,
    planKey: context.plan.planKey,
    planLabel: context.plan.label,
    studentName: asText(student.name || student.nickname) || "学生",
    lessonDurationMinutes: context.plan.lessonDurationMinutes,
    learningPlan: context.learningPlan,
    currentStage: {
      stageId: context.stage.stageId,
      stageLabel: context.stage.stageLabel,
      stageTitle: context.stage.stageTitle,
      goal: context.stage.goal,
    },
    stageOptions: context.plan.stages.map((stage) => ({
      stageId: stage.stageId,
      stageLabel: stage.stageLabel,
      stageTitle: stage.stageTitle,
      goal: stage.goal,
    })),
    skillCatalog: getAllSkills(context.plan).map((skill) => ({
      skillId: skill.skillId,
      label: skill.label,
      dimensionId: skill.dimensionId,
      dimensionLabel: dimensionLabelById.get(skill.dimensionId) || skill.dimensionId,
      focusType: skill.focusType,
      stageId: skill.stageId,
      stageLabel: skill.stageLabel,
      stageTitle: skill.stageTitle,
    })),
    dimensions,
    skills: skillMetrics,
    priorities,
    observationNeeds,
    stageReadiness,
    prepSuggestion,
    evidenceSummary: {
      assessedSkillCount,
      totalSkillCount: skillMetrics.length,
      coveragePercent: skillMetrics.length ? Math.round(assessedSkillCount / skillMetrics.length * 100) : 0,
      unlinkedObservationCount: collected.unlinkedObservationCount,
      label: `本阶段 ${assessedSkillCount}/${skillMetrics.length} 项能力已有证据`,
      note: collected.unlinkedObservationCount
        ? `另有 ${collected.unlinkedObservationCount} 条历史课堂观察等待关联；评分使用已关联证据。`
        : "待观察能力会在取得课堂证据后评分。",
    },
    summary: {
      stageDisplay: `${context.stage.stageLabel} · ${context.stage.stageTitle}`,
      stageGoal: context.stage.goal,
      evidenceCoverage: `本阶段 ${assessedSkillCount}/${skillMetrics.length} 项已有证据`,
      topPriorityLabel: topPriority ? topPriority.label : "暂无优先复习项",
      topPriorityReason: topPriority ? topPriority.reason : "继续按阶段目标观察",
      nextLessonTitle: prepSuggestion.title,
      nextLessonDurationMinutes: prepSuggestion.durationMinutes,
      readinessLabel: stageReadiness.statusLabel,
    },
  };
};

const validatePlanConfiguration = () => {
  const errors = [];
  const planKeys = new Set();
  getPlans().forEach((plan) => {
    if (!plan.planKey || planKeys.has(plan.planKey)) errors.push(`planKey 重复或为空：${plan.planKey || "(空)"}`);
    planKeys.add(plan.planKey);
    if (!Number.isInteger(plan.lessonDurationMinutes) || plan.lessonDurationMinutes <= 0) {
      errors.push(`${plan.planKey} 的课时时长无效`);
    }
    const dimensionIds = new Set((plan.dimensions || []).map((item) => item.dimensionId));
    const stageIds = new Set();
    const skillIds = new Set();
    (plan.stages || []).forEach((stage) => {
      if (!stage.stageId || stageIds.has(stage.stageId)) errors.push(`${plan.planKey} 的阶段 ID 重复或为空`);
      stageIds.add(stage.stageId);
      (stage.skills || []).forEach((skill) => {
        if (!skill.skillId || skillIds.has(skill.skillId)) errors.push(`${plan.planKey} 的能力 ID 重复或为空`);
        skillIds.add(skill.skillId);
        if (!dimensionIds.has(skill.dimensionId)) errors.push(`${skill.skillId} 使用了不存在的维度`);
        if (!FOCUS_LABELS[skill.focusType]) errors.push(`${skill.skillId} 使用了不存在的课程类型`);
      });
    });
  });
  return errors;
};

module.exports = {
  FOCUS_LABELS,
  LEARNING_PLAN_CONFIG,
  SOURCE_WEIGHTS,
  STATUS_DEFINITIONS,
  buildLearningRadar,
  getAllSkills,
  getPlanByKey,
  getPlanByTemplateKey,
  getPlanForStudent,
  normalizeLearningPlan,
  normalizeObservationStatus,
  validatePlanConfiguration,
};
