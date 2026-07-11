Page({
  data: {
    studentId: "",
    previewStudentId: "",
    mode: "",
    role: "",
    student: null,
    cycleStatus: null,
    analytics: null,
    message: "",
  },

  onLoad(options) {
    this.setData({
      studentId: options.studentId || "",
      previewStudentId: options.previewStudentId || "",
      mode: options.mode || "",
    });
    this.loadAnalytics();
  },

  loadAnalytics() {
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getStudentAnalytics",
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
            message: result.message || "暂时无法读取复习分析",
          });
          return;
        }
        this.setData({
          role: result.role,
          student: result.student,
          cycleStatus: result.cycleStatus,
          analytics: this.prepareAnalytics(result.analytics),
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
    return Object.assign(
      {
        totalMistakeCount: 0,
        pendingCount: 0,
        reviewedCount: 0,
        masteredCount: 0,
        topQuestionTypes: [],
        topSkillTags: [],
        topReasons: [],
        sectionStats: [],
        reviewSuggestions: [],
      },
      analytics || {}
    );
  },

  goMistake(e) {
    wx.navigateTo({
      url: "/pages/mistake-detail/index?id=" + e.currentTarget.dataset.id,
    });
  },
});
