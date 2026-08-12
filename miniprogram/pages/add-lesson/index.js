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
    lessonNoTip: "",
    message: "",
    saving: false,
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
          message: "服务暂时不可用，请稍后再试",
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
    }, () => {
      this.updateLessonNoSuggestion();
    });
  },

  onStudentChange(e) {
    const studentIndex = Number(e.detail.value);
    const student = this.data.students[studentIndex];
    this.setData({
      studentIndex,
      selectedStudentName: student ? student.name : "请选择学生",
    }, () => {
      this.updateLessonNoSuggestion();
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    if (field === "lessonNo") {
      this.lessonNoManuallyChanged = true;
    }
    this.setData({
      ["form." + field]: e.detail.value,
    });
  },

  updateLessonNoSuggestion() {
    const student = this.data.students[this.data.studentIndex];
    this.lessonNoManuallyChanged = false;
    if (!student) {
      this.setData({
        lessonNoTip: "",
        "form.lessonNo": "",
      });
      return;
    }

    const requestId = (this.lessonNoSuggestionRequestId || 0) + 1;
    this.lessonNoSuggestionRequestId = requestId;
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getNextLessonNo",
          data: {
            studentId: student._id,
          },
        },
      })
      .then((res) => {
        if (requestId !== this.lessonNoSuggestionRequestId) return;
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            lessonNoTip: "",
            message: result.message || "无法获取建议课次",
          });
          return;
        }

        const nextLessonNo = result.nextLessonNo || 1;
        const lessonNoTip = result.hasHistory
          ? `上次是第 ${result.maxLessonNo} 节，本次可填第 ${nextLessonNo} 节`
          : "还没有课程记录，可从第 1 节开始";
        const updates = {
          lessonNoTip,
        };
        if (!this.lessonNoManuallyChanged) {
          updates["form.lessonNo"] = String(nextLessonNo);
        }
        this.setData(updates);
      })
      .catch((err) => {
        if (requestId !== this.lessonNoSuggestionRequestId) return;
        console.error(err);
        this.setData({
          lessonNoTip: "",
          message: "服务暂时不可用，请稍后再试",
        });
      });
  },

  onDateChange(e) {
    this.setData({
      "form.lessonDate": e.detail.value,
    });
  },

  submitLesson() {
    if (this.data.saving) return;
    const student = this.data.students[this.data.studentIndex];
    const form = this.data.form;
    if (!student || !form.title || !form.lessonDate || !form.lessonNo) {
      wx.showToast({
        title: "请填写课程信息",
        icon: "none",
      });
      return;
    }

    if (!this.lessonRequestId) {
      this.lessonRequestId = `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中", mask: true });
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
            requestId: this.lessonRequestId,
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
            title: result.message || "保存失败",
            icon: "none",
          });
          return;
        }
        this.lessonRequestId = "";
        wx.showToast({ title: "已保存" });
        setTimeout(() => {
          wx.navigateBack();
        }, 500);
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "服务暂时不可用，请稍后再试",
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ saving: false });
      });
  },
});
