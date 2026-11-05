const { playReliableAudio } = require("../../../utils/reliableAudio");
const { callCloud } = require("../../../utils/cloud");

const sanitizeSegment = (value, fallback, limit = 60) => {
  const text = String(value || "").trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-");
  return text.slice(0, limit) || fallback;
};

const getExtension = (name) => {
  const matched = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return matched ? matched[1] : "";
};

Page({
  data: {
    lessonId: "",
    loading: true,
    message: "",
    lesson: null,
    student: null,
    items: [],
    readyCount: 0,
    totalCount: 0,
    audioComplete: false,
    modeLabel: "",
    gapSeconds: 2,
    responseSeconds: 8,
    uploadingItemId: "",
    deletingItemId: "",
    playingItemId: "",
  },

  onLoad(options) {
    this.setData({ lessonId: options.lessonId || "" });
    this.loadManager();
  },

  onUnload() {
    if (this.audioPlayback) this.audioPlayback.destroy();
  },

  loadManager() {
    if (!this.data.lessonId) {
      this.setData({ loading: false, message: "课程信息不完整，请返回后重试。" });
      return;
    }
    this.setData({ loading: true, message: "" });
    callCloud({ type: "getFollowReadingAudioManager", data: { lessonId: this.data.lessonId } }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取跟读示范音频");
      this.setData({
        loading: false,
        lesson: result.lesson,
        student: result.student,
        items: result.items || [],
        readyCount: result.readyCount || 0,
        totalCount: result.totalCount || 0,
        audioComplete: result.audioComplete === true,
        modeLabel: result.mode === "manual" ? "学生手动逐条播放" : "自动连续跟读",
        gapSeconds: result.gapSeconds || 2,
        responseSeconds: result.responseSeconds || 8,
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ loading: false, message: err.message || "示范音频暂时无法打开" });
    });
  },

  chooseAudio(e) {
    const item = this.data.items[Number(e.currentTarget.dataset.index)];
    if (!item || this.data.uploadingItemId) return;
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["mp3", "m4a", "wav", "aac"],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) return;
        const extension = getExtension(file.name);
        if (!["mp3", "m4a", "wav", "aac"].includes(extension)) {
          wx.showToast({ title: "请选择 MP3、M4A、WAV 或 AAC 音频", icon: "none" });
          return;
        }
        this.uploadAudio(item, file, extension);
      },
    });
  },

  uploadAudio(item, file, extension) {
    const safeName = sanitizeSegment(file.name, `teacher-demo.${extension}`, 80);
    const cloudPath = `follow-reading-assets/${sanitizeSegment(this.data.lessonId, "lesson")}/${sanitizeSegment(item.id, "item")}-${Date.now()}-${safeName}`;
    let uploadedFileID = "";
    this.setData({ uploadingItemId: item.id });
    wx.showLoading({ title: item.audioReady ? "替换中" : "上传中", mask: true });
    wx.cloud.uploadFile({ cloudPath, filePath: file.path })
      .then((uploadResult) => {
        uploadedFileID = uploadResult.fileID;
        return callCloud({
          type: "saveFollowReadingDemoAudio",
          data: {
            lessonId: this.data.lessonId,
            itemId: item.id,
            fileID: uploadedFileID,
            cloudPath,
            fileName: file.name || `teacher-demo.${extension}`,
            fileSize: file.size || 0,
          },
        });
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) throw new Error(result.message || "示范音频保存失败");
        wx.showToast({ title: item.audioReady ? "已替换" : "已上传" });
        this.loadManager();
      })
      .catch((err) => {
        console.error(err);
        if (uploadedFileID && wx.cloud.deleteFile) wx.cloud.deleteFile({ fileList: [uploadedFileID] }).catch(() => {});
        wx.showToast({ title: err.message || "上传失败", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ uploadingItemId: "" });
      });
  },

  playAudio(e) {
    const item = this.data.items[Number(e.currentTarget.dataset.index)];
    if (!item || !item.audioUrl) {
      wx.showToast({ title: "音频地址暂不可用，请刷新后重试", icon: "none" });
      return;
    }
    if (this.audioPlayback) this.audioPlayback.destroy();
    this.setData({ playingItemId: item.id });
    const playback = playReliableAudio({ audioUrl: item.audioUrl }, {
      onEnded: () => {
        if (this.audioPlayback === playback) this.audioPlayback = null;
        this.setData({ playingItemId: "" });
      },
      onError: (error) => {
        console.error(error);
        if (this.audioPlayback === playback) this.audioPlayback = null;
        this.setData({ playingItemId: "" });
        wx.showToast({ title: "音频播放失败", icon: "none" });
      },
    });
    this.audioPlayback = playback;
  },

  deleteAudio(e) {
    const item = this.data.items[Number(e.currentTarget.dataset.index)];
    if (!item || !item.audioReady || this.data.deletingItemId) return;
    wx.showModal({
      title: "删除这段示范音？",
      content: `删除第 ${item.order} 条后，整项跟读会进入待补充状态；重新上传即可开放给学生。`,
      confirmText: "删除",
      confirmColor: "#B0432F",
      success: (modal) => {
        if (!modal.confirm) return;
        this.setData({ deletingItemId: item.id });
        callCloud({ type: "deleteFollowReadingDemoAudio", data: { lessonId: this.data.lessonId, itemId: item.id } }).then((res) => {
          const result = res.result || {};
          if (!result.success) throw new Error(result.message || "删除失败");
          wx.showToast({ title: "已删除" });
          this.loadManager();
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "删除失败", icon: "none" });
        }).finally(() => this.setData({ deletingItemId: "" }));
      },
    });
  },
});
