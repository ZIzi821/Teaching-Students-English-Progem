const frenchPreview = require("../../utils/frenchPreview");

function normalizeActivity(item) {
  const progress = item.progress || {};
  return Object.assign({}, item, {
    completed: progress.completed === true || item.completed === true || item.isCompleted === true,
  });
}

Page({
  data: {
    level: 'A1', loading: true, message: '', items: [], summary: {}, audioUrls: {}, playingId: '', audioLoadingId: '', savingId: '', mode: '', previewStudentId: '', isTeacherPreview: false,
  },

  onLoad(options) {
    this.requestVersion = 0;
    this.audioRequestVersion = 0;
    this.setData(frenchPreview.parseOptions(options));
    this.audio = wx.createInnerAudioContext();
    this.audio.obeyMuteSwitch = false;
    this.audio.onEnded(() => this.clearPlaying());
    this.audio.onError(() => {
      this.setData({ audioLoadingId: '' });
      this.clearPlaying();
      wx.showToast({ title: '音频播放失败，请稍后重试', icon: 'none' });
    });
  },

  onShow() { this.load(); },
  onHide() { this.stopAudio(); },
  onUnload() {
    this.stopAudio();
    if (this.audio) this.audio.destroy();
  },

  cloud(type, data) {
    return wx.cloud.callFunction({ name: 'quickstartFunctions', data: { type, data: frenchPreview.withData(this, data) } }).then((response) => {
      const result = response.result || {};
      if (result.success === false) throw new Error(result.message || '暂不可用');
      return result.data || result;
    });
  },

  clearPlaying() {
    if (this.data.playingId) this.setData({ playingId: '' });
  },

  stopAudio() {
    this.audioRequestVersion = (this.audioRequestVersion || 0) + 1;
    if (this.audio) this.audio.stop();
    if (this.data.playingId || this.data.audioLoadingId) this.setData({ playingId: '', audioLoadingId: '' });
  },

  load() {
    const requestVersion = ++this.requestVersion;
    const { level } = this.data;
    this.stopAudio();
    this.setData({ loading: true, message: '', savingId: '' });
    this.cloud('getFrenchExpressions', { level }).then((payload) => {
      if (requestVersion !== this.requestVersion) return;
      this.setData({ loading: false, items: (payload.items || []).map(normalizeActivity), summary: payload.summary || {} });
    }).catch((error) => {
      if (requestVersion !== this.requestVersion) return;
      this.setData({ loading: false, message: error.message || '暂时无法读取表达' });
    });
  },

  switchLevel(event) {
    const { level } = event.currentTarget.dataset;
    if (level === this.data.level) return;
    this.setData({ level });
    this.load();
  },

  startAudio(id, url) {
    if (!this.audio) return;
    this.audio.stop();
    this.audio.src = url;
    this.setData({ playingId: id });
    this.audio.play();
  },

  play(event) {
    const { id, key } = event.currentTarget.dataset;
    if (!key) {
      wx.showToast({ title: '该表达暂未提供音频', icon: 'none' });
      return;
    }
    if (this.data.playingId === id) {
      this.stopAudio();
      return;
    }
    const audioRequestVersion = (this.audioRequestVersion || 0) + 1;
    this.audioRequestVersion = audioRequestVersion;
    const cachedUrl = this.data.audioUrls[key];
    if (cachedUrl) {
      this.startAudio(id, cachedUrl);
      return;
    }
    this.setData({ audioLoadingId: id });
    this.cloud('getFrenchAudioUrl', { audioKey: key }).then((payload) => {
      if (audioRequestVersion !== this.audioRequestVersion) return;
      if (!payload.tempUrl) throw new Error(payload.message || '该表达音频尚未上传');
      this.setData({ ['audioUrls.' + key]: payload.tempUrl });
      this.startAudio(id, payload.tempUrl);
    }).catch((error) => {
      if (audioRequestVersion !== this.audioRequestVersion) return;
      wx.showToast({ title: error.message || '音频暂不可用', icon: 'none' });
    }).finally(() => {
      if (audioRequestVersion === this.audioRequestVersion && this.data.audioLoadingId === id) {
        this.setData({ audioLoadingId: '' });
      }
    });
  },

  complete(event) {
    if (frenchPreview.blockWrite(this)) return;
    const { id } = event.currentTarget.dataset;
    const activity = this.data.items.find((item) => item.id === id);
    if (!activity || activity.completed || this.data.savingId) return;
    this.setData({ savingId: id });
    this.cloud('completeFrenchActivity', { contentType: 'expression', contentId: id }).then(() => {
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
