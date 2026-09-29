Page({
  data: {
    students: [],
    isTeacher: false,
    noPermission: false,
    message: "",
    hiddenCount: 0,
    hidingId: "",
  },

  onShow() {
    this.loadStudents();
  },

  loadStudents() {
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "listStudents",
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            isTeacher: false,
            noPermission: true,
            message: result.message || "只有朱老师可以查看学生列表",
            students: [],
          });
          return;
        }
        this.setData({
          isTeacher: true,
          noPermission: false,
          message: "",
          hiddenCount: Number(result.hiddenCount || 0),
          students: this.prepareStudents(result.data || []),
        });
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          isTeacher: false,
          noPermission: true,
          message: "服务暂时不可用，请稍后再试",
        });
      });
  },

  prepareStudents(students) {
    return students.map((item) => {
      const boundAccountCount = Math.max(
        0,
        Number(item.boundAccountCount)
          || (Array.isArray(item.studentOpenIds) ? item.studentOpenIds.length : item.studentOpenId ? 1 : 0)
      );
      const bindLimit = Math.max(0, Number(item.studentBindLimit) || 0);
      return Object.assign({}, item, {
        initial: item.name ? item.name.substr(0, 1) : "学",
        bindStatus: boundAccountCount
          ? `已绑定 ${boundAccountCount}/${bindLimit || "不限"}`
          : `待绑定 · 最多 ${bindLimit || "不限"} 个`,
        progressLabel: "已上 " + (item.completedLessonCount || 0) + " / " + (item.plannedLessonCount || 0) + " 节",
        progressPercent: item.progressPercent || 0,
      });
    });
  },

  goStudent(e) {
    wx.navigateTo({
      url: "/pages/student-detail/index?id=" + e.currentTarget.dataset.id,
    });
  },

  goAddStudent() {
    wx.navigateTo({
      url: "/pages/add-student/index",
    });
  },

  hideStudent(e) {
    const studentId = String(e.currentTarget.dataset.id || "");
    const studentName = String(e.currentTarget.dataset.name || "这位学生");
    if (!studentId || this.data.hidingId) return;
    wx.showModal({
      title: `隐藏${studentName}？`,
      content: "隐藏后不会删除学生账号、课程、错题和学习进度，可随时在教师工作台恢复。",
      confirmText: "确认隐藏",
      confirmColor: "#9a6a34",
      success: (modalResult) => {
        if (!modalResult.confirm) return;
        this.setData({ hidingId: studentId });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "setStudentVisibility",
            data: { studentId, hidden: true },
          },
        }).then((res) => {
          const result = res.result || {};
          if (!result.success) throw new Error(result.message || "隐藏失败");
          wx.showToast({ title: "已移入工作台", icon: "success" });
          this.loadStudents();
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "隐藏失败", icon: "none" });
        }).finally(() => {
          this.setData({ hidingId: "" });
        });
      },
    });
  },

  goWorkbench() {
    wx.reLaunch({ url: "/pages/teacher-workbench/index" });
  },
});
