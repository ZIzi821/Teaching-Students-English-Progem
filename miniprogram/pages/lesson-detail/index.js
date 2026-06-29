Page({
  data: {
    lessonId: "",
    role: "",
    isTeacher: false,
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
  },

  onLoad(options) {
    this.setData({
      lessonId: options.id || "",
    });
    this.loadLesson();
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
        this.setData({
          role: result.role,
          isTeacher: result.role === "teacher",
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
        fileCount: item.fileIds ? item.fileIds.length : 1,
        fileID: item.fileID || (item.fileIds && item.fileIds.length ? item.fileIds[0] : ""),
      });
    });
  },

  prepareMistakes(mistakes) {
    return mistakes.map((item) => {
      return Object.assign({}, item, {
        displayTitle: item.questionTitle || "英语错题记录",
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
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const tempFile = res.tempFiles[0];
        const fileName = this.createMaterialFileName(type, tempFile.tempFilePath);
        this.uploadSelectedFile(type, tempFile.tempFilePath, fileName, tempFile.size || 0);
      },
    });
  },

  chooseFileMaterial(type) {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      success: (res) => {
        const tempFile = res.tempFiles[0];
        this.uploadSelectedFile(type, tempFile.path, tempFile.name || this.createMaterialFileName(type, tempFile.path), tempFile.size || 0);
      },
    });
  },

  createMaterialFileName(type, filePath) {
    const suffixMatch = String(filePath || "").match(/\.[^.]+$/);
    const suffix = suffixMatch ? suffixMatch[0] : type === "audio" ? ".mp3" : ".png";
    return type + "-" + Date.now() + suffix;
  },

  uploadSelectedFile(type, filePath, fileName, fileSize) {
    if (!this.data.lesson) return;
    const safeFileName = String(fileName || "material").replace(/[\\/:*?"<>|\s]+/g, "-");
    const cloudPath = "lesson-materials/" + this.data.lesson.studentId + "/" + this.data.lessonId + "/" + Date.now() + "-" + safeFileName;
    wx.showLoading({ title: "上传中" });
    wx.cloud
      .uploadFile({
        cloudPath,
        filePath,
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
          wx.showToast({
            title: result.message || "保存失败",
            icon: "none",
          });
          return;
        }
        wx.showToast({ title: "已上传" });
        this.loadLesson();
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
    wx.navigateTo({
      url: "/pages/mistake-detail/index?id=" + e.currentTarget.dataset.id,
    });
  },

  goAddMistake() {
    wx.navigateTo({
      url: "/pages/add-mistake/index?lessonId=" + this.data.lessonId + "&studentId=" + this.data.lesson.studentId,
    });
  },
});
