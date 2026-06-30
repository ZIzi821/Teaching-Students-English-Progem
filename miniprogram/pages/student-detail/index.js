Page({
  data: {
    studentId: "",
    previewStudentId: "",
    mode: "",
    role: "",
    isTeacher: false,
    isTeacherPreview: false,
    student: null,
    lessons: [],
    message: "",
    showProgressEditor: false,
    progressForm: {
      plannedLessonCount: "",
      completedLessonCount: "",
    },
  },

  onLoad(options) {
    const mode = options.mode || "";
    const previewStudentId = options.previewStudentId || "";
    this.setData({
      studentId: previewStudentId || options.id || "",
      previewStudentId,
      mode,
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
            previewStudentId: this.data.previewStudentId,
            mode: this.data.mode,
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
        const isTeacherPreview = result.role === "teacher" && this.data.mode === "teacherPreview";
        this.setData({
          role: result.role,
          isTeacher: result.role === "teacher" && !isTeacherPreview,
          isTeacherPreview,
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
      progressLabel: "已上 " + (student.completedLessonCount || 0) + " / " + (student.plannedLessonCount || 0) + " 节",
    });
  },

  goLesson(e) {
    let url = "/pages/lesson-detail/index?id=" + e.currentTarget.dataset.id;
    if (this.data.isTeacherPreview) {
      url += "&mode=teacherPreview&previewStudentId=" + this.data.student._id;
    }
    wx.navigateTo({
      url,
    });
  },

  goAddLesson() {
    wx.navigateTo({
      url: "/pages/add-lesson/index?studentId=" + this.data.student._id,
    });
  },

  goTeacherPreview() {
    wx.navigateTo({
      url: "/pages/student-detail/index?mode=teacherPreview&previewStudentId=" + this.data.student._id,
    });
  },

  showProgressEditor() {
    this.setData({
      showProgressEditor: true,
      progressForm: {
        plannedLessonCount: String(this.data.student.plannedLessonCount || 0),
        completedLessonCount: String(this.data.student.completedLessonCount || 0),
      },
    });
  },

  hideProgressEditor() {
    this.setData({
      showProgressEditor: false,
    });
  },

  onProgressInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      ["progressForm." + field]: e.detail.value,
    });
  },

  submitProgress() {
    wx.showLoading({ title: "保存中" });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "updateStudentProgress",
          data: {
            studentId: this.data.student._id,
            plannedLessonCount: this.data.progressForm.plannedLessonCount,
            completedLessonCount: this.data.progressForm.completedLessonCount,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          wx.showToast({
            title: result.message || "保存失败",
            icon: "none",
          });
          return;
        }
        wx.showToast({ title: "已保存" });
        this.setData({ showProgressEditor: false });
        this.loadStudent();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({
          title: "保存失败",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },
});
