const sampleData = require("../../utils/sampleData");

Page({
  data: {
    envId: "",
    role: "loading",
    isTeacher: false,
    isStudent: false,
    isGuest: false,
    openid: "",
    teacherName: "朱老师",
    currentStudent: null,
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
    studentsProgress: [],
    errorMessage: "",
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
      this.setFallbackData("当前基础库不支持云开发");
      return;
    }
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getHomeData",
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setFallbackData(result.message || "读取身份失败");
          return;
        }
        const role = result.role || "guest";
        this.setData({
          role,
          isTeacher: role === "teacher",
          isStudent: role === "student",
          isGuest: role === "guest",
          openid: result.openid || "",
          teacherName: result.teacherName || "朱老师",
          currentStudent: result.currentStudent || null,
          stats: result.stats || {},
          recentLessons: result.recentLessons || [],
          studentsProgress: result.studentsProgress || [],
          errorMessage: "",
        });
        if (role === "guest") {
          wx.navigateTo({
            url: "/pages/bind-student/index",
          });
        }
      })
      .catch((err) => {
        console.error(err);
        this.setFallbackData("请先上传并部署 quickstartFunctions 云函数");
      });
  },

  setFallbackData(message) {
    this.setData({
      role: "guest",
      isTeacher: false,
      isStudent: false,
      isGuest: true,
      errorMessage: message,
      stats: {
        mistakeCount: sampleData.mistakes.length,
        progress: {
          progressText: "0 / 0",
          progressPercent: 0,
        },
      },
      recentLessons: sampleData.lessons.slice(0, 2),
      studentsProgress: [],
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
      url: "/pages/lesson-detail/index?id=" + lessonId,
    });
  },

  goMyLessons() {
    const studentId = this.data.currentStudent ? this.data.currentStudent._id : "";
    wx.navigateTo({
      url: "/pages/student-detail/index?id=" + studentId,
    });
  },

  goVocabulary() {
    const student = this.data.currentStudent;
    if (!student || !student._id || !student.vocabularyEnabled) return;
    wx.navigateTo({
      url: "/pages/vocabulary/index?studentId=" + student._id,
    });
  },

  goBind() {
    wx.navigateTo({
      url: "/pages/bind-student/index",
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

  goLessonBookings() {
    wx.navigateTo({
      url: "/pages/lesson-bookings/index",
    });
  },
});
