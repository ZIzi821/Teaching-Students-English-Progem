const PAGE_SIZE = 40;

const FILTERS = [
  { value: "all", label: "全部" },
  { value: "unlearned", label: "未学习" },
  { value: "learning", label: "学习中" },
  { value: "due", label: "待复习" },
  { value: "mastered", label: "已掌握" },
  { value: "easy", label: "太简单" },
];

const pad = (value) => String(value).padStart(2, "0");

const formatDateTime = (value) => {
  const timestamp = Number(value || 0);
  if (!timestamp) return "尚无记录";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "尚无记录";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatNextReview = (value) => {
  const timestamp = Number(value || 0);
  if (!timestamp) return "尚未安排";
  if (timestamp <= Date.now()) return "现在需要复习";
  return formatDateTime(timestamp);
};

const getStatus = (word) => {
  if (word.isEasy === true) return { key: "easy", label: "太简单" };
  if (Number(word.masteryLevel || 0) >= 5) return { key: "mastered", label: "已掌握" };
  if (Number(word.reviewCount || 0) > 0 && word.isDue === true) return { key: "due", label: "待复习" };
  if (Number(word.reviewCount || 0) > 0) return { key: "learning", label: "学习中" };
  return { key: "unlearned", label: "未学习" };
};

const getLastResultLabel = (value) => ({
  known: "上次：记住了",
  forgot: "上次：没记住",
  hard: "上次：有点难",
  easy: "上次：太简单",
}[value] || "还没有作答记录");

Page({
  data: {
    loadingStudents: true,
    loadingWords: false,
    loadingMore: false,
    noPermission: false,
    message: "",
    students: [],
    studentIndex: 0,
    selectedStudent: null,
    enabled: false,
    summary: {
      totalCount: 0,
      unlearnedCount: 0,
      learningCount: 0,
      reviewDueCount: 0,
      masteredCount: 0,
      easyCount: 0,
    },
    filters: FILTERS,
    activeFilter: "all",
    searchKeyword: "",
    words: [],
    browseTotal: 0,
    hasMore: false,
  },

  onLoad(options) {
    this.requestedStudentId = String((options && options.studentId) || "");
    this.loadStudents();
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingWords && !this.data.loadingMore) {
      this.loadWords({ append: true });
    }
  },

  loadStudents() {
    this.setData({ loadingStudents: true, noPermission: false, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "listStudents" },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取学生列表");
      const students = (result.data || []).map((item) => Object.assign({}, item, {
        vocabularyStateLabel: item.vocabularyEnabled === true ? "已开启背词" : "尚未开启背词",
      }));
      let studentIndex = students.findIndex((item) => item._id === this.requestedStudentId);
      if (studentIndex < 0) studentIndex = 0;
      this.setData({
        loadingStudents: false,
        students,
        studentIndex,
        selectedStudent: students[studentIndex] || null,
      }, () => {
        if (students.length) this.loadWords();
      });
    }).catch((err) => {
      console.error(err);
      this.setData({
        loadingStudents: false,
        noPermission: true,
        message: err.message || "只有老师可以查看学生单词明细",
      });
    });
  },

  changeStudent(e) {
    const studentIndex = Number(e.detail.value || 0);
    const selectedStudent = this.data.students[studentIndex] || null;
    this.setData({
      studentIndex,
      selectedStudent,
      activeFilter: "all",
      searchKeyword: "",
      words: [],
      browseTotal: 0,
      hasMore: false,
      message: "",
    }, () => this.loadWords());
  },

  selectFilter(e) {
    const activeFilter = String(e.currentTarget.dataset.filter || "all");
    if (activeFilter === this.data.activeFilter) return;
    this.setData({ activeFilter, words: [], browseTotal: 0, hasMore: false }, () => this.loadWords());
  },

  inputSearch(e) {
    const searchKeyword = String(e.detail.value || "");
    this.setData({ searchKeyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.setData({ words: [], browseTotal: 0, hasMore: false }, () => this.loadWords());
    }, 350);
  },

  clearSearch() {
    if (!this.data.searchKeyword) return;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.setData({ searchKeyword: "", words: [], browseTotal: 0, hasMore: false }, () => this.loadWords());
  },

  loadWords(options) {
    const selectedStudent = this.data.selectedStudent;
    if (!selectedStudent || !selectedStudent._id) return Promise.resolve();
    const append = Boolean(options && options.append);
    const requestId = (this.wordsRequestId || 0) + 1;
    this.wordsRequestId = requestId;
    this.setData({
      loadingWords: !append,
      loadingMore: append,
      message: "",
    });
    return wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getVocabularyData",
        data: {
          studentId: selectedStudent._id,
          browseTab: "all",
          masteryFilter: this.data.activeFilter,
          searchKeyword: this.data.searchKeyword.trim(),
          offset: append ? this.data.words.length : 0,
          limit: PAGE_SIZE,
        },
      },
    }).then((res) => {
      if (requestId !== this.wordsRequestId) return;
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "暂时无法读取单词明细");
      const receivedWords = (result.words || []).map((item) => this.prepareWord(item));
      const words = append ? this.data.words.concat(receivedWords) : receivedWords;
      this.setData({
        enabled: result.enabled === true,
        selectedStudent: Object.assign({}, result.student || selectedStudent, {
          vocabularyStateLabel: result.enabled === true ? "已开启背词" : "尚未开启背词",
        }),
        summary: this.prepareSummary(result.summary),
        words,
        browseTotal: Math.max(0, Number(result.browseTotal || 0)),
        hasMore: result.browseHasMore === true,
        loadingWords: false,
        loadingMore: false,
      });
    }).catch((err) => {
      if (requestId !== this.wordsRequestId) return;
      console.error(err);
      this.setData({
        loadingWords: false,
        loadingMore: false,
        message: err.message || "暂时无法读取单词明细",
      });
    });
  },

  prepareSummary(summary) {
    const source = summary || {};
    return {
      totalCount: Math.max(0, Number(source.totalCount || 0)),
      unlearnedCount: Math.max(0, Number(source.unlearnedCount || 0)),
      learningCount: Math.max(0, Number(
        source.activeLearningCount === undefined ? source.learningCount || 0 : source.activeLearningCount
      )),
      reviewDueCount: Math.max(0, Number(source.reviewDueCount || 0)),
      masteredCount: Math.max(0, Number(
        source.strictMasteredCount === undefined ? source.masteredCount || 0 : source.strictMasteredCount
      )),
      easyCount: Math.max(0, Number(source.easyCount || 0)),
    };
  },

  prepareWord(item) {
    const source = item || {};
    const status = getStatus(source);
    const reviewCount = Math.max(0, Number(source.reviewCount || 0));
    const correctCount = Math.max(0, Number(source.correctCount || 0));
    return {
      key: String(source.key || source.word || ""),
      word: String(source.word || "待确认"),
      meaning: String(source.meaning || "暂未填写释义"),
      partOfSpeech: String(source.partOfSpeech || ""),
      sourceLabel: String(source.sourceLabel || "基础词库"),
      bookLabel: String(source.bookLabel || source.levelLabel || ""),
      unitLabel: String(source.unitLabel || ""),
      statusKey: status.key,
      statusLabel: status.label,
      masteryLevel: Math.max(0, Number(source.masteryLevel || 0)),
      reviewCount,
      correctCount,
      wrongCount: Math.max(0, Number(source.wrongCount || 0)),
      accuracyLabel: reviewCount ? `记住 ${correctCount}/${reviewCount} 次` : "还没有开始学习",
      lastResultLabel: getLastResultLabel(String(source.lastResult || "")),
      lastReviewedLabel: formatDateTime(source.lastReviewedAtMs),
      nextReviewLabel: formatNextReview(source.nextReviewAtMs),
    };
  },
});
