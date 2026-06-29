const sampleData = require("../../utils/sampleData");

Page({
  data: {
    studentId: "",
    student: null,
    lessons: [],
    isSample: true,
  },

  onLoad(options) {
    this.setData({
      studentId: options.id || "",
    });
    this.loadStudent();
  },

  loadStudent() {
    const studentId = this.data.studentId;
    const sampleStudent = sampleData.students.find((item) => item._id === studentId) || sampleData.students[0];
    const sampleLessons = sampleData.lessons.filter((item) => item.studentId === sampleStudent._id);

    this.setData({
      student: this.prepareStudent(sampleStudent),
      lessons: sampleLessons,
      isSample: true,
    });

    if (!wx.cloud || studentId.indexOf("sample-") === 0) return;
    const db = wx.cloud.database();
    Promise.all([
      db.collection("students").doc(studentId).get(),
      db.collection("lessons").where({ studentId }).orderBy("lessonDate", "desc").get(),
    ])
      .then((res) => {
        this.setData({
          student: this.prepareStudent(res[0].data),
          lessons: res[1].data || [],
          isSample: false,
        });
      })
      .catch(() => {
        console.log("读取学生详情失败，保留示例数据");
      });
  },

  prepareStudent(student) {
    return Object.assign({}, student, {
      initial: student.name ? student.name.substr(0, 1) : "学",
    });
  },

  goLesson(e) {
    wx.navigateTo({
      url: "/pages/lesson-detail/index?id=" + e.currentTarget.dataset.id,
    });
  },

  goAddLesson() {
    wx.navigateTo({
      url: "/pages/add-lesson/index?studentId=" + this.data.studentId,
    });
  },
});
