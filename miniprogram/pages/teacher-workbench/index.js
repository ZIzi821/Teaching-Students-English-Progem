Page({
  data: {
    loading: true,
    isTeacher: false,
    noPermission: false,
    message: "",
    activeCount: 0,
    hiddenCount: 0,
    hiddenStudents: [],
    restoringId: "",
    learningAlerts: [],
    vocabularyAlgorithmVersion: "",
    quizSessionCount: 0,
  },

  onShow() {
    this.loadStudents();
  },

  loadStudents() {
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "listStudents",
        data: { includeHidden: true },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) {
        this.setData({
          loading: false,
          isTeacher: false,
          noPermission: true,
          message: result.message || "只有教师账号可以使用工作台",
          hiddenStudents: [],
        });
        return;
      }
      const hiddenStudents = (result.data || [])
        .filter((student) => student.teacherHidden === true)
        .map((student) => Object.assign({}, student, {
          initial: student.name ? student.name.substr(0, 1) : "学",
          learningLabel: [
            student.englishCourseEnabled ? "英语课程" : "",
            student.vocabularyEnabled ? "英语单词" : "",
            student.mistakeLearningEnabled ? "英语错题" : "",
            student.frenchLearningEnabled ? "法语" : "",
          ].filter(Boolean).join(" · ") || "未开启学习功能",
        }));
      this.setData({
        loading: false,
        isTeacher: true,
        noPermission: false,
        activeCount: Number(result.activeCount || 0),
        hiddenCount: Number(result.hiddenCount || hiddenStudents.length),
        hiddenStudents,
        message: "",
      });
      this.loadLearningAlerts();
    }).catch((err) => {
      console.error(err);
      this.setData({
        loading: false,
        isTeacher: false,
        noPermission: true,
        message: "工作台暂时无法加载，请稍后再试",
      });
    });
  },

  loadLearningAlerts() {
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getTeacherLearningAlerts" },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "英语学习提醒加载失败");
      this.setData({
        learningAlerts: result.alerts || [],
        vocabularyAlgorithmVersion: result.algorithmVersion || "",
        quizSessionCount: Number(result.sessionCount || 0),
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ learningAlerts: [] });
    });
  },

  goLearningAlert(event) {
    const studentId = String(event.currentTarget.dataset.studentId || "");
    if (!studentId) return;
    wx.navigateTo({
      url: "/pages/teacher-vocabulary-detail/index?studentId=" + encodeURIComponent(studentId),
    });
  },

  restoreStudent(event) {
    const studentId = String(event.currentTarget.dataset.id || "");
    const studentName = String(event.currentTarget.dataset.name || "这位学生");
    if (!studentId || this.data.restoringId) return;
    this.setData({ restoringId: studentId });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "setStudentVisibility",
        data: { studentId, hidden: false },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "恢复失败");
      wx.showToast({ title: `${studentName}已恢复`, icon: "success" });
      this.loadStudents();
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "恢复失败", icon: "none" });
    }).finally(() => {
      this.setData({ restoringId: "" });
    });
  },

  goStudents() {
    wx.reLaunch({ url: "/pages/students/index" });
  },

  goAddStudent() {
    wx.navigateTo({ url: "/pages/add-student/index" });
  },

  goAddLesson() {
    wx.navigateTo({ url: "/pages/add-lesson/index" });
  },
});
