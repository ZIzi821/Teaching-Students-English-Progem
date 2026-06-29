const sampleData = require("../../utils/sampleData");

Page({
  data: {
    envId: "",
    stats: {
      studentCount: 0,
      lessonCount: 0,
      mistakeCount: 0,
    },
    recentLessons: [],
  },

  onLoad() {
    const app = getApp();
    this.setData({
      envId: app.globalData.env,
      stats: {
        studentCount: sampleData.students.length,
        lessonCount: sampleData.lessons.length,
        mistakeCount: sampleData.mistakes.length,
      },
      recentLessons: sampleData.lessons.slice(0, 2),
    });
    this.loadCloudStats();
  },

  loadCloudStats() {
    if (!wx.cloud) return;
    const db = wx.cloud.database();
    Promise.all([
      db.collection("students").count(),
      db.collection("lessons").count(),
      db.collection("mistakes").count(),
      db.collection("lessons").orderBy("lessonDate", "desc").limit(2).get(),
    ])
      .then((res) => {
        const cloudLessons = res[3].data || [];
        this.setData({
          stats: {
            studentCount: res[0].total,
            lessonCount: res[1].total,
            mistakeCount: res[2].total,
          },
          recentLessons: cloudLessons.length ? cloudLessons : this.data.recentLessons,
        });
      })
      .catch(() => {
        console.log("使用本地示例数据展示首页");
      });
  },

  goStudents() {
    wx.navigateTo({
      url: "/pages/students/index",
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
