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
      lessonCount: 0,
      mistakeCount: 0,
    },
    recentLessons: [],
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
          errorMessage: "",
        });
        if (role === "guest") {
          wx.navigateTo({
            url: "/pages/bind-student/index?openid=" + (result.openid || ""),
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
        lessonCount: sampleData.lessons.length,
        mistakeCount: sampleData.mistakes.length,
      },
      recentLessons: sampleData.lessons.slice(0, 2),
    });
  },

  goStudents() {
    wx.navigateTo({
      url: "/pages/students/index",
    });
  },

  goMyLessons() {
    const studentId = this.data.currentStudent ? this.data.currentStudent._id : "";
    wx.navigateTo({
      url: "/pages/student-detail/index?id=" + studentId,
    });
  },

  goBind() {
    wx.navigateTo({
      url: "/pages/bind-student/index?openid=" + this.data.openid,
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
});
