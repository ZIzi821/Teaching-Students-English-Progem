Page({
  data: {
    students: [],
    lessons: [],
    studentIndex: 0,
    lessonIndex: 0,
    selectedStudentName: "请选择学生",
    selectedLessonTitle: "请先选择学生",
    questionImageFileId: "",
    message: "",
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
            message: result.message || "只有朱老师可以添加错题",
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
    if (students[studentIndex]) {
      this.loadLessons(students[studentIndex]._id);
    }
  },

  loadLessons(studentId) {
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "listLessons",
          data: {
            studentId,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            lessons: [],
            selectedLessonTitle: result.message || "无法读取课程",
          });
          return;
        }
        this.applyLessons(result.data || []);
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          lessons: [],
          selectedLessonTitle: "请先上传并部署云函数",
        });
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
      selectedLessonTitle: lessons[lessonIndex] ? lessons[lessonIndex].title : "请先添加英语课",
    });
  },

  onStudentChange(e) {
    const studentIndex = Number(e.detail.value);
    const student = this.data.students[studentIndex];
    this.preferredStudentId = student ? student._id : "";
    this.preferredLessonId = "";
    this.setData({
      studentIndex,
      selectedStudentName: student ? student.name : "请选择学生",
    });
    if (student) {
      this.loadLessons(student._id);
    }
  },

  onLessonChange(e) {
    const lessonIndex = Number(e.detail.value);
    this.setData({
      lessonIndex,
      selectedLessonTitle: this.data.lessons[lessonIndex] ? this.data.lessons[lessonIndex].title : "请先添加英语课",
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
    const student = this.data.students[this.data.studentIndex];
    const suffix = filePath.match(/\.[^.]+$/);
    const ext = suffix ? suffix[0] : ".png";
    const cloudPath = "english-mistake-images/" + (student ? student._id : "student") + "-" + Date.now() + ext;
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

    const tags = form.tagsText
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter((item) => item);
    wx.showLoading({ title: "保存中" });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "addMistake",
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
