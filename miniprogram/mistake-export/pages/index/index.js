const SELECTION_MODES = [
  { value: "all", label: "全部课程" },
  { value: "range", label: "选择课程范围" },
];

const EXPORT_FORMATS = [
  { value: "docx", label: "Word（题目与答案分区）", shortLabel: "Word", hint: "保留完整题目、选项和答案，适合打印或直接保存。" },
  { value: "markdown", label: "Markdown（适合交给 AI）", shortLabel: "Markdown", hint: "按题目、选项、答案和解析分区；可一键复制内容或转发 .md 文件。" },
];

const EXCLUDE_OPTIONS = [
  { value: "exported_mistakes", label: "排除以前已导出的错题（推荐）", hint: "同一节课后来新增的错题仍可继续导出。" },
  { value: "exported_lessons", label: "排除以前已导出的整节课程", hint: "适合按月份或阶段一次性整理，不再重复旧课程。" },
  { value: "none", label: "不排除历史记录", hint: "所选范围内的全部错题都会再次导出。" },
];

Page({
  data: {
    studentId: "",
    loading: true,
    creating: false,
    openingId: "",
    message: "",
    student: null,
    lessonOptions: [],
    history: [],
    historyCount: 0,
    totalMistakeCount: 0,
    exportedMistakeCount: 0,
    exportFormats: EXPORT_FORMATS,
    exportFormatIndex: 0,
    exportFormat: "docx",
    exportFormatLabel: "Word",
    exportFormatHint: EXPORT_FORMATS[0].hint,
    selectionModes: SELECTION_MODES,
    selectionModeIndex: 0,
    selectionMode: "all",
    startLessonIndex: 0,
    endLessonIndex: -1,
    startLessonLabel: "",
    endLessonLabel: "",
    excludeOptions: EXCLUDE_OPTIONS,
    excludePolicyIndex: 0,
    excludePolicy: "exported_mistakes",
    excludePolicyHint: EXCLUDE_OPTIONS[0].hint,
    estimateMistakeCount: 0,
    estimateLessonCount: 0,
  },

  onLoad(options) {
    this.setData({ studentId: String(options.studentId || "") });
    this.loadWorkspace();
  },

  loadWorkspace() {
    if (!this.data.studentId) {
      this.setData({ loading: false, message: "学生信息不完整，请返回后重试" });
      return;
    }
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getMistakeExportWorkspace",
        data: { studentId: this.data.studentId, exportFormat: this.data.exportFormat },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取错题导出记录");
      const lessonOptions = result.lessonOptions || [];
      const lastIndex = Math.max(0, lessonOptions.length - 1);
      const currentStart = Math.min(this.data.startLessonIndex, lastIndex);
      const desiredEnd = this.data.endLessonIndex < 0 ? lastIndex : this.data.endLessonIndex;
      const currentEnd = Math.max(currentStart, Math.min(desiredEnd, lastIndex));
      this.setData({
        loading: false,
        student: result.student || null,
        lessonOptions,
        history: result.history || [],
        historyCount: Number(result.historyCount) || 0,
        totalMistakeCount: Number(result.totalMistakeCount) || 0,
        exportedMistakeCount: Number(result.exportedMistakeCount) || 0,
        startLessonIndex: currentStart,
        endLessonIndex: currentEnd,
        message: "",
      }, () => this.refreshEstimate());
    }).catch((err) => {
      console.error(err);
      this.setData({ loading: false, message: err.message || "服务暂时不可用，请稍后再试" });
    });
  },

  onExportFormatChange(e) {
    const index = Number(e.detail.value) || 0;
    const option = EXPORT_FORMATS[index] || EXPORT_FORMATS[0];
    this.setData({
      exportFormatIndex: index,
      exportFormat: option.value,
      exportFormatLabel: option.shortLabel,
      exportFormatHint: option.hint,
    }, () => this.loadWorkspace());
  },

  onSelectionModeChange(e) {
    const index = Number(e.detail.value) || 0;
    const option = SELECTION_MODES[index] || SELECTION_MODES[0];
    this.setData({ selectionModeIndex: index, selectionMode: option.value }, () => this.refreshEstimate());
  },

  onStartLessonChange(e) {
    const startLessonIndex = Number(e.detail.value) || 0;
    const endLessonIndex = Math.max(startLessonIndex, this.data.endLessonIndex);
    this.setData({ startLessonIndex, endLessonIndex }, () => this.refreshEstimate());
  },

  onEndLessonChange(e) {
    const endLessonIndex = Number(e.detail.value) || 0;
    const startLessonIndex = Math.min(this.data.startLessonIndex, endLessonIndex);
    this.setData({ startLessonIndex, endLessonIndex }, () => this.refreshEstimate());
  },

  onExcludePolicyChange(e) {
    const index = Number(e.detail.value) || 0;
    const option = EXCLUDE_OPTIONS[index] || EXCLUDE_OPTIONS[0];
    this.setData({
      excludePolicyIndex: index,
      excludePolicy: option.value,
      excludePolicyHint: option.hint,
    }, () => this.refreshEstimate());
  },

  getSelectedLessons() {
    if (this.data.selectionMode === "all") return this.data.lessonOptions.slice();
    return this.data.lessonOptions.slice(this.data.startLessonIndex, this.data.endLessonIndex + 1);
  },

  refreshEstimate() {
    const selected = this.getSelectedLessons();
    let lessons = selected;
    if (this.data.excludePolicy === "exported_lessons") {
      lessons = selected.filter((item) => !item.wasLessonExported);
    }
    let estimateMistakeCount = lessons.reduce((total, item) => total + Number(item.mistakeCount || 0), 0);
    if (this.data.excludePolicy === "exported_mistakes") {
      estimateMistakeCount = selected.reduce((total, item) => (
        total + Math.max(0, Number(item.mistakeCount || 0) - Number(item.exportedMistakeCount || 0))
      ), 0);
    }
    const start = this.data.lessonOptions[this.data.startLessonIndex];
    const end = this.data.lessonOptions[this.data.endLessonIndex];
    this.setData({
      estimateLessonCount: lessons.length,
      estimateMistakeCount,
      startLessonLabel: start ? start.label : "",
      endLessonLabel: end ? end.label : "",
    });
  },

  createExport() {
    if (this.data.creating || !this.data.lessonOptions.length) return;
    if (!this.data.estimateMistakeCount) {
      wx.showToast({ title: "当前条件下没有可导出的错题", icon: "none" });
      return;
    }
    const start = this.data.lessonOptions[this.data.startLessonIndex];
    const end = this.data.lessonOptions[this.data.endLessonIndex];
    const requestId = `mistake_export_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    this.setData({ creating: true });
    wx.showLoading({ title: `正在生成${this.data.exportFormatLabel}`, mask: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "createMistakeExport",
        data: {
          studentId: this.data.studentId,
          requestId,
          exportFormat: this.data.exportFormat,
          selectionMode: this.data.selectionMode,
          startLessonId: start ? start._id : "",
          endLessonId: end ? end._id : "",
          excludePolicy: this.data.excludePolicy,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "错题汇总生成失败");
      wx.showToast({ title: `${this.data.exportFormatLabel} 已生成`, icon: "success" });
      this.loadWorkspace();
      if (result.export && result.export.fileID) this.openExportFile(result.export);
    }).catch((err) => {
      console.error(err);
      wx.showModal({
        title: "暂时无法导出",
        content: err.message || "请稍后重试",
        showCancel: false,
      });
      this.loadWorkspace();
    }).finally(() => {
      wx.hideLoading();
      this.setData({ creating: false });
    });
  },

  openHistory(e) {
    const item = this.data.history[Number(e.currentTarget.dataset.index)];
    if (!item || item.status !== "ready" || !item.fileID) return;
    this.openExportFile(item);
  },

  openExportFile(item) {
    if (!item || !item.fileID || this.data.openingId) return;
    this.setData({ openingId: item._id || item.fileID });
    wx.showLoading({ title: "正在打开", mask: true });
    wx.cloud.downloadFile({ fileID: item.fileID })
      .then((download) => {
        if (item.exportFormat === "markdown") return this.copyMarkdownFromPath(download.tempFilePath);
        return wx.openDocument({
          filePath: download.tempFilePath,
          fileType: "docx",
          showMenu: true,
        });
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: "文件打开失败，请稍后重试", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ openingId: "" });
      });
  },

  copyMarkdownFromPath(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: "utf8",
        success: (result) => {
          wx.setClipboardData({
            data: String(result.data || ""),
            success: () => {
              wx.showToast({ title: "Markdown 已复制", icon: "success" });
              resolve();
            },
            fail: reject,
          });
        },
        fail: reject,
      });
    });
  },

  shareMarkdown(e) {
    const item = this.data.history[Number(e.currentTarget.dataset.index)];
    if (!item || item.status !== "ready" || item.exportFormat !== "markdown" || !item.fileID || this.data.openingId) return;
    this.setData({ openingId: item._id || item.fileID });
    wx.showLoading({ title: "正在准备文件", mask: true });
    wx.cloud.downloadFile({ fileID: item.fileID })
      .then((download) => {
        if (typeof wx.shareFileMessage !== "function") return this.copyMarkdownFromPath(download.tempFilePath);
        return wx.shareFileMessage({
          filePath: download.tempFilePath,
          fileName: item.fileName || "英语错题汇总.md",
        });
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: "文件转发失败，请改用复制内容", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ openingId: "" });
      });
  },
});
