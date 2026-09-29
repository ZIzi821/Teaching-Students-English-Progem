const frenchPreview = require("../../utils/frenchPreview");

Page({
  data: {
    loading: true,
    submitting: false,
    message: "",
    enabled: false,
    level: "A1",
    sentences: [],
    currentIndex: 0,
    currentSentence: null,
    audioUrls: {},
    audioLoading: false,
    mode: "",
    previewStudentId: "",
    isTeacherPreview: false,
  },

  onLoad(options) {
    this.requestVersion = 0;
    this.audioRequestVersion = 0;
    this.setData(frenchPreview.parseOptions(options));
    this.audioContext = wx.createInnerAudioContext();
    this.audioContext.obeyMuteSwitch = false;
    this.audioContext.onError(() => {
      if (this.currentAudioKey) {
        this.setData({ ["audioUrls." + this.currentAudioKey]: "" });
      }
      this.setData({ audioLoading: false });
      wx.showToast({ title: "音频播放失败，请稍后再试", icon: "none" });
    });
  },

  onShow() {
    this.loadSentences();
  },

  onHide() {
    this.stopAudio();
  },

  onUnload() {
    if (this.audioContext) {
      this.stopAudio();
      this.audioContext.destroy();
      this.audioContext = null;
    }
  },

  stopAudio() {
    this.audioRequestVersion = (this.audioRequestVersion || 0) + 1;
    this.currentAudioKey = "";
    if (this.audioContext) this.audioContext.stop();
    if (this.data.audioLoading) this.setData({ audioLoading: false });
  },

  loadSentences() {
    const requestVersion = ++this.requestVersion;
    const level = this.data.level;
    this.stopAudio();
    this.setData({ loading: true, message: "" });
    if (!wx.cloud) {
      this.setData({ loading: false, message: "微信版本过低，请更新后重试" });
      return;
    }
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: { type: "getFrenchSentences", data: frenchPreview.withData(this, { level }) },
      })
      .then((res) => {
        if (requestVersion !== this.requestVersion) return;
        const result = res.result || {};
        if (result.success === false) throw new Error(result.message || "暂时无法读取法语句子");
        const payload = result.data || result;
        const sentences = (payload.sentences || []).map((item) => Object.assign({}, item, {
          text: item.text || item.sentence || "",
          translation: item.translationCN || item.meaningCN || item.translation || item.meaning || "",
          note: item.cueCN || item.note || item.cue || "",
          topicLabel: item.topicLabel || item.topic || "",
          completed: item.completed === true || item.isCompleted === true || Boolean(item.progress && item.progress.completed),
        }));
        this.setData({
          loading: false,
          enabled: payload.enabled !== false,
          sentences,
          currentIndex: 0,
          currentSentence: sentences[0] || null,
          message: "",
        });
      })
      .catch((err) => {
        if (requestVersion !== this.requestVersion) return;
        console.error(err);
        this.setData({ loading: false, message: err.message || "法语句子暂时不可用" });
      });
  },

  switchLevel(e) {
    this.setData({ level: e.currentTarget.dataset.level });
    this.loadSentences();
  },

  updateCurrentSentence(index) {
    this.stopAudio();
    const safeIndex = Math.max(0, Math.min(index, this.data.sentences.length));
    this.setData({
      currentIndex: safeIndex,
      currentSentence: this.data.sentences[safeIndex] || null,
    });
  },

  playAudio(e) {
    const audioKey = (e && e.currentTarget && e.currentTarget.dataset.key) || (this.data.currentSentence && this.data.currentSentence.audioKey);
    if (!audioKey || !this.audioContext || this.data.audioLoading) return;
    const sentenceId = this.data.currentSentence && this.data.currentSentence.id;
    const audioRequestVersion = (this.audioRequestVersion || 0) + 1;
    this.audioRequestVersion = audioRequestVersion;
    this.currentAudioKey = audioKey;
    const cachedUrl = this.data.audioUrls[audioKey];
    if (cachedUrl) {
      this.audioContext.stop();
      this.audioContext.src = cachedUrl;
      this.audioContext.play();
      return;
    }
    this.setData({ audioLoading: true });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: { type: "getFrenchAudioUrl", data: frenchPreview.withData(this, { audioKey }) },
      })
      .then((res) => {
        if (
          audioRequestVersion !== this.audioRequestVersion
          || !this.data.currentSentence
          || this.data.currentSentence.id !== sentenceId
          || this.data.currentSentence.audioKey !== audioKey
        ) return;
        const result = res.result || {};
        if (result.success === false) throw new Error(result.message || "音频暂不可用");
        const payload = result.data || result;
        if (payload.available === false || !payload.tempUrl) {
          throw new Error(payload.message || "音频还未上传，暂时无法播放");
        }
        this.setData({ ["audioUrls." + audioKey]: payload.tempUrl });
        this.audioContext.stop();
        this.audioContext.src = payload.tempUrl;
        this.audioContext.play();
      })
      .catch((err) => {
        if (audioRequestVersion !== this.audioRequestVersion) return;
        console.error(err);
        wx.showToast({ title: err.message || "音频暂不可用", icon: "none" });
      })
      .finally(() => {
        if (audioRequestVersion === this.audioRequestVersion) this.setData({ audioLoading: false });
      });
  },

  completeSentence() {
    if (frenchPreview.blockWrite(this)) return;
    const sentence = this.data.currentSentence;
    if (!sentence || !sentence.id || this.data.submitting) return;
    this.setData({ submitting: true });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "completeFrenchSentence",
          data: frenchPreview.withData(this, { sentenceId: sentence.id }),
        },
      })
      .then((res) => {
        const response = res.result || {};
        if (response.success === false) throw new Error(response.message || "跟读记录保存失败");
        const sentences = this.data.sentences.slice();
        sentences[this.data.currentIndex] = Object.assign({}, sentence, { completed: true });
        this.setData({ sentences });
        this.updateCurrentSentence(this.data.currentIndex + 1);
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: err.message || "保存失败，请重试", icon: "none" });
      })
      .finally(() => this.setData({ submitting: false }));
  },

  nextSentence() {
    if (this.data.submitting) return;
    this.updateCurrentSentence(this.data.currentIndex + 1);
  },

  restart() {
    this.updateCurrentSentence(0);
  },
});
