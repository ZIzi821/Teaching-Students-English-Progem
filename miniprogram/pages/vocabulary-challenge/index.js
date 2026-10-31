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
    estimatedMinutes: 0,
    focusLabel: "",
    dailyGoal: 8,
    algorithmVersion: "",
    sessionSaved: false,
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
          limit: 100,
          quizMode: true,
          quizScope: this.data.scope,
        },
      },
    }).then((res) => {
      const result = res.result || {};
        if (!result.success) throw new Error(result.message || "暂时无法准备小测");
      const role = result.role || "guest";
      const canReview = role === "student" && result.readOnly !== true;
      const plannedWords = result.quizPlan && Array.isArray(result.quizPlan.words)
        ? result.quizPlan.words
        : [];
      const allWords = challenge.uniqueWords(
        (result.words || []).concat(result.todayWords || [], plannedWords)
      );
      this.allWords = allWords;
      this.todayWords = challenge.uniqueWords(result.todayWords || []);
      this.quizPlan = result.quizPlan || null;
      this.wordsByKey = new Map(allWords.map((item) => [String(item.key || item.word), item]));
      this.setData({
        student: result.student || null,
        canReview,
        readOnly: !canReview,
        loading: false,
        estimatedMinutes: Number(this.quizPlan && this.quizPlan.estimatedMinutes || 0),
        focusLabel: String(this.quizPlan && this.quizPlan.focusLabel || ""),
        dailyGoal: Number(this.quizPlan && this.quizPlan.dailyGoal || 8),
        algorithmVersion: String(this.quizPlan && this.quizPlan.algorithmVersion || ""),
      });
      this.startSession(this.data.scope);
    }).catch((err) => {
      console.error(err);
      this.setData({
        loading: false,
          message: err.message || "暂时无法准备小测，请稍后重试",
      });
    });
  },

  startSession(scope, retryWords) {
    const selectedWords = retryWords || (this.quizPlan && this.quizPlan.words) || challenge.selectChallengeWords({
      todayWords: this.todayWords || [],
      allWords: this.allWords || [],
      scope,
      limit: 8,
    });
    const questions = challenge.buildChallengeQuestions(selectedWords, this.allWords || []);
    if (!questions.length) {
      this.setData({
        message: scope === "weak"
          ? "这些词还没到复习时间，可以先做综合小测。"
          : "暂时没有可以出题的单词。",
      });
      return;
    }
    this.questions = questions;
    this.sessionResults = [];
    this.sessionStartedAtMs = Date.now();
    this.setData({
      scope,
      score: 0,
      completed: false,
      accuracy: 0,
      incorrectCount: 0,
      resultSegments: [],
      saveFailureCount: 0,
      sessionSaved: false,
      totalQuestions: questions.length,
      message: "",
    });
    this.showQuestion(0);
  },

  showQuestion(index) {
    const current = this.questions[index];
    this.autoSubmittingAnswer = false;
    this.questionStartedAtMs = Date.now();
    this.setData({
      questionIndex: index,
      progressPercent: Math.round(index / this.questions.length * 100),
      currentQuestion: Object.assign({}, current, {
        options: current.options.map((item) => Object.assign({}, item, { state: "" })),
        letterSlots: challenge.fillLetterCompletionSlots(current.letterSlots, ""),
        letterInputWidthRpx: Math.min(360, Math.max(176, 116 + Number(current.letterAnswerLength || 0) * 46)),
        autoFocusInput: current.answerMode === "input",
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
    if (this.data.answered || this.data.saving) return this.data.spellingAnswer;
    const question = this.data.currentQuestion || {};
    const rawValue = String(e.detail.value || "");
    if (question.taskType !== "letterCompletion") {
      this.setData({ spellingAnswer: rawValue });
      return rawValue;
    }
    const value = challenge.normalizeLetterCompletionInput(rawValue, question.letterAnswerLength);
    const shouldAutoJudge = question.autoJudge === true
      && value.length === Number(question.letterAnswerLength || 0)
      && !this.autoSubmittingAnswer;
    if (shouldAutoJudge) this.autoSubmittingAnswer = true;
    this.setData({
      spellingAnswer: value,
      currentQuestion: Object.assign({}, question, {
        letterSlots: challenge.fillLetterCompletionSlots(question.letterSlots, value),
      }),
    }, () => {
      if (shouldAutoJudge) this.finishAnswer(value);
    });
    return value;
  },

  submitSpelling() {
    if (this.data.answered || this.data.saving) return;
    const question = this.data.currentQuestion || {};
    const answer = question.taskType === "letterCompletion"
      ? challenge.normalizeLetterCompletionInput(this.data.spellingAnswer, question.letterAnswerLength)
      : this.data.spellingAnswer;
    if (!challenge.normalizeAnswer(answer)) {
      wx.showToast({
        title: question.emptyAnswerMessage || "请先输入英文答案",
        icon: "none",
      });
      return;
    }
    if (question.taskType === "letterCompletion" && answer.length < Number(question.letterAnswerLength || 0)) {
      wx.showToast({
        title: `还差 ${Number(question.letterAnswerLength || 0) - answer.length} 个字母`,
        icon: "none",
      });
      return;
    }
    this.finishAnswer(answer);
  },

  finishAnswer(answer) {
    if (this.data.answered || this.data.saving) return;
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
      questionType: question.type,
      taskType: question.taskType,
      answerMode: question.answerMode,
      correct: isCorrect,
      responseTimeMs: Math.max(0, Date.now() - Number(this.questionStartedAtMs || Date.now())),
    });
    this.setData({
      currentQuestion: Object.assign({}, question, {
        options,
        autoFocusInput: false,
        letterSlots: challenge.fillLetterCompletionSlots(question.letterSlots, answer, {
          answered: true,
          correct: isCorrect,
        }),
      }),
      answered: true,
      answerCorrect: isCorrect,
      answerMessage: isCorrect
        ? "答对了！"
        : this.data.readOnly ? "这题没答对，学生可以稍后再练" : "没关系，这个词稍后再练",
      score: this.data.score + (isCorrect ? 1 : 0),
    });
    if (this.data.canReview) {
      this.saveReview(question.wordKey, question.type, question.answerMode, isCorrect);
    }
  },

  saveReview(wordKey, questionType, answerMode, isCorrect) {
    this.setData({ saving: true, saveWarning: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "reviewVocabularyQuizAnswer",
        data: {
          studentId: this.data.studentId,
          wordKey,
          questionType,
          answerMode,
          correct: isCorrect,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "学习结果保存失败");
    }).catch((err) => {
      console.error(err);
      this.setData({
        saveWarning: "这题的结果没有保存，完成后请回单词页再试。",
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
        { label: "答对", value: score, color: "#14645A" },
      { label: "没记牢", value: incorrectCount, color: "#C9A24A" },
      ],
    });
    if (this.data.canReview) this.saveSession();
  },

  saveSession() {
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "completeVocabularyQuiz",
        data: {
          studentId: this.data.studentId,
          scope: this.data.scope,
          dailyGoal: this.data.dailyGoal,
          startedAtMs: this.sessionStartedAtMs,
          results: this.sessionResults,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "小测总结保存失败");
      this.setData({ sessionSaved: true });
    }).catch((err) => {
      console.error(err);
      this.setData({
        saveWarning: "本轮答题已完成，但小测总结没有保存。请稍后再做一次。",
      });
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

  goHomeworkTasks() {
    const query = [];
    if (this.data.studentId) query.push(`studentId=${encodeURIComponent(this.data.studentId)}`);
    if (this.data.previewStudentId) query.push(`previewStudentId=${encodeURIComponent(this.data.previewStudentId)}`);
    if (this.data.mode) query.push(`mode=${encodeURIComponent(this.data.mode)}`);
    wx.redirectTo({ url: `/pages/homework/index?${query.join("&")}` });
  },

  startSmartChallenge() {
    this.setData({ scope: "smart", message: "" }, () => this.loadChallenge());
  },

  goBack() {
    wx.navigateBack();
  },
});
