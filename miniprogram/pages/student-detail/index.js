Page({
  data: {
    studentId: "",
    role: "",
    isTeacher: false,
    student: null,
    lessons: [],
    message: "",
  },

  onLoad(options) {
    this.setData({
      studentId: options.id || "",
    });
    this.loadStudent();
  },

  loadStudent() {
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getStudentDetail",
          data: {
            studentId: this.data.studentId,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            message: result.message || "无权查看该学生",
            student: null,
            lessons: [],
          });
          return;
        }
        this.setData({
          role: result.role,
          isTeacher: result.role === "teacher",
          student: this.prepareStudent(result.student),
          lessons: result.lessons || [],
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

  prepareStudent(student) {
    return Object.assign({}, student, {
      initial: student && student.name ? student.name.substr(0, 1) : "学",
    });
  },

  goLesson(e) {
    wx.navigateTo({
      url: "/pages/lesson-detail/index?id=" + e.currentTarget.dataset.id,
    });
  },

  goAddLesson() {
    wx.navigateTo({
      url: "/pages/add-lesson/index?studentId=" + this.data.student._id,
    });
  },
});
