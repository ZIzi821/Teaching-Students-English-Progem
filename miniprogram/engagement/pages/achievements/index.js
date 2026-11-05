const { callCloud } = require("../../../utils/cloud");
Page({
  data: {
    loading: true,
    message: "",
    mode: "",
    previewStudentId: "",
    isTeacherPreview: false,
    student: null,
    dashboard: null,
  },

  onLoad(options) {
    this.setData({
      mode: String(options.mode || ""),
      previewStudentId: String(options.previewStudentId || ""),
    });
  },

  onShow() {
    this.loadEngagement();
  },

  onPullDownRefresh() {
    this.loadEngagement({ stopRefresh: true });
  },

  loadEngagement(options = {}) {
    this.setData({ loading: true, message: "" });
    callCloud({
      type: "getStudentEngagement",
      data: {
        mode: this.data.mode,
        previewStudentId: this.data.previewStudentId,
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "成就数据暂时无法加载");
      const dashboard = result.dashboard || {};
      this.setData({
        loading: false,
        message: "",
        isTeacherPreview: result.isTeacherPreview === true,
        student: result.student || null,
        dashboard: Object.assign({}, dashboard, {
          weeklyRanking: (dashboard.weeklyRanking || []).map((item) => Object.assign({}, item, {
            rankMark: item.rank === 1 ? "冠" : item.rank === 2 ? "亚" : item.rank === 3 ? "季" : item.rank,
          })),
        }),
      });
    }).catch((err) => {
      console.error(err);
      this.setData({
        loading: false,
        message: err.message || "成就数据暂时无法加载",
        student: null,
        dashboard: null,
      });
    }).finally(() => {
      if (options.stopRefresh) wx.stopPullDownRefresh();
    });
  },

  retry() {
    this.loadEngagement();
  },

  goBackToTeacher() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: "/pages/index/index" });
      },
    });
  },
});
