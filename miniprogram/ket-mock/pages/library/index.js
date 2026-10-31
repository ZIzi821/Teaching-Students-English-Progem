const sanitizeSegment = (value, fallback, limit = 50) => {
  const text = String(value || "").trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-");
  return text.slice(0, limit) || fallback;
};

const getExtension = (name) => {
  const matched = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return matched ? matched[1] : "";
};

Page({
  data: {
    loading: true,
    message: "",
    sets: [],
    summary: { setCount: 0, readyCount: 0, totalCount: 0, completeSetCount: 0 },
    expandedSetId: "",
    uploadingKey: "",
    deletingKey: "",
    playingKey: "",
  },

  onLoad() {
    this.loadLibrary();
  },

  onUnload() {
    if (this.audioContext) this.audioContext.destroy();
  },

  loadLibrary() {
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getKetMockLibrary" },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取模拟题录音库");
      const sets = (result.sets || []).map((set) => Object.assign({}, set, {
        progressPercent: set.audioTotalCount ? Math.round(set.audioReadyCount / set.audioTotalCount * 100) : 0,
        cues: (set.cues || []).map((cue) => Object.assign({}, cue, {
          partLabel: `Part ${cue.part}`,
          responseLabel: cue.responseExpected ? `回答最长 ${cue.maxResponseSeconds} 秒` : "考官提示音",
        })),
      }));
      this.setData({
        loading: false,
        sets,
        summary: result.summary || this.data.summary,
        expandedSetId: this.data.expandedSetId || (sets[0] && sets[0].id) || "",
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ loading: false, message: err.message || "录音库暂时无法加载" });
    });
  },

  toggleSet(e) {
    const setId = String(e.currentTarget.dataset.id || "");
    this.setData({ expandedSetId: this.data.expandedSetId === setId ? "" : setId });
  },

  chooseCueAudio(e) {
    const setIndex = Number(e.currentTarget.dataset.setIndex);
    const cueIndex = Number(e.currentTarget.dataset.cueIndex);
    const set = this.data.sets[setIndex];
    const cue = set && set.cues[cueIndex];
    if (!set || !cue || this.data.uploadingKey) return;
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
        this.uploadCueAudio(set, cue, file, extension);
      },
    });
  },

  uploadCueAudio(set, cue, file, extension) {
    const key = `${set.id}:${cue.id}`;
    const safeName = sanitizeSegment(file.name, `examiner.${extension}`, 80);
    const cloudPath = `ket-mock-assets/${sanitizeSegment(set.id, "set")}/${sanitizeSegment(cue.id, "cue")}-${Date.now()}-${safeName}`;
    let uploadedFileID = "";
    this.setData({ uploadingKey: key });
    wx.showLoading({ title: cue.audioReady ? "替换中" : "上传中", mask: true });
    wx.cloud.uploadFile({ cloudPath, filePath: file.path })
      .then((uploadRes) => {
        uploadedFileID = uploadRes.fileID;
        return wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "saveKetMockCueAudio",
            data: {
              setId: set.id,
              cueId: cue.id,
              fileID: uploadedFileID,
              cloudPath,
              fileName: file.name || `examiner.${extension}`,
              fileSize: file.size || 0,
            },
          },
        });
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) throw new Error(result.message || "音频保存失败");
        wx.showToast({ title: cue.audioReady ? "已替换" : "已上传" });
        this.loadLibrary();
      })
      .catch((err) => {
        console.error(err);
        if (uploadedFileID && wx.cloud.deleteFile) wx.cloud.deleteFile({ fileList: [uploadedFileID] }).catch(() => {});
        wx.showToast({ title: err.message || "上传失败", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ uploadingKey: "" });
      });
  },

  playCueAudio(e) {
    const set = this.data.sets[Number(e.currentTarget.dataset.setIndex)];
    const cue = set && set.cues[Number(e.currentTarget.dataset.cueIndex)];
    if (!cue || !cue.audioUrl) {
      wx.showToast({ title: "音频地址暂不可用，请刷新后重试", icon: "none" });
      return;
    }
    const key = `${set.id}:${cue.id}`;
    if (this.audioContext) this.audioContext.destroy();
    const audio = wx.createInnerAudioContext();
    this.audioContext = audio;
    audio.obeyMuteSwitch = false;
    audio.src = cue.audioUrl;
    audio.onPlay(() => this.setData({ playingKey: key }));
    audio.onEnded(() => this.setData({ playingKey: "" }));
    audio.onStop(() => this.setData({ playingKey: "" }));
    audio.onError((err) => {
      console.error(err);
      this.setData({ playingKey: "" });
      wx.showToast({ title: "音频播放失败", icon: "none" });
    });
    audio.play();
  },

  deleteCueAudio(e) {
    const setIndex = Number(e.currentTarget.dataset.setIndex);
    const cueIndex = Number(e.currentTarget.dataset.cueIndex);
    const set = this.data.sets[setIndex];
    const cue = set && set.cues[cueIndex];
    if (!set || !cue || !cue.audioReady || this.data.deletingKey) return;
    wx.showModal({
      title: "删除这段考官录音？",
      content: `删除后，“${set.title}”会进入待补充状态；重新上传即可开放考试。`,
      confirmText: "删除",
      confirmColor: "#B0432F",
      success: (modal) => {
        if (!modal.confirm) return;
        const key = `${set.id}:${cue.id}`;
        this.setData({ deletingKey: key });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: { type: "deleteKetMockCueAudio", data: { setId: set.id, cueId: cue.id } },
        }).then((res) => {
          const result = res.result || {};
          if (!result.success) throw new Error(result.message || "删除失败");
          wx.showToast({ title: "已删除" });
          this.loadLibrary();
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "删除失败", icon: "none" });
        }).finally(() => this.setData({ deletingKey: "" }));
      },
    });
  },

  copySource(e) {
    const set = this.data.sets[Number(e.currentTarget.dataset.index)];
    if (set && set.sourceUrl) wx.setClipboardData({ data: set.sourceUrl });
  },
});
