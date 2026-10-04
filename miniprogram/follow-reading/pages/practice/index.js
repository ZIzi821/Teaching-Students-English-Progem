const { playReliableAudio, preloadAudioSources } = require("../../../utils/reliableAudio");

const sanitizeSegment = (value, fallback, limit = 36) => {
  const text = String(value || "").trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-");
  return text.slice(0, limit) || fallback;
};

const formatTimer = (seconds) => {
  const total = Math.max(0, Math.trunc(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

Page({
  data: {
    lessonId: "",
    previewStudentId: "",
    mode: "",
    isTeacherPreview: false,
    lesson: null,
    student: null,
    task: null,
    items: [],
    state: "loading",
    message: "",
    preloadState: "idle",
    preloadLabel: "等待预载示范音频",
    preloadDone: 0,
    preloadTotal: 0,
    currentIndex: -1,
    currentItem: null,
    progressPercent: 0,
    positionLabel: "",
    countdown: 0,
    elapsedSeconds: 0,
    elapsedLabel: "00:00",
    remainingSeconds: 0,
    remainingLabel: "00:00",
    completedCount: 0,
    totalCount: 0,
    previousAttemptCount: 0,
    nextAttemptNo: 1,
    submittedAttemptNo: 0,
    submittedLate: false,
    uploadDone: 0,
    uploadTotal: 0,
    previewComplete: false,
  },

  onLoad(options) {
    this.setData({
      lessonId: options.lessonId || "",
      previewStudentId: options.previewStudentId || "",
      mode: options.mode || "",
    });
    this.localAudioByItemId = {};
    this.localResponses = [];
    this.uploadedByItemId = {};
    if (this.setupRecorder() === false) return;
    this.loadPractice();
  },

  onHide() {
    if (this.practiceActive && !this.allowTemporaryHide && !this.isUnloading) {
      this.interruptPractice("练习已中断：跟读过程中离开了当前页面。请重新开始本轮练习。");
    }
  },

  onUnload() {
    this.isUnloading = true;
    this.discardRecorderStop = true;
    this.cleanupRuntime();
    this.teardownRecorder();
  },

  setupRecorder() {
    if (typeof wx.getRecorderManager !== "function") {
      this.setData({ state: "error", message: "当前微信版本不支持录音，请升级微信后重试。" });
      return false;
    }
    this.recorder = wx.getRecorderManager();
    this.handleRecorderStart = () => {
      if (!this.practiceActive) return;
      const responseSeconds = Number(this.data.task && this.data.task.responseSeconds) || 8;
      this.setData({
        state: "recording",
        elapsedSeconds: 0,
        elapsedLabel: "00:00",
        remainingSeconds: responseSeconds,
        remainingLabel: formatTimer(responseSeconds),
      });
      this.recordTimer = setInterval(() => {
        const elapsed = this.data.elapsedSeconds + 1;
        const remaining = Math.max(0, responseSeconds - elapsed);
        this.setData({
          elapsedSeconds: elapsed,
          elapsedLabel: formatTimer(elapsed),
          remainingSeconds: remaining,
          remainingLabel: formatTimer(remaining),
        });
      }, 1000);
    };
    this.handleRecorderStop = (result) => {
      this.clearRecordTimer();
      if (this.discardRecorderStop || !this.practiceActive || this.isUnloading) return;
      if (!result || !result.tempFilePath || Number(result.duration || 0) < 500) {
        this.setData({
          state: "item_retry",
          message: "这一条没有录到清楚的声音，请重新播放示范后再读一次。",
          elapsedSeconds: 0,
          elapsedLabel: "00:00",
        });
        return;
      }
      const item = this.data.currentItem;
      this.localResponses.push({
        itemId: item.id,
        itemOrder: item.order,
        tempFilePath: result.tempFilePath,
        duration: Number(result.duration || 0),
        fileSize: Number(result.fileSize || 0),
      });
      const completedCount = this.localResponses.length;
      this.setData({ state: "between", completedCount, message: "" });
      this.advanceAfterResponse();
    };
    this.handleRecorderError = (error) => {
      console.error(error);
      if (this.isUnloading || !this.practiceActive) return;
      this.interruptPractice("麦克风录音发生错误，请检查权限后重新开始本轮练习。");
    };
    this.recorder.onStart(this.handleRecorderStart);
    this.recorder.onStop(this.handleRecorderStop);
    this.recorder.onError(this.handleRecorderError);
    return true;
  },

  teardownRecorder() {
    if (!this.recorder) return;
    if (typeof this.recorder.offStart === "function") this.recorder.offStart(this.handleRecorderStart);
    if (typeof this.recorder.offStop === "function") this.recorder.offStop(this.handleRecorderStop);
    if (typeof this.recorder.offError === "function") this.recorder.offError(this.handleRecorderError);
  },

  loadPractice() {
    if (!this.data.lessonId) {
      this.setData({ state: "error", message: "课程信息不完整，请返回课程页重新进入。" });
      return;
    }
    this.setData({ state: "loading", message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getFollowReadingPractice",
        data: {
          lessonId: this.data.lessonId,
          mode: this.data.mode,
          previewStudentId: this.data.previewStudentId,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取跟读任务");
      const items = result.task && result.task.items || [];
      this.setData({
        lesson: result.lesson,
        student: result.student,
        task: result.task,
        items,
        isTeacherPreview: result.isTeacherPreview === true,
        state: "instructions",
        totalCount: items.length,
        previousAttemptCount: result.previousAttemptCount || 0,
        nextAttemptNo: result.nextAttemptNo || 1,
        preloadState: "loading",
        preloadDone: 0,
        preloadTotal: items.length,
        preloadLabel: `正在预载老师示范音频 0 / ${items.length}`,
      }, () => this.startAudioPreload().catch(() => {}));
    }).catch((err) => {
      console.error(err);
      this.setData({ state: "error", message: err.message || "跟读任务暂时无法打开" });
    });
  },

  startAudioPreload(force = false) {
    if (this.preloadPromise && !force) return this.preloadPromise;
    const items = this.data.items || [];
    this.localAudioByItemId = {};
    this.setData({
      preloadState: "loading",
      preloadDone: 0,
      preloadTotal: items.length,
      preloadLabel: `正在预载老师示范音频 0 / ${items.length}`,
    });
    this.preloadPromise = preloadAudioSources(items.map((item) => ({ id: item.id, audioUrl: item.audioUrl })), {
      concurrency: 3,
      onProgress: (done, total) => this.setData({
        preloadDone: done,
        preloadTotal: total,
        preloadLabel: `正在预载老师示范音频 ${done} / ${total}`,
      }),
    }).then((result) => {
      this.localAudioByItemId = result.localById;
      this.setData({
        preloadState: "ready",
        preloadDone: result.total,
        preloadLabel: `老师示范音频已预载 ${result.total} / ${result.total}`,
      });
      return result;
    }).catch((error) => {
      console.error(error);
      this.preloadPromise = null;
      this.setData({
        preloadState: "failed",
        preloadLabel: "示范音频预载失败，请检查网络后重试",
      });
      throw error;
    });
    return this.preloadPromise;
  },

  beginPractice() {
    if (!["instructions", "success"].includes(this.data.state)) return;
    this.setData({ state: "preparing", message: "", previewComplete: false });
    const audioReady = this.data.preloadState === "ready"
      ? Promise.resolve()
      : this.startAudioPreload(this.data.preloadState === "failed");
    audioReady.then(() => this.ensureMicrophonePermission(() => this.startFlow()))
      .catch(() => {
        this.setData({ state: "instructions" });
        wx.showModal({ title: "音频准备失败", content: "老师示范音频没有全部加载完成，请检查网络后重试。", showCancel: false });
      });
  },

  ensureMicrophonePermission(callback) {
    wx.getSetting({
      success: (setting) => {
        const allowed = setting.authSetting && setting.authSetting["scope.record"];
        if (allowed === true) return callback();
        if (allowed === false) return this.showMicrophoneHelp();
        this.allowTemporaryHide = true;
        wx.authorize({
          scope: "scope.record",
          success: () => { this.allowTemporaryHide = false; callback(); },
          fail: () => { this.allowTemporaryHide = false; this.showMicrophoneHelp(); },
        });
      },
      fail: callback,
    });
  },

  showMicrophoneHelp() {
    this.setData({ state: "instructions" });
    wx.showModal({
      title: "需要麦克风权限",
      content: "示范音播放结束后会自动录制跟读。请在小程序设置中允许使用麦克风。",
      confirmText: "打开设置",
      success: (result) => {
        if (result.confirm && wx.openSetting) wx.openSetting();
      },
    });
  },

  startFlow() {
    this.practiceActive = true;
    this.discardRecorderStop = false;
    this.localResponses = [];
    this.uploadedByItemId = {};
    this.batchRequestId = `follow-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.keepScreenOn(true);
    this.enableLeaveWarning(true);
    this.openItem(0);
  },

  openItem(index) {
    if (!this.practiceActive) return;
    const item = this.data.items[index];
    if (!item) {
      this.finishPractice();
      return;
    }
    const automatic = this.data.task && this.data.task.mode === "automatic";
    this.setData({
      currentIndex: index,
      currentItem: item,
      positionLabel: `${index + 1} / ${this.data.items.length}`,
      progressPercent: Math.round((index + 1) / this.data.items.length * 100),
      state: automatic ? "between" : "awaiting_play",
      countdown: Number(this.data.task.gapSeconds) || 2,
      elapsedSeconds: 0,
      elapsedLabel: "00:00",
      message: "",
    });
    if (automatic) this.nextTimer = setTimeout(() => this.playCurrentDemo(), index ? 650 : 350);
  },

  playCurrentDemo() {
    if (!this.practiceActive || !this.data.currentItem) return;
    if (this.audioPlayback) this.audioPlayback.destroy();
    const item = this.data.currentItem;
    this.setData({ state: "playing", message: "" });
    const playback = playReliableAudio({
      localPath: this.localAudioByItemId[item.id],
      audioUrl: item.audioUrl,
    }, {
      onEnded: () => {
        if (!this.practiceActive || this.audioPlayback !== playback) return;
        playback.destroy();
        this.audioPlayback = null;
        this.startGapCountdown();
      },
      onError: (error) => {
        console.error(error);
        if (!this.practiceActive || this.audioPlayback !== playback) return;
        this.audioPlayback = null;
        this.setData({ state: "audio_retry", message: "老师示范音没有正常播放，请重试这一条。" });
      },
    });
    this.audioPlayback = playback;
  },

  startGapCountdown() {
    this.clearCountdownTimer();
    const gap = Number(this.data.task && this.data.task.gapSeconds) || 2;
    this.setData({ state: "countdown", countdown: gap });
    this.countdownTimer = setInterval(() => {
      const next = this.data.countdown - 1;
      if (next <= 0) {
        this.clearCountdownTimer();
        this.startRecording();
        return;
      }
      this.setData({ countdown: next });
    }, 1000);
  },

  startRecording() {
    if (!this.practiceActive || !this.recorder) return;
    const responseSeconds = Number(this.data.task && this.data.task.responseSeconds) || 8;
    this.setData({ state: "starting" });
    try {
      this.recorder.start({
        duration: responseSeconds * 1000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3",
      });
    } catch (error) {
      this.handleRecorderError(error);
    }
  },

  finishCurrentResponse() {
    if (this.data.state !== "recording" || !this.recorder) return;
    this.setData({ state: "stopping" });
    try { this.recorder.stop(); } catch (error) { this.handleRecorderError(error); }
  },

  retryCurrentItem() {
    if (!["audio_retry", "item_retry"].includes(this.data.state)) return;
    this.playCurrentDemo();
  },

  advanceAfterResponse() {
    const nextIndex = this.data.currentIndex + 1;
    if (nextIndex >= this.data.items.length) {
      this.nextTimer = setTimeout(() => this.finishPractice(), 500);
      return;
    }
    this.nextTimer = setTimeout(() => this.openItem(nextIndex), 500);
  },

  finishPractice() {
    if (!this.practiceActive) return;
    if (this.data.isTeacherPreview) {
      this.practiceActive = false;
      this.keepScreenOn(false);
      this.enableLeaveWarning(false);
      this.setData({ state: "success", previewComplete: true, submittedAttemptNo: 0 });
      return;
    }
    this.uploadResponses();
  },

  uploadResponses() {
    if (!this.practiceActive) return;
    this.setData({ state: "uploading", uploadDone: Object.keys(this.uploadedByItemId).length, uploadTotal: this.localResponses.length });
    const uploadNext = (index) => {
      if (!this.practiceActive) return Promise.reject(new Error("本轮跟读已经中断"));
      if (index >= this.localResponses.length) return Promise.resolve();
      const response = this.localResponses[index];
      if (this.uploadedByItemId[response.itemId]) return uploadNext(index + 1);
      const cloudPath = this.buildResponseCloudPath(response, index);
      return wx.cloud.uploadFile({ cloudPath, filePath: response.tempFilePath }).then((upload) => {
        this.uploadedByItemId[response.itemId] = {
          itemId: response.itemId,
          fileID: upload.fileID,
          cloudPath,
          fileName: `${String(index + 1).padStart(2, "0")}-${response.itemId}.mp3`,
          duration: response.duration,
          fileSize: response.fileSize,
        };
        this.setData({ uploadDone: Object.keys(this.uploadedByItemId).length });
        return uploadNext(index + 1);
      });
    };
    uploadNext(0).then(() => wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "submitFollowReadingBatch",
        data: {
          lessonId: this.data.lessonId,
          requestId: this.batchRequestId,
          responses: this.localResponses.map((response) => this.uploadedByItemId[response.itemId]),
        },
      },
    })).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "跟读录音提交失败");
      this.practiceActive = false;
      this.keepScreenOn(false);
      this.enableLeaveWarning(false);
      this.setData({
        state: "success",
        previewComplete: false,
        submittedAttemptNo: result.attemptNo || this.data.nextAttemptNo,
        submittedLate: result.submittedLate === true,
        previousAttemptCount: Math.max(this.data.previousAttemptCount + 1, result.attemptNo || 0),
        nextAttemptNo: (result.attemptNo || this.data.nextAttemptNo) + 1,
      });
    }).catch((error) => {
      console.error(error);
      if (!this.practiceActive) return;
      this.setData({ state: "upload_error", message: error.message || "跟读录音提交失败" });
    });
  },

  retryUpload() {
    if (this.data.state === "upload_error" && this.practiceActive) this.uploadResponses();
  },

  resetPractice() {
    if (this.data.state !== "success") return;
    this.setData({
      state: "instructions",
      currentIndex: -1,
      currentItem: null,
      completedCount: 0,
      progressPercent: 0,
      positionLabel: "",
      submittedAttemptNo: 0,
      submittedLate: false,
      previewComplete: false,
    });
  },

  buildResponseCloudPath(response, index) {
    const studentId = sanitizeSegment(this.data.student && this.data.student._id, "student", 30);
    const lessonId = sanitizeSegment(this.data.lessonId, "lesson", 35);
    const requestId = sanitizeSegment(this.batchRequestId, "attempt", 45);
    const itemId = sanitizeSegment(response.itemId, `item-${index + 1}`, 35);
    return `follow-reading-submissions/${studentId}/${lessonId}/${requestId}/${String(index + 1).padStart(2, "0")}-${itemId}.mp3`;
  },

  interruptPractice(message) {
    if (!this.practiceActive) return;
    this.practiceActive = false;
    this.discardRecorderStop = true;
    this.cleanupRuntime();
    this.enableLeaveWarning(false);
    if (!this.isUnloading) this.setData({ state: "error", message });
  },

  cleanupRuntime() {
    if (this.nextTimer) clearTimeout(this.nextTimer);
    this.nextTimer = null;
    this.clearCountdownTimer();
    this.clearRecordTimer();
    if (this.audioPlayback) this.audioPlayback.destroy();
    this.audioPlayback = null;
    if (this.recorder && ["starting", "recording", "stopping"].includes(this.data.state)) {
      try { this.recorder.stop(); } catch (_) {}
    }
    this.keepScreenOn(false);
  },

  clearCountdownTimer() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  },

  clearRecordTimer() {
    if (this.recordTimer) clearInterval(this.recordTimer);
    this.recordTimer = null;
  },

  keepScreenOn(value) {
    if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: value, fail: () => {} });
  },

  enableLeaveWarning(enabled) {
    if (enabled && wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: "本轮跟读尚未完成，离开后本次录音不会保存。" });
    } else if (!enabled && wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload();
    }
  },

  goBack() {
    wx.navigateBack();
  },
});
