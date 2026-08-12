const challenge = require("../../utils/vocabularyChallenge");

Page({
  data: {
    studentId: "",
    previewStudentId: "",
    mode: "",
    scope: "smart",
    loading: true,
    message: "",
    student: null,
    canReview: false,
    readOnly: true,
    questionIndex: 0,
    totalQuestions: 0,
    progressPercent: 0,
    currentQuestion: null,
    spellingAnswer: "",
    answered: false,
    answerCorrect: false,
    answerMessage: "",
    saving: false,
    saveWarning: "",
    saveFailureCount: 0,
    score: 0,
    completed: false,
    accuracy: 0,
    incorrectCount: 0,
    resultSegments: [],
  },

  onLoad(options) {
    this.setData({
      studentId: options.studentId || "",
      previewStudentId: options.previewStudentId || "",
      mode: options.mode || "",
      scope: options.scope === "weak" ? "weak" : "smart",
    });
    this.loadChallenge();
  },

  loadChallenge() {
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getVocabularyData",
        data: {
          studentId: this.data.studentId,
          previewStudentId: this.data.previewStudentId,
          mode: this.data.mode,
          browseTab: this.data.scope === "weak" ? "weak" : "all",
          offset: 0,
          limit: 60,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "暂时无法准备挑战");
      const role = result.role || "guest";
      const canReview = role === "student" && result.readOnly !== true;
      const allWords = challenge.uniqueWords((result.words || []).concat(result.todayWords || []));
      this.allWords = allWords;
      this.todayWords = challenge.uniqueWords(result.todayWords || []);
      this.wordsByKey = new Map(allWords.map((item) => [String(item.key || item.word), item]));
      this.setData({
        student: result.student || null,
        canReview,
        readOnly: !canReview,
        loading: false,
      });
      this.startSession(this.data.scope);
    }).catch((err) => {
      console.error(err);
      this.setData({
        loading: false,
        message: err.message || "暂时无法准备挑战，请稍后重试",
      });
    });
  },

  startSession(scope, retryWords) {
    const selectedWords = challenge.selectChallengeWords({
      todayWords: retryWords || this.todayWords || [],
      allWords: retryWords || this.allWords || [],
      scope: retryWords ? "retry" : scope,
      limit: 6,
    });
    const questions = challenge.buildChallengeQuestions(selectedWords, this.allWords || []);
    if (!questions.length) {
      this.setData({
        message: scope === "weak"
          ? "需要巩固的单词正在等待复习时间，可以先做综合挑战。"
          : "当前没有可用于挑战的已确认单词。",
      });
      return;
    }
    this.questions = questions;
    this.sessionResults = [];
    this.setData({
      scope,
      score: 0,
      completed: false,
      accuracy: 0,
      incorrectCount: 0,
      resultSegments: [],
      saveFailureCount: 0,
      totalQuestions: questions.length,
      message: "",
    });
    this.showQuestion(0);
  },

  showQuestion(index) {
    const current = this.questions[index];
    this.setData({
      questionIndex: index,
      progressPercent: Math.round(index / this.questions.length * 100),
      currentQuestion: Object.assign({}, current, {
        options: current.options.map((item) => Object.assign({}, item, { state: "" })),
      }),
      spellingAnswer: "",
      answered: false,
      answerCorrect: false,
      answerMessage: "",
      saveWarning: "",
      saving: false,
    });
  },

  selectOption(e) {
    if (this.data.answered || this.data.saving) return;
    const optionIndex = Number(e.currentTarget.dataset.index);
    const option = this.data.currentQuestion.options[optionIndex];
    if (!option) return;
    this.finishAnswer(option.label);
  },

  onSpellingInput(e) {
    this.setData({ spellingAnswer: String(e.detail.value || "") });
  },

  submitSpelling() {
    if (this.data.answered || this.data.saving) return;
    if (!challenge.normalizeAnswer(this.data.spellingAnswer)) {
      wx.showToast({ title: "请先输入英文答案", icon: "none" });
      return;
    }
    this.finishAnswer(this.data.spellingAnswer);
  },

  finishAnswer(answer) {
    const question = this.data.currentQuestion;
    const isCorrect = challenge.normalizeAnswer(answer) === challenge.normalizeAnswer(question.answer);
    const options = question.options.map((item) => {
      let state = "";
      if (item.isAnswer) state = "correct";
      if (!isCorrect && challenge.normalizeAnswer(item.label) === challenge.normalizeAnswer(answer)) {
        state = "wrong";
      }
      return Object.assign({}, item, { state });
    });
    this.sessionResults.push({
      wordKey: question.wordKey,
      word: question.word,
      correct: isCorrect,
    });
    this.setData({
      currentQuestion: Object.assign({}, question, { options }),
      answered: true,
      answerCorrect: isCorrect,
      answerMessage: isCorrect
        ? "答对了，记忆更稳了一步"
        : this.data.readOnly ? "这次没想起来，可在学生端继续巩固" : "这次没想起来，稍后会再复习",
      score: this.data.score + (isCorrect ? 1 : 0),
    });
    if (this.data.canReview) this.saveReview(question.wordKey, isCorrect);
  },

  saveReview(wordKey, isCorrect) {
    this.setData({ saving: true, saveWarning: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "reviewVocabularyWord",
        data: {
          studentId: this.data.studentId,
          wordKey,
          result: isCorrect ? "known" : "forgot",
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "学习结果保存失败");
    }).catch((err) => {
      console.error(err);
      this.setData({
        saveWarning: "本题结果未保存，可继续完成挑战后再回单词页复习。",
        saveFailureCount: this.data.saveFailureCount + 1,
      });
    }).finally(() => {
      this.setData({ saving: false });
    });
  },

  nextQuestion() {
    if (!this.data.answered || this.data.saving) return;
    const nextIndex = this.data.questionIndex + 1;
    if (nextIndex < this.questions.length) {
      this.showQuestion(nextIndex);
      return;
    }
    const total = this.sessionResults.length;
    const score = this.sessionResults.filter((item) => item.correct).length;
    const incorrectCount = total - score;
    this.setData({
      completed: true,
      progressPercent: 100,
      score,
      accuracy: total ? Math.round(score / total * 100) : 0,
      incorrectCount,
      resultSegments: [
        { label: "答对", value: score, color: "#4f8f73" },
        { label: "需巩固", value: incorrectCount, color: "#e0b96a" },
      ],
    });
  },

  retryMistakes() {
    const retryWords = this.sessionResults
      .filter((item) => !item.correct)
      .map((item) => this.wordsByKey.get(item.wordKey))
      .filter(Boolean);
    if (!retryWords.length) return;
    this.startSession("weak", retryWords);
  },

  restartSession() {
    this.startSession(this.data.scope);
  },

  startSmartChallenge() {
    this.setData({ scope: "smart", message: "" }, () => this.loadChallenge());
  },

  goBack() {
    wx.navigateBack();
  },
});
