const RECORDING_REVIEW_STATUSES = ["朗读正确", "需要重录"];
const MAX_FEEDBACK_TAGS = 5;
const MAX_FEEDBACK_NOTE_LENGTH = 300;

const RECORDING_FEEDBACK_TAG_OPTIONS = [
  { label: "发音准确", statuses: ["朗读正确"] },
  { label: "语速自然", statuses: ["朗读正确"] },
  { label: "声音清楚", statuses: ["朗读正确"] },
  { label: "比上次进步", statuses: ["朗读正确"] },
  { label: "注意尾音", statuses: RECORDING_REVIEW_STATUSES },
  { label: "注意单词重音", statuses: RECORDING_REVIEW_STATUSES },
  { label: "语速再慢一点", statuses: RECORDING_REVIEW_STATUSES },
  { label: "句子读完整", statuses: ["需要重录"] },
];

const optionByLabel = new Map(RECORDING_FEEDBACK_TAG_OPTIONS.map((item) => [item.label, item]));

const normalizeStatus = (value) => (
  value === "需要重录" ? "需要重录" : "朗读正确"
);

const normalizeNote = (value) => String(value || "").trim().slice(0, MAX_FEEDBACK_NOTE_LENGTH);

const normalizeTags = (value, status) => {
  const normalizedStatus = normalizeStatus(status);
  const result = [];
  (Array.isArray(value) ? value : []).forEach((rawLabel) => {
    const label = String(rawLabel || "").trim();
    const option = optionByLabel.get(label);
    if (
      !option
      || !option.statuses.includes(normalizedStatus)
      || result.includes(label)
      || result.length >= MAX_FEEDBACK_TAGS
    ) return;
    result.push(label);
  });
  return result;
};

const buildFeedbackText = (tags, note) => {
  const parts = [];
  if (tags.length) parts.push(tags.join("、"));
  if (note) parts.push(note);
  return parts.join("；").slice(0, 500);
};

const normalizeRecordingFeedback = (data = {}) => {
  const status = normalizeStatus(data.status);
  const hasStructuredFeedback = Array.isArray(data.teacherFeedbackTags)
    || Object.prototype.hasOwnProperty.call(data, "teacherFeedbackNote");
  const tags = normalizeTags(data.teacherFeedbackTags, status);
  const note = normalizeNote(
    hasStructuredFeedback ? data.teacherFeedbackNote : data.teacherFeedback
  );
  return {
    status,
    tags,
    note,
    text: buildFeedbackText(tags, note),
  };
};

module.exports = {
  MAX_FEEDBACK_NOTE_LENGTH,
  MAX_FEEDBACK_TAGS,
  RECORDING_FEEDBACK_TAG_OPTIONS,
  RECORDING_REVIEW_STATUSES,
  normalizeRecordingFeedback,
};
