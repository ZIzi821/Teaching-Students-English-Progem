const getActionableHomeworkCount = (homeworkSummary = {}) => {
  const source = homeworkSummary || {};
  const value = Object.prototype.hasOwnProperty.call(source, "actionableCount")
    ? source.actionableCount
    : source.pendingCount;
  return Math.max(0, Number(value) || 0);
};

const buildHomeworkPlanStep = ({ pendingHomework = null, homeworkSummary = {} } = {}) => {
  const summary = homeworkSummary || {};
  const awaitingReviewCount = Math.max(0, Number(summary.awaitingReviewCount) || 0);
  const completedCount = Math.max(0, Number(summary.completedCount) || 0);
  if (pendingHomework) {
    return {
      title: "查看课后任务",
      hint: `${pendingHomework.title || "最近英语课"} · ${pendingHomework.recordingTaskEnabled ? "需要完成任务并提交录音" : "还有任务等待完成"}`,
      actionLabel: "去完成 →",
    };
  }
  if (awaitingReviewCount > 0) {
    return {
      title: "查看课后任务",
      hint: `已提交 ${awaitingReviewCount} 项，正在等待老师检查`,
      actionLabel: "查看 →",
    };
  }
  return {
    title: "查看课后任务",
    hint: completedCount > 0
      ? "目前没有待完成任务，可以查看以前的完成记录"
      : "老师布置后会显示在这里",
    actionLabel: "查看 →",
  };
};

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
      const pendingCount = getActionableHomeworkCount(homeworkSummary);
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
  buildHomeworkPlanStep,
  buildPrimaryLearningAction,
  getActionableHomeworkCount,
};
