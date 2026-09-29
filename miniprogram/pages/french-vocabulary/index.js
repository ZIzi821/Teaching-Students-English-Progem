const frenchPreview = require("../../utils/frenchPreview");

const PART_OF_SPEECH = {
  noun: "名词",
  verb: "动词",
  adjective: "形容词",
  adverb: "副词",
  pronoun: "代词",
  number: "数词",
  expression: "常用表达",
  interjection: "感叹词",
  preposition: "介词",
  conjunction: "连接词",
};

const GENDER = { m: "阳性", f: "阴性" };

Page({
  data: {
    loading: true,
    submitting: false,
    audioLoading: false,
    message: "",
    enabled: false,
    levels: ["A1", "A2", "All"],
    level: "A1",
    query: "",
    queue: [],
    currentIndex: 0,
    currentWord: null,
    revealed: false,
    freeBrowse: false,
    counts: {},
    audioUrls: {},
    roundHint: "",
    reviewMode: "daily",
    mode: "",
    previewStudentId: "",
    isTeacherPreview: false,
  },

  onLoad(options) {
    this.requestVersion = 0;
    this.audioRequestVersion = 0;
    this.setData(Object.assign({}, frenchPreview.parseOptions(options), {
      reviewMode: options && (options.practice === "difficult" || options.mode === "difficult")
        ? "difficult"
        : "daily",
    }));
    this.audioContext = wx.createInnerAudioContext();
    this.audioContext.obeyMuteSwitch = false;
    this.audioContext.onError(() => {
      if (this.currentAudioKey) this.setData({ [`audioUrls.${this.currentAudioKey}`]: "" });
      this.setData({ audioLoading: false });
      wx.showToast({ title: "音频播放失败，请稍后再试", icon: "none" });
    });
  },

  onShow() {
    this.loadQueue();
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

  normalizeWord(word) {
    return Object.assign({}, word, {
      display: word.displayForm || word.display || word.text || word.lemma || "",
      meaningCN: word.meaningCN || word.meaning || "",
      meaningEN: word.meaningEN || "",
      posLabel: PART_OF_SPEECH[word.partOfSpeech] || word.partOfSpeech || "",
      genderLabel: GENDER[word.gender] || "",
      topicLabel: word.topicLabel || word.topic || "",
      progress: word.progress || {},
    });
  },

  callCloud(type, data) {
    return wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type, data: frenchPreview.withData(this, data) },
    }).then((response) => {
      const result = response.result || {};
      if (result.success === false) throw new Error(result.message || "暂时不可用");
      return result.data || result;
    });
  },

  loadQueue() {
    const requestVersion = ++this.requestVersion;
    const level = this.data.level;
    this.stopAudio();
    this.setData({ loading: true, message: "", freeBrowse: false, revealed: false });
    if (!wx.cloud) {
      this.setData({ loading: false, message: "微信版本过低，请更新后重试" });
      return;
    }
    this.callCloud("getFrenchReviewQueue", {
      level,
      difficultyOnly: this.data.reviewMode === "difficult",
    }).then((payload) => {
      if (requestVersion !== this.requestVersion) return;
      const queue = (payload.queue || []).map((word) => this.normalizeWord(word));
      const counts = payload.counts || {};
      this.setData({
        loading: false,
        enabled: payload.enabled !== false,
        queue,
        currentIndex: 0,
        currentWord: queue[0] || null,
        counts,
        roundHint: this.data.reviewMode === "difficult"
          ? `难词专项 ${counts.difficult || 0} 个`
          : `到期 ${counts.dueToday || 0} 个 · 新词 ${counts.new || 0} 个`,
      });
    }).catch((error) => {
      if (requestVersion !== this.requestVersion) return;
      console.error(error);
      this.setData({ loading: false, message: error.message || "复习队列暂不可用" });
    });
  },

  switchLevel(event) {
    this.setData({ level: event.currentTarget.dataset.level, query: "" });
    this.loadQueue();
  },

  onSearch(event) {
    this.setData({ query: event.detail.value || "" });
  },

  searchWords() {
    const requestVersion = ++this.requestVersion;
    const level = this.data.level;
    const query = this.data.query;
    this.stopAudio();
    this.setData({ loading: true, message: "", revealed: false, freeBrowse: true });
    this.callCloud("getFrenchWords", { level, query }).then((payload) => {
      if (requestVersion !== this.requestVersion) return;
      const queue = (payload.words || []).map((word) => this.normalizeWord(word));
      this.setData({
        loading: false,
        queue,
        currentIndex: 0,
        currentWord: queue[0] || null,
        roundHint: `自由浏览 ${queue.length} 个`,
      });
    }).catch((error) => {
      if (requestVersion !== this.requestVersion) return;
      console.error(error);
      this.setData({ loading: false, message: error.message || "搜索暂不可用" });
    });
  },

  reveal() {
    this.setData({ revealed: true });
  },

  move(index) {
    this.stopAudio();
    const queue = this.data.queue;
    const nextIndex = Math.max(0, Math.min(index, queue.length));
    this.setData({
      currentIndex: nextIndex,
      currentWord: queue[nextIndex] || null,
      revealed: false,
    });
  },

  review(event) {
    if (frenchPreview.blockWrite(this)) return;
    const word = this.data.currentWord;
    const result = event.currentTarget.dataset.result;
    if (!word || this.data.submitting) return;
    this.setData({ submitting: true });
    this.callCloud("reviewFrenchWord", { wordId: word.id, result }).then(() => {
      this.move(this.data.currentIndex + 1);
    }).catch((error) => {
      console.error(error);
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    }).finally(() => this.setData({ submitting: false }));
  },

  playAudio() {
    const word = this.data.currentWord;
    if (!word || !word.audioKey || !this.audioContext || this.data.audioLoading) return;
    const audioKey = word.audioKey;
    const cachedUrl = this.data.audioUrls[audioKey];
    const audioRequestVersion = (this.audioRequestVersion || 0) + 1;
    this.audioRequestVersion = audioRequestVersion;
    this.currentAudioKey = audioKey;
    if (cachedUrl) {
      this.audioContext.stop();
      this.audioContext.src = cachedUrl;
      this.audioContext.play();
      return;
    }
    this.setData({ audioLoading: true });
    this.callCloud("getFrenchAudioUrl", { audioKey }).then((payload) => {
      if (
        audioRequestVersion !== this.audioRequestVersion
        || !this.data.currentWord
        || this.data.currentWord.audioKey !== audioKey
      ) return;
      if (!payload.tempUrl) throw new Error(payload.message || "这条音频尚未上传");
      this.setData({ [`audioUrls.${audioKey}`]: payload.tempUrl });
      this.audioContext.stop();
      this.audioContext.src = payload.tempUrl;
      this.audioContext.play();
    }).catch((error) => {
      if (audioRequestVersion !== this.audioRequestVersion) return;
      console.error(error);
      wx.showToast({ title: error.message || "音频暂不可用", icon: "none" });
    }).finally(() => {
      if (audioRequestVersion === this.audioRequestVersion) this.setData({ audioLoading: false });
    });
  },

  openMemory() {
    const word = this.data.currentWord;
    if (word) {
      wx.navigateTo({
        url: frenchPreview.appendToUrl(
          this,
          `/pages/french-memory/index?wordId=${encodeURIComponent(word.id)}`
        ),
      });
    }
  },
});
