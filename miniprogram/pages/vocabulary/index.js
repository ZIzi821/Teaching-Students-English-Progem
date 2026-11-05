const { callCloud } = require("../../utils/cloud");
const { createVocabularyAudioPlayer } = require("../../utils/vocabularyAudio");
const { getFriendlyCloudErrorMessage } = require("../../utils/cloudError");

const WORD_TABS = [
  { value: "all", label: "全部" },
  { value: "textbook", label: "课本" },
  { value: "mistake", label: "错题" },
  { value: "weak", label: "没记牢" },
  { value: "mastered", label: "已掌握" },
];
const DAILY_GOAL_OPTIONS = [5, 8, 10, 15, 20, 30];
const PAGE_SIZE = 40;
const VIEW_PREFERENCE_KEY = "vocabularyViewPreference";

const getFirstCount = (values, fallback) => {
  for (let i = 0; i < values.length; i++) {
    if (values[i] === undefined || values[i] === null || values[i] === "") continue;
    const count = Number(values[i]);
    if (Number.isFinite(count) && count >= 0) return count;
  }
  return fallback || 0;
};

Page({
  data: {
    studentId: "",
    previewStudentId: "",
    mode: "",
    role: "",
    readOnly: true,
    isTeacherManager: false,
    canSetDailyGoal: false,
    canReview: false,
    catalogMode: true,
    loading: true,
    wordPageLoading: false,
    message: "",
    student: null,
    enabled: false,
    settings: {
      levelIds: [],
      dailyGoal: 8,
      includeMistakeWords: true,
      learningOrder: "smart",
    },
    dailyGoalOptions: DAILY_GOAL_OPTIONS.map((value) => ({ value, disabled: false })),
    dailyPlan: {
      dailyGoal: 8,
      defaultGoal: 8,
      hasStudentChoice: false,
    },
    dailyGoalSaving: false,
    levels: [],
    units: [],
    libraries: [],
    mistakeWordsEnabled: false,
    selectedLevelLabel: "暂未选择基础词库",
    summary: {
      todayCount: 0,
      todayReviewedCount: 0,
      todayRemainingCount: 0,
      totalCount: 0,
      masteredCount: 0,
      learningCount: 0,
      textbookWordCount: 0,
      mistakeWordCount: 0,
      weakCount: 0,
      easyCount: 0,
      memoryReviewedCount: 0,
      memoryRetentionPercent: null,
      memoryAtRiskCount: 0,
      memoryDueNowCount: 0,
      memoryDueTomorrowCount: 0,
      memoryDueInThreeDaysCount: 0,
      memoryDueInSevenDaysCount: 0,
      memoryNextReviewAtMs: 0,
      memoryDisclaimer: "开始复习后，系统会根据真实反馈逐步安排间隔。",
    },
    activeTab: "all",
    wordTabs: WORD_TABS,
    browsePanelOpen: true,
    detailSection: "words",
    memoryEvaluationLabel: "",
    searchActive: false,
    isStudyMode: true,
    searchKeyword: "",
    bookFilterOptions: [{ id: "all", label: "全部课本" }],
    bookFilterIndex: 0,
    unitFilterOptions: [{ id: "all", label: "全部单元" }],
    unitFilterIndex: 0,
    todayWords: [],
    todayReviewedWords: [],
    words: [],
    visibleWords: [],
    filteredWordCount: 0,
    hasMoreWords: false,
    pendingWords: [],
    reviewingWordKey: "",
    playingWordKey: "",
    audioLoadingWordKey: "",
    pendingSavingKey: "",
    todayChartSegments: [],
    masteryChartSegments: [],
    weeklyChartPoints: [],
    weeklyStats: {
      totalReviewed: 0,
      activeDays: 0,
      streakDays: 0,
      totalReviewActions: 0,
      fluentActions: 0,
      fluentRate: 0,
      streakPendingToday: false,
    },
  },

  onLoad(options) {
    const catalogMode = String(options.view || "") !== "detail";
    if (!catalogMode) this.initPronunciationPlayer();
    let savedPreference = {};
    try {
      savedPreference = wx.getStorageSync(VIEW_PREFERENCE_KEY) || {};
    } catch (err) {
      savedPreference = {};
    }
    this.savedViewPreference = savedPreference;
    const requestedTab = String(options.tab || "");
    const savedTab = WORD_TABS.some((item) => item.value === requestedTab)
      ? requestedTab
      : WORD_TABS.some((item) => item.value === savedPreference.activeTab)
        ? savedPreference.activeTab
        : "all";
    // 这是单词记录总览；今日三步流程只保留在学生首页，避免两个页面重复。
    const browsePanelOpen = true;
    this.setData({
      studentId: options.studentId || "",
      previewStudentId: options.previewStudentId || "",
      mode: options.mode || "",
      catalogMode,
      browsePanelOpen,
      activeTab: savedTab === "today" ? "all" : savedTab,
      isStudyMode: false,
    }, () => {
      if (catalogMode) this.loadVocabularyCatalog();
      else this.loadVocabularyData();
    });
  },

  onShow() {
    if (this.hasShown && this.data.studentId) {
      if (this.data.catalogMode) this.loadVocabularyCatalog();
      else this.loadVocabularyData();
    }
    this.hasShown = true;
  },

  onHide() {
    this.clearDueRefreshTimer();
    this.stopPronunciation();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
  },

  onUnload() {
    this.clearDueRefreshTimer();
    if (this.pronunciationPlayer) {
      this.pronunciationPlayer.destroy();
      this.pronunciationPlayer = null;
    }
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
  },

  clearDueRefreshTimer() {
    if (!this.dueRefreshTimer) return;
    clearTimeout(this.dueRefreshTimer);
    this.dueRefreshTimer = null;
  },

  retryLoad() {
    if (this.data.catalogMode) this.loadVocabularyCatalog();
    else this.loadVocabularyData();
  },

  loadVocabularyCatalog() {
    if (!this.data.studentId) {
      this.setData({ loading: false, message: "缺少学生信息" });
      return Promise.resolve();
    }
    this.setData({ loading: true, message: "" });
    return callCloud({
      type: "getVocabularyCatalog",
      data: {
        studentId: this.data.studentId,
        previewStudentId: this.data.previewStudentId,
        mode: this.data.mode,
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "暂时无法读取词库目录");
      this.setData({
        role: result.role || "",
        readOnly: Boolean(result.readOnly || result.role === "teacher"),
        student: result.student || null,
        enabled: result.enabled === true,
        settings: this.prepareSettings(result.settings, result.student),
        dailyPlan: this.prepareDailyPlan(result.dailyPlan, result.settings || {}),
        libraries: this.prepareCatalogLibraries(result.libraries || []),
        mistakeWordsEnabled: result.mistakeWordsEnabled === true,
        loading: false,
        message: "",
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ loading: false, message: err.message || "暂时无法读取词库目录" });
    });
  },

  prepareCatalogLibraries(libraries) {
    return libraries.map((item) => ({
      id: String(item.id || ""),
      label: String(item.label || "未命名词库"),
      edition: String(item.edition || ""),
      scopeLabel: (item.levelLabels || []).join("、"),
    }));
  },

  openVocabularyDetail() {
    if (!this.data.studentId) return;
    const query = [
      "view=detail",
      "tab=all",
      "studentId=" + encodeURIComponent(this.data.studentId),
    ];
    if (this.data.previewStudentId) {
      query.push("previewStudentId=" + encodeURIComponent(this.data.previewStudentId));
    }
    if (this.data.mode) query.push("mode=" + encodeURIComponent(this.data.mode));
    wx.navigateTo({ url: "/pages/vocabulary/index?" + query.join("&") });
  },

  scheduleDueRefresh() {
    this.clearDueRefreshTimer();
    const nextReviewAtMs = this.data.todayWords
      .filter((item) => item.lastResult === "forgot" && !item.isDue && item.nextReviewAtMs > 0)
      .map((item) => item.nextReviewAtMs)
      .sort((a, b) => a - b)[0];
    if (!nextReviewAtMs) return;
    const delay = Math.max(1000, nextReviewAtMs - Date.now() + 500);
    this.dueRefreshTimer = setTimeout(() => {
      this.dueRefreshTimer = null;
      if (this.data.studentId) this.loadVocabularyData();
    }, delay);
  },

  loadVocabularyData(options) {
    const requestOptions = options || {};
    const append = requestOptions.append === true;
    const requestId = (this.vocabularyRequestId || 0) + 1;
    this.vocabularyRequestId = requestId;
    if (!this.data.studentId) {
      this.setData({ loading: false, message: "缺少学生信息" });
      return Promise.resolve();
    }
    const book = this.data.bookFilterOptions[this.data.bookFilterIndex] || { id: "all" };
    const unit = this.data.unitFilterOptions[this.data.unitFilterIndex] || { id: "all" };
    this.setData({
      loading: append || this.data.student ? this.data.loading : true,
      wordPageLoading: append || Boolean(this.data.student),
      message: "",
    });
    return wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getVocabularyData",
          data: {
            studentId: this.data.studentId,
            previewStudentId: this.data.previewStudentId,
            mode: this.data.mode,
            browseTab: this.data.activeTab,
            searchKeyword: this.data.searchKeyword,
            levelId: book.id,
            unitId: unit.id,
            offset: append ? this.data.words.length : 0,
            limit: PAGE_SIZE,
          },
        },
      })
      .then((res) => {
        if (requestId !== this.vocabularyRequestId) return;
        const result = res.result || {};
        if (!result.success) {
          throw new Error(result.message || "暂时无法读取单词");
        }
        const role = result.role || "";
        const student = result.student || null;
        const settings = this.prepareSettings(result.settings, student);
        const dailyPlan = this.prepareDailyPlan(result.dailyPlan, settings);
        const levels = this.prepareLevels(result.levels || []);
        const todayWords = this.prepareWords(result.todayWords || []);
        const todayReviewedWords = this.prepareWords(result.todayReviewedWords || []);
        const receivedWords = this.prepareWords(result.words || []);
        const words = append ? this.data.words.concat(receivedWords) : receivedWords;
        const isTeacherManager = role === "teacher" && this.data.mode !== "teacherPreview";
        const summary = this.prepareSummary(result.summary, todayWords, words);
        const weeklyStats = this.prepareWeeklyStats(result.weeklyStats);
        const charts = this.prepareCharts(summary, dailyPlan);
        this.setData(
          {
            role,
            readOnly: Boolean(result.readOnly || role === "teacher"),
            isTeacherManager,
            canSetDailyGoal: isTeacherManager,
            canReview: role === "student" && result.readOnly !== true,
            student,
            enabled: Boolean(
              result.enabled !== undefined ? result.enabled : student && student.vocabularyEnabled
            ),
            settings,
            dailyPlan,
            levels,
            units: this.prepareUnits(result.units || []),
            selectedLevelLabel: this.getSelectedLevelLabel(settings.levelIds, levels),
            summary,
            todayChartSegments: charts.todayChartSegments,
            masteryChartSegments: charts.masteryChartSegments,
            weeklyChartPoints: weeklyStats.days,
            weeklyStats,
            dailyGoalOptions: this.prepareDailyGoalOptions(
              summary.todayReviewedCount,
              isTeacherManager
            ),
            todayWords,
            todayReviewedWords,
            words,
            filteredWordCount: Number(result.browseTotal || 0),
            hasMoreWords: result.browseHasMore === true,
            pendingWords: isTeacherManager ? this.preparePendingWords(result.pendingWords || []) : [],
            loading: false,
            wordPageLoading: false,
            message: "",
            searchActive: Boolean(String(this.data.searchKeyword || "").trim()),
            isStudyMode: this.data.activeTab === "today" && !String(this.data.searchKeyword || "").trim(),
          },
          () => {
            if (!this.libraryFiltersReady) {
              this.libraryFiltersReady = true;
              this.refreshBookFilters();
            }
            this.refreshVisibleWords();
            this.scheduleDueRefresh();
          }
        );
      })
      .catch((err) => {
        if (requestId !== this.vocabularyRequestId) return;
        console.error(err);
        this.setData({
          loading: false,
          wordPageLoading: false,
          message: err.message || "暂时无法读取单词",
          visibleWords: [],
        });
      });
  },

  prepareSettings(settings, student) {
    const source = settings || (student && student.vocabularySettings) || {};
    const dailyGoal = Number(source.dailyGoal || 8);
    return {
      profileVersion: Number(source.profileVersion || 0),
      levelIds: Array.isArray(source.levelIds) ? source.levelIds : [],
      dailyGoal: Number.isFinite(dailyGoal) && dailyGoal > 0 ? dailyGoal : 8,
      includeMistakeWords: source.includeMistakeWords !== false,
      learningOrder: source.learningOrder || "smart",
    };
  },

  prepareDailyPlan(dailyPlan, settings) {
    const source = dailyPlan || {};
    const defaultGoal = Number(source.defaultGoal || settings.dailyGoal || 8);
    const dailyGoal = Number(source.dailyGoal || defaultGoal);
    return {
      dailyGoal: Number.isFinite(dailyGoal) ? dailyGoal : 8,
      defaultGoal: Number.isFinite(defaultGoal) ? defaultGoal : 8,
      hasStudentChoice: source.hasStudentChoice === true,
      selectedAtMs: Number(source.selectedAtMs || 0),
    };
  },

  prepareDailyGoalOptions(todayReviewedCount, canSetDailyGoal) {
    const completedCount = Number(todayReviewedCount || 0);
    return DAILY_GOAL_OPTIONS.map((value) => ({
      value,
      disabled: !canSetDailyGoal || value < completedCount,
    }));
  },

  prepareLevels(levels) {
    return levels.map((item) => {
      if (typeof item === "string") return { id: item, label: item };
      return {
        id: item.id || item.levelId || item.value || "",
        label: item.label || item.levelLabel || item.name || item.id || "",
        bookTitle: item.bookTitle || item.label || item.name || item.id || "",
        edition: item.edition || "",
        isTextbook: item.isTextbook === true,
        order: Number(item.order || 0),
      };
    });
  },

  prepareUnits(units) {
    return units.map((item) => ({
      id: item.id || item.unitId || "",
      label: item.label || item.unitLabel || item.id || "",
      levelId: item.levelId || "",
      order: Number(item.order || 0),
    })).filter((item) => item.id);
  },

  getSelectedLevelLabel(levelIds, levels) {
    const selected = (levelIds || []).map((id) => levels.find((item) => item.id === id)).filter(Boolean);
    if (selected.length === 1 && selected[0].id === "yilin-2024-7A") {
      return "译林七年级上 · 2024新教材（2022课标）";
    }
    const labels = (levelIds || []).map((id) => {
      const found = levels.find((item) => item.id === id);
      return found ? found.label : id;
    });
    return labels.length ? labels.join("、") : "暂未选择基础词库";
  },

  prepareSummary(summary, todayWords, words) {
    const source = summary || {};
    const rawRetention = source.memoryRetentionPercent;
    const memoryRetentionPercent = rawRetention === null || rawRetention === undefined
      ? null
      : Math.max(0, Math.min(100, Number(rawRetention) || 0));
    return {
      todayCount: getFirstCount(
        [source.todayCount, source.todayTotal, source.todayRemaining, source.dueCount],
        todayWords.length
      ),
      totalCount: getFirstCount([source.totalCount, source.total], words.length),
      masteredCount: getFirstCount([source.masteredCount, source.mastered], 0),
      learningCount: getFirstCount([source.learningCount, source.learning], 0),
      textbookWordCount: getFirstCount([source.textbookWordCount], 0),
      mistakeWordCount: getFirstCount([source.mistakeWordCount], 0),
      weakCount: getFirstCount([source.weakCount], 0),
      easyCount: getFirstCount([source.easyCount], 0),
      todayReviewedCount: getFirstCount([source.todayReviewedCount], 0),
      todayRemainingCount: getFirstCount([source.todayRemainingCount], todayWords.length),
      memoryReviewedCount: getFirstCount([source.memoryReviewedCount], 0),
      memoryRetentionPercent,
      memoryAtRiskCount: getFirstCount([source.memoryAtRiskCount], 0),
      memoryDueNowCount: getFirstCount([source.memoryDueNowCount], 0),
      memoryDueTomorrowCount: getFirstCount([source.memoryDueTomorrowCount], 0),
      memoryDueInThreeDaysCount: getFirstCount([source.memoryDueInThreeDaysCount], 0),
      memoryDueInSevenDaysCount: getFirstCount([source.memoryDueInSevenDaysCount], 0),
      memoryNextReviewAtMs: Number(source.memoryNextReviewAtMs || 0),
      memoryDisclaimer: String(
        source.memoryDisclaimer || "开始复习后，系统会根据真实反馈逐步安排间隔。"
      ),
    };
  },

  prepareCharts(summary, dailyPlan) {
    const reviewed = Math.max(0, Number(summary.todayReviewedCount) || 0);
    const goal = Math.max(reviewed, Number(dailyPlan.dailyGoal) || 0);
    const easyCount = Math.max(0, Number(summary.easyCount) || 0);
    const masteredCount = Math.max(0, Number(summary.masteredCount) || 0);
    const learningCount = Math.max(0, Number(summary.learningCount) || 0);
    const totalCount = Math.max(0, Number(summary.totalCount) || 0);
    const notStartedCount = Math.max(0, totalCount - masteredCount - learningCount);
    return {
      todayChartSegments: [
        { label: "今日完成", value: reviewed, color: "#14645A" },
        { label: "今日剩余", value: Math.max(0, goal - reviewed), color: "#eadfcf" },
      ],
      masteryChartSegments: [
        { label: "未学习", value: notStartedCount, color: "#eadfcf" },
        { label: "学习中", value: learningCount, color: "#C9A24A" },
        { label: "已掌握", value: Math.max(0, masteredCount - easyCount), color: "#14645A" },
        { label: "太简单", value: easyCount, color: "#7b8eaa" },
      ],
    };
  },

  prepareWeeklyStats(weeklyStats) {
    const source = weeklyStats || {};
    return {
      days: (source.days || []).map((item) => ({
        label: String(item.label || ""),
        value: Math.max(0, Number(item.reviewedWordCount) || 0),
        goal: Math.max(0, Number(item.dailyGoal) || 0),
      })),
      totalReviewed: Math.max(0, Number(source.totalReviewed) || 0),
      activeDays: Math.max(0, Number(source.activeDays) || 0),
      streakDays: Math.max(0, Number(source.streakDays) || 0),
      totalReviewActions: Math.max(0, Number(source.totalReviewActions) || 0),
      fluentActions: Math.max(0, Number(source.fluentActions) || 0),
      fluentRate: Math.max(0, Math.min(100, Number(source.fluentRate) || 0)),
      streakPendingToday: source.streakPendingToday === true,
    };
  },

  prepareWords(words) {
    return words.map((item, index) => this.prepareWord(item, index));
  },

  prepareWord(item, index) {
    const source = item || {};
    const sources = Array.isArray(source.sources) ? source.sources : [];
    const sourceKinds = this.getSourceKinds(source, sources);
    return {
      key: String(source.key || source.word || index),
      word: String(source.word || "待确认"),
      meaning: String(source.meaning || ""),
      partOfSpeech: String(source.partOfSpeech || ""),
      levelLabel: String(source.levelLabel || ""),
      levelId: String(source.levelId || ""),
      levelIds: Array.isArray(source.levelIds) ? source.levelIds : [],
      bookLabel: String(source.bookLabel || source.levelLabel || ""),
      edition: String(source.edition || ""),
      unitId: String(source.unitId || ""),
      unitIds: Array.isArray(source.unitIds) ? source.unitIds : [],
      unitLabel: String(source.unitLabel || ""),
      unitLabels: Array.isArray(source.unitLabels) ? source.unitLabels : [],
      isTextbook: source.isTextbook === true,
      isEasy: source.isEasy === true,
      sources,
      sourceKinds,
      isMistakeSource: sourceKinds.indexOf("mistake") >= 0,
      sourceLabel: String(source.sourceLabel || (source.sourceMistakeId ? "错题词汇" : "基础词库")),
      sourceMistakeId: String(source.sourceMistakeId || ""),
      sourceQuestionNo: String(source.sourceQuestionNo || ""),
      sourceText: String(source.sourceText || ""),
      masteryLevel: Number(source.masteryLevel || 0),
      isDue: source.isDue !== false,
      reviewedToday: source.reviewedToday === true,
      lastResult: String(source.lastResult || ""),
      reviewCount: Math.max(0, Number(source.reviewCount) || 0),
      correctCount: Math.max(0, Number(source.correctCount) || 0),
      wrongCount: Math.max(0, Number(source.wrongCount) || 0),
      nextReviewAtMs: Number(source.nextReviewAtMs || 0),
      estimatedRetentionPercent: source.estimatedRetentionPercent === null
        || source.estimatedRetentionPercent === undefined
        ? null
        : Math.max(0, Math.min(100, Number(source.estimatedRetentionPercent) || 0)),
      memoryState: String(source.memoryState || "new"),
      memoryScheduleLabel: String(source.memoryScheduleLabel || ""),
      pronunciationFileId: String(source.pronunciationFileId || ""),
      pronunciationUrl: String(source.pronunciationUrl || ""),
      pronunciationStartMs: Math.max(0, Number(source.pronunciationStartMs) || 0),
      pronunciationDurationMs: Math.max(0, Number(source.pronunciationDurationMs) || 0),
      pronunciationDirectFileId: String(source.pronunciationDirectFileId || ""),
      pronunciationDirectUrl: String(source.pronunciationDirectUrl || ""),
      pronunciationDirectDurationMs: Math.max(0, Number(source.pronunciationDirectDurationMs) || 0),
      progressLabel: source.isEasy === true
        ? source.isDue === true ? "熟悉词 · 到期复习" : "太简单 · 降低频率"
        : source.reviewedToday === true && source.isDue === false
          ? source.lastResult === "forgot" ? "稍后再复习" : "今日已完成"
        : String(source.progressLabel || "待学习"),
      meaningShown: false,
    };
  },

  getSourceKinds(word, sources) {
    const values = [word.sourceLabel || ""]
      .concat(
        sources.map((item) => {
          if (typeof item === "string") return item;
          return item.type || item.sourceType || item.label || item.key || "";
        })
      )
      .join(" ")
      .toLowerCase();
    const kinds = [];
    if (word.sourceMistakeId || values.indexOf("mistake") >= 0 || values.indexOf("错题") >= 0) {
      kinds.push("mistake");
    }
    if (
      values.indexOf("library") >= 0 ||
      values.indexOf("textbook") >= 0 ||
      values.indexOf("课本") >= 0 ||
      values.indexOf("词库") >= 0 ||
      values.indexOf("grade") >= 0 ||
      !kinds.length
    ) {
      kinds.push("library");
    }
    if (word.isTextbook || values.indexOf("textbook") >= 0 || values.indexOf("课本") >= 0) {
      kinds.push("textbook");
    }
    return kinds;
  },

  preparePendingWords(words) {
    return words.map((item, index) => {
      const word = this.prepareWord(item, index);
      return Object.assign({}, word, {
        meaning: String((item && item.meaning) || ""),
        partOfSpeech: String((item && item.partOfSpeech) || ""),
      });
    });
  },

  selectDetailSection(e) {
    const section = e.currentTarget.dataset.section;
    if (section === this.data.detailSection) return;
    this.setData({ detailSection: section }, () => {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      if (section === "stats") this.loadMemoryEvaluationStatus();
    });
  },

  loadMemoryEvaluationStatus() {
    if (!this.data.isTeacherManager || !this.data.studentId || this.memoryEvaluationRequested) return;
    this.memoryEvaluationRequested = true;
    callCloud({
      type: "getEnglishMemoryEvaluation",
      data: { studentId: this.data.studentId },
    }).then((res) => {
      const result = res.result || {};
      const status = result.success && result.evaluation && result.evaluation.status;
      if (status && status.label) this.setData({ memoryEvaluationLabel: status.label });
    }).catch((err) => {
      console.error(err);
      this.memoryEvaluationRequested = false;
    });
  },

  goMemoryEvaluation() {
    if (!this.data.isTeacherManager || !this.data.studentId) return;
    wx.navigateTo({
      url: "/insights/pages/memory-evaluation/index?studentId=" + encodeURIComponent(this.data.studentId),
    });
  },

  selectTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!WORD_TABS.some((item) => item.value === tab)) return;
    this.setData({
      activeTab: tab,
      browsePanelOpen: true,
      isStudyMode: false,
    }, () => {
      this.saveViewPreference();
      this.loadVocabularyData();
    });
  },

  toggleBrowsePanel() {
    const browsePanelOpen = !this.data.browsePanelOpen;
    this.setData({
      browsePanelOpen,
      activeTab: browsePanelOpen ? (this.data.activeTab === "today" ? "all" : this.data.activeTab) : "today",
      isStudyMode: !browsePanelOpen && !this.data.searchActive,
      bookFilterIndex: 0,
      unitFilterIndex: 0,
    }, () => {
      this.saveViewPreference();
      this.loadVocabularyData();
    });
  },

  saveViewPreference() {
    const book = this.data.bookFilterOptions[this.data.bookFilterIndex] || { id: "all" };
    const unit = this.data.unitFilterOptions[this.data.unitFilterIndex] || { id: "all" };
    const preference = {
      activeTab: this.data.activeTab,
      browsePanelOpen: this.data.browsePanelOpen,
      bookId: book.id,
      unitId: unit.id,
    };
    this.savedViewPreference = preference;
    try {
      wx.setStorageSync(VIEW_PREFERENCE_KEY, preference);
    } catch (err) {
      console.warn("save vocabulary view preference failed", err);
    }
  },

  continueLearning() {
    this.startStudy();
  },

  startStudy() {
    if (!this.data.studentId || !this.data.enabled) return;
    const query = [`studentId=${encodeURIComponent(this.data.studentId)}`];
    if (this.data.previewStudentId) {
      query.push(`previewStudentId=${encodeURIComponent(this.data.previewStudentId)}`);
    }
    if (this.data.mode) query.push(`mode=${encodeURIComponent(this.data.mode)}`);
    wx.navigateTo({
      url: `/pages/vocabulary-study/index?${query.join("&")}`,
    });
  },

  goChallenge(e) {
    const scope = String(e.currentTarget.dataset.scope || "smart");
    const query = [`scope=${encodeURIComponent(scope)}`];
    if (this.data.studentId) query.push(`studentId=${encodeURIComponent(this.data.studentId)}`);
    if (this.data.previewStudentId) {
      query.push(`previewStudentId=${encodeURIComponent(this.data.previewStudentId)}`);
    }
    if (this.data.mode) query.push(`mode=${encodeURIComponent(this.data.mode)}`);
    wx.navigateTo({
      url: `/pages/vocabulary-challenge/index?${query.join("&")}`,
    });
  },

  onSearchInput(e) {
    const searchKeyword = String(e.detail.value || "");
    const searchActive = Boolean(searchKeyword.trim());
    this.setData({
      searchKeyword,
      searchActive,
      isStudyMode: !searchActive && !this.data.browsePanelOpen,
    });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.loadVocabularyData();
    }, 300);
  },

  clearSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.setData({
      searchKeyword: "",
      searchActive: false,
      isStudyMode: !this.data.browsePanelOpen,
    }, () => this.loadVocabularyData());
  },

  selectDailyGoal(e) {
    const dailyGoal = Number(e.currentTarget.dataset.goal);
    if (
      !this.data.canSetDailyGoal
      || this.data.dailyGoalSaving
      || DAILY_GOAL_OPTIONS.indexOf(dailyGoal) < 0
    ) {
      return;
    }
    if (dailyGoal < this.data.summary.todayReviewedCount) {
      wx.showToast({
        title: `今天已完成 ${this.data.summary.todayReviewedCount} 个，目标下限为当前完成数`,
        icon: "none",
      });
      return;
    }
    this.setData({ dailyGoalSaving: true });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "setVocabularyDailyGoal",
          data: {
            studentId: this.data.studentId,
            dailyGoal,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) throw new Error(result.message || "今日目标保存失败");
        wx.showToast({ title: `今天学 ${dailyGoal} 个单词`, icon: "none" });
        return this.loadVocabularyData();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: getFriendlyCloudErrorMessage(err, "保存失败"), icon: "none" });
      })
      .finally(() => {
        this.setData({ dailyGoalSaving: false });
      });
  },

  onBookFilterChange(e) {
    const index = Number(e.detail.value) || 0;
    this.setData({ bookFilterIndex: index, unitFilterIndex: 0 }, () => {
      this.refreshUnitFilters(() => {
        this.saveViewPreference();
        this.loadVocabularyData();
      });
    });
  },

  onUnitFilterChange(e) {
    this.setData({ unitFilterIndex: Number(e.detail.value) || 0 }, () => {
      this.saveViewPreference();
      this.loadVocabularyData();
    });
  },

  refreshBookFilters() {
    const selectedIds = new Set(this.data.settings.levelIds || []);
    const levels = this.data.levels.filter((level) => selectedIds.has(level.id));
    const current = this.data.bookFilterOptions[this.data.bookFilterIndex] || { id: "all" };
    const preferredBookId = this.savedViewPreference && this.savedViewPreference.bookId;
    const options = [{ id: "all", label: "全部课本" }].concat(
      levels.map((level) => ({
        id: level.id,
        label: level.edition ? `${level.label} · ${level.edition}` : level.label,
      }))
    );
    const nextId = preferredBookId || current.id;
    const nextIndex = Math.max(0, options.findIndex((item) => item.id === nextId));
    this.setData({
      bookFilterOptions: options,
      bookFilterIndex: nextIndex,
    }, () => this.refreshUnitFilters(null, this.savedViewPreference && this.savedViewPreference.unitId));
  },

  refreshUnitFilters(callback, preferredUnitId) {
    const book = this.data.bookFilterOptions[this.data.bookFilterIndex] || { id: "all" };
    const currentUnit = this.data.unitFilterOptions[this.data.unitFilterIndex] || { id: "all" };
    const levelById = new Map(this.data.levels.map((level) => [level.id, level]));
    const unitOptions = this.data.units
      .filter((unit) => book.id === "all" || unit.levelId === book.id)
      .map((unit) => {
        const level = levelById.get(unit.levelId) || {};
        return {
          id: unit.id,
          label: book.id === "all" && level.label ? `${level.label} · ${unit.label}` : unit.label,
          levelOrder: Number(level.order || 0),
          order: unit.order,
        };
      })
      .sort((a, b) => {
        if (book.id === "all" && a.levelOrder !== b.levelOrder) {
          return a.levelOrder - b.levelOrder;
        }
        return a.order - b.order || a.label.localeCompare(b.label);
      });
    const options = [{ id: "all", label: "全部单元" }].concat(unitOptions);
    const nextUnitId = preferredUnitId || currentUnit.id;
    const nextUnitIndex = Math.max(0, options.findIndex((item) => item.id === nextUnitId));
    this.setData({
      unitFilterOptions: options,
      unitFilterIndex: nextUnitIndex,
    }, () => {
      if (preferredUnitId) this.savedViewPreference = Object.assign({}, this.savedViewPreference, { unitId: "" });
      if (typeof callback === "function") callback();
    });
  },

  refreshVisibleWords() {
    this.setData({ visibleWords: this.data.words });
  },

  loadMoreWords() {
    if (!this.data.hasMoreWords || this.data.wordPageLoading) return;
    this.loadVocabularyData({ append: true });
  },

  toggleMeaning(e) {
    const wordKey = String(e.currentTarget.dataset.key || "");
    if (!wordKey) return;
    const visibleWord = this.data.visibleWords.find((item) => item.key === wordKey);
    const meaningShown = !(visibleWord && visibleWord.meaningShown);
    const updateWords = (words) =>
      words.map((item) => (item.key === wordKey ? Object.assign({}, item, { meaningShown }) : item));
    this.setData(
      {
        todayWords: updateWords(this.data.todayWords),
        todayReviewedWords: updateWords(this.data.todayReviewedWords),
        words: updateWords(this.data.words),
      },
      () => this.refreshVisibleWords()
    );
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

  playPronunciation(e) {
    const wordKey = String(e.currentTarget.dataset.key || "");
    const word = this.data.visibleWords.find((item) => item.key === wordKey);
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
      wordKey,
      directUrl: word.pronunciationDirectUrl,
      directFileId: word.pronunciationDirectFileId,
      directDurationMs: word.pronunciationDirectDurationMs,
      fallbackUrl: word.pronunciationUrl,
      fallbackFileId: word.pronunciationFileId,
      startMs: word.pronunciationStartMs,
      durationMs: word.pronunciationDurationMs,
    });
  },

  reviewWord(e) {
    const wordKey = String(e.currentTarget.dataset.key || "");
    const resultValue = e.currentTarget.dataset.result;
    if (
      !this.data.canReview ||
      !wordKey ||
      ["forgot", "hard", "known", "easy"].indexOf(resultValue) < 0 ||
      this.data.reviewingWordKey
    ) {
      return;
    }
    this.setData({ reviewingWordKey: wordKey });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "reviewVocabularyWord",
          data: {
            studentId: this.data.studentId,
            wordKey,
            result: resultValue,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) throw new Error(result.message || "暂时无法保存");
        const nextReviewHint = this.formatNextReviewHint(result.nextReviewAtMs);
        const messages = {
          forgot: nextReviewHint || "已优先安排复习",
          hard: this.data.activeTab === "mastered"
            ? "已重新加入学习"
            : nextReviewHint || "已缩短复习间隔",
          known: nextReviewHint || "已安排下次复习",
          easy: nextReviewHint || "已降低出现频率",
        };
        wx.showToast({ title: messages[resultValue], icon: "none" });
        return this.loadVocabularyData();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: getFriendlyCloudErrorMessage(err, "保存失败"), icon: "none" });
      })
      .finally(() => {
        this.setData({ reviewingWordKey: "" });
      });
  },

  formatNextReviewHint(nextReviewAtMs) {
    const target = Number(nextReviewAtMs || 0);
    if (!target) return "";
    const remainingMs = Math.max(0, target - Date.now());
    if (remainingMs < 60 * 60 * 1000) {
      return `${Math.max(1, Math.ceil(remainingMs / 60000))} 分钟后复习`;
    }
    if (remainingMs < 24 * 60 * 60 * 1000) {
      return `${Math.max(1, Math.ceil(remainingMs / 3600000))} 小时后复习`;
    }
    const days = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
    return days === 1 ? "明天复习" : `${days} 天后复习`;
  },

  onPendingInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    if (!Number.isInteger(index) || ["meaning", "partOfSpeech"].indexOf(field) < 0) return;
    const pendingWords = this.data.pendingWords.slice();
    pendingWords[index] = Object.assign({}, pendingWords[index], {
      [field]: e.detail.value,
    });
    this.setData({ pendingWords });
  },

  updatePendingWord(e) {
    const index = Number(e.currentTarget.dataset.index);
    const action = e.currentTarget.dataset.action || "save";
    const word = this.data.pendingWords[index];
    if (!this.data.isTeacherManager || !word || this.data.pendingSavingKey) return;
    if (action === "exclude") {
      wx.showModal({
        title: "忽略这个单词？",
        content: "确认后，这个词会归入已忽略列表。",
        confirmText: "确认忽略",
        confirmColor: "#B0432F",
        success: (res) => {
          if (res.confirm) this.submitPendingWord(word, true);
        },
      });
      return;
    }
    if (!String(word.meaning || "").trim()) {
      wx.showToast({ title: "请先填写中文释义", icon: "none" });
      return;
    }
    this.submitPendingWord(word, false);
  },

  submitPendingWord(word, excluded) {
    this.setData({ pendingSavingKey: word.key });
    const data = {
      studentId: this.data.studentId,
      wordKey: word.key,
    };
    if (excluded) {
      data.excluded = true;
    } else {
      data.meaning = String(word.meaning || "").trim();
      data.partOfSpeech = String(word.partOfSpeech || "").trim();
      data.excluded = false;
    }
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "updateVocabularyWord",
          data,
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) throw new Error(result.message || "保存失败");
        wx.showToast({ title: excluded ? "已忽略" : "单词已加入", icon: "none" });
        return this.loadVocabularyData();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: getFriendlyCloudErrorMessage(err, "保存失败"), icon: "none" });
      })
      .finally(() => {
        this.setData({ pendingSavingKey: "" });
      });
  },

  goSourceMistake(e) {
    const mistakeId = e.currentTarget.dataset.id;
    if (!mistakeId) return;
    wx.navigateTo({
      url: "/pages/mistake-detail/index?id=" + mistakeId + "&readOnly=1",
    });
  },
});
