const { callCloud } = require("../../../utils/cloud");
const LARGE_BIN_GAP_POINTS = 15;

// 把统计结果翻译成老师能直接判断的一句话结论。
const buildVerdict = (source, statusKey) => {
  const gap = Number(source.calibrationGapPoints || 0);
  if (statusKey === "collecting") {
    return {
      title: "数据还不够，先继续背词",
      meaning: "复习反馈积累到首轮门槛后，这里会给出复习安排是否合适的判断。",
    };
  }
  if (statusKey === "initially_stable") {
    return {
      title: "复习安排基本合适",
      meaning: "系统预测的记住比例和孩子实际表现接近，保持现有安排即可。",
    };
  }
  if (gap > 5) {
    return {
      title: "复习安排偏密",
      meaning: "孩子实际记住的比系统预测的多，部分单词可能复习得过于频繁。",
    };
  }
  if (gap < -5) {
    return {
      title: "复习间隔偏长",
      meaning: "孩子实际记住的比系统预测的少，部分单词需要更早安排复习。",
    };
  }
  return {
    title: "整体接近，单个词偏差较大",
    meaning: "总体比例接近，但具体到单个单词时预测还不够准，先看下方分组找出偏差区间。",
  };
};

const formatPercent = (value) => (
  value === null || value === undefined ? "—" : `${value}%`
);

const formatScore = (value) => (
  value === null || value === undefined ? "—" : Number(value).toFixed(3)
);

const formatGap = (value) => {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(1)} 个百分点`;
};

const formatDate = (timestamp) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
};

Page({
  data: {
    studentId: "",
    loading: true,
    message: "",
    student: null,
    evaluation: null,
    showDetails: false,
  },

  onLoad(options) {
    this.setData({ studentId: String(options.studentId || "") });
    this.loadEvaluation();
  },

  onShow() {
    if (this.hasShown && this.data.studentId) this.loadEvaluation();
    this.hasShown = true;
  },

  loadEvaluation() {
    if (!this.data.studentId) {
      this.setData({ loading: false, message: "学生信息不完整，请返回后重试" });
      return;
    }
    this.setData({ loading: true, message: "" });
    callCloud({
      type: "getEnglishMemoryEvaluation",
      data: { studentId: this.data.studentId },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "算法评估加载失败");
      this.setData({
        student: result.student || null,
        evaluation: this.prepareEvaluation(result.evaluation || {}),
        message: "",
      });
    }).catch((err) => {
      console.error(err);
      this.setData({
        student: null,
        evaluation: null,
        message: err.message || "加载遇到问题，请稍后重试",
      });
    }).finally(() => {
      this.setData({ loading: false });
    });
  },

  prepareEvaluation(source) {
    const status = source.status || { key: "collecting", label: "收集中", tone: "collecting" };
    const calibrationBins = (source.calibrationBins || []).map((item) => Object.assign({}, item, {
      predictedDisplay: formatPercent(item.predictedRetentionPercent),
      actualDisplay: formatPercent(item.actualRecallPercent),
      gapDisplay: formatGap(item.calibrationGapPoints),
    }));
    const sourceBreakdown = (source.sourceBreakdown || []).map((item) => Object.assign({}, item, {
      predictedDisplay: formatPercent(item.predictedRetentionPercent),
      actualDisplay: formatPercent(item.actualRecallPercent),
      brierDisplay: formatScore(item.brierScore),
    }));
    const recentRows = [
      { label: "近 7 天", data: source.recentSevenDays || {} },
      { label: "近 30 天", data: source.recentThirtyDays || {} },
    ].map((item) => ({
      label: item.label,
      sampleSize: Number(item.data.sampleSize || 0),
      predictedDisplay: formatPercent(item.data.predictedRetentionPercent),
      actualDisplay: formatPercent(item.data.actualRecallPercent),
    }));
    const firstDate = formatDate(source.firstObservedAtMs);
    const lastDate = formatDate(source.lastObservedAtMs);
    return Object.assign({}, source, {
      status,
      verdict: buildVerdict(source, status.key),
      activeBins: calibrationBins
        .filter((item) => item.hasSample)
        .map((item) => Object.assign({}, item, {
          largeGap: Math.abs(Number(item.calibrationGapPoints || 0)) > LARGE_BIN_GAP_POINTS,
        })),
      hasSample: Number(source.sampleSize || 0) > 0,
      predictedDisplay: formatPercent(source.predictedRetentionPercent),
      actualDisplay: formatPercent(source.actualRecallPercent),
      gapDisplay: formatGap(source.calibrationGapPoints),
      brierDisplay: formatScore(source.brierScore),
      excludedQualityCount: Number(source.excludedInvalidCount || 0)
        + Number(source.excludedOtherVersionCount || 0),
      calibrationBins,
      sourceBreakdown,
      recentRows,
      dateRangeLabel: firstDate && lastDate
        ? firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`
        : "尚无可评估日期",
    });
  },

  toggleDetails() {
    this.setData({ showDetails: !this.data.showDetails });
  },
});
