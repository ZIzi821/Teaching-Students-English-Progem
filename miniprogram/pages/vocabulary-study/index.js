const { createVocabularyAudioPlayer } = require("../../utils/vocabularyAudio");

const MAX_SESSION_WORDS = 30;

Page({
  data: {
    studentId: "",
    previewStudentId: "",
    mode: "",
    loading: true,
    message: "",
    student: null,
    readOnly: true,
    canReview: false,
    words: [],
    currentIndex: 0,
    currentWord: null,
    answerShown: false,
    sessionDone: false,
    sessionPosition: 0,
    sessionTotal: 0,
    progressPercent: 0,
    reviewing: false,
    playingWordKey: "",
    audioLoadingWordKey: "",
    resultCounts: {
      forgot: 0,
      hard: 0,
      known: 0,
      easy: 0,
    },
  },

  onLoad(options) {
    this.initPronunciationPlayer();
    this.retryCounts = {};
    this.setData({
      studentId: String(options.studentId || ""),
      previewStudentId: String(options.previewStudentId || ""),
      mode: String(options.mode || ""),
    });
    this.loadSession();
  },

  onHide() {
    this.stopPronunciation();
  },

  onUnload() {
    if (this.pronunciationPlayer) {
      this.pronunciationPlayer.destroy();
      this.pronunciationPlayer = null;
    }
  },

  loadSession() {
    if (!this.data.studentId) {
      this.setData({ loading: false, message: "缺少学生信息" });
      return;
    }
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getVocabularyData",
        data: {
          studentId: this.data.studentId,
          previewStudentId: this.data.previewStudentId,
          mode: this.data.mode,
          browseTab: "today",
          offset: 0,
          limit: MAX_SESSION_WORDS,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "暂时无法准备今日单词");
      const role = String(result.role || "");
      const readOnly = Boolean(result.readOnly || role === "teacher");
      const dueWords = (result.todayWords || [])
        .filter((item) => item && item.isDue !== false)
        .slice(0, MAX_SESSION_WORDS)
        .map((item, index) => this.prepareWord(item, index));
      const previewFallback = readOnly && !dueWords.length
        ? (result.todayReviewedWords || []).slice(0, MAX_SESSION_WORDS).map((item, index) => this.prepareWord(item, index))
        : [];
      const words = dueWords.length ? dueWords : previewFallback;
      this.retryCounts = {};
      this.setData({
        loading: false,
        student: result.student || null,
        readOnly,
        canReview: role === "student" && !readOnly,
        words,
        currentIndex: 0,
        currentWord: words[0] || null,
        answerShown: false,
        sessionDone: !words.length,
        resultCounts: { forgot: 0, hard: 0, known: 0, easy: 0 },
        message: "",
      }, () => this.syncProgress());
    }).catch((err) => {
      console.error(err);
      this.setData({
        loading: false,
        message: err.message || "暂时无法准备今日单词",
      });
    });
  },

  prepareWord(item, index) {
    const source = item || {};
    const unitId = String(source.unitId || "");
    let memoryPrompt = "先读英文，在心里说出中文意思。";
    if (unitId === "letters") memoryPrompt = "先听字母名，再大声读两遍。";
    if (unitId.indexOf("numbers") === 0) memoryPrompt = "先看数字，再试着说出英文。";
    return {
      key: String(source.key || source.word || index),
      word: String(source.word || "待确认"),
      meaning: String(source.meaning || "释义待确认"),
      partOfSpeech: String(source.partOfSpeech || ""),
      levelLabel: String(source.levelLabel || ""),
      unitLabel: String(source.unitLabel || ""),
      unitId,
      sourceLabel: String(source.sourceLabel || "基础词库"),
      reviewedToday: source.reviewedToday === true,
      reviewCount: Math.max(0, Number(source.reviewCount) || 0),
      pronunciationFileId: String(source.pronunciationFileId || ""),
      pronunciationUrl: String(source.pronunciationUrl || ""),
      pronunciationStartMs: Math.max(0, Number(source.pronunciationStartMs) || 0),
      pronunciationDurationMs: Math.max(0, Number(source.pronunciationDurationMs) || 0),
      pronunciationDirectFileId: String(source.pronunciationDirectFileId || ""),
      pronunciationDirectUrl: String(source.pronunciationDirectUrl || ""),
      pronunciationDirectDurationMs: Math.max(0, Number(source.pronunciationDirectDurationMs) || 0),
      memoryPrompt,
      isRetry: source.isRetry === true,
    };
  },

  syncProgress() {
    const total = this.data.words.length;
    const position = total ? Math.min(this.data.currentIndex + 1, total) : 0;
    const completed = Math.min(this.data.currentIndex, total);
    this.setData({
      sessionPosition: position,
      sessionTotal: total,
      progressPercent: total ? Math.round(completed / total * 100) : 100,
    });
  },

  revealAnswer() {
    if (!this.data.currentWord || this.data.reviewing) return;
    this.setData({ answerShown: true });
  },

  rateWord(e) {
    const result = String(e.currentTarget.dataset.result || "");
    const word = this.data.currentWord;
    if (!word || this.data.reviewing || ["forgot", "hard", "known", "easy"].indexOf(result) < 0) return;
    if (!this.data.answerShown) {
      wx.showToast({ title: "请先查看答案", icon: "none" });
      return;
    }
    if (this.data.readOnly) {
      this.finishRating(result, word, false);
      return;
    }
    if (!this.data.canReview) return;
    this.setData({ reviewing: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "reviewVocabularyWord",
        data: {
          studentId: this.data.studentId,
          wordKey: word.key,
          result,
        },
      },
    }).then((res) => {
      const response = res.result || {};
      if (!response.success) throw new Error(response.message || "暂时无法保存学习结果");
      this.finishRating(result, word, true);
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "保存失败，请重试", icon: "none" });
    }).finally(() => {
      this.setData({ reviewing: false });
    });
  },

  finishRating(result, word, saved) {
    const resultCounts = Object.assign({}, this.data.resultCounts, {
      [result]: Number(this.data.resultCounts[result] || 0) + 1,
    });
    const words = this.data.words.slice();
    const shouldRetry = (result === "forgot" || result === "hard")
      && Number(this.retryCounts[word.key] || 0) < 1;
    if (shouldRetry) {
      this.retryCounts[word.key] = Number(this.retryCounts[word.key] || 0) + 1;
      words.push(Object.assign({}, word, { isRetry: true }));
    }
    const nextIndex = this.data.currentIndex + 1;
    const sessionDone = nextIndex >= words.length;
    const feedback = {
      forgot: "没关系，本轮后面再见一次",
      hard: "已放到本轮后面再练一次",
      known: "记住了，继续下一个",
      easy: "很熟练，之后减少出现",
    };
    wx.showToast({
      title: this.data.readOnly ? "预览选择，不保存进度" : feedback[result],
      icon: "none",
    });
    this.stopPronunciation();
    this.setData({
      words,
      currentIndex: nextIndex,
      currentWord: sessionDone ? null : words[nextIndex],
      answerShown: false,
      sessionDone,
      resultCounts,
      reviewing: false,
    }, () => this.syncProgress());
    if (saved && sessionDone && typeof wx.vibrateShort === "function") {
      wx.vibrateShort({ type: "light" });
    }
  },

  initPronunciationPlayer() {
    if (this.pronunciationPlayer) return;
    this.pronunciationPlayer = createVocabularyAudioPlayer({
      timeoutMs: 8000,
      onStateChange: ({ state, wordKey }) => {
        if (!this.data) return;
        if (state === "loading" || state === "waiting") {
          this.setData({ audioLoadingWordKey: wordKey, playingWordKey: "" });
          return;
        }
        if (state === "playing") {
          this.setData({ audioLoadingWordKey: "", playingWordKey: wordKey });
          return;
        }
        this.setData({ audioLoadingWordKey: "", playingWordKey: "" });
      },
      onError: (error) => {
        console.error("pronunciation playback failed", error);
        wx.showToast({ title: "发音加载失败，请检查网络后重试", icon: "none" });
      },
    });
  },

  stopPronunciation() {
    if (this.pronunciationPlayer) this.pronunciationPlayer.stop();
  },

  playPronunciation() {
    const word = this.data.currentWord;
    if (!word) return;
    const hasDirectAudio = word.pronunciationDirectDurationMs
      && (word.pronunciationDirectUrl || word.pronunciationDirectFileId);
    const hasFallbackAudio = word.pronunciationDurationMs
      && (word.pronunciationUrl || word.pronunciationFileId);
    if (!hasDirectAudio && !hasFallbackAudio) {
      wx.showToast({ title: "这个词暂时没有可播放的读音", icon: "none" });
      return;
    }
    this.initPronunciationPlayer();
    this.pronunciationPlayer.play({
      wordKey: word.key,
      directUrl: word.pronunciationDirectUrl,
      directFileId: word.pronunciationDirectFileId,
      directDurationMs: word.pronunciationDirectDurationMs,
      fallbackUrl: word.pronunciationUrl,
      fallbackFileId: word.pronunciationFileId,
      startMs: word.pronunciationStartMs,
      durationMs: word.pronunciationDurationMs,
    });
  },

  goChallenge() {
    const query = ["scope=smart"];
    if (this.data.studentId) query.push(`studentId=${encodeURIComponent(this.data.studentId)}`);
    if (this.data.previewStudentId) query.push(`previewStudentId=${encodeURIComponent(this.data.previewStudentId)}`);
    if (this.data.mode) query.push(`mode=${encodeURIComponent(this.data.mode)}`);
    wx.redirectTo({
      url: `/pages/vocabulary-challenge/index?${query.join("&")}`,
    });
  },

  goVocabularyHome() {
    const query = [];
    if (this.data.studentId) query.push(`studentId=${encodeURIComponent(this.data.studentId)}`);
    if (this.data.previewStudentId) query.push(`previewStudentId=${encodeURIComponent(this.data.previewStudentId)}`);
    if (this.data.mode) query.push(`mode=${encodeURIComponent(this.data.mode)}`);
    wx.redirectTo({
      url: `/pages/vocabulary/index?${query.join("&")}`,
    });
  },
});
