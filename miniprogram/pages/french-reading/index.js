const { callCloud } = require('../../utils/cloud');
const frenchPreview = require("../../utils/frenchPreview");

function normalizeActivity(item) {
  const progress = item.progress || {};
  return Object.assign({}, item, { completed: progress.completed === true || item.completed === true || item.isCompleted === true });
}

Page({
  data: {
    level: 'A1', loading: true, message: '', items: [], index: 0, current: null, showHelp: false, saving: false, mode: '', previewStudentId: '', isTeacherPreview: false,
  },

  onLoad(options) {
    this.requestVersion = 0;
    this.setData(frenchPreview.parseOptions(options));
    this.load();
  },

  cloud(type, data) {
    return callCloud({ type, data: frenchPreview.withData(this, data) }).then((response) => {
      const result = response.result || {};
      if (result.success === false) throw new Error(result.message || '暂不可用');
      return result.data || result;
    });
  },
  load() {
    const requestVersion = ++this.requestVersion;
    const { level } = this.data;
    this.setData({ loading: true, message: '', showHelp: false, saving: false });
    this.cloud('getFrenchReadings', { level }).then((payload) => {
      if (requestVersion !== this.requestVersion) return;
      const items = (payload.items || []).map(normalizeActivity);
      this.setData({ loading: false, items, index: 0, current: items[0] || null });
    }).catch((error) => {
      if (requestVersion !== this.requestVersion) return;
      this.setData({ loading: false, message: error.message || '暂时无法读取阅读' });
    });
  },

  switchLevel(event) {
    const { level } = event.currentTarget.dataset;
    if (level === this.data.level) return;
    this.setData({ level });
    this.load();
  },

  toggle() {
    this.setData({ showHelp: !this.data.showHelp });
  },

  moveNext() {
    const index = this.data.index + 1;
    this.setData({ index, current: this.data.items[index] || null, showHelp: false, saving: false });
  },
  complete() {
    if (frenchPreview.blockWrite(this)) return;
    const { current } = this.data;
    if (!current || this.data.saving) return;
    if (current.completed) {
      this.moveNext();
      return;
    }
    this.setData({ saving: true });
    this.cloud('completeFrenchActivity', { contentType: 'reading', contentId: current.id, questionCount: (current.comprehension || []).length }).then(() => {
      const items = this.data.items.map((item) => (item.id === current.id
        ? Object.assign({}, item, { completed: true, progress: Object.assign({}, item.progress, { completed: true }) })
        : item));
      this.setData({ items });
      this.moveNext();
    }).catch((error) => {
      this.setData({ saving: false });
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' });
    });
  },

  next() {
    if (!this.data.current) return;
    this.moveNext();
  },
});
