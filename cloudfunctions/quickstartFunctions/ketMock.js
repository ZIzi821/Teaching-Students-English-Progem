const crypto = require("crypto");
const KET_MOCK_SETS = require("./data/ket-mock-sets.json");

const SCORE_FIELDS = [
  "grammarVocabulary",
  "pronunciation",
  "interactiveCommunication",
  "globalAchievement",
];

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
    scoreNotice: "教师练习评分，用于后续学习调整，不是 Cambridge 官方考试成绩。",
  });
};

const validateCatalogue = (sets = KET_MOCK_SETS) => {
  const errors = [];
  const ids = new Set();
  (sets || []).forEach((set, setIndex) => {
    if (!set || !set.id) errors.push(`set ${setIndex + 1}: missing id`);
    if (ids.has(set && set.id)) errors.push(`duplicate set id: ${set.id}`);
    ids.add(set && set.id);
    if (!["official_public_adapted", "current_format_original"].includes(set && set.sourceType)) {
      errors.push(`${set && set.id}: invalid sourceType`);
    }
    if (!set || !Array.isArray(set.cues) || set.cues.length !== 9) {
      errors.push(`${set && set.id}: expected 9 cues`);
      return;
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
    });
    if (!set.cues.some((cue) => cue.part === 1 && cue.responseExpected)) errors.push(`${set.id}: missing Part 1 response`);
    if (!set.cues.some((cue) => cue.part === 2 && cue.responseExpected)) errors.push(`${set.id}: missing Part 2 response`);
  });
  if ((sets || []).length !== 8) errors.push("catalogue must contain 8 complete sets");
  return errors;
};

module.exports = {
  KET_MOCK_SETS,
  SCORE_FIELDS,
  buildAssetCompleteness,
  findCue,
  findSet,
  getAssetDocumentId,
  normalizeAssessment,
  sanitizeSetForStudent,
  validateCatalogue,
};
