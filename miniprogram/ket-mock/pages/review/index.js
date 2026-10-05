const SCORE_OPTIONS = Array.from({ length: 11 }, (_, index) => ({
  value: index / 2,
  label: `${index / 2} 分`,
}));

const SCORE_FIELDS = [
  { key: "grammarVocabulary", label: "语法与词汇", hint: "表达范围与准确度" },
  { key: "pronunciation", label: "发音", hint: "清晰度、重音与语调" },
  { key: "interactiveCommunication", label: "互动沟通", hint: "回应、衔接与推进讨论" },
  { key: "globalAchievement", label: "整体表现", hint: "完成任务与整体可理解度" },
];

const formatDateTime = (timestamp) => {
  const value = Number(timestamp || 0);
  if (!value) return "";
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatDuration = (duration) => {
  const seconds = Math.max(0, Math.round(Number(duration || 0) / 1000));
  return `${Math.floor(seconds / 60) ? Math.floor(seconds / 60) + "分" : ""}${seconds % 60}秒`;
};

Page({
  data: {
    sessionId: "",
    loading: true,
    message: "",
    role: "",
    canReview: false,
    session: null,
    set: null,
    part1Rows: [],
    part2Rows: [],
    playingKey: "",
    scoreOptions: SCORE_OPTIONS,
    scoreFields: SCORE_FIELDS,
    scoreGuideExpanded: false,
    scoreTrend: null,
    saving: false,
    assessmentForm: {
      grammarVocabulary: 3,
      pronunciation: 3,
      interactiveCommunication: 3,
      globalAchievement: 3,
      strengths: "",
      nextFocus: "",
      comment: "",
    },
  },

  onLoad(options) {
    this.setData({ sessionId: options.sessionId || "" });
    this.loadSession();
  },

  onUnload() {
    if (this.audioContext) this.audioContext.destroy();
  },

  loadSession() {
    if (!this.data.sessionId) {
      this.setData({ loading: false, message: "模拟考试记录不完整，请返回后重试。" });
      return;
    }
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getKetMockSessionDetail", data: { sessionId: this.data.sessionId } },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取模拟考试");
      const session = Object.assign({}, result.session, {
        submittedLabel: formatDateTime(result.session.submittedAtMs),
        reviewedLabel: formatDateTime(result.session.reviewedAtMs),
      });
      const responseByCue = new Map((session.responses || []).map((response) => [response.cueId, response]));
      const rows = (result.set.cues || []).filter((cue) => cue.responseExpected).map((cue) => {
        const response = responseByCue.get(cue.id) || {};
        return Object.assign({}, cue, response, {
          cueTitle: cue.title,
          promptAudioUrl: cue.audioUrl || "",
          responseAudioUrl: response.audioUrl || "",
          durationLabel: formatDuration(response.duration),
        });
      });
      const assessment = session.assessment || {};
      this.setData({
        loading: false,
        role: result.role,
        canReview: result.canReview === true,
        session,
        set: result.set,
        part1Rows: rows.filter((row) => row.part === 1),
        part2Rows: rows.filter((row) => row.part === 2),
        assessmentForm: Object.assign({}, this.data.assessmentForm, assessment),
        scoreTrend: result.scoreTrend || null,
        message: "",
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ loading: false, message: err.message || "模拟考试暂时无法打开" });
    });
  },

  playAudio(e) {
    const part = Number(e.currentTarget.dataset.part);
    const index = Number(e.currentTarget.dataset.index);
    const type = String(e.currentTarget.dataset.type || "response");
    const row = (part === 1 ? this.data.part1Rows : this.data.part2Rows)[index];
    if (!row) return;
    const url = type === "prompt" ? row.promptAudioUrl : row.responseAudioUrl;
    if (!url) {
      wx.showToast({ title: "音频地址暂不可用，请重新加载", icon: "none" });
      return;
    }
    const key = `${type}:${row.cueId}`;
    if (this.data.playingKey === key && this.audioContext) {
      this.audioContext.stop();
      return;
    }
    if (this.audioContext) this.audioContext.destroy();
    const audio = wx.createInnerAudioContext();
    this.audioContext = audio;
    audio.obeyMuteSwitch = false;
    audio.src = url;
    audio.onPlay(() => this.setData({ playingKey: key }));
    audio.onStop(() => this.setData({ playingKey: "" }));
    audio.onEnded(() => this.setData({ playingKey: "" }));
    audio.onError((err) => {
      console.error(err);
      this.setData({ playingKey: "" });
      wx.showToast({ title: "音频播放失败", icon: "none" });
    });
    audio.play();
  },

  onScoreChange(e) {
    const field = String(e.currentTarget.dataset.field || "");
    const option = SCORE_OPTIONS[Number(e.detail.value)] || SCORE_OPTIONS[6];
    if (SCORE_FIELDS.some((item) => item.key === field)) {
      this.setData({ [`assessmentForm.${field}`]: option.value });
    }
  },

  onAssessmentInput(e) {
    const field = String(e.currentTarget.dataset.field || "");
    if (["strengths", "nextFocus", "comment"].includes(field)) {
      this.setData({ [`assessmentForm.${field}`]: e.detail.value });
    }
  },

  toggleScoreGuide() {
    this.setData({ scoreGuideExpanded: !this.data.scoreGuideExpanded });
  },

  saveAssessment() {
    if (!this.data.canReview || this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: "保存评分", mask: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "reviewKetMockSession",
        data: { sessionId: this.data.sessionId, assessment: this.data.assessmentForm },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "评分保存失败");
      wx.showToast({ title: "评分已保存" });
      this.loadSession();
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "保存失败", icon: "none" });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ saving: false });
    });
  },
});
