Page({
  data: {
    studentId: "",
    previewStudentId: "",
    mode: "",
    role: "",
    student: null,
    cycleStatus: null,
    analytics: null,
    mistakeStatusSegments: [],
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

  onShow() {
    if (this.hasShown && this.data.studentId) this.loadAnalytics();
    this.hasShown = true;
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
        const analytics = this.prepareAnalytics(result.analytics);
        this.setData({
          role: result.role,
          student: result.student,
          cycleStatus: result.cycleStatus,
          analytics,
          mistakeStatusSegments: [
            { label: "待复习", value: analytics.pendingCount, color: "#C9A24A" },
            { label: "已复习", value: analytics.reviewedCount, color: "#7b8eaa" },
            { label: "已掌握", value: analytics.masteredCount, color: "#14645A" },
          ],
          message: "",
        });
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "加载遇到问题，请稍后重试",
        });
      });
  },

  prepareAnalytics(analytics) {
    const result = Object.assign(
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
    const maxQuestionTypeCount = Math.max(1, ...result.topQuestionTypes.map((item) => Number(item.count) || 0));
    result.topQuestionTypes = result.topQuestionTypes.map((item) => Object.assign({}, item, {
      percent: Math.round((Number(item.count || 0) / maxQuestionTypeCount) * 100),
    }));
    return result;
  },

  goMistake(e) {
    let url = "/pages/mistake-detail/index?id=" + e.currentTarget.dataset.id;
    if (this.data.mode === "teacherPreview") url += "&readOnly=1";
    wx.navigateTo({
      url,
    });
  },
});
