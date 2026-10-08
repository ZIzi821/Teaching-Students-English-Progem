const usesLessonDurationMinutes = (student = {}, lessonTemplateKey = "") => (
  String(lessonTemplateKey || "") === "vocabulary_coaching"
  || student.progressUnit === "minute"
  || student.lessonAccountingMode === "minute"
);

module.exports = {
  usesLessonDurationMinutes,
};
