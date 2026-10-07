const buildNextLessonTitleSuggestion = (value) => {
  const title = String(value || "").trim();
  const matched = title.match(/^(.*?)(\d+)$/);
  if (!matched || !String(matched[1] || "").trim()) return "";
  const current = Number(matched[2]);
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) return "";
  const nextNumber = String(current + 1).padStart(matched[2].length, "0");
  return `${matched[1]}${nextNumber}`;
};

module.exports = {
  buildNextLessonTitleSuggestion,
};
