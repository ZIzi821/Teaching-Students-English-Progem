const MIX_LABELS = {
  speaking: "口语课",
  grammar: "语法课",
  input: "听读与表达课",
  ket: "KET 基础与复习课",
};

Page({
  data: {
    studentId: "",
    loading: true,
    saving: false,
    message: "",
    radar: null,
    stageIndex: 0,
    mixRows: [],
  },

  onLoad(options) {
    this.setData({ studentId: String(options.studentId || "") });
    this.loadRadar();
  },

  onShow() {
    if (this.hasShown && this.data.studentId && !this.data.saving) this.loadRadar();
    this.hasShown = true;
  },

  loadRadar() {
    if (!this.data.studentId) {
      this.setData({ loading: false, message: "学生信息不完整，请返回后重试" });
      return;
    }
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getStudentLearningRadar",
        data: { studentId: this.data.studentId },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "学习雷达加载失败");
      const source = result.radar || {};
      if (!source.available) {
        this.setData({
          radar: null,
          message: source.reason || "当前课程模板还没有阶段计划",
        });
        return;
      }
      const radar = this.prepareRadar(source);
      const stageIndex = Math.max(0, radar.stageOptions.findIndex((item) => (
        item.stageId === radar.currentStage.stageId
      )));
      this.setData({
        radar,
        stageIndex,
        mixRows: this.prepareMixRows(radar.prepSuggestion.recentMix),
        message: "",
      });
    }).catch((err) => {
      console.error(err);
      this.setData({
        radar: null,
        message: err.message || "服务暂时不可用，请稍后再试",
      });
    }).finally(() => {
      this.setData({ loading: false });
    });
  },

  prepareRadar(source) {
    const pinnedIds = new Set((source.learningPlan && source.learningPlan.teacherPinnedSkillIds) || []);
    const skills = (source.skills || []).map((skill) => Object.assign({}, skill, {
      hasScore: skill.score !== null && skill.score !== undefined,
      pinned: pinnedIds.has(skill.skillId),
    }));
    const skillById = new Map(skills.map((skill) => [skill.skillId, skill]));
    return Object.assign({}, source, {
      stageOptions: (source.stageOptions || []).map((stage) => Object.assign({}, stage, {
        displayLabel: `${stage.stageLabel} · ${stage.stageTitle}`,
      })),
      dimensions: (source.dimensions || []).map((dimension) => Object.assign({}, dimension, {
        hasScore: dimension.score !== null && dimension.score !== undefined,
      })),
      skills,
      priorities: (source.priorities || []).slice(0, 5),
      observationNeeds: (source.observationNeeds || []).slice(0, 5),
      currentTargetSkill: skillById.get(source.prepSuggestion && source.prepSuggestion.targetSkillId) || null,
    });
  },

  prepareMixRows(mix) {
    if (!mix || !mix.target || !mix.recent) return [];
    return Object.keys(MIX_LABELS).map((key) => ({
      key,
      label: MIX_LABELS[key],
      recent: Number(mix.recent[key] || 0),
      target: Number(mix.target[key] || 0),
      complete: Number(mix.recent[key] || 0) >= Number(mix.target[key] || 0),
    }));
  },

  onStageChange(e) {
    if (this.data.saving || !this.data.radar) return;
    const nextIndex = Number(e.detail.value);
    const target = this.data.radar.stageOptions[nextIndex];
    if (!target || target.stageId === this.data.radar.currentStage.stageId) return;
    wx.showModal({
      title: "确认切换学习阶段",
      content: `将当前阶段切换为“${target.displayLabel}”。历史证据会保留，之后的雷达和备课建议按新阶段生成。`,
      confirmText: "确认切换",
      confirmColor: "#4f8f73",
      success: (modalResult) => {
        if (!modalResult.confirm) return;
        this.saveLearningPlan({
          currentStageId: target.stageId,
          teacherPinnedSkillIds: [],
          confirmStageChange: true,
        }, "学习阶段已更新");
      },
    });
  },

  confirmNextStage() {
    const readiness = this.data.radar && this.data.radar.stageReadiness;
    if (!readiness || !readiness.eligibleForTeacherConfirmation || !readiness.nextStageId) return;
    const target = this.data.radar.stageOptions.find((item) => item.stageId === readiness.nextStageId);
    if (!target) return;
    wx.showModal({
      title: "确认进入下一阶段",
      content: `系统只提供达标建议，最终由老师确认。确定进入“${target.displayLabel}”吗？`,
      confirmText: "确认进入",
      confirmColor: "#4f8f73",
      success: (modalResult) => {
        if (!modalResult.confirm) return;
        this.saveLearningPlan({
          currentStageId: target.stageId,
          teacherPinnedSkillIds: [],
          confirmStageChange: true,
        }, "已进入下一阶段");
      },
    });
  },

  togglePinnedSkill(e) {
    if (this.data.saving || !this.data.radar) return;
    const skillId = String(e.currentTarget.dataset.skillId || "");
    const current = (this.data.radar.learningPlan.teacherPinnedSkillIds || []).slice();
    const index = current.indexOf(skillId);
    if (index >= 0) current.splice(index, 1);
    else current.push(skillId);
    this.saveLearningPlan({
      currentStageId: this.data.radar.currentStage.stageId,
      teacherPinnedSkillIds: current,
      confirmStageChange: false,
    }, index >= 0 ? "已取消重点" : "已设为备课重点");
  },

  saveLearningPlan(payload, successMessage) {
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "updateStudentLearningPlan",
        data: Object.assign({ studentId: this.data.studentId }, payload),
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "保存失败");
      wx.showToast({ title: successMessage, icon: "none" });
      this.loadRadar();
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "保存失败", icon: "none" });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ saving: false });
    });
  },
});
