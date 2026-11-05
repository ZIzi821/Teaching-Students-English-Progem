const { callCloud } = require("../../../utils/cloud");
const LARGE_BIN_GAP_POINTS = 15;

const describeFactor = (factor) => {
  const percent = Math.round((Number(factor) - 1) * 100);
  if (!percent) return "默认间隔";
  return percent > 0 ? `间隔延长 ${percent}%` : `间隔缩短 ${-percent}%`;
};

// 校准建议卡和“已校准”状态行的文案。
const buildCalibrationView = (source, dismissed) => {
  const calibration = source.calibration || {};
  const view = { showSuggestion: false, canReset: calibration.applied === true && calibration.isDefault === false };
  if (calibration.canApply && !dismissed) {
    const longer = calibration.suggestedFactor > calibration.currentFactor;
    Object.assign(view, {
      showSuggestion: true,
      title: `建议：复习间隔整体${longer ? "延长" : "缩短"}约 ${Math.abs(calibration.changePercent)}%`,
      text: `按历史数据重新计算，预测记住会从 ${source.predictedRetentionPercent}% 变成约 ${calibration.previewPredictedPercent}%，更接近实际的 ${source.actualRecallPercent}%。`,
    });
  }
  if (!view.showSuggestion && calibration.reason === "not_significant") {
    view.noteText = `目前差距 ${Math.abs(Number(source.calibrationGapPoints) || 0)} 个百分点；按 ${source.sampleSize} 次反馈计算，差距超过约 ${calibration.requiredGapPoints} 个百分点才能排除偶然波动。继续背词，数据足够后会自动给出建议。`;
  } else if (!view.showSuggestion && !calibration.applied && calibration.reason === "collecting" && source.sampleSize > 0) {
    view.noteText = `至少需要 ${calibration.minSample || 50} 次复习反馈才会给出校准建议，目前 ${source.sampleSize} 次。`;
  }
  if (calibration.applied) {
    const appliedDate = formatDate(calibration.appliedAtMs);
    view.statusTitle = calibration.isDefault ? `${appliedDate} 已恢复默认` : `${appliedDate} 已校准 · ${describeFactor(calibration.currentFactor)}`;
    view.statusText = calibration.reviewReady
      ? `之后已有 ${calibration.sampleSinceCalibration} 次复习反馈，可以复查效果。`
      : `之后已有 ${calibration.sampleSinceCalibration} 次复习反馈，满 50 次后复查效果。`;
  }
  return view;
};

// 把统计结果翻译成老师能直接判断的一句话结论。
const buildVerdict = (source, statusKey) => {
  const gap = Number(source.calibrationGapPoints || 0);
  if (statusKey === "collecting") {
    return {
      title: "数据还不够，先继续背词",
      meaning: "复习反馈积累到首轮门槛后，这里会给出复习安排是否合适的判断。",
    };
  }
  const canApply = Boolean(source.calibration && source.calibration.canApply);
  if (canApply && gap > 0) {
    return {
      title: "复习安排偏密",
      meaning: "孩子实际记住的比系统预测的多，部分单词复习得过于频繁。",
    };
  }
  if (canApply && gap < 0) {
    return {
      title: "复习间隔偏长",
      meaning: "孩子实际记住的比系统预测的少，部分单词需要更早安排复习。",
    };
  }
  if (statusKey === "initially_stable") {
    return {
      title: "复习安排基本合适",
      meaning: "系统预测的记住比例和孩子实际表现接近，保持现有安排即可。",
    };
  }
  if (!(source.calibration && source.calibration.canApply)) {
    return {
      title: "有偏差迹象，先继续观察",
      meaning: gap > 0
        ? "孩子实际记住的比系统预测的略多，但数据还不足以确认，暂不调整复习间隔。"
        : "孩子实际记住的比系统预测的略少，但数据还不足以确认，暂不调整复习间隔。",
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
    saving: false,
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
        rawCalibration: (result.evaluation && result.evaluation.calibration) || null,
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
      status: source.calibration && source.calibration.canApply
        ? { key: "needs_calibration", label: "需要校准", tone: "attention" }
        : status.key === "needs_calibration"
          ? { key: status.key, label: "继续观察", tone: "collecting" }
          : status,
      verdict: buildVerdict(source, status.key),
      calibrationView: buildCalibrationView(source, this.suggestionDismissed === true),
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

  dismissSuggestion() {
    this.suggestionDismissed = true;
    this.setData({ "evaluation.calibrationView.showSuggestion": false });
  },

  applyCalibration() {
    const calibration = this.data.rawCalibration;
    if (this.data.saving || !calibration || !calibration.canApply) return;
    wx.showModal({
      title: "应用校准",
      content: `之后这个孩子的复习间隔将${describeFactor(calibration.suggestedFactor / calibration.currentFactor)}。已经排好的复习时间不变，随时可以恢复默认。`,
      confirmText: "应用",
      confirmColor: "#14645A",
      success: (modal) => {
        if (modal.confirm) this.saveCalibration({ action: "apply", expectedFactor: calibration.suggestedFactor }, "已应用校准");
      },
    });
  },

  resetCalibration() {
    if (this.data.saving) return;
    wx.showModal({
      title: "恢复默认",
      content: "之后的复习间隔恢复为默认算法，已有学习记录保持不变。",
      confirmText: "恢复",
      confirmColor: "#B0432F",
      success: (modal) => {
        if (modal.confirm) this.saveCalibration({ action: "reset" }, "已恢复默认");
      },
    });
  },

  saveCalibration(payload, successMessage) {
    this.setData({ saving: true });
    callCloud({
      type: "updateEnglishMemoryCalibration",
      data: Object.assign({ studentId: this.data.studentId }, payload),
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "保存失败，请再试一次");
      wx.showToast({ title: successMessage, icon: "none" });
      this.suggestionDismissed = false;
      this.loadEvaluation();
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "保存失败，请再试一次", icon: "none" });
    }).finally(() => {
      this.setData({ saving: false });
    });
  },
});
