Page({
  data: {
    lessonId: "",
    studentId: "",
    lesson: null,
    importText: "",
    previewCount: 0,
    message: "",
    importing: false,
  },

  onLoad(options) {
    this.setData({
      lessonId: options.lessonId || "",
      studentId: options.studentId || "",
    });
    this.loadLesson();
  },

  loadLesson() {
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getLessonDetail",
          data: { lessonId: this.data.lessonId },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({ message: result.message || "课程读取失败" });
          return;
        }
        this.setData({ lesson: result.lesson, message: "" });
      })
      .catch((err) => {
        console.error(err);
        this.setData({ message: "课程读取失败" });
      });
  },

  onImportTextInput(e) {
    const importText = e.detail.value;
    let previewCount = 0;
    try {
      const parsed = JSON.parse(importText);
      const items = Array.isArray(parsed) ? parsed : parsed.mistakes;
      previewCount = Array.isArray(items) ? items.length : 0;
    } catch (err) {
      previewCount = 0;
    }
    this.setData({ importText, previewCount, message: "" });
  },

  createImportBatchId(importText) {
    const source = this.data.lessonId + "|" + importText;
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return "import-" + (hash >>> 0).toString(16) + "-" + source.length;
  },

  importMistakes() {
    if (this.data.importing) return;
    let items;
    try {
      const parsed = JSON.parse(this.data.importText);
      items = Array.isArray(parsed) ? parsed : parsed.mistakes;
    } catch (err) {
      wx.showToast({ title: "导入内容格式不正确", icon: "none" });
      return;
    }
    if (!Array.isArray(items) || !items.length) {
      wx.showToast({ title: "没有可导入的错题", icon: "none" });
      return;
    }
    this.setData({ importing: true });
    wx.showLoading({ title: "导入中", mask: true });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "batchImportMistakes",
          data: {
            studentId: this.data.studentId,
            lessonId: this.data.lessonId,
            importBatchId: this.createImportBatchId(this.data.importText),
            items,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({ message: result.message || "导入失败" });
          return;
        }
        wx.showToast({ title: "已导入 " + result.importedCount + " 道", icon: "none" });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch((err) => {
        console.error(err);
        this.setData({ message: "导入失败，请稍后重试" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ importing: false });
      });
  },
});
