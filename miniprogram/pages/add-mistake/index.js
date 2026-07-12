const CONTENT_RISK_MESSAGE = "内容含违规信息，请修改后再提交";

Page({
  data: {
    students: [],
    lessons: [],
    papers: [{ _id: "", displayTitle: "不关联试卷" }],
    studentIndex: 0,
    lessonIndex: 0,
    paperIndex: 0,
    selectedStudentName: "请选择学生",
    selectedLessonTitle: "请先选择学生",
    selectedPaperTitle: "不关联试卷",
    questionImageFileId: "",
    message: "",
    showAdvanced: false,
    saving: false,
    isEditing: false,
    paperSections: ["听力", "笔试", "口语", "语法", "阅读", "写作"],
    paperSectionIndex: 1,
    questionTypes: ["听力细节", "听力主旨", "单词拼写", "词义理解", "语法选择", "动词时态", "介词/连词", "阅读细节", "阅读推理", "写作句子", "粗心错误"],
    questionTypeIndex: 0,
    reasonTypes: ["粗心", "没听清", "单词不认识", "语法规则不会", "题意理解错", "固定搭配不熟"],
    reasonTypeIndex: 0,
    reviewPriorities: ["高", "中", "低"],
    reviewPriorityIndex: 1,
    reviewStatuses: ["待复习", "已复习", "已掌握"],
    reviewStatusIndex: 0,
    form: {
      questionNo: "",
      studentAnswer: "",
      correctAnswer: "",
      reason: "",
      explanation: "",
      questionText: "",
      tagsText: "",
    },
  },

  onLoad(options) {
    this.mistakeId = options.id || "";
    if (this.mistakeId) {
      wx.setNavigationBarTitle({ title: "整理英语错题" });
      this.loadMistakeForEdit();
      return;
    }
    this.preferredStudentId = options.studentId || "";
    this.preferredLessonId = options.lessonId || "";
    this.loadStudents();
  },

  loadMistakeForEdit() {
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getMistakeDetail",
          data: { mistakeId: this.mistakeId },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success || !result.mistake) {
          this.setData({ message: result.message || "错题读取失败" });
          return;
        }
        const mistake = result.mistake;
        this.preferredStudentId = mistake.studentId || "";
        this.preferredLessonId = mistake.lessonId || "";
        this.preferredPaperId = mistake.paperId || "";
        this.setData({
          isEditing: true,
          showAdvanced: true,
          questionImageFileId: mistake.questionImageFileId || "",
          paperSectionIndex: Math.max(0, this.data.paperSections.indexOf(mistake.paperSection)),
          questionTypeIndex: Math.max(0, this.data.questionTypes.indexOf(mistake.questionType)),
          reasonTypeIndex: Math.max(0, this.data.reasonTypes.indexOf(mistake.mistakeReasonType)),
          reviewPriorityIndex: Math.max(0, this.data.reviewPriorities.indexOf(mistake.reviewPriority || "中")),
          reviewStatusIndex: Math.max(0, this.data.reviewStatuses.indexOf(mistake.reviewStatus || mistake.status || "待复习")),
          form: {
            questionNo: mistake.questionNo || "",
            studentAnswer: mistake.studentAnswer || "",
            correctAnswer: mistake.correctAnswer || "",
            reason: mistake.reason || "",
            explanation: mistake.explanation || "",
            questionText: mistake.questionText || "",
            tagsText: (mistake.skillTags || mistake.tags || []).join(", "),
          },
        });
        this.loadStudents();
      })
      .catch((err) => {
        console.error(err);
        this.setData({ message: "错题读取失败" });
      });
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
    if (lessons[lessonIndex]) {
      this.loadPapers(lessons[lessonIndex]._id);
    } else {
      this.applyPapers([]);
    }
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
    const lesson = this.data.lessons[lessonIndex];
    this.setData({
      lessonIndex,
      selectedLessonTitle: lesson ? lesson.title : "请先添加英语课",
    });
    if (lesson) {
      this.loadPapers(lesson._id);
    } else {
      this.applyPapers([]);
    }
  },

  loadPapers(lessonId) {
    if (!lessonId) {
      this.applyPapers([]);
      return;
    }
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getLessonDetail",
          data: {
            lessonId,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        this.applyPapers(result.success ? result.papers || [] : []);
      })
      .catch((err) => {
        console.error(err);
        this.applyPapers([]);
      });
  },

  applyPapers(papers) {
    const paperOptions = [{ _id: "", displayTitle: "不关联试卷" }].concat(
      (papers || []).map((paper) =>
        Object.assign({}, paper, {
          displayTitle: paper.paperTitle || paper.title || paper.fileName || "课程资料",
        })
      )
    );
    const preferredPaperIndex = this.preferredPaperId
      ? paperOptions.findIndex((paper) => paper._id === this.preferredPaperId)
      : -1;
    const paperIndex = preferredPaperIndex >= 0 ? preferredPaperIndex : this.preferredLessonId && paperOptions.length > 1 ? 1 : 0;
    this.setData({
      papers: paperOptions,
      paperIndex,
      selectedPaperTitle: paperOptions[paperIndex].displayTitle,
    });
  },

  toggleAdvanced() {
    this.setData({ showAdvanced: !this.data.showAdvanced });
  },

  onPaperChange(e) {
    const paperIndex = Number(e.detail.value);
    this.setData({
      paperIndex,
      selectedPaperTitle: this.data.papers[paperIndex] ? this.data.papers[paperIndex].displayTitle : "不关联试卷",
    });
  },

  onPaperSectionChange(e) {
    this.setData({ paperSectionIndex: Number(e.detail.value) });
  },

  onQuestionTypeChange(e) {
    this.setData({ questionTypeIndex: Number(e.detail.value) });
  },

  onReasonTypeChange(e) {
    this.setData({ reasonTypeIndex: Number(e.detail.value) });
  },

  onReviewPriorityChange(e) {
    this.setData({ reviewPriorityIndex: Number(e.detail.value) });
  },

  onReviewStatusChange(e) {
    this.setData({ reviewStatusIndex: Number(e.detail.value) });
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

  removeImage() {
    this.setData({
      questionImageFileId: "",
      message: "",
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
        return wx.cloud
          .callFunction({
            name: "quickstartFunctions",
            data: {
              type: "checkUploadedImage",
              data: {
                fileID: res.fileID,
              },
            },
          })
          .then((checkRes) => {
            const result = checkRes.result || {};
            if (result.success === false) {
              throw new Error(result.message || CONTENT_RISK_MESSAGE);
            }
            return res;
          });
      })
      .then((res) => {
        this.setData({
          questionImageFileId: res.fileID,
          message: "",
        });
        wx.showToast({ title: "图片已上传" });
      })
      .catch((err) => {
        console.error(err);
        const message = err.message === CONTENT_RISK_MESSAGE ? CONTENT_RISK_MESSAGE : err.message || "上传失败";
        this.setData({
          questionImageFileId: "",
          message,
        });
        wx.showToast({
          title: message,
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  submitMistake(e) {
    if (this.data.saving) return;
    const student = this.data.students[this.data.studentIndex];
    const lesson = this.data.lessons[this.data.lessonIndex];
    const paper = this.data.papers[this.data.paperIndex];
    const form = this.data.form;
    const action = (e && e.currentTarget && e.currentTarget.dataset.action) || "back";
    const hasAnswerText = Boolean(form.studentAnswer || form.correctAnswer);
    if (!student || !lesson || (!this.data.questionImageFileId && !hasAnswerText)) {
      wx.showToast({
        title: "请上传题目图片或填写答案",
        icon: "none",
      });
      return;
    }

    const tags = form.tagsText
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter((item) => item);
    const entryStatus = form.studentAnswer && form.correctAnswer ? "已整理" : "待整理";
    const hasDetailedInfo = this.data.showAdvanced || this.data.isEditing;
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中" });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: this.data.isEditing ? "updateMistake" : "addMistake",
          data: {
            mistakeId: this.mistakeId,
            studentId: student._id,
            lessonId: lesson._id,
            paperId: hasDetailedInfo && paper && paper._id ? paper._id : "",
            questionImageFileId: this.data.questionImageFileId,
            questionNo: form.questionNo,
            paperSection: hasDetailedInfo ? this.data.paperSections[this.data.paperSectionIndex] : "",
            questionType: hasDetailedInfo ? this.data.questionTypes[this.data.questionTypeIndex] : "",
            skillTags: hasDetailedInfo ? tags : [],
            mistakeReasonType: hasDetailedInfo ? this.data.reasonTypes[this.data.reasonTypeIndex] : "",
            studentAnswer: form.studentAnswer,
            correctAnswer: form.correctAnswer,
            explanation: form.explanation,
            questionText: form.questionText,
            reason: form.reason,
            tags: hasDetailedInfo ? tags : [],
            reviewPriority: this.data.reviewPriorities[this.data.reviewPriorityIndex],
            reviewStatus: this.data.reviewStatuses[this.data.reviewStatusIndex],
            status: this.data.reviewStatuses[this.data.reviewStatusIndex],
            entryStatus,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (result.success === false) {
          this.setData({
            message: result.message || "保存失败",
            questionImageFileId: result.code === "CONTENT_RISK" ? "" : this.data.questionImageFileId,
          });
          wx.showToast({
            title: result.message || "保存失败",
            icon: "none",
          });
          return;
        }
        if (action === "continue" && !this.data.isEditing) {
          this.resetMistakeForm();
          wx.showToast({ title: "已保存，可继续录入", icon: "none" });
          return;
        }
        wx.showToast({ title: entryStatus === "待整理" ? "已保存为待整理" : "已保存", icon: "none" });
        setTimeout(() => wx.navigateBack(), 500);
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "请先上传并部署云函数",
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ saving: false });
      });
  },

  resetMistakeForm() {
    this.setData({
      questionImageFileId: "",
      message: "",
      showAdvanced: false,
      paperSectionIndex: 1,
      questionTypeIndex: 0,
      reasonTypeIndex: 0,
      reviewPriorityIndex: 1,
      reviewStatusIndex: 0,
      form: {
        questionNo: "",
        studentAnswer: "",
        correctAnswer: "",
        reason: "",
        explanation: "",
        questionText: "",
        tagsText: "",
      },
    });
  },
});
