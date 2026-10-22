const { prefetchVocabularyAudio } = require("../../utils/vocabularyAudio");
const { buildHomeworkPlanStep, buildPrimaryLearningAction } = require("../../utils/studentLearningFlow");

const formatHomeworkActivityTime = (timestamp) => {
  const date = new Date(Number(timestamp || 0));
  if (Number.isNaN(date.getTime()) || !timestamp) return "刚刚同步";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

Page({
  data: {
    envId: "",
    role: "loading",
    isTeacher: false,
    isStudent: false,
    isTeacherPreview: false,
    isGuest: false,
    mode: "",
    previewStudentId: "",
    openid: "",
    teacherName: "朱老师",
    homeTitle: "朱老师英语课堂",
    studentHomeSubtitle: "今天也来学一点吧。",
    currentStudent: null,
    showEnglishLearning: true,
    englishCourseEnabled: true,
    mistakeLearningEnabled: true,
    stats: {
      studentCount: 0,
      mistakeCount: 0,
      progressOverview: {
        progressText: "0 / 0",
        progressPercent: 0,
      },
      progress: {
        progressText: "0 / 0",
        progressPercent: 0,
      },
    },
    recentLessons: [],
    homeworkCompletionNotices: [],
    learningActivityNotices: [],
    studentLearningActivities: [],
    pendingHomework: null,
    homeworkSummary: { pendingCount: 0, completedCount: 0, totalCount: 0 },
    studentPlanSteps: [],
    studentsProgress: [],
    vocabularyPulse: {
      enabled: false,
      goal: 0,
      reviewedCount: 0,
      remainingCount: 0,
      progressPercent: 0,
      completed: false,
    },
    vocabularyQuizPulse: {
      completed: false,
      attemptCount: 0,
      bestAccuracy: 0,
      bestCorrectCount: 0,
      bestTotalQuestions: 0,
    },
    studentPrimaryAction: null,
    showStudentSwitcher: false,
    errorMessage: "",
  },

  onLoad(options) {
    this.setData({
      mode: String(options.mode || ""),
      previewStudentId: String(options.previewStudentId || ""),
    });
  },

  onShow() {
    const app = getApp();
    this.setData({
      envId: app.globalData.env,
    });
    this.loadHomeData();
  },

  loadHomeData() {
    if (!wx.cloud) {
      this.setFallbackData("微信版本过低，请更新后重试");
      return;
    }
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getHomeData",
          data: {
            mode: this.data.mode,
            previewStudentId: this.data.previewStudentId,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setFallbackData(result.message || "读取身份失败");
          return;
        }
        const role = result.role || "guest";
        const isTeacherPreview = result.isTeacherPreview === true;
        const isStudentSurface = role === "student" || isTeacherPreview;
        const currentStudent = result.currentStudent || null;
        const mistakeLearningEnabled = currentStudent
          ? currentStudent.mistakeLearningEnabled !== false
          : true;
        const englishCourseEnabled = currentStudent
          ? typeof currentStudent.englishCourseEnabled === "boolean"
            ? currentStudent.englishCourseEnabled
            : mistakeLearningEnabled
          : true;
        const showEnglishLearning = currentStudent
          ? currentStudent.vocabularyEnabled === true || englishCourseEnabled || mistakeLearningEnabled
          : true;
        const isFrenchOnly = isStudentSurface
          && currentStudent
          && currentStudent.frenchLearningEnabled === true
          && !showEnglishLearning;
        this.setData({
          role,
          isTeacher: role === "teacher" && !isTeacherPreview,
          isStudent: isStudentSurface,
          isTeacherPreview,
          isGuest: role === "guest" && !isTeacherPreview,
          openid: result.openid || "",
          teacherName: result.teacherName || "朱老师",
          homeTitle: isFrenchOnly ? "我的法语学习" : "朱老师英语课堂",
          studentHomeSubtitle: isFrenchOnly
            ? "今天从一句法语开始，沿着自己的路线继续学习。"
            : "今天也来学一点吧。",
          currentStudent,
          showEnglishLearning,
          englishCourseEnabled,
          mistakeLearningEnabled,
          stats: result.stats || {},
          recentLessons: result.recentLessons || [],
          homeworkCompletionNotices: (result.homeworkCompletionNotices || []).map((item) => Object.assign({}, item, {
            activityLabel: formatHomeworkActivityTime(item.activityAtMs),
          })),
          learningActivityNotices: (result.learningActivityNotices || []).map((item) => Object.assign({}, item, {
            activityLabel: formatHomeworkActivityTime(item.activityAtMs),
            actionLabel: String(item.activityType || "").indexOf("schedule_") === 0 ? "查看日程 →" : "查看 →",
          })),
          studentLearningActivities: (result.studentLearningActivities || []).map((item) => Object.assign({}, item, {
            activityLabel: formatHomeworkActivityTime(item.activityAtMs),
          })),
          pendingHomework: result.pendingHomework || null,
          homeworkSummary: result.homeworkSummary || { pendingCount: 0, completedCount: 0, totalCount: 0 },
          studentPlanSteps: this.buildStudentPlanSteps(
            currentStudent,
            result.vocabularyPulse,
            result.vocabularyQuizPulse,
            result.pendingHomework,
            result.homeworkSummary
          ),
          studentsProgress: (result.studentsProgress || []).map((item) => Object.assign({}, item, {
            initial: String(item && item.name || "学").slice(0, 1),
          })),
          vocabularyPulse: result.vocabularyPulse || {
            enabled: false,
            goal: 0,
            reviewedCount: 0,
            remainingCount: 0,
            progressPercent: 0,
            completed: false,
          },
          vocabularyQuizPulse: result.vocabularyQuizPulse || {
            completed: false,
            attemptCount: 0,
            bestAccuracy: 0,
            bestCorrectCount: 0,
            bestTotalQuestions: 0,
          },
          studentPrimaryAction: buildPrimaryLearningAction({
            student: currentStudent || {},
            vocabularyPulse: result.vocabularyPulse || {},
            vocabularyQuizPulse: result.vocabularyQuizPulse || {},
            homeworkSummary: result.homeworkSummary || {},
            englishCourseEnabled,
            mistakeLearningEnabled,
          }),
          showStudentSwitcher: role === "teacher" && !isTeacherPreview ? this.data.showStudentSwitcher : false,
          errorMessage: "",
        });
        if (role === "guest" && !isTeacherPreview) {
          wx.navigateTo({
            url: "/pages/bind-student/index",
          });
        } else if (role === "student" && currentStudent && currentStudent.vocabularyEnabled === true) {
          this.prefetchTodayVocabularyAudio(currentStudent._id);
        }
      })
      .catch((err) => {
        console.error(err);
        this.setFallbackData("服务暂时不可用，请稍后再试");
      });
  },

  setFallbackData(message) {
    this.setData({
      role: "guest",
      isTeacher: false,
      isStudent: false,
      isTeacherPreview: false,
      isGuest: true,
      openid: "",
      currentStudent: null,
      errorMessage: message,
      stats: {
        mistakeCount: 0,
        progress: {
          progressText: "0 / 0",
          progressPercent: 0,
        },
      },
      recentLessons: [],
      homeworkCompletionNotices: [],
      learningActivityNotices: [],
      studentLearningActivities: [],
      pendingHomework: null,
      homeworkSummary: { pendingCount: 0, completedCount: 0, totalCount: 0 },
      studentPlanSteps: [],
      studentsProgress: [],
      homeTitle: "朱老师英语课堂",
      studentHomeSubtitle: "今天也来学一点吧。",
      showEnglishLearning: true,
      englishCourseEnabled: true,
      mistakeLearningEnabled: true,
      vocabularyPulse: {
        enabled: false,
        goal: 0,
        reviewedCount: 0,
        remainingCount: 0,
        progressPercent: 0,
        completed: false,
      },
      vocabularyQuizPulse: {
        completed: false,
        attemptCount: 0,
        bestAccuracy: 0,
        bestCorrectCount: 0,
        bestTotalQuestions: 0,
      },
      studentPrimaryAction: null,
      showStudentSwitcher: false,
    });
  },

  prefetchTodayVocabularyAudio(studentId) {
    const normalizedStudentId = String(studentId || "").trim();
    if (!normalizedStudentId || this.prefetchedAudioStudentId === normalizedStudentId) return;
    this.prefetchedAudioStudentId = normalizedStudentId;
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getVocabularyData",
        data: {
          studentId: normalizedStudentId,
          browseTab: "today",
          offset: 0,
          limit: 30,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "今日单词音频准备失败");
      const todayWords = (result.todayWords || [])
        .filter((item) => item && item.isDue !== false)
        .slice(0, 30);
      return prefetchVocabularyAudio(todayWords, { concurrency: 3 });
    }).then((summary) => {
      if (summary && summary.failed) {
        console.warn("some vocabulary audio prefetches failed", summary);
      }
    }).catch((err) => {
      this.prefetchedAudioStudentId = "";
      console.warn("prefetch today vocabulary audio failed", err);
    });
  },

  buildStudentPlanSteps(student, vocabularyPulse, vocabularyQuizPulse, pendingHomework, homeworkSummary) {
    if (!student) return [];
    const steps = [];
    const pulse = vocabularyPulse || {};
    const quizPulse = vocabularyQuizPulse || {};
    if (student.vocabularyEnabled === true) {
      steps.push({
        action: "study",
        tone: "green",
        completed: pulse.completed === true,
        title: pulse.completed ? "今天的单词已完成" : "先背今天的单词",
        hint: pulse.completed
          ? "今天已经完成，可以重新查看背词流程"
          : `一次一个：先回忆，再看答案；还差 ${Number(pulse.remainingCount) || 0} 个`,
        actionLabel: pulse.completed ? "查看 →" : "去背词 →",
      });
      steps.push({
        action: "quiz",
        tone: "sand",
        completed: quizPulse.completed === true,
        title: quizPulse.completed ? "今天的单词小测已完成" : "背完后做单词小测",
        hint: quizPulse.completed
          ? `今天已完成 ${Number(quizPulse.attemptCount) || 1} 轮，最好成绩 ${Number(quizPulse.bestAccuracy) || 0}%`
          : "系统会按今日接触、薄弱词和复习时间安排选择、补缺与默写题",
        actionLabel: quizPulse.completed ? "再练 →" : "去小测 →",
      });
    }
    const courseEnabled = typeof student.englishCourseEnabled === "boolean"
      ? student.englishCourseEnabled
      : student.mistakeLearningEnabled !== false;
    if (courseEnabled) {
      const summary = homeworkSummary || {};
      steps.push(Object.assign({
        action: "homework",
        tone: "gold",
      }, buildHomeworkPlanStep({ pendingHomework, homeworkSummary: summary })));
    }
    return steps.map((item, index) => Object.assign({}, item, { number: index + 1 }));
  },

  handlePlanStep(e) {
    const action = String(e.currentTarget.dataset.action || "");
    if (action === "study") this.goVocabularyStudy();
    else if (action === "quiz") this.goVocabularyChallenge();
    else if (action === "homework") this.goHomeworkTasks();
  },

  handlePrimaryLearningAction() {
    const action = this.data.studentPrimaryAction && this.data.studentPrimaryAction.action;
    if (action === "study") this.goVocabularyStudy();
    else if (action === "quiz") this.goVocabularyChallenge();
    else if (action === "homework") this.goHomeworkTasks();
    else if (action === "mistakes") this.goMistakeReview();
    else if (action === "french") this.goFrenchLearning();
  },

  toggleStudentSwitcher() {
    if (!this.data.isTeacher) return;
    if (!this.data.studentsProgress.length) {
      wx.showToast({ title: "还没有可预览的学生", icon: "none" });
      return;
    }
    this.setData({ showStudentSwitcher: !this.data.showStudentSwitcher });
  },

  openStudentPreview(e) {
    const studentId = String(e.currentTarget.dataset.id || "");
    if (!studentId || !this.data.isTeacher) return;
    this.setData({ showStudentSwitcher: false });
    wx.navigateTo({
      url: "/pages/index/index?mode=teacherPreview&previewStudentId=" + encodeURIComponent(studentId),
    });
  },

  withPreviewParams(url) {
    if (!this.data.isTeacherPreview || !this.data.previewStudentId) return url;
    const separator = url.indexOf("?") >= 0 ? "&" : "?";
    return `${url}${separator}mode=teacherPreview&previewStudentId=${encodeURIComponent(this.data.previewStudentId)}`;
  },

  goBackToTeacher() {
    wx.navigateBack({
      fail() { wx.reLaunch({ url: "/pages/index/index" }); },
    });
  },

  goStudents() {
    wx.navigateTo({
      url: "/pages/students/index",
    });
  },

  goStudentDetail(e) {
    const studentId = e.currentTarget.dataset.id;
    if (!studentId) return;
    wx.navigateTo({
      url: "/pages/student-detail/index?id=" + studentId,
    });
  },

  goLessonDetail(e) {
    const lessonId = e.currentTarget.dataset.id;
    if (!lessonId) return;
    wx.navigateTo({
      url: this.withPreviewParams("/pages/lesson-detail/index?id=" + lessonId),
    });
  },

  markLearningActivitiesViewed(viewedThroughAtMs) {
    if (!wx.cloud || !viewedThroughAtMs) return Promise.reject(new Error("云服务暂时不可用"));
    return wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "markLearningActivitiesViewed",
        data: { viewedThroughAtMs },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "同步已读状态失败");
      return result;
    });
  },

  goLearningActivity(e) {
    const lessonId = String(e.currentTarget.dataset.lessonId || "");
    const studentId = String(e.currentTarget.dataset.studentId || "");
    const activityType = String(e.currentTarget.dataset.type || "");
    const activityAtMs = Number(e.currentTarget.dataset.activityAt || 0);
    if (!activityAtMs) return;
    const notices = this.data.learningActivityNotices || [];
    this.setData({
      learningActivityNotices: notices.filter((item) => Number(item.activityAtMs || 0) > activityAtMs),
    });
    this.markLearningActivitiesViewed(activityAtMs).catch((err) => {
      console.error("mark learning activity viewed failed", err);
    });
    if (lessonId) {
      wx.navigateTo({ url: "/pages/lesson-detail/index?id=" + lessonId });
    } else if (studentId && activityType.indexOf("quiz_") === 0) {
      wx.navigateTo({ url: "/pages/teacher-vocabulary-detail/index?studentId=" + encodeURIComponent(studentId) });
    } else if (activityType.indexOf("schedule_") === 0) {
      wx.reLaunch({ url: "/schedule/pages/index/index" });
    }
  },

  dismissLearningActivities() {
    const notices = this.data.learningActivityNotices || [];
    const viewedThroughAtMs = notices.reduce(
      (latest, item) => Math.max(latest, Number(item.activityAtMs || 0)),
      0
    );
    if (!viewedThroughAtMs) return;
    this.setData({ learningActivityNotices: [] });
    this.markLearningActivitiesViewed(viewedThroughAtMs).catch((err) => {
      console.error("dismiss learning activities failed", err);
      this.setData({ learningActivityNotices: notices });
      wx.showToast({ title: "暂时未同步，请重试", icon: "none" });
    });
  },

  markStudentActivitiesViewed(viewedThroughAtMs) {
    if (this.data.isTeacherPreview || !wx.cloud || !viewedThroughAtMs) return Promise.resolve();
    return wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "markStudentLearningActivitiesViewed",
        data: { viewedThroughAtMs },
      },
    });
  },

  goStudentLearningActivity(e) {
    const activityAtMs = Number(e.currentTarget.dataset.activityAt || 0);
    const lessonId = String(e.currentTarget.dataset.lessonId || "");
    const activityType = String(e.currentTarget.dataset.type || "");
    const notices = this.data.studentLearningActivities || [];
    this.setData({
      studentLearningActivities: notices.filter((item) => Number(item.activityAtMs || 0) > activityAtMs),
    });
    this.markStudentActivitiesViewed(activityAtMs).catch((err) => console.error(err));
    if (lessonId) {
      wx.navigateTo({ url: this.withPreviewParams("/pages/lesson-detail/index?id=" + lessonId) });
    } else if (activityType === "vocabularyQuiz") {
      this.goVocabularyChallenge();
    }
  },

  dismissStudentLearningActivities() {
    const notices = this.data.studentLearningActivities || [];
    const viewedThroughAtMs = notices.reduce(
      (latest, item) => Math.max(latest, Number(item.activityAtMs || 0)),
      0
    );
    if (!viewedThroughAtMs) return;
    this.setData({ studentLearningActivities: [] });
    this.markStudentActivitiesViewed(viewedThroughAtMs).catch((err) => {
      console.error(err);
      this.setData({ studentLearningActivities: notices });
    });
  },

  goPendingHomework() {
    const lesson = this.data.pendingHomework;
    if (!lesson || !lesson._id) return;
    wx.navigateTo({ url: this.withPreviewParams("/pages/lesson-detail/index?id=" + lesson._id) });
  },

  goMistakeReview() {
    const studentId = this.data.currentStudent ? this.data.currentStudent._id : "";
    if (!studentId || !this.data.mistakeLearningEnabled) return;
    wx.navigateTo({
      url: this.withPreviewParams(
        "/pages/review-dashboard/index?studentId=" + encodeURIComponent(studentId)
      ),
    });
  },

  goHomeworkTasks() {
    const student = this.data.currentStudent;
    if (!student || !student._id) return;
    wx.navigateTo({
      url: this.withPreviewParams("/pages/homework/index?studentId=" + encodeURIComponent(student._id)),
    });
  },

  goVocabulary() {
    const student = this.data.currentStudent;
    if (!student || !student._id || !student.vocabularyEnabled) return;
    wx.navigateTo({
      url: this.withPreviewParams("/pages/vocabulary/index?studentId=" + student._id),
    });
  },

  goVocabularyStudy() {
    const student = this.data.currentStudent;
    if (!student || !student._id || !student.vocabularyEnabled) return;
    wx.navigateTo({
      url: this.withPreviewParams("/pages/vocabulary-study/index?studentId=" + encodeURIComponent(student._id)),
    });
  },

  goVocabularyChallenge() {
    const student = this.data.currentStudent;
    if (!student || !student._id || !student.vocabularyEnabled) return;
    wx.navigateTo({
      url: this.withPreviewParams("/pages/vocabulary-challenge/index?studentId=" + encodeURIComponent(student._id)),
    });
  },

  goFrenchLearning() {
    if (this.data.isStudent && (!this.data.currentStudent || !this.data.currentStudent.frenchLearningEnabled)) return;
    wx.navigateTo({
      url: this.withPreviewParams("/pages/french-learning/index"),
    });
  },

  goBind() {
    wx.navigateTo({
      url: "/pages/bind-student/index",
    });
  },

  unbindIdentity() {
    if (this.data.isTeacherPreview) return;
    if (!this.data.isTeacher && !this.data.isStudent) return;
    const roleLabel = this.data.isTeacher
      ? "教师端"
      : `${this.data.currentStudent && this.data.currentStudent.name || "学生"}的学生端`;
    wx.showModal({
      title: "退出当前身份？",
      content: `即将退出${roleLabel}。课程、错题和学习记录都不会删除，以后可以再次输入访问码进入。`,
      confirmText: "确认退出",
      confirmColor: "#a04f43",
      success: (modalResult) => {
        if (!modalResult.confirm) return;
        wx.showLoading({ title: "正在退出", mask: true });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: { type: "unbindIdentity" },
        }).then((res) => {
          const result = res.result || {};
          if (!result.success) throw new Error(result.message || "退出失败");
          wx.reLaunch({ url: "/pages/bind-student/index?signedOut=1" });
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "退出失败，请重试", icon: "none" });
        }).finally(() => {
          wx.hideLoading();
        });
      },
    });
  },

  goAddLesson() {
    wx.navigateTo({
      url: "/pages/add-lesson/index",
    });
  },

  goAddStudent() {
    wx.navigateTo({
      url: "/pages/add-student/index",
    });
  },

  goAddMistake() {
    wx.navigateTo({
      url: "/pages/add-mistake/index",
    });
  },

  goVocabularyDetail() {
    wx.navigateTo({
      url: "/pages/teacher-vocabulary-detail/index",
    });
  },

});
