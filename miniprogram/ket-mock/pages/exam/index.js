const sanitizeSegment = (value, fallback, limit = 40) => {
  const text = String(value || "").trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-");
  return text.slice(0, limit) || fallback;
};

const { playReliableAudio, preloadAudioSources } = require("../../../utils/reliableAudio");

const formatTimer = (seconds) => {
  const total = Math.max(0, Math.trunc(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

Page({
  data: {
    lessonId: "",
    lesson: null,
    student: null,
    set: null,
    latestSession: null,
    state: "loading",
    message: "",
    preparationText: "",
    preparationDone: 0,
    preparationTotal: 0,
    audioPreloadState: "idle",
    audioPreloadLabel: "等待预载考官录音",
    sessionId: "",
    currentCueIndex: -1,
    currentCue: null,
    currentPart: 1,
    cuePositionLabel: "",
    progressPercent: 0,
    elapsedSeconds: 0,
    elapsedLabel: "00:00",
    remainingSeconds: 0,
    remainingLabel: "",
    completedResponseCount: 0,
    expectedResponseCount: 0,
    uploadDone: 0,
    uploadTotal: 0,
    submittedLate: false,
  },

  onLoad(options) {
    this.setData({ lessonId: options.lessonId || "" });
    this.localAudioByCueId = {};
    this.localResponses = [];
    this.uploadedFileIDs = [];
    if (this.setupRecorder() === false) return;
    this.loadExam();
  },

  onHide() {
    if (this.examActive && !this.allowTemporaryHide) {
      this.interruptExam("page_hidden", "考试已中断：考试过程中离开了当前页面。请回到课程页重新开始。");
    }
  },

  onUnload() {
    this.isUnloading = true;
    if (this.examActive) this.abortSessionSilently("page_unloaded");
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
      if (!this.examActive) return;
      const cue = this.data.currentCue || {};
      this.setData({
        state: "recording",
        elapsedSeconds: 0,
        elapsedLabel: "00:00",
        remainingSeconds: Number(cue.maxResponseSeconds || 0),
        remainingLabel: formatTimer(cue.maxResponseSeconds),
      });
      this.recordTimer = setInterval(() => {
        const elapsed = this.data.elapsedSeconds + 1;
        const remaining = Math.max(0, Number(cue.maxResponseSeconds || 0) - elapsed);
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
      if (this.discardRecorderStop || !this.examActive || this.isUnloading) return;
      if (!result || !result.tempFilePath) {
        this.interruptExam("recording_empty", "麦克风没有生成录音，本场考试未提交。请检查权限后重新开始。");
        return;
      }
      const cue = this.data.currentCue;
      this.localResponses.push({
        cueId: cue.id,
        part: cue.part,
        order: cue.order,
        tempFilePath: result.tempFilePath,
        duration: Number(result.duration || 0),
        fileSize: Number(result.fileSize || 0),
      });
      const completedResponseCount = this.localResponses.length;
      this.setData({
        state: "between",
        completedResponseCount,
        elapsedSeconds: 0,
        elapsedLabel: "00:00",
      });
      this.nextCueTimer = setTimeout(() => this.playNextCue(), 900);
    };
    this.handleRecorderError = (err) => {
      console.error(err);
      if (this.isUnloading || !this.examActive) return;
      this.interruptExam("recorder_error", "录音发生错误，本场考试未提交。请检查麦克风后重新开始。");
    };
    this.recorder.onStart(this.handleRecorderStart);
    this.recorder.onStop(this.handleRecorderStop);
    this.recorder.onError(this.handleRecorderError);
    return true;
  },

  loadExam() {
    if (!this.data.lessonId) {
      this.setData({ state: "error", message: "课程信息不完整，请返回课程页重新进入。" });
      return;
    }
    this.setData({ state: "loading", message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getKetMockExam", data: { lessonId: this.data.lessonId } },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取模拟考试");
      const latestSession = result.latestSession || null;
      const completed = latestSession && ["submitted", "reviewed"].includes(latestSession.status);
      const expectedResponseCount = (result.set.cues || []).filter((cue) => cue.responseExpected).length;
      this.setData({
        lesson: result.lesson,
        student: result.student,
        set: result.set,
        latestSession,
        state: completed ? "completed" : "instructions",
        expectedResponseCount,
        preparationTotal: (result.set.cues || []).length,
        preparationDone: 0,
        audioPreloadState: completed ? "idle" : "loading",
        audioPreloadLabel: completed ? "" : "正在预载考官录音 0 / " + (result.set.cues || []).length,
        message: "",
      }, () => {
        if (!completed) this.startExamAudioPreload().catch(() => {});
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ state: "error", message: err.message || "模拟考试暂时无法打开" });
    });
  },

  beginExam() {
    if (this.data.state !== "instructions") return;
    const cueCount = (this.data.set && this.data.set.cues || []).length;
    this.setData({
      state: "preparing",
      preparationText: "正在检查麦克风权限",
      preparationDone: 0,
      preparationTotal: cueCount,
    });
    this.ensureMicrophonePermission(() => this.ensureExamAudioReady());
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
      content: "完整模拟会在每段考官录音结束后自动录制回答。请在小程序设置中允许使用麦克风。",
      confirmText: "打开设置",
      success: (result) => {
        if (result.confirm && wx.openSetting) wx.openSetting();
      },
    });
  },

  startExamAudioPreload(force = false) {
    if (this.audioPreloadPromise && !force) return this.audioPreloadPromise;
    const cues = (this.data.set && this.data.set.cues) || [];
    this.localAudioByCueId = {};
    this.setData({
      audioPreloadState: "loading",
      audioPreloadLabel: `正在预载考官录音 0 / ${cues.length}`,
      preparationDone: 0,
      preparationTotal: cues.length,
    });
    this.audioPreloadPromise = preloadAudioSources(cues.map((cue) => ({
      id: cue.id,
      audioUrl: cue.audioUrl,
    })), {
      concurrency: 3,
      onProgress: (done, total) => this.setData({
        preparationDone: done,
        preparationTotal: total,
        audioPreloadLabel: `正在预载考官录音 ${done} / ${total}`,
      }),
    }).then((result) => {
      this.localAudioByCueId = result.localById;
      this.setData({
        audioPreloadState: "ready",
        audioPreloadLabel: `考官录音已预载 ${result.total} / ${result.total}`,
        preparationDone: result.total,
      });
      return result;
    }).catch((error) => {
      console.error(error);
      this.audioPreloadPromise = null;
      this.setData({
        audioPreloadState: "failed",
        audioPreloadLabel: "考官录音预载失败，开始时会重新尝试",
      });
      throw error;
    });
    return this.audioPreloadPromise;
  },

  ensureExamAudioReady() {
    this.setData({
      state: "preparing",
      preparationText: this.data.audioPreloadState === "ready" ? "考官录音已经准备完成" : "正在准备考官录音",
    });
    const ready = this.data.audioPreloadState === "ready"
      ? Promise.resolve()
      : this.startExamAudioPreload(this.data.audioPreloadState === "failed");
    ready.then(() => this.createSession()).catch((err) => {
      console.error(err);
      this.setData({ state: "instructions" });
      wx.showModal({ title: "准备失败", content: "考官录音没有全部加载完成，请检查网络后重试。", showCancel: false });
    });
  },

  createSession() {
    this.setData({ preparationText: "正在建立考试记录" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "startKetMockSession", data: { lessonId: this.data.lessonId } },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "考试记录建立失败");
      if (result.alreadySubmitted) {
        this.setData({
          state: "completed",
          latestSession: { _id: result.sessionId, status: result.status },
        });
        return;
      }
      this.examActive = true;
      this.discardRecorderStop = false;
      this.keepScreenOn(true);
      this.enableLeaveWarning(true);
      this.setData({
        sessionId: result.sessionId,
        state: "between",
        completedResponseCount: 0,
        expectedResponseCount: result.expectedResponseCount,
        currentCueIndex: -1,
      });
      this.nextCueTimer = setTimeout(() => this.playNextCue(), 650);
    }).catch((err) => {
      console.error(err);
      this.setData({ state: "instructions" });
      wx.showModal({ title: "无法开始", content: err.message || "请稍后重试", showCancel: false });
    });
  },

  playNextCue() {
    if (!this.examActive) return;
    const cues = this.data.set.cues || [];
    const nextIndex = this.data.currentCueIndex + 1;
    if (nextIndex >= cues.length) {
      this.finishAndUpload();
      return;
    }
    const cue = cues[nextIndex];
    this.setData({
      currentCueIndex: nextIndex,
      currentCue: cue,
      currentPart: cue.part,
      cuePositionLabel: `${nextIndex + 1} / ${cues.length}`,
      progressPercent: Math.round((nextIndex + 1) / cues.length * 100),
      state: "playing",
      elapsedSeconds: 0,
      elapsedLabel: "00:00",
    });
    this.playCueAudio(cue);
  },

  playCueAudio(cue) {
    if (this.examAudio) this.examAudio.destroy();
    const playback = playReliableAudio({
      localPath: this.localAudioByCueId[cue.id],
      audioUrl: cue.audioUrl,
    }, {
      onEnded: () => {
        if (!this.examActive || this.examAudio !== playback) return;
        playback.destroy();
        this.examAudio = null;
        if (cue.responseExpected) this.startRecording(cue);
        else {
          this.setData({ state: "between" });
          this.nextCueTimer = setTimeout(() => this.playNextCue(), 700);
        }
      },
      onError: (err) => {
        console.error(err);
        this.interruptExam("audio_error", "考官录音播放失败，本场考试已中断。请检查声音和网络后重新开始。");
      },
    });
    this.examAudio = playback;
  },

  startRecording(cue) {
    if (!this.examActive || !this.recorder) return;
    this.setData({ state: "starting" });
    try {
      this.recorder.start({
        duration: Math.max(1000, Math.min(180000, Number(cue.maxResponseSeconds || 60) * 1000)),
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3",
      });
    } catch (err) {
      this.handleRecorderError(err);
    }
  },

  finishAnswer() {
    if (this.data.state !== "recording" || !this.recorder) return;
    this.setData({ state: "stopping" });
    try { this.recorder.stop(); } catch (err) { this.handleRecorderError(err); }
  },

  finishAndUpload() {
    if (!this.examActive) return;
    if (this.pendingUploadedResponses && this.pendingUploadedResponses.length === this.localResponses.length) {
      this.setData({
        state: "uploading",
        uploadDone: this.pendingUploadedResponses.length,
        uploadTotal: this.pendingUploadedResponses.length,
      });
      this.submitUploadedResponses(this.pendingUploadedResponses);
      return;
    }
    this.setData({
      state: "uploading",
      uploadDone: 0,
      uploadTotal: this.localResponses.length,
    });
    this.uploadedFileIDs = [];
    this.pendingUploadedResponses = null;
    const uploadedResponses = [];
    const uploadNext = (index) => {
      if (!this.examActive) return Promise.reject(new Error("考试已经中断"));
      if (index >= this.localResponses.length) return Promise.resolve(uploadedResponses);
      const response = this.localResponses[index];
      const cloudPath = this.buildResponseCloudPath(response, index);
      return wx.cloud.uploadFile({ cloudPath, filePath: response.tempFilePath }).then((upload) => {
        this.uploadedFileIDs.push(upload.fileID);
        uploadedResponses.push({
          cueId: response.cueId,
          fileID: upload.fileID,
          cloudPath,
          fileName: `${response.cueId}.mp3`,
          duration: response.duration,
          fileSize: response.fileSize,
        });
        this.setData({ uploadDone: index + 1 });
        return uploadNext(index + 1);
      });
    };
    uploadNext(0)
      .then((responses) => {
        this.pendingUploadedResponses = responses;
        this.submitUploadedResponses(responses);
      })
      .catch((err) => {
        console.error(err);
        const fileIDs = this.uploadedFileIDs.slice();
        this.uploadedFileIDs = [];
        this.pendingUploadedResponses = null;
        const cleanup = fileIDs.length && wx.cloud.deleteFile
          ? wx.cloud.deleteFile({ fileList: fileIDs }).catch(() => {})
          : Promise.resolve();
        cleanup.finally(() => {
          if (!this.examActive) return;
          this.setData({ state: "upload_error", message: err.message || "考试录音上传失败" });
        });
      });
  },

  submitUploadedResponses(responses) {
    wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: { type: "completeKetMockSession", data: { sessionId: this.data.sessionId, responses } },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) throw new Error(result.message || "考试提交失败");
        this.examActive = false;
        this.keepScreenOn(false);
        this.enableLeaveWarning(false);
        this.pendingUploadedResponses = null;
        this.setData({
          state: "success",
          submittedLate: result.submittedLate === true,
          latestSession: { _id: result.sessionId, status: "submitted" },
        });
      })
      .catch((err) => {
        console.error(err);
        if (!this.examActive) return;
        this.setData({ state: "upload_error", message: err.message || "考试录音提交失败" });
      });
  },

  retryUpload() {
    if (this.data.state === "upload_error" && this.examActive) this.finishAndUpload();
  },

  buildResponseCloudPath(response, index) {
    const studentId = sanitizeSegment(this.data.student && this.data.student._id, "student", 30);
    const lessonId = sanitizeSegment(this.data.lessonId, "lesson", 35);
    const sessionId = sanitizeSegment(this.data.sessionId, "session", 45);
    const cueId = sanitizeSegment(response.cueId, `answer-${index + 1}`, 35);
    return `ket-mock-submissions/${studentId}/${lessonId}/${sessionId}/${String(index + 1).padStart(2, "0")}-${cueId}.mp3`;
  },

  interruptExam(reason, message) {
    if (!this.examActive) return;
    this.examActive = false;
    this.discardRecorderStop = true;
    this.cleanupRuntime();
    this.enableLeaveWarning(false);
    this.abortSessionSilently(reason);
    if (!this.isUnloading) this.setData({ state: "error", message });
  },

  abortSessionSilently(reason) {
    const sessionId = this.data.sessionId;
    if (!sessionId) return;
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "abortKetMockSession", data: { sessionId, reason } },
    }).catch(() => {});
  },

  clearRecordTimer() {
    if (this.recordTimer) clearInterval(this.recordTimer);
    this.recordTimer = null;
  },

  cleanupRuntime() {
    if (this.nextCueTimer) clearTimeout(this.nextCueTimer);
    this.nextCueTimer = null;
    this.clearRecordTimer();
    if (this.examAudio) this.examAudio.destroy();
    this.examAudio = null;
    if (this.recorder && ["starting", "recording", "stopping"].includes(this.data.state)) {
      try { this.recorder.stop(); } catch (_) {}
    }
    this.keepScreenOn(false);
  },

  teardownRecorder() {
    if (!this.recorder) return;
    if (typeof this.recorder.offStart === "function") this.recorder.offStart(this.handleRecorderStart);
    if (typeof this.recorder.offStop === "function") this.recorder.offStop(this.handleRecorderStop);
    if (typeof this.recorder.offError === "function") this.recorder.offError(this.handleRecorderError);
  },

  keepScreenOn(value) {
    if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: value, fail: () => {} });
  },

  enableLeaveWarning(enabled) {
    if (enabled && wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: "考试尚未完成，离开后本场会中断。" });
    } else if (!enabled && wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload();
    }
  },

  openResult() {
    const session = this.data.latestSession;
    if (!session || !session._id) return;
    wx.navigateTo({ url: `/ket-mock/pages/review/index?sessionId=${encodeURIComponent(session._id)}` });
  },

  goBack() {
    wx.navigateBack();
  },
});
