const sampleData = require("../../utils/sampleData");

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
    selectedStudentName: "",
    form: {
      title: "",
      subject: "数学",
      lessonDate: "",
      summary: "",
    },
  },

  onLoad(options) {
    this.setData({
      "form.lessonDate": formatDate(new Date()),
    });
    this.loadStudents(options.studentId || "");
  },

  loadStudents(preferredStudentId) {
    const fallbackStudents = sampleData.students;
    this.applyStudents(fallbackStudents, preferredStudentId);

    if (!wx.cloud) return;
    wx.cloud
      .database()
      .collection("students")
      .orderBy("createdAt", "desc")
      .get()
      .then((res) => {
        if (res.data && res.data.length) {
          this.applyStudents(res.data, preferredStudentId);
        }
      })
      .catch(() => {
        console.log("students 集合暂不可用，使用示例学生");
      });
  },

  applyStudents(students, preferredStudentId) {
    let studentIndex = 0;
    if (preferredStudentId) {
      const foundIndex = students.findIndex((item) => item._id === preferredStudentId);
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
    if (!student || !form.title || !form.subject || !form.lessonDate) {
      wx.showToast({
        title: "请填写课程信息",
        icon: "none",
      });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({
        title: "当前基础库不支持云开发",
        icon: "none",
      });
      return;
    }

    wx.showLoading({ title: "保存中" });
    const db = wx.cloud.database();
    db.collection("lessons")
      .add({
        data: {
          studentId: student._id,
          title: form.title,
          subject: form.subject,
          lessonDate: form.lessonDate,
          summary: form.summary,
          paperFileIds: [],
          createdAt: db.serverDate(),
        },
      })
      .then(() => {
        wx.showToast({ title: "已保存" });
        setTimeout(() => {
          wx.navigateBack();
        }, 500);
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({
          title: "保存失败，请检查集合权限",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },
});
