Page({
  data: {
    students: [],
    noPermission: false,
    message: "",
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
            noPermission: true,
            message: result.message || "只有朱老师可以查看学生列表",
            students: [],
          });
          return;
        }
        this.setData({
          noPermission: false,
          message: "",
          students: this.prepareStudents(result.data || []),
        });
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          noPermission: true,
          message: "请先上传并部署云函数",
        });
      });
  },

  prepareStudents(students) {
    return students.map((item) => {
      return Object.assign({}, item, {
        initial: item.name ? item.name.substr(0, 1) : "学",
        bindStatus: item.studentOpenId ? "已绑定" : "待绑定",
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
});
