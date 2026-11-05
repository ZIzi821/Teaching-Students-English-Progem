const frenchPreview = require("../../utils/frenchPreview");
const { callCloud } = require("../../utils/cloud");

const EMPTY_DASHBOARD = {
  today: { dueCount: 0, newWordCount: 0, newRemainingCount: 0, reviewedCount: 0, successfulRecallCount: 0, againCount: 0, activityCount: 0, studySessionCount: 0, goal: 0, goalPercent: 0 },
  streakDays: 0,
  levelProgress: [],
  memoryOverview: { reviewedWordCount: 0, currentRetentionPercent: 0, atRiskCount: 0, averageStabilityDays: 0, points: [], disclaimer: "" },
  dailyPath: { completedStepCount: 0, totalStepCount: 0, progressPercent: 0, completed: false, estimatedMinutes: 0, steps: [] },
};

const STEP_ROUTES = {
  word: "/pages/french-vocabulary/index?practice=daily",
  sentence: "/pages/french-shadowing/index",
  grammar: "/pages/french-grammar/index",
  expression: "/pages/french-expressions/index",
  reading: "/pages/french-reading/index",
  writing: "/pages/french-writing/index",
};

const clampPercent = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const normaliseDashboard = (dashboard) => {
  const source = dashboard && typeof dashboard === "object" ? dashboard : {};
  const today = source.today && typeof source.today === "object" ? source.today : {};
  const levels = Array.isArray(source.levelProgress) ? source.levelProgress : [];
  const memory = source.memoryOverview && typeof source.memoryOverview === "object"
    ? source.memoryOverview
    : {};
  const dailyPath = source.dailyPath && typeof source.dailyPath === "object" ? source.dailyPath : {};
  return {
    today: Object.assign({}, EMPTY_DASHBOARD.today, today, { goalPercent: clampPercent(today.goalPercent) }),
    streakDays: Math.max(0, Number(source.streakDays) || 0),
    levelProgress: levels.map((item) => Object.assign({}, item, { overallPercent: clampPercent(item && item.overallPercent) })),
    memoryOverview: Object.assign({}, EMPTY_DASHBOARD.memoryOverview, memory, {
      reviewedWordCount: Math.max(0, Number(memory.reviewedWordCount) || 0),
      currentRetentionPercent: clampPercent(memory.currentRetentionPercent),
      atRiskCount: Math.max(0, Number(memory.atRiskCount) || 0),
      averageStabilityDays: Math.max(0, Number(memory.averageStabilityDays) || 0),
      points: Array.isArray(memory.points)
        ? memory.points.map((item) => Object.assign({}, item, { value: clampPercent(item && item.value) }))
        : [],
    }),
    dailyPath: Object.assign({}, EMPTY_DASHBOARD.dailyPath, dailyPath, {
      completedStepCount: Math.max(0, Number(dailyPath.completedStepCount) || 0),
      totalStepCount: Math.max(0, Number(dailyPath.totalStepCount) || 0),
      progressPercent: clampPercent(dailyPath.progressPercent),
      estimatedMinutes: Math.max(0, Number(dailyPath.estimatedMinutes) || 0),
      steps: Array.isArray(dailyPath.steps) ? dailyPath.steps.map((item) => Object.assign({}, item, {
        url: STEP_ROUTES[item && item.key] || "/pages/french-learning/index",
      })) : [],
    }),
  };
};

Page({
  data: {
    loading: true,
    message: "",
    enabled: false,
    role: "",
    mode: "",
    previewStudentId: "",
    isTeacherPreview: false,
    welcomeTitle: "Bonjour !",
    learnerName: "",
    dailySpotlight: null,
    spotlightAudioLoading: false,
    spotlightAudioUrl: "",
    dashboard: EMPTY_DASHBOARD,
    overview: {
      wordSummary: { totalCount: 0, reviewedCount: 0, masteredCount: 0, dueCount: 0 },
      sentenceSummary: { totalCount: 0, completedCount: 0 },
    },
  },

  onLoad(options) {
    this.audioRequestVersion = 0;
    this.setData(frenchPreview.parseOptions(options));
    this.audioContext = wx.createInnerAudioContext();
    this.audioContext.obeyMuteSwitch = false;
    this.audioContext.onError(() => {
      this.setData({ spotlightAudioLoading: false, spotlightAudioUrl: "" });
      wx.showToast({ title: "音频播放失败，请稍后再试", icon: "none" });
    });
  },

  onShow() { this.loadOverview(); },

  onHide() { this.stopSpotlightAudio(); },

  onUnload() {
    if (!this.audioContext) return;
    this.stopSpotlightAudio();
    this.audioContext.destroy();
    this.audioContext = null;
  },

  stopSpotlightAudio() {
    this.audioRequestVersion = (this.audioRequestVersion || 0) + 1;
    if (this.audioContext) this.audioContext.stop();
    if (this.data.spotlightAudioLoading) this.setData({ spotlightAudioLoading: false });
  },

  loadOverview() {
    this.setData({ loading: true, message: "" });
    if (!wx.cloud) {
      this.setData({ loading: false, message: "微信版本过低，请更新后重试" });
      return;
    }
    callCloud({ type: "getFrenchLearningOverview", data: frenchPreview.withData(this, {}) })
      .then((res) => {
        const result = res.result || {};
        if (result.success === false) throw new Error(result.message || "暂时无法读取法语学习");
        const payload = result.data || result;
        const learnerName = String(payload.learnerName || "").trim();
        this.setData({
          loading: false,
          enabled: payload.enabled !== false,
          role: payload.role || "",
          learnerName,
          welcomeTitle: learnerName ? `Bonjour, ${learnerName} !` : "Bonjour !",
          dailySpotlight: payload.dailySpotlight || null,
          spotlightAudioUrl: "",
          dashboard: normaliseDashboard(payload.dashboard),
          overview: {
            wordSummary: payload.wordSummary || { totalCount: 0, reviewedCount: 0, masteredCount: 0, dueCount: 0 },
            sentenceSummary: payload.sentenceSummary || { totalCount: 0, completedCount: 0 },
          },
          message: "",
        });
      })
      .catch((err) => {
        console.error(err);
        this.setData({ loading: false, message: err.message || "法语学习暂时不可用" });
      });
  },

  navigate(e) {
    if (!this.data.enabled) return;
    const url = String(e.currentTarget.dataset.url || "");
    if (url) wx.navigateTo({ url: frenchPreview.appendToUrl(this, url) });
  },

  playSpotlightAudio() {
    const spotlight = this.data.dailySpotlight;
    if (!spotlight || !spotlight.audioKey || !this.audioContext || this.data.spotlightAudioLoading) return;
    const audioKey = spotlight.audioKey;
    if (this.data.spotlightAudioUrl) {
      this.audioContext.stop();
      this.audioContext.src = this.data.spotlightAudioUrl;
      this.audioContext.play();
      return;
    }
    const requestVersion = (this.audioRequestVersion || 0) + 1;
    this.audioRequestVersion = requestVersion;
    this.setData({ spotlightAudioLoading: true });
    callCloud({ type: "getFrenchAudioUrl", data: frenchPreview.withData(this, { audioKey }) }).then((res) => {
      if (
        requestVersion !== this.audioRequestVersion
        || !this.data.dailySpotlight
        || this.data.dailySpotlight.audioKey !== audioKey
      ) return;
      const result = res.result || {};
      if (result.success === false) throw new Error(result.message || "音频暂不可用");
      const payload = result.data || result;
      if (!payload.tempUrl) throw new Error(payload.message || "这条音频暂不可用");
      this.setData({ spotlightAudioUrl: payload.tempUrl });
      this.audioContext.stop();
      this.audioContext.src = payload.tempUrl;
      this.audioContext.play();
    }).catch((err) => {
      if (requestVersion !== this.audioRequestVersion) return;
      console.error(err);
      wx.showToast({ title: err.message || "音频暂不可用", icon: "none" });
    }).finally(() => {
      if (requestVersion === this.audioRequestVersion) this.setData({ spotlightAudioLoading: false });
    });
  },
});
