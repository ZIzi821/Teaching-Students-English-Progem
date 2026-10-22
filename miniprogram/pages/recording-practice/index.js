const sanitizePathSegment = (value, fallback, limit = 28) => {
  const safe = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, limit);
  return safe || fallback;
};

const shortId = (value) => sanitizePathSegment(
  String(value || "").replace(/^lesson_|^submission_/, ""),
  "record",
  10
);

const formatPathTime = (date = new Date()) => {
  const pad = (part, width = 2) => String(part).padStart(width, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    pad(date.getMilliseconds(), 3),
  ].join("-");
};

const formatTimer = (seconds) => {
  const total = Math.max(0, Math.trunc(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

Page({
  data: {
    lessonId: "",
    lesson: null,
    student: null,
    state: "loading",
    message: "",
    prompt: "",
    isKetTask: false,
    ketSpeakingTask: null,
    suggestedRecordingSeconds: 0,
    repeatCount: 2,
    preparationSeconds: 5,
    countdown: 5,
    elapsedSeconds: 0,
    elapsedLabel: "00:00",
    previousSubmissionCount: 0,
    nextAttemptNo: 1,
    submittedAttemptNo: 0,
    submittedDurationLabel: "",
  },

  onLoad(options) {
    this.setData({ lessonId: options.lessonId || "" });
    if (this.setupRecorder() === false) return;
    this.loadPractice();
  },

  onUnload() {
    this.isUnloading = true;
    this.discardStoppedRecording = true;
    this.clearTimers();
    this.keepScreenOn(false);
    if (this.recorderManager && ["starting", "recording", "stopping"].includes(this.data.state)) {
      try {
        this.recorderManager.stop();
      } catch (_) {}
    }
    if (this.recorderManager) {
      if (typeof this.recorderManager.offStart === "function") this.recorderManager.offStart(this.handleRecorderStart);
      if (typeof this.recorderManager.offStop === "function") this.recorderManager.offStop(this.handleRecorderStop);
      if (typeof this.recorderManager.offError === "function") this.recorderManager.offError(this.handleRecorderError);
    }
  },

  setupRecorder() {
    if (typeof wx.getRecorderManager !== "function") {
      this.setData({ state: "error", message: "请升级微信后使用录音功能。" });
      return false;
    }
    this.recorderManager = wx.getRecorderManager();
    this.handleRecorderStart = () => {
      this.setData({ state: "recording", elapsedSeconds: 0, elapsedLabel: "00:00" });
      this.elapsedTimer = setInterval(() => {
        const elapsedSeconds = this.data.elapsedSeconds + 1;
        this.setData({ elapsedSeconds, elapsedLabel: formatTimer(elapsedSeconds) });
      }, 1000);
    };
    this.handleRecorderStop = (res) => {
      this.clearElapsedTimer();
      this.keepScreenOn(false);
      if (this.isUnloading || this.discardStoppedRecording) return;
      if (!res || !res.tempFilePath) {
        this.setData({ state: "ready" });
        wx.showToast({ title: "没有生成录音，请重新录制", icon: "none" });
        return;
      }
      if ((Number(res.duration) || 0) < 800) {
        this.setData({ state: "ready" });
        wx.showToast({ title: "录音时间太短，请重新录制", icon: "none" });
        return;
      }
      this.uploadRecording(res.tempFilePath, res.duration || 0, res.fileSize || 0);
    };
    this.handleRecorderError = (err) => {
      console.error(err);
      this.clearTimers();
      this.keepScreenOn(false);
      if (this.isUnloading) return;
      this.setData({ state: "ready" });
      this.showMicrophoneHelp(err);
    };
    this.recorderManager.onStart(this.handleRecorderStart);
    this.recorderManager.onStop(this.handleRecorderStop);
    this.recorderManager.onError(this.handleRecorderError);
    return true;
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
        type: "getLessonDetail",
        data: { lessonId: this.data.lessonId },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取录音任务");
      if (result.role !== "student") throw new Error("请从学生端进入录音练习");
      const lesson = result.lesson || {};
      if (lesson.recordingTaskEnabled !== true) throw new Error("老师尚未为这节课布置录音任务");
      if (lesson.recordingTaskType === "ket_mock") {
        wx.redirectTo({
          url: `/ket-mock/pages/exam/index?lessonId=${encodeURIComponent(this.data.lessonId)}`,
        });
        return;
      }
      const submissions = Array.isArray(result.submissions) ? result.submissions : [];
      const highestAttemptNo = submissions.reduce((max, item, index) => (
        Math.max(max, Number(item.attemptNo) || submissions.length - index)
      ), 0);
      const repeatCount = Math.max(1, Math.min(5, Number(lesson.recordingRepeatCount) || 2));
      const preparationSeconds = [0, 3, 5, 10, 15].includes(Number(lesson.recordingPreparationSeconds))
        ? Number(lesson.recordingPreparationSeconds)
        : 5;
      const isKetTask = lesson.recordingTaskType === "ket_official";
      this.setData({
        lesson,
        student: result.student || { _id: lesson.studentId, name: "学生" },
        state: "ready",
        prompt: lesson.recordingPrompt || "按老师课堂要求完成朗读并提交。",
        isKetTask,
        ketSpeakingTask: lesson.ketSpeakingTask || null,
        suggestedRecordingSeconds: Math.max(0, Number(lesson.recordingSuggestedSeconds) || 0),
        repeatCount,
        preparationSeconds,
        countdown: preparationSeconds,
        previousSubmissionCount: submissions.length,
        nextAttemptNo: highestAttemptNo + 1,
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ state: "error", message: err.message || "录音任务暂时无法打开" });
    });
  },

  ensureMicrophonePermission(callback) {
    wx.getSetting({
      success: (settingRes) => {
        const permission = settingRes.authSetting && settingRes.authSetting["scope.record"];
        if (permission === true) {
          callback();
          return;
        }
        if (permission === false) {
          this.showMicrophoneHelp({ errMsg: "permission denied" });
          return;
        }
        wx.authorize({
          scope: "scope.record",
          success: callback,
          fail: (err) => this.showMicrophoneHelp(err),
        });
      },
      fail: callback,
    });
  },

  showMicrophoneHelp(err) {
    const detail = String((err && err.errMsg) || "");
    wx.showModal({
      title: "需要麦克风权限",
      content: /auth|authorize|permission|deny/i.test(detail)
        ? "请在小程序设置中允许使用麦克风，然后重新开始录音。"
        : "录音没有成功，请确认麦克风可用后重试。",
      confirmText: "打开设置",
      success: (result) => {
        if (result.confirm && typeof wx.openSetting === "function") wx.openSetting();
      },
    });
  },

  beginPreparation() {
    if (!["ready", "success"].includes(this.data.state) || !this.recorderManager) return;
    this.ensureMicrophonePermission(() => this.startPreparationCountdown());
  },

  startPreparationCountdown() {
    this.clearTimers();
    this.discardStoppedRecording = false;
    this.keepScreenOn(true);
    const countdown = this.data.preparationSeconds;
    if (countdown <= 0) {
      this.setData({ submittedAttemptNo: 0 });
      this.startRecording();
      return;
    }
    this.setData({ state: "countdown", countdown, submittedAttemptNo: 0 });
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

  cancelPreparation() {
    if (this.data.state !== "countdown") return;
    this.clearCountdownTimer();
    this.keepScreenOn(false);
    this.setData({ state: "ready", countdown: this.data.preparationSeconds });
  },

  startRecording() {
    if (!this.recorderManager || this.isUnloading) return;
    this.setData({ state: "starting", elapsedSeconds: 0, elapsedLabel: "00:00" });
    try {
      this.recorderManager.start({
        duration: 180000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3",
      });
    } catch (err) {
      this.handleRecorderError(err);
    }
  },

  stopRecording() {
    if (this.data.state !== "recording" || !this.recorderManager) return;
    this.setData({ state: "stopping" });
    this.recorderManager.stop();
  },

  resetPractice() {
    if (this.data.state !== "success") return;
    this.setData({
      state: "ready",
      countdown: this.data.preparationSeconds,
      elapsedSeconds: 0,
      elapsedLabel: "00:00",
      submittedAttemptNo: 0,
      submittedDurationLabel: "",
    });
  },

  buildCloudPath(attemptNo) {
    const lesson = this.data.lesson || {};
    const student = this.data.student || {};
    const studentFolder = `${sanitizePathSegment(student.name, "学生", 20)}-${shortId(student._id || lesson.studentId)}`;
    const lessonDate = sanitizePathSegment(lesson.lessonDate, "未标日期", 16);
    const lessonNo = sanitizePathSegment(lesson.lessonNo, "未编号", 10);
    const lessonTitle = sanitizePathSegment(lesson.title, "英语课", 28);
    const durationMinutes = Math.max(0, Number(lesson.durationMinutes) || 0);
    const lessonMarker = lesson.lessonNo
      ? `第${lessonNo}节`
      : durationMinutes ? `${durationMinutes}分钟` : lessonNo;
    const lessonFolder = `${lessonDate}-${lessonMarker}-${lessonTitle}-${shortId(lesson._id || this.data.lessonId)}`;
    return `lesson-submissions/${studentFolder}/${lessonFolder}/第${attemptNo}次-${formatPathTime()}-reading.mp3`;
  },

  uploadRecording(filePath, duration, fileSize) {
    const attemptNo = this.data.nextAttemptNo;
    const cloudPath = this.buildCloudPath(attemptNo);
    let uploadedFileID = "";
    this.setData({ state: "uploading" });
    wx.cloud.uploadFile({ cloudPath, filePath })
      .then((uploadRes) => {
        uploadedFileID = uploadRes.fileID;
        return wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "submitLessonRecording",
            data: {
              lessonId: this.data.lessonId,
              fileID: uploadedFileID,
              cloudPath,
              fileName: `第${attemptNo}次-独立朗读录音.mp3`,
              attemptNo,
              duration,
              fileSize,
            },
          },
        });
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) throw new Error(result.message || "录音提交失败");
        const durationSeconds = Math.max(1, Math.round((Number(duration) || 0) / 1000));
        this.setData({
          state: "success",
          submittedAttemptNo: attemptNo,
          submittedDurationLabel: `${durationSeconds} 秒`,
          previousSubmissionCount: this.data.previousSubmissionCount + 1,
          nextAttemptNo: attemptNo + 1,
        });
      })
      .catch((err) => {
        console.error(err);
        if (uploadedFileID && wx.cloud.deleteFile) {
          wx.cloud.deleteFile({ fileList: [uploadedFileID] }).catch(() => {});
        }
        this.setData({ state: "ready" });
        wx.showToast({ title: err.message || "录音提交失败", icon: "none" });
      });
  },

  clearCountdownTimer() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  },

  clearElapsedTimer() {
    if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    this.elapsedTimer = null;
  },

  clearTimers() {
    this.clearCountdownTimer();
    this.clearElapsedTimer();
  },

  keepScreenOn(keepScreenOn) {
    if (typeof wx.setKeepScreenOn !== "function") return;
    wx.setKeepScreenOn({ keepScreenOn, fail: () => {} });
  },

  goBack() {
    wx.navigateBack();
  },
});
