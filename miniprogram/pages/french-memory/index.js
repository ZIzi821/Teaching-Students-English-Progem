const frenchPreview = require("../../utils/frenchPreview");

const STATE_LABELS = {
  new: "未学习",
  learning: "学习中",
  review: "复习中",
  mastered: "已掌握",
};

const RATING_LABELS = {
  again: "Again · 再来一次",
  hard: "Hard · 有点难",
  good: "Good · 记住了",
  easy: "Easy · 太简单",
};

const formatDateTime = (value) => {
  const time = Number(value);
  if (!time) return "暂无记录";
  const date = new Date(time);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatDuration = (days) => {
  const value = Math.max(0, Number(days) || 0);
  if (!value) return "待建立";
  if (value < 1 / 24) return `${Math.max(1, Math.round(value * 24 * 60))} 分钟`;
  if (value < 1) return `${Math.max(1, Math.round(value * 24))} 小时`;
  return `${Math.round(value * 10) / 10} 天`;
};

const formatNextReview = (value) => {
  const time = Number(value);
  if (!time) return "完成第一次复习后生成";
  const difference = time - Date.now();
  if (difference <= 0) return "现在可以复习";
  const minutes = Math.ceil(difference / 60000);
  if (minutes < 60) return `约 ${minutes} 分钟后`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `约 ${hours} 小时后`;
  const days = Math.ceil(hours / 24);
  return `${formatDateTime(time)}（约 ${days} 天后）`;
};

Page({
  data: {
    loading: true,
    message: "",
    word: null,
    memory: null,
    points: [],
    history: [],
    disclaimer: "",
    hasCurve: false,
    hasReview: false,
    mode: "",
    previewStudentId: "",
    isTeacherPreview: false,
  },

  onLoad(options) {
    this.setData(frenchPreview.parseOptions(options));
    this.wordId = options.wordId || "";
    this.loadMemory();
  },

  loadMemory() {
    if (!this.wordId) {
      this.setData({ loading: false, message: "没有找到这个单词" });
      return;
    }
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getFrenchWordMemory", data: frenchPreview.withData(this, { wordId: this.wordId }) },
    }).then((response) => {
      const result = response.result || {};
      if (result.success === false) throw new Error(result.message || "暂时无法读取记忆数据");
      const payload = result.data || result;
      const memory = payload.memory || {};
      const curve = Array.isArray(payload.curve) ? payload.curve : [];
      const history = Array.isArray(memory.reviewHistory)
        ? memory.reviewHistory.slice().reverse().slice(0, 8).map((item) => ({
          reviewedAt: formatDateTime(item.reviewedAtMs),
          ratingLabel: RATING_LABELS[item.rating] || item.rating || "复习",
          retentionBefore: Math.round((Number(item.retrievabilityBefore) || 0) * 100),
          stabilityAfter: formatDuration(item.stabilityAfterDays),
          interval: formatDuration(item.intervalDays),
        }))
        : [];
      const viewMemory = Object.assign({}, memory, {
        stateLabel: STATE_LABELS[memory.state] || "未学习",
        lastReviewedLabel: formatDateTime(memory.lastReviewedAtMs),
        nextReviewLabel: formatNextReview(memory.nextReviewAtMs),
        intervalLabel: formatDuration(memory.currentIntervalDays),
        stabilityLabel: formatDuration(memory.stabilityDays),
      });
      this.setData({
        loading: false,
        word: payload.word || null,
        memory: viewMemory,
        points: curve.map((item) => ({ label: `${item.elapsedDays}天`, value: item.retentionPercent })),
        history,
        hasCurve: curve.length > 1,
        hasReview: Number(memory.reviewCount) > 0,
        disclaimer: payload.disclaimer || "曲线用于学习规划参考。",
      });
    }).catch((error) => {
      console.error(error);
      this.setData({ loading: false, message: error.message || "暂时无法读取记忆数据" });
    });
  },
});
