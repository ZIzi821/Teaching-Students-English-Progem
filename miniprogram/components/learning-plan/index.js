const { callCloud } = require("../../utils/cloud");

const SKILL_GROUPS = [
  { key: "practicing", label: "练习中", tones: ["priority", "consolidating", "insufficient"] },
  { key: "waiting", label: "还没观察", tones: ["unassessed"] },
  { key: "passed", label: "已达标", tones: ["stable", "basic"] },
];

const buildPlanView = (radar) => {
  if (!radar || !radar.available) return null;
  const stages = radar.stageOptions || [];
  const currentIndex = Math.max(0, stages.findIndex((stage) => stage.stageId === radar.currentStage.stageId));
  const skills = (radar.skills || []).filter((skill) => skill.stateTone !== "inactive");
  const groups = SKILL_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    skills: skills.filter((skill) => group.tones.includes(skill.stateTone)).map((skill) => ({
      skillId: skill.skillId,
      label: skill.label,
      core: skill.core === true,
    })),
  })).filter((group) => group.skills.length);
  const readiness = radar.stageReadiness || {};
  const criteria = readiness.criteria || [];
  const prep = radar.prepSuggestion || {};
  return {
    stageNumber: currentIndex + 1,
    stageCount: stages.length,
    stageTitle: radar.currentStage.stageTitle,
    stageGoal: radar.currentStage.goal,
    steps: stages.map((stage, index) => ({
      stageId: stage.stageId,
      state: index < currentIndex ? "done" : index === currentIndex ? "current" : "next",
    })),
    stageOptions: stages.map((stage) => ({
      stageId: stage.stageId,
      displayLabel: `${stage.stageLabel} · ${stage.stageTitle}`,
    })),
    stageIndex: currentIndex,
    passedSkillCount: skills.filter((skill) => ["stable", "basic"].includes(skill.stateTone)).length,
    skillCount: skills.length,
    groups,
    criteria,
    remainingCriteriaCount: criteria.filter((item) => !item.passed).length,
    canAdvance: readiness.eligibleForTeacherConfirmation === true && Boolean(readiness.nextStageId),
    nextStageId: readiness.nextStageId || "",
    nextStageLabel: readiness.nextStageLabel || "",
    isFinalStage: readiness.isFinalStage === true,
    prep: {
      title: prep.title || "",
      durationMinutes: prep.durationMinutes || radar.lessonDurationMinutes || 0,
      reason: prep.reason || "",
      blocks: prep.blocks || [],
      evidencePrompt: prep.evidencePrompt || "",
    },
  };
};

Component({
  options: {
    styleIsolation: "apply-shared",
  },

  properties: {
    radar: {
      type: Object,
      value: null,
    },
    studentId: {
      type: String,
      value: "",
    },
  },

  data: {
    plan: null,
    saving: false,
  },

  observers: {
    radar(radar) {
      this.setData({ plan: buildPlanView(radar) });
    },
  },

  methods: {
    onStageChange(e) {
      const plan = this.data.plan;
      if (this.data.saving || !plan) return;
      const target = plan.stageOptions[Number(e.detail.value)];
      if (!target || Number(e.detail.value) === plan.stageIndex) return;
      wx.showModal({
        title: "调整学习阶段",
        content: `切换到“${target.displayLabel}”。历史课堂记录会保留，下节课建议按新阶段生成。`,
        confirmText: "确认切换",
        confirmColor: "#14645A",
        success: (modalResult) => {
          if (modalResult.confirm) this.saveStage(target.stageId, "学习阶段已更新");
        },
      });
    },

    confirmNextStage() {
      const plan = this.data.plan;
      if (this.data.saving || !plan || !plan.canAdvance) return;
      wx.showModal({
        title: "进入下一阶段",
        content: `确定进入“${plan.nextStageLabel}”吗？`,
        confirmText: "确认进入",
        confirmColor: "#14645A",
        success: (modalResult) => {
          if (modalResult.confirm) this.saveStage(plan.nextStageId, "已进入下一阶段");
        },
      });
    },

    saveStage(stageId, successMessage) {
      this.setData({ saving: true });
      wx.showLoading({ title: "保存中" });
      callCloud({
        type: "updateStudentLearningPlan",
        data: {
          studentId: this.data.studentId,
          currentStageId: stageId,
          teacherPinnedSkillIds: [],
          confirmStageChange: true,
        },
      }).then((res) => {
        const result = res.result || {};
        if (!result.success) throw new Error(result.message || "保存失败，请再试一次");
        wx.showToast({ title: successMessage, icon: "none" });
        this.triggerEvent("updated");
      }).catch((err) => {
        console.error(err);
        wx.showToast({ title: err.message || "保存失败，请再试一次", icon: "none" });
      }).finally(() => {
        wx.hideLoading();
        this.setData({ saving: false });
      });
    },
  },
});
