const FALLBACK_VOCABULARY_LEVELS = [
  { id: "1A", label: "一年级上" },
  { id: "1B", label: "一年级下" },
  { id: "2A", label: "二年级上" },
  { id: "2B", label: "二年级下" },
  { id: "3A", label: "三年级上" },
  { id: "3B", label: "三年级下" },
];
const DAILY_GOAL_OPTIONS = [5, 8, 10, 15, 20, 30];

Page({
  data: {
    studentId: "",
    previewStudentId: "",
    mode: "",
    role: "",
    isTeacher: false,
    isTeacherPreview: false,
    student: null,
    lessons: [],
    cycleStatus: null,
    analytics: null,
    message: "",
    showProgressEditor: false,
    progressForm: {
      plannedLessonCount: "",
      completedLessonCount: "",
    },
    vocabularyLevels: FALLBACK_VOCABULARY_LEVELS.map((item) => Object.assign({}, item, { checked: false })),
    dailyGoalOptions: DAILY_GOAL_OPTIONS,
    dailyGoalIndex: 1,
    vocabularyForm: {
      enabled: false,
      levelIds: [],
      dailyGoal: 8,
      includeMistakeWords: true,
      hideBasicWords: false,
      learningOrder: "smart",
    },
    vocabularyDailyPlan: {
      dailyGoal: 8,
      defaultGoal: 8,
      hasStudentChoice: false,
    },
    vocabularySaving: false,
    showVocabularySettings: false,
    vocabularyOverview: {
      enabled: false,
      dailyPlan: { dailyGoal: 0 },
      summary: { todayReviewedCount: 0, todayRemainingCount: 0, totalCount: 0, masteredCount: 0 },
      weeklyStats: { totalReviewed: 0, activeDays: 0, streakDays: 0 },
    },
    vocabularyTodaySegments: [],
    vocabularyMasterySegments: [],
    mistakeStatusSegments: [],
    weeklyChartPoints: [],
  },

  onLoad(options) {
    const mode = options.mode || "";
    const previewStudentId = options.previewStudentId || "";
    this.setData({
      studentId: previewStudentId || options.id || "",
      previewStudentId,
      mode,
    });
    this.loadStudent();
  },

  onShow() {
    if (this.hasShown && this.data.studentId) this.loadStudent();
    this.hasShown = true;
  },

  loadStudent() {
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getStudentDetail",
          data: {
            studentId: this.data.studentId,
            previewStudentId: this.data.previewStudentId,
            mode: this.data.mode,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            message: result.message || "无权查看该学生",
            student: null,
            lessons: [],
          });
          return;
        }
        const isTeacherPreview = result.role === "teacher" && this.data.mode === "teacherPreview";
        const student = this.prepareStudent(result.student);
        const vocabularyState = this.prepareVocabularyState(student, result.vocabularyLevels || []);
        const overviewState = this.prepareVocabularyOverview(result.vocabularyOverview, vocabularyState.dailyPlan);
        const analytics = this.prepareAnalytics(result.analytics);
        this.setData({
          role: result.role,
          isTeacher: result.role === "teacher" && !isTeacherPreview,
          isTeacherPreview,
          student,
          lessons: result.lessons || [],
          cycleStatus: result.cycleStatus || null,
          analytics,
          vocabularyLevels: vocabularyState.levels,
          dailyGoalIndex: vocabularyState.dailyGoalIndex,
          vocabularyForm: vocabularyState.form,
          vocabularyDailyPlan: vocabularyState.dailyPlan,
          vocabularyOverview: overviewState.overview,
          vocabularyTodaySegments: overviewState.todaySegments,
          vocabularyMasterySegments: overviewState.masterySegments,
          weeklyChartPoints: overviewState.weeklyChartPoints,
          mistakeStatusSegments: this.prepareMistakeStatusSegments(analytics),
          message: "",
        });
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "请先上传并部署云函数",
        });
      });
  },

  prepareAnalytics(analytics) {
    if (!analytics) return null;
    const topQuestionTypes = analytics.topQuestionTypes || [];
    const maxQuestionTypeCount = Math.max(1, ...topQuestionTypes.map((item) => Number(item.count) || 0));
    return Object.assign({}, analytics, {
      topQuestionTypes: topQuestionTypes.map((item) => Object.assign({}, item, {
        percent: Math.round((Number(item.count || 0) / maxQuestionTypeCount) * 100),
      })),
      topSkillTags: analytics.topSkillTags || [],
      reviewSuggestions: analytics.reviewSuggestions || [],
    });
  },

  prepareVocabularyOverview(overview, fallbackDailyPlan) {
    const source = overview || {};
    const summary = source.summary || {};
    const dailyPlan = source.dailyPlan || fallbackDailyPlan || {};
    const weeklyStats = source.weeklyStats || {};
    const reviewed = Math.max(0, Number(summary.todayReviewedCount) || 0);
    const goal = Math.max(reviewed, Number(dailyPlan.dailyGoal) || 0);
    const total = Math.max(0, Number(summary.totalCount) || 0);
    const mastered = Math.max(0, Number(summary.masteredCount) || 0);
    const easy = Math.max(0, Number(summary.easyCount) || 0);
    const learning = Math.max(0, Number(summary.learningCount) || 0);
    return {
      overview: {
        enabled: source.enabled === true,
        dailyPlan,
        summary: Object.assign({}, summary, {
          todayReviewedCount: reviewed,
          todayRemainingCount: Math.max(0, Number(summary.todayRemainingCount) || goal - reviewed),
          totalCount: total,
          masteredCount: mastered,
        }),
        weeklyStats: {
          totalReviewed: Math.max(0, Number(weeklyStats.totalReviewed) || 0),
          activeDays: Math.max(0, Number(weeklyStats.activeDays) || 0),
          streakDays: Math.max(0, Number(weeklyStats.streakDays) || 0),
        },
      },
      todaySegments: [
        { label: "今日完成", value: reviewed, color: "#4f8f73" },
        { label: "今日剩余", value: Math.max(0, goal - reviewed), color: "#eadfcf" },
      ],
      masterySegments: [
        { label: "未学习", value: Math.max(0, total - mastered - learning), color: "#eadfcf" },
        { label: "学习中", value: learning, color: "#e0b96a" },
        { label: "已掌握", value: Math.max(0, mastered - easy), color: "#4f8f73" },
        { label: "太简单", value: easy, color: "#7b8eaa" },
      ],
      weeklyChartPoints: (weeklyStats.days || []).map((item) => ({
        label: String(item.label || ""),
        value: Math.max(0, Number(item.reviewedWordCount) || 0),
        goal: Math.max(0, Number(item.dailyGoal) || 0),
      })),
    };
  },

  prepareMistakeStatusSegments(analytics) {
    const source = analytics || {};
    return [
      { label: "待复习", value: Math.max(0, Number(source.pendingCount) || 0), color: "#e0b96a" },
      { label: "已复习", value: Math.max(0, Number(source.reviewedCount) || 0), color: "#7b8eaa" },
      { label: "已掌握", value: Math.max(0, Number(source.masteredCount) || 0), color: "#4f8f73" },
    ];
  },

  prepareStudent(student) {
    const plannedLessonCount = student.plannedLessonCount || 0;
    const completedLessonCount = student.completedLessonCount || 0;
    const progressLabel = plannedLessonCount
      ? "已上 " + completedLessonCount + " / " + plannedLessonCount + " 节"
      : "已上 " + completedLessonCount + " 节 · 总课时未设置";
    return Object.assign({}, student, {
      initial: student && student.name ? student.name.substr(0, 1) : "学",
      progressLabel,
    });
  },

  prepareVocabularyState(student, availableLevels) {
    const settings = (student && student.vocabularySettings) || {};
    const vocabularyLevels = (availableLevels.length ? availableLevels : FALLBACK_VOCABULARY_LEVELS)
      .map((item) => ({
        id: item.id || item.levelId || "",
        label: item.label || item.name || item.id || "",
        collectionLabel: item.collectionLabel || (item.isTextbook ? "译林牛津初中英语" : "小学基础词库"),
        edition: item.edition || "",
        isTextbook: item.isTextbook === true,
        order: Number(item.order || 0),
      }))
      .filter((item) => item.id)
      .sort((a, b) => a.order - b.order);
    const selectedLevelIds = Array.isArray(settings.levelIds)
      ? settings.levelIds.filter((id) => vocabularyLevels.some((item) => item.id === id))
      : [];
    const requestedDailyGoal = Number(settings.dailyGoal || 8);
    const dailyGoalIndex = DAILY_GOAL_OPTIONS.indexOf(requestedDailyGoal);
    const safeDailyGoalIndex = dailyGoalIndex >= 0 ? dailyGoalIndex : 1;
    const dailyPlanSource = (student && student.vocabularyDailyPlan) || {};
    const dailyPlanGoal = Number(dailyPlanSource.dailyGoal || DAILY_GOAL_OPTIONS[safeDailyGoalIndex]);
    return {
      levels: vocabularyLevels.map((item) =>
        Object.assign({}, item, { checked: selectedLevelIds.indexOf(item.id) >= 0 })
      ),
      dailyGoalIndex: safeDailyGoalIndex,
      dailyPlan: {
        dailyGoal: dailyPlanGoal,
        defaultGoal: Number(dailyPlanSource.defaultGoal || DAILY_GOAL_OPTIONS[safeDailyGoalIndex]),
        hasStudentChoice: dailyPlanSource.hasStudentChoice === true,
      },
      form: {
        enabled: Boolean(student && student.vocabularyEnabled),
        levelIds: selectedLevelIds,
        dailyGoal: DAILY_GOAL_OPTIONS[safeDailyGoalIndex],
        includeMistakeWords: settings.includeMistakeWords !== false,
        hideBasicWords: settings.hideBasicWords === true,
        learningOrder: settings.learningOrder || "smart",
      },
    };
  },

  goLesson(e) {
    let url = "/pages/lesson-detail/index?id=" + e.currentTarget.dataset.id;
    if (this.data.isTeacherPreview) {
      url += "&mode=teacherPreview&previewStudentId=" + this.data.student._id;
    }
    wx.navigateTo({
      url,
    });
  },

  goAddLesson() {
    wx.navigateTo({
      url: "/pages/add-lesson/index?studentId=" + this.data.student._id,
    });
  },

  goTeacherPreview() {
    wx.navigateTo({
      url: "/pages/student-detail/index?mode=teacherPreview&previewStudentId=" + this.data.student._id,
    });
  },

  goReviewDashboard() {
    let url = "/pages/review-dashboard/index?studentId=" + this.data.student._id;
    if (this.data.isTeacherPreview) {
      url += "&mode=teacherPreview&previewStudentId=" + this.data.student._id;
    }
    wx.navigateTo({ url });
  },

  goLessonBookings() {
    const studentId = this.data.student ? this.data.student._id : "";
    if (!studentId) return;
    wx.navigateTo({
      url: "/pages/lesson-bookings/index?mode=teacherPreview&previewStudentId=" + studentId,
    });
  },

  goVocabulary() {
    const student = this.data.student;
    if (!student || !student._id) return;
    const params = ["studentId=" + student._id];
    if (this.data.isTeacherPreview) {
      params.push("mode=teacherPreview", "previewStudentId=" + student._id);
    }
    wx.navigateTo({
      url: "/pages/vocabulary/index?" + params.join("&"),
    });
  },

  toggleVocabularySettings() {
    this.setData({ showVocabularySettings: !this.data.showVocabularySettings });
  },

  onVocabularyEnabledChange(e) {
    this.setData({
      "vocabularyForm.enabled": Boolean(e.detail.value),
    });
  },

  onIncludeMistakeWordsChange(e) {
    this.setData({
      "vocabularyForm.includeMistakeWords": Boolean(e.detail.value),
    });
  },

  onHideBasicWordsChange(e) {
    this.setData({
      "vocabularyForm.hideBasicWords": Boolean(e.detail.value),
    });
  },

  onVocabularyLevelsChange(e) {
    const levelIds = e.detail.value || [];
    this.setData({
      "vocabularyForm.levelIds": levelIds,
      vocabularyLevels: this.data.vocabularyLevels.map((item) =>
        Object.assign({}, item, { checked: levelIds.indexOf(item.id) >= 0 })
      ),
    });
  },

  onVocabularyDailyGoalChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      dailyGoalIndex: index,
      "vocabularyForm.dailyGoal": this.data.dailyGoalOptions[index],
    });
  },

  saveVocabularySettings() {
    if (!this.data.isTeacher || this.data.vocabularySaving || !this.data.student) return;
    const form = this.data.vocabularyForm;
    this.setData({ vocabularySaving: true });
    wx.showLoading({ title: "保存中", mask: true });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "updateVocabularySettings",
          data: {
            studentId: this.data.student._id,
            enabled: form.enabled,
            levelIds: form.levelIds,
            dailyGoal: form.dailyGoal,
            includeMistakeWords: form.includeMistakeWords,
            hideBasicWords: form.hideBasicWords,
            learningOrder: form.learningOrder,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          throw new Error(result.message || "单词设置保存失败");
        }
        wx.showToast({ title: "单词设置已保存" });
        this.loadStudent();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({
          title: err.message || "保存失败",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ vocabularySaving: false });
      });
  },

  showProgressEditor() {
    this.setData({
      showProgressEditor: true,
      progressForm: {
        plannedLessonCount: String(this.data.student.plannedLessonCount || 0),
        completedLessonCount: String(this.data.student.completedLessonCount || 0),
      },
    });
  },

  hideProgressEditor() {
    this.setData({
      showProgressEditor: false,
    });
  },

  onProgressInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      ["progressForm." + field]: e.detail.value,
    });
  },

  submitProgress() {
    wx.showLoading({ title: "保存中" });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "updateStudentProgress",
          data: {
            studentId: this.data.student._id,
            plannedLessonCount: this.data.progressForm.plannedLessonCount,
            completedLessonCount: this.data.progressForm.completedLessonCount,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          wx.showToast({
            title: result.message || "保存失败",
            icon: "none",
          });
          return;
        }
        wx.showToast({ title: "已保存" });
        this.setData({ showProgressEditor: false });
        this.loadStudent();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({
          title: "保存失败",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },
});
