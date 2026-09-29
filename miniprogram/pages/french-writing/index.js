const frenchPreview = require("../../utils/frenchPreview");

const normalize = (value) => String(value || '')
  .normalize('NFC')
  .toLocaleLowerCase('fr-FR')
  .trim()
  .replace(/[.!?]+$/, '')
  .replace(/\s+/g, ' ');

function normalizeActivity(item) {
  const progress = item.progress || {};
  return Object.assign({}, item, { completed: progress.completed === true || item.completed === true || item.isCompleted === true });
}

Page({
  data: { level: 'A1', loading: true, message: '', items: [], index: 0, current: null, answer: '', tokens: [], usedTokenIndexes: [], showAnswer: false, result: '', saving: false, mode: '', previewStudentId: '', isTeacherPreview: false },
  onLoad(options) { this.requestVersion = 0; this.setData(frenchPreview.parseOptions(options)); this.load(); },
  cloud(type, data) { return wx.cloud.callFunction({ name: 'quickstartFunctions', data: { type, data: frenchPreview.withData(this, data) } }).then((response) => { const result = response.result || {}; if (result.success === false) throw new Error(result.message || '暂不可用'); return result.data || result; }); },
  resetExercise(index, items) { this.setData({ index, current: items[index] || null, answer: '', tokens: [], usedTokenIndexes: [], showAnswer: false, result: '', saving: false }); },
  load() {
    const requestVersion = ++this.requestVersion;
    const { level } = this.data;
    this.setData({ loading: true, message: '', showAnswer: false, saving: false });
    this.cloud('getFrenchWritingActivities', { level }).then((payload) => { if (requestVersion !== this.requestVersion) return; const items = (payload.items || []).map(normalizeActivity); this.setData({ loading: false, items }); this.resetExercise(0, items); }).catch((error) => { if (requestVersion !== this.requestVersion) return; this.setData({ loading: false, message: error.message || '暂时无法读取造句' }); });
  },
  switchLevel(event) { const { level } = event.currentTarget.dataset; if (level === this.data.level) return; this.setData({ level }); this.load(); },
  add(event) {
    const { token, index } = event.currentTarget.dataset;
    if (this.data.usedTokenIndexes.indexOf(index) !== -1) return;
    const tokens = this.data.tokens.concat(token);
    this.setData({ tokens, usedTokenIndexes: this.data.usedTokenIndexes.concat(index), answer: tokens.join(' ') });
  },
  input(event) { this.setData({ answer: event.detail.value, tokens: [], usedTokenIndexes: [] }); },
  check() {
    const { current, answer } = this.data;
    if (!current || this.data.saving) return;
    if (!answer.trim()) { wx.showToast({ title: '先写出一句法语再检查', icon: 'none' }); return; }
    const correct = normalize(answer) === normalize(current.answer);
    if (this.data.isTeacherPreview) {
      this.setData({ showAnswer: true, result: correct ? '正确！' : '再对照参考答案看一看。' });
      return;
    }
    this.setData({ showAnswer: true, result: correct ? '正确！' : '再对照参考答案看一看。', saving: true });
    this.cloud('completeFrenchActivity', { contentType: 'writing', contentId: current.id, correct }).then((payload) => {
      const completed = Boolean(payload.progress && payload.progress.completed);
      const items = this.data.items.map((item) => (item.id === current.id
        ? Object.assign({}, item, { completed, progress: Object.assign({}, item.progress, { completed }) })
        : item));
      this.setData({ items, current: Object.assign({}, current, { completed }), saving: false });
    }).catch((error) => { this.setData({ saving: false }); wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' }); });
  },
  next() { if (!this.data.current) return; this.resetExercise(this.data.index + 1, this.data.items); },
});
