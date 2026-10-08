const buildPrimaryLearningAction = ({
  student = {},
  vocabularyPulse = {},
  vocabularyQuizPulse = {},
  homeworkSummary = {},
  englishCourseEnabled = false,
  mistakeLearningEnabled = false,
} = {}) => {
  if (student.vocabularyEnabled === true) {
    if (vocabularyPulse.completed !== true) {
      return {
        action: "study",
        label: `① 开始背单词 · 还差 ${Math.max(0, Number(vocabularyPulse.remainingCount) || 0)} 个`,
      };
    }
    if (vocabularyQuizPulse.completed !== true) {
      return { action: "quiz", label: "② 开始单词小测" };
    }
    if (englishCourseEnabled) {
      const pendingCount = Math.max(0, Number(homeworkSummary.pendingCount) || 0);
      return {
        action: "homework",
        label: pendingCount ? `③ 查看课后任务 · 待完成 ${pendingCount} 项` : "③ 查看课后任务",
      };
    }
    return { action: "study", label: "查看今日背词结果" };
  }
  if (englishCourseEnabled) return { action: "homework", label: "查看全部课后任务" };
  if (mistakeLearningEnabled) return { action: "mistakes", label: "开始错题复习" };
  if (student.frenchLearningEnabled === true) return { action: "french", label: "进入法语学习" };
  return null;
};

module.exports = {
  buildPrimaryLearningAction,
};
