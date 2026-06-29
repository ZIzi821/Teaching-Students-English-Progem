const sampleData = require("../../utils/sampleData");

Page({
  data: {
    students: [],
    lessons: [],
    studentIndex: 0,
    lessonIndex: 0,
    selectedStudentName: "",
    selectedLessonTitle: "",
    questionImageFileId: "",
    form: {
      studentAnswer: "",
      correctAnswer: "",
      reason: "",
      explanation: "",
      tagsText: "",
    },
  },

  onLoad(options) {
    this.preferredStudentId = options.studentId || "";
    this.preferredLessonId = options.lessonId || "";
    this.loadStudents();
  },

  loadStudents() {
    this.applyStudents(sampleData.students);

    if (!wx.cloud) return;
    wx.cloud
      .database()
      .collection("students")
      .orderBy("createdAt", "desc")
      .get()
      .then((res) => {
        if (res.data && res.data.length) {
          this.applyStudents(res.data);
        }
      })
      .catch(() => {
        console.log("students 集合暂不可用，使用示例学生");
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
    this.loadLessons(students[studentIndex] ? students[studentIndex]._id : "");
  },

  loadLessons(studentId) {
    const fallbackLessons = sampleData.lessons.filter((item) => item.studentId === studentId);
    this.applyLessons(fallbackLessons);

    if (!wx.cloud || studentId.indexOf("sample-") === 0) return;
    wx.cloud
      .database()
      .collection("lessons")
      .where({ studentId })
      .orderBy("lessonDate", "desc")
      .get()
      .then((res) => {
        this.applyLessons(res.data || []);
      })
      .catch(() => {
        console.log("lessons 集合暂不可用，使用示例课程");
      });
  },

  applyLessons(lessons) {
    let lessonIndex = 0;
    if (this.preferredLessonId) {
      const foundIndex = lessons.findIndex((item) => item._id === this.preferredLessonId);
      lessonIndex = foundIndex >= 0 ? foundIndex : 0;
    }
    this.setData({
      lessons,
      lessonIndex,
      selectedLessonTitle: lessons[lessonIndex] ? lessons[lessonIndex].title : "请先添加课程",
    });
  },

  onStudentChange(e) {
    const studentIndex = Number(e.detail.value);
    const student = this.data.students[studentIndex];
    this.preferredStudentId = student ? student._id : "";
    this.preferredLessonId = "";
    this.setData({
      studentIndex,
      selectedStudentName: student ? student.name : "",
    });
    this.loadLessons(student ? student._id : "");
  },

  onLessonChange(e) {
    const lessonIndex = Number(e.detail.value);
    this.setData({
      lessonIndex,
      selectedLessonTitle: this.data.lessons[lessonIndex] ? this.data.lessons[lessonIndex].title : "",
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      ["form." + field]: e.detail.value,
    });
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const filePath = res.tempFiles[0].tempFilePath;
        this.uploadImage(filePath);
      },
    });
  },

  uploadImage(filePath) {
    if (!wx.cloud) {
      wx.showToast({
        title: "当前基础库不支持云开发",
        icon: "none",
      });
      return;
    }
    const student = this.data.students[this.data.studentIndex];
    const suffix = filePath.match(/\.[^.]+$/);
    const ext = suffix ? suffix[0] : ".png";
    const cloudPath = "mistake-images/" + (student ? student._id : "student") + "-" + Date.now() + ext;
    wx.showLoading({ title: "上传中" });
    wx.cloud
      .uploadFile({
        cloudPath,
        filePath,
      })
      .then((res) => {
        this.setData({
          questionImageFileId: res.fileID,
        });
        wx.showToast({ title: "图片已上传" });
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({
          title: "上传失败",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  submitMistake() {
    const student = this.data.students[this.data.studentIndex];
    const lesson = this.data.lessons[this.data.lessonIndex];
    const form = this.data.form;
    if (!student || !lesson || !form.studentAnswer || !form.correctAnswer || !form.reason || !form.explanation) {
      wx.showToast({
        title: "请填写错题信息",
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

    const tags = form.tagsText
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter((item) => item);
    const db = wx.cloud.database();
    wx.showLoading({ title: "保存中" });
    db.collection("mistakes")
      .add({
        data: {
          studentId: student._id,
          lessonId: lesson._id,
          paperId: "",
          questionImageFileId: this.data.questionImageFileId,
          studentAnswer: form.studentAnswer,
          correctAnswer: form.correctAnswer,
          explanation: form.explanation,
          reason: form.reason,
          tags,
          status: "待复习",
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
