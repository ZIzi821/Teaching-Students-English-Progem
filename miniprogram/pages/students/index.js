const sampleData = require("../../utils/sampleData");

Page({
  data: {
    students: [],
    isSample: true,
  },

  onShow() {
    this.loadStudents();
  },

  loadStudents() {
    this.setData({
      students: this.prepareStudents(sampleData.students),
      isSample: true,
    });

    if (!wx.cloud) return;
    const db = wx.cloud.database();
    db.collection("students")
      .orderBy("createdAt", "desc")
      .get()
      .then((res) => {
        if (res.data && res.data.length) {
          this.setData({
            students: this.prepareStudents(res.data),
            isSample: false,
          });
        }
      })
      .catch(() => {
        console.log("students 集合暂不可用，展示示例学生");
      });
  },

  prepareStudents(students) {
    return students.map((item) => {
      return Object.assign({}, item, {
        initial: item.name ? item.name.substr(0, 1) : "学",
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
