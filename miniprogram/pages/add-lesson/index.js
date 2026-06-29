function formatDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return year + "-" + (month < 10 ? "0" + month : month) + "-" + (day < 10 ? "0" + day : day);
}

Page({
  data: {
    students: [],
    studentIndex: 0,
    selectedStudentName: "请选择学生",
    message: "",
    form: {
      title: "",
      subject: "英语",
      lessonDate: "",
      lessonNo: "",
      summary: "",
    },
  },

  onLoad(options) {
    this.preferredStudentId = options.studentId || "";
    this.setData({
      "form.lessonDate": formatDate(new Date()),
    });
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
            message: result.message || "只有朱老师可以添加课程",
          });
          return;
        }
        this.applyStudents(result.data || []);
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "请先上传并部署云函数",
        });
      });
  },

  applyStudents(students) {
    let studentIndex = 0;
    if (this.preferredStudentId) {
      const foundIndex = students.findIndex((item) => item._id === this.preferredStudentId);
      studentIndex = foundIndex >= 0 ? foundIndex : 0;
    }
    this.setData({
      students,
      studentIndex,
      selectedStudentName: students[studentIndex] ? students[studentIndex].name : "请选择学生",
    });
  },

  onStudentChange(e) {
    const studentIndex = Number(e.detail.value);
    this.setData({
      studentIndex,
      selectedStudentName: this.data.students[studentIndex].name,
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      ["form." + field]: e.detail.value,
    });
  },

  onDateChange(e) {
    this.setData({
      "form.lessonDate": e.detail.value,
    });
  },

  submitLesson() {
    const student = this.data.students[this.data.studentIndex];
    const form = this.data.form;
    if (!student || !form.title || !form.lessonDate || !form.lessonNo) {
      wx.showToast({
        title: "请填写课程信息",
        icon: "none",
      });
      return;
    }

    wx.showLoading({ title: "保存中" });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "addLesson",
          data: {
            studentId: student._id,
            title: form.title,
            subject: form.subject,
            lessonDate: form.lessonDate,
            lessonNo: form.lessonNo,
            summary: form.summary,
            paperFileIds: [],
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (result.success === false) {
          this.setData({
            message: result.message || "保存失败",
          });
          wx.showToast({
            title: "保存失败",
            icon: "none",
          });
          return;
        }
        wx.showToast({ title: "已保存" });
        setTimeout(() => {
          wx.navigateBack();
        }, 500);
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "请先上传并部署云函数",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },
});
