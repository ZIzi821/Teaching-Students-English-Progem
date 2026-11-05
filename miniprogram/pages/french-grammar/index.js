const { callCloud } = require('../../utils/cloud');
const frenchPreview = require("../../utils/frenchPreview");

function normalizeActivity(item) {
  const progress = item.progress || {};
  return Object.assign({}, item, {
    completed: progress.completed === true || item.completed === true || item.isCompleted === true,
    commonMistakesText: Array.isArray(item.commonMistakes) ? item.commonMistakes.join('；') : '',
  });
}

Page({
  data: {
    level: 'A1', loading: true, message: '', items: [], openId: '', summary: {}, savingId: '', mode: '', previewStudentId: '', isTeacherPreview: false,
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
    this.setData({ loading: true, message: '', openId: '', savingId: '' });
    this.cloud('getFrenchGrammar', { level }).then((payload) => {
      if (requestVersion !== this.requestVersion) return;
      this.setData({ loading: false, items: (payload.items || []).map(normalizeActivity), summary: payload.summary || {} });
    }).catch((error) => {
      if (requestVersion !== this.requestVersion) return;
      this.setData({ loading: false, message: error.message || '暂时无法读取语法' });
    });
  },

  switchLevel(event) {
    const { level } = event.currentTarget.dataset;
    if (level === this.data.level) return;
    this.setData({ level });
    this.load();
  },

  toggle(event) {
    const { id } = event.currentTarget.dataset;
    this.setData({ openId: this.data.openId === id ? '' : id });
  },

  complete(event) {
    if (frenchPreview.blockWrite(this)) return;
    const { id } = event.currentTarget.dataset;
    const activity = this.data.items.find((item) => item.id === id);
    if (!activity || activity.completed || this.data.savingId) return;
    this.setData({ savingId: id });
    this.cloud('completeFrenchActivity', { contentType: 'grammar', contentId: id }).then(() => {
      const items = this.data.items.map((item) => (item.id === id
        ? Object.assign({}, item, { completed: true, progress: Object.assign({}, item.progress, { completed: true }) })
        : item));
      this.setData({ items, savingId: '' });
    }).catch((error) => {
      this.setData({ savingId: '' });
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' });
    });
  },
});
