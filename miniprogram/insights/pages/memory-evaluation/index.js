const STATUS_DESCRIPTIONS = {
  collecting: "样本还少，先积累数据，不调整参数。",
  needs_calibration: "预测与反馈已有明显偏差，建议按区间和来源排查。",
  initially_stable: "首轮校准表现稳定，继续收集数据验证。",
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
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getEnglishMemoryEvaluation",
        data: { studentId: this.data.studentId },
      },
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
        message: err.message || "服务暂时不可用，请稍后再试",
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
      status: Object.assign({}, status, {
        description: STATUS_DESCRIPTIONS[status.key] || STATUS_DESCRIPTIONS.collecting,
      }),
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
});
