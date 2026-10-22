const crypto = require("crypto");
const KET_MOCK_SETS = require("./data/ket-mock-sets.json");

const SCORE_FIELDS = [
  "grammarVocabulary",
  "pronunciation",
  "interactiveCommunication",
  "globalAchievement",
];
const SCORE_DIMENSIONS = Object.freeze([
  { key: "grammarVocabulary", label: "语法与词汇", tone: "grammar" },
  { key: "pronunciation", label: "发音", tone: "pronunciation" },
  { key: "interactiveCommunication", label: "互动沟通", tone: "interaction" },
  { key: "globalAchievement", label: "整体表现", tone: "global" },
]);
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;

const asText = (value, limit = 500) => String(value || "").trim().slice(0, limit);

const findSet = (setId) => KET_MOCK_SETS.find((item) => item.id === String(setId || "")) || null;
const findCue = (set, cueId) => ((set && set.cues) || []).find((item) => item.id === String(cueId || "")) || null;

const getAssetDocumentId = (setId, cueId) => `ket_asset_${crypto
  .createHash("sha1")
  .update(`${String(setId || "")}\n${String(cueId || "")}`)
  .digest("hex")}`;

const buildAssetCompleteness = (set, assets = []) => {
  const assetByCueId = new Map((assets || [])
    .filter((item) => item && item.setId === (set && set.id) && item.cueId)
    .map((item) => [String(item.cueId), item]));
  const cues = ((set && set.cues) || []).map((cue) => {
    const asset = assetByCueId.get(cue.id) || null;
    return Object.assign({}, cue, {
      audioReady: Boolean(asset && asset.fileID),
      audioAsset: asset,
    });
  });
  const readyCount = cues.filter((cue) => cue.audioReady).length;
  return {
    cues,
    readyCount,
    totalCount: cues.length,
    complete: cues.length > 0 && readyCount === cues.length,
    missingCueIds: cues.filter((cue) => !cue.audioReady).map((cue) => cue.id),
  };
};

const sanitizeSetForStudent = (set, assets = []) => {
  const completeness = buildAssetCompleteness(set, assets);
  return {
    id: set.id,
    order: set.order,
    title: set.title,
    shortTitle: set.shortTitle,
    sourceType: set.sourceType,
    sourceBadge: set.sourceBadge,
    sourceLabel: set.sourceLabel,
    sourceReference: set.sourceReference,
    topic: set.topic,
    formatLabel: set.formatLabel,
    expectedMinutes: set.expectedMinutes,
    visualAsset: set.visualAsset,
    visualAlt: set.visualAlt,
    visualPrompt: set.visualPrompt,
    visualQuestion: set.visualQuestion,
    visualOptions: set.visualOptions,
    audioComplete: completeness.complete,
    cues: completeness.cues.map((cue) => ({
      id: cue.id,
      part: cue.part,
      order: cue.order,
      title: cue.title,
      responseExpected: cue.responseExpected === true,
      maxResponseSeconds: Number(cue.maxResponseSeconds || 0),
      studentInstruction: cue.studentInstruction || "听清后回答",
      audioUrl: cue.audioAsset && cue.audioAsset.audioUrl || "",
    })),
  };
};

const normalizeScore = (value) => {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 5 || !Number.isInteger(score * 2)) return null;
  return score;
};

const normalizeAssessment = (data = {}) => {
  const scores = {};
  SCORE_FIELDS.forEach((field) => {
    const score = normalizeScore(data[field]);
    if (score === null) throw new Error("四项练习评分都必须填写 0–5 分，可使用 0.5 分");
    scores[field] = score;
  });
  const average = SCORE_FIELDS.reduce((sum, field) => sum + scores[field], 0) / SCORE_FIELDS.length;
  return Object.assign({}, scores, {
    average: Math.round(average * 10) / 10,
    strengths: asText(data.strengths, 500),
    nextFocus: asText(data.nextFocus, 500),
    comment: asText(data.comment, 800),
    scoreNotice: "教师练习评分用于观察四维表现和安排后续学习。",
  });
};

const roundScore = (value) => Math.round(Number(value || 0) * 10) / 10;

const formatScore = (value) => {
  const rounded = roundScore(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const getSessionTime = (session = {}) => {
  const candidates = [session.reviewedAtMs, session.submittedAtMs, session.startedAtMs];
  for (const value of candidates) {
    const timestamp = Number(value || 0);
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  }
  return 0;
};

const formatSessionDate = (session, timestamp) => {
  const lessonDate = String(session && session.lessonDateSnapshot || "").trim();
  const matched = lessonDate.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (matched) return `${Number(matched[1])}/${Number(matched[2])}`;
  if (!timestamp) return "";
  const date = new Date(timestamp + HONG_KONG_OFFSET_MS);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
};

const readTrendAssessment = (session = {}) => {
  if (session.status !== "reviewed" || !session.assessment) return null;
  const scores = {};
  for (const field of SCORE_FIELDS) {
    const score = normalizeScore(session.assessment[field]);
    if (score === null) return null;
    scores[field] = score;
  }
  return Object.assign(scores, {
    average: roundScore(SCORE_FIELDS.reduce((sum, field) => sum + scores[field], 0) / SCORE_FIELDS.length),
  });
};

const buildChangeState = (latest, previous, hasComparison) => {
  if (!hasComparison) return { value: 0, label: "首次评分", tone: "baseline" };
  const value = roundScore(latest - previous);
  return {
    value,
    label: value > 0 ? `+${formatScore(value)}` : value < 0 ? formatScore(value) : "持平",
    tone: value > 0 ? "up" : value < 0 ? "down" : "steady",
  };
};

const buildScoreTrend = (sessions = [], options = {}) => {
  const requestedLimit = Math.trunc(Number(options.limit || 8));
  const limit = Number.isFinite(requestedLimit) ? Math.max(2, Math.min(12, requestedLimit)) : 8;
  const reviewed = (Array.isArray(sessions) ? sessions : [])
    .map((session) => ({
      session,
      assessment: readTrendAssessment(session),
      atMs: getSessionTime(session),
    }))
    .filter((item) => item.assessment)
    .sort((left, right) => (
      left.atMs - right.atMs
      || String(left.session._id || "").localeCompare(String(right.session._id || ""))
    ));
  const visible = reviewed.slice(-limit);
  const startOrder = reviewed.length - visible.length + 1;
  const sessionPoints = visible.map((item, index) => {
    const set = findSet(item.session.setId);
    return {
      key: String(item.session._id || `ket-score-${startOrder + index}`),
      order: startOrder + index,
      orderLabel: `第 ${startOrder + index} 次`,
      dateLabel: formatSessionDate(item.session, item.atMs),
      setTitle: set && (set.shortTitle || set.title)
        || String(item.session.lessonTitleSnapshot || "KET 口语模拟"),
      average: item.assessment.average,
      scores: item.assessment,
    };
  });
  const hasComparison = sessionPoints.length >= 2;
  const latestPoint = sessionPoints[sessionPoints.length - 1] || null;
  const previousPoint = sessionPoints[sessionPoints.length - 2] || null;
  const averageChange = buildChangeState(
    latestPoint ? latestPoint.average : 0,
    previousPoint ? previousPoint.average : 0,
    hasComparison
  );
  const dimensions = SCORE_DIMENSIONS.map((dimension) => {
    const points = sessionPoints.map((point) => {
      const score = point.scores[dimension.key];
      return {
        key: point.key,
        score,
        scoreLabel: formatScore(score),
        heightPercent: Math.max(4, Math.round(score / 5 * 100)),
        orderLabel: point.orderLabel,
        dateLabel: point.dateLabel,
      };
    });
    const latest = points[points.length - 1];
    const previous = points[points.length - 2];
    const change = buildChangeState(
      latest ? latest.score : 0,
      previous ? previous.score : 0,
      hasComparison
    );
    return Object.assign({}, dimension, {
      latest: latest ? latest.score : 0,
      latestLabel: latest ? latest.scoreLabel : "—",
      changeValue: change.value,
      changeLabel: change.label,
      changeTone: change.tone,
      points,
    });
  });
  return {
    hasData: sessionPoints.length > 0,
    hasComparison,
    reviewedCount: reviewed.length,
    visibleCount: sessionPoints.length,
    hiddenCount: Math.max(0, reviewed.length - sessionPoints.length),
    latestAverage: latestPoint ? latestPoint.average : 0,
    latestAverageLabel: latestPoint ? formatScore(latestPoint.average) : "—",
    averageChangeValue: averageChange.value,
    averageChangeLabel: averageChange.label,
    averageChangeTone: averageChange.tone,
    dimensions,
    sessions: sessionPoints.map((point) => ({
      key: point.key,
      orderLabel: point.orderLabel,
      dateLabel: point.dateLabel,
      setTitle: point.setTitle,
      average: point.average,
    })),
    emptyMessage: "还没有老师完成评分的 KET 模拟；第一次评分会建立基线，第二次开始显示变化。",
    notice: "趋势来自老师已完成的四维练习评分，用于观察学习变化。",
  };
};

const validateCatalogue = (sets = KET_MOCK_SETS) => {
  const errors = [];
  const ids = new Set();
  (sets || []).forEach((set, setIndex) => {
    if (!set || !set.id) errors.push(`set ${setIndex + 1}: missing id`);
    if (ids.has(set && set.id)) errors.push(`duplicate set id: ${set.id}`);
    ids.add(set && set.id);
    if (!["official_public_adapted", "exclusive_original", "institution_exclusive_original"].includes(set && set.sourceType)) {
      errors.push(`${set && set.id}: invalid sourceType`);
    }
    const enhancedSet = Number(set && set.order || 0) >= 9;
    const expectedCueCount = enhancedSet ? 10 : 9;
    const expectedResponseCount = enhancedSet ? 8 : 7;
    if (!set || !Array.isArray(set.cues) || set.cues.length !== expectedCueCount) {
      errors.push(`${set && set.id}: expected ${expectedCueCount} cues`);
      return;
    }
    if (!set.teacherGuide || !Array.isArray(set.teacherGuide.scoreGuidance) || set.teacherGuide.scoreGuidance.length !== 4) {
      errors.push(`${set.id}: incomplete teacher score guidance`);
    }
    const cueIds = new Set();
    set.cues.forEach((cue) => {
      if (!cue.id || cueIds.has(cue.id)) errors.push(`${set.id}: duplicate or missing cue id`);
      cueIds.add(cue.id);
      if (![1, 2].includes(cue.part)) errors.push(`${set.id}/${cue.id}: invalid part`);
      if (!cue.script) errors.push(`${set.id}/${cue.id}: missing script`);
      if (cue.responseExpected && Number(cue.maxResponseSeconds || 0) <= 0) {
        errors.push(`${set.id}/${cue.id}: response cue needs time limit`);
      }
      if (enhancedSet && cue.responseExpected && (!Array.isArray(cue.backupPrompts) || !cue.backupPrompts.length || !cue.modelAnswer)) {
        errors.push(`${set.id}/${cue.id}: enhanced response cue needs backup prompts and a model answer`);
      }
    });
    if (set.cues.filter((cue) => cue.responseExpected).length !== expectedResponseCount) {
      errors.push(`${set.id}: expected ${expectedResponseCount} response cues`);
    }
    if (!set.cues.some((cue) => cue.part === 1 && cue.responseExpected)) errors.push(`${set.id}: missing Part 1 response`);
    if (!set.cues.some((cue) => cue.part === 2 && cue.responseExpected)) errors.push(`${set.id}: missing Part 2 response`);
  });
  if ((sets || []).length !== 12) errors.push("catalogue must contain 12 complete sets");
  return errors;
};

module.exports = {
  KET_MOCK_SETS,
  SCORE_DIMENSIONS,
  SCORE_FIELDS,
  buildAssetCompleteness,
  buildScoreTrend,
  findCue,
  findSet,
  getAssetDocumentId,
  normalizeAssessment,
  sanitizeSetForStudent,
  validateCatalogue,
};
