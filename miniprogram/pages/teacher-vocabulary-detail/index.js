Page({
  data: {
    loading: true,
    noPermission: false,
    message: "",
    requestedStudentId: "",
    students: [],
  },

  onLoad(options) {
    this.requestedStudentId = String(options && options.studentId || "").trim();
    this.setData({ requestedStudentId: this.requestedStudentId });
  },

  onShow() {
    this.loadCatalog();
  },

  onPullDownRefresh() {
    this.loadCatalog({ stopRefresh: true });
  },

  loadCatalog(options = {}) {
    this.setData({ loading: true, noPermission: false, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getVocabularyCatalog",
        data: { scope: "teacher" },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取学生词库");
      const students = (result.students || []).map((item) => this.prepareStudent(item));
      if (this.requestedStudentId) {
        students.sort((left, right) => (
          Number(right.studentId === this.requestedStudentId)
          - Number(left.studentId === this.requestedStudentId)
        ));
      }
      this.setData({ loading: false, students, message: "", noPermission: false });
    }).catch((err) => {
      console.error(err);
      this.setData({
        loading: false,
        noPermission: true,
        message: err.message || "只有老师可以查看学生词库",
      });
    }).finally(() => {
      if (options.stopRefresh) wx.stopPullDownRefresh();
    });
  },

  prepareStudent(item) {
    const source = item || {};
    const student = source.student || {};
    const libraries = (source.libraries || []).map((library) => ({
      id: String(library.id || ""),
      label: String(library.label || "未命名词库"),
      edition: String(library.edition || ""),
      scopeLabel: (library.levelLabels || []).join("、"),
      wordCount: Math.max(0, Number(library.wordCount || 0)),
    }));
    return {
      studentId: String(student._id || ""),
      name: String(student.name || "学生"),
      grade: String(student.grade || "年级未填写"),
      enabled: source.enabled === true,
      stateLabel: source.enabled === true ? "已开启背词" : "背词未开启",
      libraries,
      libraryCount: libraries.length,
      mistakeWordsEnabled: source.mistakeWordsEnabled === true,
    };
  },

  openStudentVocabulary(e) {
    const studentId = String(e.currentTarget.dataset.id || "").trim();
    if (!studentId) return;
    wx.navigateTo({
      url: "/pages/student-detail/index?id=" + encodeURIComponent(studentId) + "&section=vocabulary",
    });
  },
});
