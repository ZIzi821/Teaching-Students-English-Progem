const {
  LESSON_TEMPLATE_OPTIONS,
  inferLessonTemplateKey,
} = require("../../utils/lessonTemplates");

const FALLBACK_VOCABULARY_LEVELS = [
  { id: "0A", label: "英语启蒙（零基础）" },
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
      lessonPackageSize: "",
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
    courseSaving: false,
    mistakeSaving: false,
    frenchSaving: false,
    lessonTemplateSaving: false,
    lessonTemplateOptions: LESSON_TEMPLATE_OPTIONS,
    lessonTemplateIndex: 0,
    mistakeLearningForm: {
      enabled: true,
    },
    courseLearningForm: {
      enabled: true,
    },
    frenchLearningForm: {
      enabled: false,
    },
    showEnglishLearning: true,
    showVocabularySettings: false,
    vocabularyOverview: {
      enabled: false,
      dailyPlan: { dailyGoal: 0 },
      summary: { todayReviewedCount: 0, todayRemainingCount: 0, totalCount: 0, masteredCount: 0 },
      weeklyStats: {
        totalReviewed: 0,
        activeDays: 0,
        streakDays: 0,
        totalReviewActions: 0,
        fluentRate: 0,
        streakPendingToday: false,
      },
    },
    vocabularyTodaySegments: [],
    vocabularyMasterySegments: [],
    mistakeStatusSegments: [],
    weeklyChartPoints: [],
  },

  onLoad(options) {
    const mode = options.mode || "";
    const previewStudentId = options.previewStudentId || "";
    this.focusVocabularySettings = options.section === "vocabulary";
    this.setData({
      studentId: previewStudentId || options.id || "",
      previewStudentId,
      mode,
      showVocabularySettings: this.focusVocabularySettings,
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
        // 学生端不再使用旧的“英语课程与作业”汇总页；旧链接统一回到真实学生首页。
        if (result.role === "student" || isTeacherPreview) {
          const previewQuery = isTeacherPreview
            ? `?mode=teacherPreview&previewStudentId=${encodeURIComponent(this.data.studentId)}`
            : "";
          wx.redirectTo({ url: "/pages/index/index" + previewQuery });
          return;
        }
        const student = this.prepareStudent(result.student);
        const vocabularyState = this.prepareVocabularyState(student, result.vocabularyLevels || []);
        const overviewState = this.prepareVocabularyOverview(result.vocabularyOverview, vocabularyState.dailyPlan);
        const analytics = this.prepareAnalytics(result.analytics);
        const mistakeLearningEnabled = student.mistakeLearningEnabled !== false;
        const englishCourseEnabled = typeof student.englishCourseEnabled === "boolean"
          ? student.englishCourseEnabled
          : mistakeLearningEnabled;
        const lessonTemplateKey = inferLessonTemplateKey(student);
        const lessonTemplateIndex = Math.max(0, LESSON_TEMPLATE_OPTIONS.findIndex((item) => item.key === lessonTemplateKey));
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
          mistakeLearningForm: {
            enabled: mistakeLearningEnabled,
          },
          courseLearningForm: {
            enabled: englishCourseEnabled,
          },
          frenchLearningForm: {
            enabled: student.frenchLearningEnabled === true,
          },
          lessonTemplateIndex,
          showEnglishLearning: student.vocabularyEnabled === true || englishCourseEnabled || mistakeLearningEnabled,
          vocabularyDailyPlan: vocabularyState.dailyPlan,
          vocabularyOverview: overviewState.overview,
          vocabularyTodaySegments: overviewState.todaySegments,
          vocabularyMasterySegments: overviewState.masterySegments,
          weeklyChartPoints: overviewState.weeklyChartPoints,
          mistakeStatusSegments: this.prepareMistakeStatusSegments(analytics),
          message: "",
        }, () => {
          if (!this.focusVocabularySettings || !this.data.isTeacher) return;
          this.focusVocabularySettings = false;
          wx.pageScrollTo({ selector: "#vocabulary-settings", duration: 250 });
        });
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "服务暂时不可用，请稍后再试",
          student: null,
          lessons: [],
          cycleStatus: null,
          analytics: null,
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
          totalReviewActions: Math.max(0, Number(weeklyStats.totalReviewActions) || 0),
          fluentRate: Math.max(0, Math.min(100, Number(weeklyStats.fluentRate) || 0)),
          streakPendingToday: weeklyStats.streakPendingToday === true,
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
      url: "/pages/index/index?mode=teacherPreview&previewStudentId=" + this.data.student._id,
    });
  },

  goStudentReminders() {
    const student = this.data.student;
    if (!this.data.isTeacher || !student || !student._id) return;
    wx.navigateTo({
      url: "/engagement/pages/reminders/index?studentId=" + encodeURIComponent(student._id),
    });
  },

  goBackToTeacher() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: "/pages/index/index" });
      },
    });
  },

  goReviewDashboard() {
    let url = "/pages/review-dashboard/index?studentId=" + this.data.student._id;
    if (this.data.isTeacherPreview) {
      url += "&mode=teacherPreview&previewStudentId=" + this.data.student._id;
    }
    wx.navigateTo({ url });
  },


  goVocabulary() {
    const student = this.data.student;
    if (!student || !student._id) return;
    const studentId = encodeURIComponent(student._id);
    const params = ["studentId=" + studentId];
    if (this.data.isTeacherPreview) {
      params.push("mode=teacherPreview", "previewStudentId=" + studentId);
    } else {
      params.push("view=detail", "tab=all");
    }
    wx.navigateTo({
      url: "/pages/vocabulary/index?" + params.join("&"),
    });
  },

  goVocabularyStudy() {
    const student = this.data.student;
    if (!student || !student._id || !student.vocabularyEnabled) return;
    const params = ["studentId=" + encodeURIComponent(student._id)];
    if (this.data.isTeacherPreview) {
      params.push("mode=teacherPreview", "previewStudentId=" + encodeURIComponent(student._id));
    }
    wx.navigateTo({
      url: "/pages/vocabulary-study/index?" + params.join("&"),
    });
  },

  goVocabularyChallenge() {
    const student = this.data.student;
    if (!student || !student._id || !student.vocabularyEnabled) return;
    const params = ["studentId=" + encodeURIComponent(student._id)];
    if (this.data.isTeacherPreview) {
      params.push("mode=teacherPreview", "previewStudentId=" + encodeURIComponent(student._id));
    }
    wx.navigateTo({
      url: "/pages/vocabulary-challenge/index?" + params.join("&"),
    });
  },

  goFrenchLearning() {
    const student = this.data.student;
    if (!student || !student.frenchLearningEnabled) return;
    const params = [];
    if (this.data.isTeacherPreview) {
      params.push(
        "mode=teacherPreview",
        "previewStudentId=" + encodeURIComponent(student._id)
      );
    }
    wx.navigateTo({
      url: "/pages/french-learning/index" + (params.length ? "?" + params.join("&") : ""),
    });
  },

  toggleVocabularySettings() {
    this.setData({ showVocabularySettings: !this.data.showVocabularySettings });
  },

  onVocabularyEnabledChange(e) {
    if (!this.data.isTeacher || this.data.vocabularySaving || !this.data.student) return;
    const enabled = Boolean(e.detail.value);
    const previousEnabled = this.data.vocabularyForm.enabled === true;
    this.setData({
      "vocabularyForm.enabled": enabled,
    }, () => {
      this.saveVocabularySettings({
        rollbackEnabled: previousEnabled,
        successTitle: enabled ? "英语背单词已开启" : "英语背单词已关闭",
      });
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

  saveVocabularySettings(options = {}) {
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
        wx.showToast({ title: options.successTitle || "英语单词设置已保存" });
        this.loadStudent();
      })
      .catch((err) => {
        console.error(err);
        if (typeof options.rollbackEnabled === "boolean") {
          this.setData({ "vocabularyForm.enabled": options.rollbackEnabled });
        }
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

  onFrenchLearningChange(e) {
    if (!this.data.isTeacher || this.data.frenchSaving || !this.data.student) return;
    const enabled = Boolean(e.detail.value);
    this.setData({
      "frenchLearningForm.enabled": enabled,
      frenchSaving: true,
    });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "setFrenchLearningSettings",
          data: {
            studentId: this.data.student._id,
            enabled,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) throw new Error(result.message || "法语设置保存失败");
        wx.showToast({ title: enabled ? "法语学习已开启" : "法语学习已关闭" });
        this.loadStudent();
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          "frenchLearningForm.enabled": !enabled,
          message: err.message || "法语设置保存失败",
        });
        wx.showToast({ title: err.message || "保存失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ frenchSaving: false });
      });
  },

  onMistakeLearningChange(e) {
    if (!this.data.isTeacher || this.data.mistakeSaving || !this.data.student) return;
    const enabled = Boolean(e.detail.value);
    this.setData({
      "mistakeLearningForm.enabled": enabled,
      mistakeSaving: true,
    });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "setMistakeLearningSettings",
        data: {
          studentId: this.data.student._id,
          enabled,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "错题功能设置保存失败");
      wx.showToast({ title: enabled ? "英语错题功能已开启" : "英语错题功能已关闭" });
      this.loadStudent();
    }).catch((err) => {
      console.error(err);
      this.setData({
        "mistakeLearningForm.enabled": !enabled,
        message: err.message || "错题功能设置保存失败",
      });
      wx.showToast({ title: err.message || "保存失败", icon: "none" });
    }).finally(() => {
      this.setData({ mistakeSaving: false });
    });
  },

  onCourseLearningChange(e) {
    if (!this.data.isTeacher || this.data.courseSaving || !this.data.student) return;
    const enabled = Boolean(e.detail.value);
    this.setData({
      "courseLearningForm.enabled": enabled,
      courseSaving: true,
    });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "setEnglishCourseSettings",
        data: {
          studentId: this.data.student._id,
          enabled,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "课程功能设置保存失败");
      wx.showToast({ title: enabled ? "英语课程与作业已开启" : "英语课程与作业已关闭", icon: "none" });
      this.loadStudent();
    }).catch((err) => {
      console.error(err);
      this.setData({
        "courseLearningForm.enabled": !enabled,
        message: err.message || "课程功能设置保存失败",
      });
      wx.showToast({ title: err.message || "保存失败", icon: "none" });
    }).finally(() => {
      this.setData({ courseSaving: false });
    });
  },

  onStudentLessonTemplateChange(e) {
    if (!this.data.isTeacher || this.data.lessonTemplateSaving || !this.data.student) return;
    const previousIndex = this.data.lessonTemplateIndex;
    const nextIndex = Number(e.detail.value);
    const option = LESSON_TEMPLATE_OPTIONS[nextIndex];
    if (!option || nextIndex === previousIndex) return;
    this.setData({ lessonTemplateIndex: nextIndex, lessonTemplateSaving: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "setStudentLessonTemplate",
        data: {
          studentId: this.data.student._id,
          lessonTemplateKey: option.key,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "课程模板保存失败");
      wx.showToast({ title: "课程模板已保存", icon: "none" });
      this.loadStudent();
    }).catch((err) => {
      console.error(err);
      this.setData({ lessonTemplateIndex: previousIndex });
      wx.showToast({ title: err.message || "保存失败", icon: "none" });
    }).finally(() => {
      this.setData({ lessonTemplateSaving: false });
    });
  },

  showProgressEditor() {
    this.setData({
      showProgressEditor: true,
      progressForm: {
        plannedLessonCount: String(this.data.student.plannedLessonCount || 0),
        completedLessonCount: String(this.data.student.completedLessonCount || 0),
        lessonPackageSize: String(this.data.student.lessonPackageSize || 0),
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
            lessonPackageSize: this.data.progressForm.lessonPackageSize,
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
