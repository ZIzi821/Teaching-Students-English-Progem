const frenchPreview = require("../../utils/frenchPreview");
const { callCloud } = require("../../utils/cloud");

const PALETTE = ["#14645A", "#7b8eaa", "#b78a5a", "#a87974", "#8f9a69"];
const MEMORY_LABELS = { new: "未学习", learning: "学习中", review: "复习中", mastered: "已掌握" };
const clamp = (value, maximum) => Math.max(0, Math.min(maximum, Number(value) || 0));
const asArray = (value) => Array.isArray(value) ? value : [];
const firstValue = (item, keys) => {
  const source = item && typeof item === "object" ? item : {};
  const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(source, candidate));
  return key ? source[key] : 0;
};

const normalisePoints = (value, keys) => asArray(value).map((item, index) => ({
  label: String((item && (item.label || item.day || item.date || item.name)) || `第${index + 1}天`),
  value: clamp(firstValue(item, keys.valueKeys), keys.maximum),
  goal: clamp(firstValue(item, keys.goalKeys), keys.maximum),
}));

const normaliseDistribution = (value) => {
  const values = Array.isArray(value) ? value : Object.keys(value && typeof value === "object" ? value : {}).map((key) => ({ label: key, value: value[key] }));
  return values.map((item, index) => {
    const rawLabel = String(item.label || item.name || item.status || "learning");
    return { label: MEMORY_LABELS[rawLabel] || rawLabel, value: Math.max(0, Number(item.value !== undefined ? item.value : item.count) || 0), color: item.color || PALETTE[index % PALETTE.length] };
  });
};

const dimensionPercent = (dimension) => clamp(
  dimension && typeof dimension === "object" ? dimension.percent : dimension,
  100
);

const normaliseLevels = (value) => asArray(value).map((item) => {
  const dimensions = item && item.dimensions || {};
  return {
    cefrLevel: String(item && (item.cefrLevel || item.level) || "A1"), label: String(item && item.label || "学习中"), status: String(item && item.status || "持续学习中"), overallPercent: clamp(item && item.overallPercent, 100),
    dimensions: [
      { label: "词汇", value: dimensionPercent(dimensions.vocabulary) }, { label: "语法", value: dimensionPercent(dimensions.grammar) }, { label: "表达", value: dimensionPercent(dimensions.expressions) },
      { label: "听力", value: dimensionPercent(dimensions.listening) }, { label: "阅读", value: dimensionPercent(dimensions.reading) }, { label: "写作", value: dimensionPercent(dimensions.writing) },
    ],
  };
});

const normaliseDashboard = (dashboard) => {
  const source = dashboard && typeof dashboard === "object" ? dashboard : {};
  const today = source.today && typeof source.today === "object" ? source.today : {};
  const workload = source.reviewWorkload && typeof source.reviewWorkload === "object" ? source.reviewWorkload : {};
  const accuracy7 = source.accuracy7 && typeof source.accuracy7 === "object" ? source.accuracy7 : {};
  const difficultWords = asArray(source.difficultWords).map((item) => ({ text: String(item && (item.displayForm || item.lemma || item.text || item.word || item.term) || "未命名词条"), meaning: String(item && (item.meaningCN || item.meaning || item.translation || "") || ""), lapseCount: Math.max(0, Number(item && (item.lapseCount || item.lapses)) || 0) }));
  const memorySegments = normaliseDistribution(source.memoryDistribution);
  return {
    today: { dueCount: Math.max(0, Number(today.dueCount) || 0), newWordCount: Math.max(0, Number(today.newWordCount) || 0), reviewedCount: Math.max(0, Number(today.reviewedCount) || 0), activityCount: Math.max(0, Number(today.activityCount) || 0), goal: Math.max(0, Number(today.goal) || 0) },
    streakDays: Math.max(0, Number(source.streakDays) || 0), levels: normaliseLevels(source.levelProgress), memorySegments,
    memoryTotal: String(memorySegments.reduce((sum, item) => sum + item.value, 0)),
    trendPoints: normalisePoints(source.trend7, { valueKeys: ["value", "reviewedCount", "activityCount", "count"], goalKeys: ["goal", "dailyGoal"], maximum: 9999 }),
    workloadPoints: normalisePoints(workload.points, { valueKeys: ["value", "count", "dueCount", "scheduledCount"], goalKeys: ["goal", "dailyGoal"], maximum: 9999 }),
    workload: { overdueCount: Math.max(0, Number(workload.overdueCount) || 0), dueToday: Math.max(0, Number(workload.dueToday) || 0), tomorrow: Math.max(0, Number(workload.tomorrow) || 0), nextSevenDays: Math.max(0, Number(workload.nextSevenDays) || 0) },
    accuracy7: clamp(accuracy7.accuracyPercent, 100), accuracy30: clamp(source.accuracy30 && source.accuracy30.accuracyPercent !== undefined ? source.accuracy30.accuracyPercent : source.accuracy30, 100), difficultWords,
  };
};

Page({
  data: { loading: true, message: "", dashboard: normaliseDashboard({}), mode: "", previewStudentId: "", isTeacherPreview: false },
  onLoad(options) { this.setData(frenchPreview.parseOptions(options)); },
  onShow() { this.loadDashboard(); },
  loadDashboard() {
    this.setData({ loading: true, message: "" });
    if (!wx.cloud) { this.setData({ loading: false, message: "微信版本过低，请更新后重试" }); return; }
    callCloud({ type: "getFrenchDashboard", data: frenchPreview.withData(this, {}) })
      .then((res) => {
        const result = res.result || {};
        if (result.success === false) throw new Error(result.message || "暂时无法读取学习进度");
        const payload = result.data || result;
        this.setData({ loading: false, dashboard: normaliseDashboard(payload.dashboard || payload), message: "" });
      })
      .catch((err) => { console.error(err); this.setData({ loading: false, message: err.message || "学习进度暂时不可用" }); });
  },
  goReview() { wx.navigateTo({ url: frenchPreview.appendToUrl(this, "/pages/french-vocabulary/index?practice=difficult") }); },
});
