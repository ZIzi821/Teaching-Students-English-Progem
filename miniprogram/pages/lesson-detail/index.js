const CONTENT_RISK_MESSAGE = "内容含违规信息，请修改后再提交";
const MATERIAL_PREFERENCES_KEY = "lessonMaterialPreferences";

const getSafeOptionIndex = (value, options) => {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < options.length ? index : 0;
};

Page({
  data: {
    lessonId: "",
    previewStudentId: "",
    mode: "",
    role: "",
    isTeacher: false,
    isTeacherPreview: false,
    lesson: null,
    papers: [],
    mistakes: [],
    hasPaperArea: false,
    message: "",
    materialTypes: [
      { label: "PDF 试卷", value: "pdf" },
      { label: "图片", value: "image" },
      { label: "听力音频", value: "audio" },
      { label: "Canva 白板截图", value: "canva" },
    ],
    materialTypeIndex: 0,
    selectedMaterialTypeLabel: "PDF 试卷",
    paperTypes: [
      { label: "综合资料", value: "mixed" },
      { label: "听力", value: "listening" },
      { label: "笔试", value: "written" },
    ],
    paperTypeIndex: 0,
    selectedPaperTypeLabel: "综合资料",
    paperSources: [
      { label: "练习", value: "practice" },
      { label: "学校试卷", value: "school_exam" },
      { label: "作业", value: "homework" },
    ],
    paperSourceIndex: 0,
    selectedPaperSourceLabel: "练习",
    paperForm: {
      paperTitle: "",
      term: "",
    },
  },

  onLoad(options) {
    this.setData({
      lessonId: options.id || "",
      previewStudentId: options.previewStudentId || "",
      mode: options.mode || "",
    });
    this.restoreMaterialPreferences();
    this.loadLesson();
  },

  onShow() {
    if (this.hasShown && this.data.lessonId) this.loadLesson();
    this.hasShown = true;
  },

  restoreMaterialPreferences() {
    const preferences = wx.getStorageSync(MATERIAL_PREFERENCES_KEY) || {};
    const materialTypeIndex = getSafeOptionIndex(preferences.materialTypeIndex, this.data.materialTypes);
    const paperTypeIndex = getSafeOptionIndex(preferences.paperTypeIndex, this.data.paperTypes);
    const paperSourceIndex = getSafeOptionIndex(preferences.paperSourceIndex, this.data.paperSources);
    this.setData({
      materialTypeIndex,
      selectedMaterialTypeLabel: this.data.materialTypes[materialTypeIndex].label,
      paperTypeIndex,
      selectedPaperTypeLabel: this.data.paperTypes[paperTypeIndex].label,
      paperSourceIndex,
      selectedPaperSourceLabel: this.data.paperSources[paperSourceIndex].label,
      "paperForm.term": preferences.term || "",
    });
  },

  rememberMaterialPreferences() {
    wx.setStorageSync(MATERIAL_PREFERENCES_KEY, {
      materialTypeIndex: this.data.materialTypeIndex,
      paperTypeIndex: this.data.paperTypeIndex,
      paperSourceIndex: this.data.paperSourceIndex,
      term: this.data.paperForm.term,
    });
  },

  onUnload() {
    if (this.audioContext) {
      this.audioContext.destroy();
    }
  },

  loadLesson() {
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getLessonDetail",
          data: {
            lessonId: this.data.lessonId,
            previewStudentId: this.data.previewStudentId,
            mode: this.data.mode,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            message: result.message || "无权查看该课程",
          });
          return;
        }
        const papers = this.preparePapers(result.papers || []);
        const isTeacherPreview = result.role === "teacher" && this.data.mode === "teacherPreview";
        this.setData({
          role: result.role,
          isTeacher: result.role === "teacher" && !isTeacherPreview,
          isTeacherPreview,
          lesson: result.lesson,
          papers,
          mistakes: this.prepareMistakes(result.mistakes || []),
          hasPaperArea: Boolean(papers.length || (result.lesson.paperFileIds && result.lesson.paperFileIds.length)),
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

  preparePapers(papers) {
    return papers.map((item) => {
      const type = item.type || "pdf";
      return Object.assign({}, item, {
        displayTitle: item.title || item.fileName || "课程资料",
        displayType: this.getMaterialTypeLabel(type),
        displayPaperType: this.getPaperTypeLabel(item.paperType || "mixed"),
        fileCount: item.fileIds ? item.fileIds.length : 1,
        fileID: item.fileID || (item.fileIds && item.fileIds.length ? item.fileIds[0] : ""),
      });
    });
  },

  prepareMistakes(mistakes) {
    return mistakes.map((item) => {
      return Object.assign({}, item, {
        displayTitle: item.questionNo || item.questionTitle || "英语错题记录",
        displayMeta: [item.paperSection, item.questionType].filter((value) => value).join(" · "),
        displayTags: item.skillTags && item.skillTags.length ? item.skillTags : item.tags || [],
        status: item.reviewStatus || item.status || "待复习",
        entryStatus: item.entryStatus || (item.studentAnswer && item.correctAnswer ? "已整理" : "待整理"),
      });
    });
  },

  getMaterialTypeLabel(type) {
    const found = this.data.materialTypes.find((item) => item.value === type);
    return found ? found.label : type;
  },

  onMaterialTypeChange(e) {
    const materialTypeIndex = Number(e.detail.value);
    this.setData({
      materialTypeIndex,
      selectedMaterialTypeLabel: this.data.materialTypes[materialTypeIndex].label,
    });
    this.rememberMaterialPreferences();
  },

  onPaperTypeChange(e) {
    const paperTypeIndex = Number(e.detail.value);
    this.setData({
      paperTypeIndex,
      selectedPaperTypeLabel: this.data.paperTypes[paperTypeIndex].label,
    });
    this.rememberMaterialPreferences();
  },

  onPaperSourceChange(e) {
    const paperSourceIndex = Number(e.detail.value);
    this.setData({
      paperSourceIndex,
      selectedPaperSourceLabel: this.data.paperSources[paperSourceIndex].label,
    });
    this.rememberMaterialPreferences();
  },

  onPaperMetaInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      ["paperForm." + field]: e.detail.value,
    });
    if (field === "term") this.rememberMaterialPreferences();
  },

  getPaperTypeLabel(type) {
    const found = this.data.paperTypes.find((item) => item.value === type);
    return found ? found.label : "综合资料";
  },

  uploadMaterial() {
    const type = this.data.materialTypes[this.data.materialTypeIndex].value;
    if (type === "image" || type === "canva") {
      this.chooseImageMaterial(type);
      return;
    }
    this.chooseFileMaterial(type);
  },

  chooseImageMaterial(type) {
    wx.chooseMedia({
      count: 9,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const files = (res.tempFiles || []).map((tempFile) => ({
          type,
          filePath: tempFile.tempFilePath,
          fileName: this.createMaterialFileName(type, tempFile.tempFilePath),
          fileSize: tempFile.size || 0,
        }));
        this.uploadSelectedFiles(files);
      },
    });
  },

  chooseFileMaterial(type) {
    wx.chooseMessageFile({
      count: 9,
      type: "file",
      success: (res) => {
        const files = (res.tempFiles || []).map((tempFile) => ({
          type,
          filePath: tempFile.path,
          fileName: tempFile.name || this.createMaterialFileName(type, tempFile.path),
          fileSize: tempFile.size || 0,
        }));
        this.uploadSelectedFiles(files);
      },
    });
  },

  uploadSelectedFiles(files) {
    if (!files.length) return;
    let successCount = 0;
    const failedFiles = [];
    let task = Promise.resolve();
    files.forEach((file, index) => {
      task = task.then(() => {
        wx.showLoading({ title: "上传 " + (index + 1) + "/" + files.length, mask: true });
        return this.uploadSelectedFile(file.type, file.filePath, file.fileName, file.fileSize)
          .then(() => {
            successCount += 1;
          })
          .catch((err) => {
            console.error(err);
            failedFiles.push(file.fileName);
          });
      });
    });
    task.finally(() => {
      wx.hideLoading();
      if (successCount) {
        this.setData({ "paperForm.paperTitle": "" });
        this.loadLesson();
      }
      wx.showToast({
        title: failedFiles.length ? successCount + " 个成功，" + failedFiles.length + " 个失败" : successCount + " 个资料已上传",
        icon: "none",
      });
    });
  },

  createMaterialFileName(type, filePath) {
    const suffixMatch = String(filePath || "").match(/\.[^.]+$/);
    const suffix = suffixMatch ? suffixMatch[0] : type === "audio" ? ".mp3" : ".png";
    return type + "-" + Date.now() + suffix;
  },

  uploadSelectedFile(type, filePath, fileName, fileSize) {
    if (!this.data.lesson) return Promise.reject(new Error("课程尚未加载"));
    const lowerFileName = String(fileName || "").toLowerCase();
    if (type === "pdf" && !lowerFileName.endsWith(".pdf")) {
      return Promise.reject(new Error("PDF 资料请选择 .pdf 文件"));
    }
    if (type === "audio" && !/\.(mp3|m4a|wav|aac)$/i.test(lowerFileName)) {
      return Promise.reject(new Error("听力音频请选择 mp3、m4a、wav 或 aac 文件"));
    }
    const safeFileName = String(fileName || "material").replace(/[\\/:*?"<>|\s]+/g, "-");
    const cloudPath = "lesson-materials/" + this.data.lesson.studentId + "/" + this.data.lessonId + "/" + Date.now() + "-" + safeFileName;
    return wx.cloud
      .uploadFile({
        cloudPath,
        filePath,
      })
      .then((res) => {
        if (type !== "image" && type !== "canva") return res;
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
        return wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "addPaper",
            data: {
              studentId: this.data.lesson.studentId,
              lessonId: this.data.lessonId,
              title: fileName,
              type,
              paperType: this.data.paperTypes[this.data.paperTypeIndex].value,
              paperTitle: this.data.paperForm.paperTitle || fileName,
              term: this.data.paperForm.term,
              source: this.data.paperSources[this.data.paperSourceIndex].value,
              fileID: res.fileID,
              fileName,
              fileSize,
            },
          },
        });
      })
      .then((res) => {
        const result = res.result || {};
        if (result.success === false) {
          throw new Error(result.message || "保存失败");
        }
        return result;
      });
  },

  openMaterial(e) {
    const material = this.data.papers[e.currentTarget.dataset.index];
    if (!material || !material.fileID) return;
    if (material.type === "pdf") {
      this.openPdf(material.fileID);
      return;
    }
    if (material.type === "image" || material.type === "canva") {
      wx.previewImage({
        urls: [material.fileID],
        current: material.fileID,
      });
      return;
    }
    if (material.type === "audio") {
      this.playAudio(material.fileID);
    }
  },

  openPdf(fileID) {
    wx.showLoading({ title: "打开中" });
    wx.cloud
      .downloadFile({ fileID })
      .then((res) => {
        return wx.openDocument({
          filePath: res.tempFilePath,
          fileType: "pdf",
          showMenu: true,
        });
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({
          title: "PDF 打开失败",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  playAudio(fileID) {
    wx.showLoading({ title: "加载音频" });
    wx.cloud
      .getTempFileURL({
        fileList: [fileID],
      })
      .then((res) => {
        const item = res.fileList && res.fileList[0];
        if (!item || !item.tempFileURL) {
          throw new Error("no temp file url");
        }
        if (this.audioContext) {
          this.audioContext.destroy();
        }
        this.audioContext = wx.createInnerAudioContext();
        this.audioContext.src = item.tempFileURL;
        this.audioContext.play();
        wx.showToast({
          title: "正在播放",
          icon: "none",
        });
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({
          title: "音频暂不能播放",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  goMistake(e) {
    let url = "/pages/mistake-detail/index?id=" + e.currentTarget.dataset.id;
    if (this.data.isTeacherPreview) url += "&readOnly=1";
    wx.navigateTo({
      url,
    });
  },

  goAddMistake() {
    wx.navigateTo({
      url: "/pages/add-mistake/index?lessonId=" + this.data.lessonId + "&studentId=" + this.data.lesson.studentId,
    });
  },

  goBatchImportMistakes() {
    wx.navigateTo({
      url: "/pages/batch-import-mistakes/index?lessonId=" + this.data.lessonId + "&studentId=" + this.data.lesson.studentId,
    });
  },
});
