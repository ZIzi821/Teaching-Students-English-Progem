const { callCloud } = require("../../utils/cloud");
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
    calibrationLoading: false,
    calibrationRows: [],
  },

  onShow() {
    this.loadStudents();
  },

  loadStudents() {
    this.setData({ loading: true, message: "" });
    callCloud({
      type: "listStudents",
      data: { includeHidden: true },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) {
        this.setData({
          loading: false,
          isTeacher: false,
          noPermission: true,
          message: result.message || "请使用教师账号进入工作台",
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
      this.loadCalibrationRows((result.data || []).filter((student) => (
        student.teacherHidden !== true && student.vocabularyEnabled === true
      )));
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

  // 每位开启背词的学生读取一次记忆调度评估，只展示结论，详细数据进入评估页查看。
  loadCalibrationRows(students) {
    const requestId = (this.calibrationRequestId || 0) + 1;
    this.calibrationRequestId = requestId;
    if (!students.length) {
      this.setData({ calibrationRows: [], calibrationLoading: false });
      return;
    }
    this.setData({ calibrationLoading: true });
    Promise.all(students.map((student) => callCloud({
      type: "getEnglishMemoryEvaluation",
      data: { studentId: student._id },
    }).then((res) => {
      const result = res.result || {};
      return result.success ? result.evaluation || null : null;
    }).catch(() => null).then((evaluation) => this.buildCalibrationRow(student, evaluation)))).then((rows) => {
      if (this.calibrationRequestId !== requestId) return;
      const order = { attention: 0, stable: 1, collecting: 2, unknown: 3 };
      rows.sort((left, right) => order[left.tone] - order[right.tone]);
      this.setData({ calibrationRows: rows, calibrationLoading: false });
    });
  },

  buildCalibrationRow(student, evaluation) {
    const row = { studentId: student._id, name: student.name || "学生" };
    if (!evaluation || !evaluation.status) {
      return Object.assign(row, { tone: "unknown", statusLabel: "暂不可用", note: "点进去重新读取" });
    }
    const status = evaluation.status;
    const note = status.key === "collecting"
      ? `还需 ${Math.max(0, Number(evaluation.remainingToFirstEvaluation) || 0)} 次反馈、${Math.max(0, Number(evaluation.remainingUniqueWords) || 0)} 个词`
      : `预测记住 ${evaluation.predictedRetentionPercent}% · 实际 ${evaluation.actualRecallPercent}%`;
    return Object.assign(row, { tone: status.tone || "collecting", statusLabel: status.label, note });
  },

  goMemoryEvaluation(event) {
    const studentId = String(event.currentTarget.dataset.id || "");
    if (!studentId) return;
    wx.navigateTo({ url: "/insights/pages/memory-evaluation/index?studentId=" + encodeURIComponent(studentId) });
  },

  restoreStudent(event) {
    const studentId = String(event.currentTarget.dataset.id || "");
    const studentName = String(event.currentTarget.dataset.name || "这位学生");
    if (!studentId || this.data.restoringId) return;
    this.setData({ restoringId: studentId });
    callCloud({
      type: "setStudentVisibility",
      data: { studentId, hidden: false },
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

  goKetMockLibrary() {
    wx.navigateTo({ url: "/ket-mock/pages/library/index" });
  },

  goEngagementManager() {
    wx.navigateTo({ url: "/engagement/pages/manager/index" });
  },
});
