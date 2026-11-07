const {
  LESSON_TEMPLATE_OPTIONS,
  findTemplate,
  inferLessonTemplateKey,
} = require("../../utils/lessonTemplates");
const { getSafeRecordingTaskType } = require("../../utils/lessonTaskOptions");
const { buildNextLessonTitleSuggestion } = require("../../utils/lessonTitle");
const { usesLessonDurationMinutes } = require("../../utils/lessonDuration");
const { callCloud } = require("../../utils/cloud");

const LESSON_FOCUS_LABELS = {
  speaking: "口语表达",
  grammar: "语法运用",
  input: "听读与表达",
  ket: "KET 基础与复习",
  foundation: "字母、数字与书写",
  vocabulary: "主题词汇与听辨",
  phonics: "拼读与认词",
  oral: "句型口语",
  reading: "短阅读与衔接",
};

function formatDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return year + "-" + (month < 10 ? "0" + month : month) + "-" + (day < 10 ? "0" + day : day);
}

Page({
  data: {
    students: [],
    studentIndex: 0,
    selectedStudentName: "请选择学生",
    lessonTemplateOptions: LESSON_TEMPLATE_OPTIONS,
    lessonTemplateIndex: 0,
    lessonTemplate: findTemplate("general"),
    requiresLessonNo: true,
    showPostLessonRecord: true,
    showDurationMinutes: false,
    usesMinuteAccounting: false,
    ketWeeklyHint: "",
    lessonNoTip: "",
    lessonTitleSuggestion: "",
    previousLessonReference: null,
    showPreviousLessonReference: true,
    message: "",
    saving: false,
    showLessonRecord: false,
    learningPlanAvailable: false,
    learningStageLabel: "",
    learningFocusOptions: [{ value: "", label: "以后标记课程类型" }],
    learningFocusIndex: 0,
    suggestedSkillLabel: "",
    form: {
      title: "",
      subject: "英语",
      lessonDate: "",
      lessonNo: "",
      durationMinutes: "",
      institutionCourse: false,
      lessonTemplateKey: "general",
      reviewContent: "",
      taughtContent: "",
      masterySummary: "",
      oralTopic: "",
      targetExpression: "",
      independentOutput: "",
      correctionNotes: "",
      ketSkill: "",
      nextReview: "",
      homeworkTask: "",
      recordingTaskEnabled: false,
      homeworkDueDays: 7,
      recordingTaskType: "manual",
      recordingPrompt: "",
      recordingRepeatCount: 2,
      recordingPreparationSeconds: 5,
      followReadingMode: "automatic",
      followReadingGapSeconds: 2,
      followReadingResponseSeconds: 8,
      followReadingContent: "",
      ketSpeakingTaskId: "",
      ketMockSetId: "",
      lessonFocusType: "",
      skillTargetIds: [],
    },
  },

  onLoad(options) {
    this.preferredStudentId = options.studentId || "";
    this.setData({
      "form.lessonDate": formatDate(new Date()),
    });
    this.loadStudents();
  },

  loadStudents() {
    callCloud({
        type: "listStudents",
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            message: result.message || "请使用朱老师教师账号添加课程",
          });
          return;
        }
        this.applyStudents(result.data || []);
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "加载遇到问题，请稍后重试",
        });
      });
  },

  applyStudents(students) {
    let studentIndex = 0;
    if (this.preferredStudentId) {
      const foundIndex = students.findIndex((item) => item._id === this.preferredStudentId);
      studentIndex = foundIndex >= 0 ? foundIndex : 0;
    }
    this.setData({
      students,
      studentIndex,
      selectedStudentName: students[studentIndex] ? students[studentIndex].name : "请选择学生",
    }, () => {
      this.applyLessonTemplate(students[studentIndex], "", () => {
        this.updateLessonNoSuggestion();
        this.checkKetWeeklyStatus();
        this.loadLearningPlanSuggestion();
      });
    });
  },

  onStudentChange(e) {
    const studentIndex = Number(e.detail.value);
    const student = this.data.students[studentIndex];
    this.setData({
      studentIndex,
      selectedStudentName: student ? student.name : "请选择学生",
      lessonTitleSuggestion: "",
      previousLessonReference: null,
    }, () => {
      this.applyLessonTemplate(student, "", () => {
        this.updateLessonNoSuggestion();
        this.checkKetWeeklyStatus();
        this.loadLearningPlanSuggestion();
      });
    });
  },

  applyLessonTemplate(student, explicitKey, callback) {
    const activeStudent = student || this.data.students[this.data.studentIndex] || null;
    const key = explicitKey || inferLessonTemplateKey(activeStudent);
    const index = Math.max(0, LESSON_TEMPLATE_OPTIONS.findIndex((item) => item.key === key));
    const currentType = this.data.form.recordingTaskType;
    const safeType = getSafeRecordingTaskType(key, currentType);
    const showDurationMinutes = usesLessonDurationMinutes(activeStudent, key);
    const updates = {
      lessonTemplateIndex: index,
      lessonTemplate: findTemplate(key),
      "form.lessonTemplateKey": key,
      "form.recordingTaskType": safeType,
      requiresLessonNo: findTemplate(key).requiresLessonNo !== false,
      showPostLessonRecord: findTemplate(key).showPostLessonRecord !== false,
      usesMinuteAccounting: Boolean(activeStudent && activeStudent.progressUnit === "minute"),
      showDurationMinutes,
    };
    if (!showDurationMinutes) {
      updates["form.durationMinutes"] = "";
    } else if (key === "vocabulary_coaching") {
      updates["form.lessonNo"] = "";
      if (this.data.form.lessonTemplateKey !== "vocabulary_coaching") {
        updates["form.durationMinutes"] = "";
      }
    } else if (activeStudent && activeStudent.progressUnit === "minute" && !this.data.form.durationMinutes) {
      updates["form.durationMinutes"] = "60";
    }
    if (safeType === "manual" && currentType !== "manual") {
      Object.assign(updates, {
        ketWeeklyHint: "",
        "form.ketSpeakingTaskId": "",
        "form.ketMockSetId": "",
      });
    }
    this.setData(updates, callback);
  },

  onLessonTemplateChange(e) {
    const option = LESSON_TEMPLATE_OPTIONS[Number(e.detail.value)] || LESSON_TEMPLATE_OPTIONS[0];
    const student = this.data.students[this.data.studentIndex];
    this.applyLessonTemplate(student, option.key, () => {
      this.updateLessonNoSuggestion();
      this.checkKetWeeklyStatus();
      this.loadLearningPlanSuggestion();
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    if (field === "lessonNo") {
      this.lessonNoManuallyChanged = true;
    }
    this.setData({
      ["form." + field]: e.detail.value,
    });
  },

  loadLearningPlanSuggestion() {
    const student = this.data.students[this.data.studentIndex];
    const requestId = (this.learningPlanRequestId || 0) + 1;
    this.learningPlanRequestId = requestId;
    if (!student || inferLessonTemplateKey(student) !== this.data.form.lessonTemplateKey) {
      this.setData({
        learningPlanAvailable: false,
        learningStageLabel: "",
        learningFocusOptions: [{ value: "", label: "以后标记课程类型" }],
        learningFocusIndex: 0,
        suggestedSkillLabel: "",
        "form.lessonFocusType": "",
        "form.skillTargetIds": [],
      });
      return;
    }
    callCloud({
      type: "getStudentLearningRadar",
      data: { studentId: student._id },
    }).then((res) => {
      if (requestId !== this.learningPlanRequestId) return;
      const result = res.result || {};
      const radar = result.radar || {};
      if (!result.success || !radar.available) {
        this.setData({ learningPlanAvailable: false });
        return;
      }
      const focusValues = Array.from(new Set((radar.skills || []).map((skill) => skill.focusType).filter(Boolean)));
      const learningFocusOptions = [{ value: "", label: "以后标记课程类型" }]
        .concat(focusValues.map((value) => ({ value, label: LESSON_FOCUS_LABELS[value] || value })));
      const suggestedFocus = radar.prepSuggestion && radar.prepSuggestion.focusType || "";
      const learningFocusIndex = Math.max(0, learningFocusOptions.findIndex((item) => item.value === suggestedFocus));
      const suggestedSkillId = radar.prepSuggestion && radar.prepSuggestion.targetSkillId || "";
      this.setData({
        learningPlanAvailable: true,
        learningStageLabel: `${radar.currentStage.stageLabel} · ${radar.currentStage.stageTitle}`,
        learningFocusOptions,
        learningFocusIndex,
        suggestedSkillLabel: radar.prepSuggestion && radar.prepSuggestion.targetSkillLabel || "",
        "form.lessonFocusType": (learningFocusOptions[learningFocusIndex] || {}).value || "",
        "form.skillTargetIds": suggestedSkillId ? [suggestedSkillId] : [],
      });
    }).catch((err) => {
      console.error(err);
      if (requestId === this.learningPlanRequestId) this.setData({ learningPlanAvailable: false });
    });
  },

  onLearningFocusChange(e) {
    const index = Number(e.detail.value);
    const option = this.data.learningFocusOptions[index] || this.data.learningFocusOptions[0];
    this.setData({
      learningFocusIndex: index,
      "form.lessonFocusType": option.value || "",
    });
  },

  updateLessonNoSuggestion() {
    const student = this.data.students[this.data.studentIndex];
    this.lessonNoManuallyChanged = false;
    if (!student) {
      this.setData({
        lessonNoTip: "",
        lessonTitleSuggestion: "",
        previousLessonReference: null,
        "form.lessonNo": "",
      });
      return;
    }

    const requestId = (this.lessonNoSuggestionRequestId || 0) + 1;
    this.lessonNoSuggestionRequestId = requestId;
    callCloud({
        type: "getNextLessonNo",
        data: {
          studentId: student._id,
          lessonTemplateKey: this.data.form.lessonTemplateKey,
        },
      })
      .then((res) => {
        if (requestId !== this.lessonNoSuggestionRequestId) return;
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            lessonNoTip: "",
            message: result.message || "无法获取建议课次",
          });
          return;
        }

        const nextLessonNo = result.nextLessonNo || 1;
        const lessonNoTip = result.hasHistory
          ? `上次是第 ${result.maxLessonNo} 节，本次可填第 ${nextLessonNo} 节`
          : "还没有课程记录，可从第 1 节开始";
        const previousLessonReference = result.previousLesson || null;
        const updates = {
          lessonNoTip,
          lessonTitleSuggestion: buildNextLessonTitleSuggestion(
            previousLessonReference && previousLessonReference.title
          ) || (this.data.form.lessonTemplateKey === "vocabulary_coaching" ? "单词陪练-1" : ""),
          previousLessonReference,
          showPreviousLessonReference: Boolean(previousLessonReference),
        };
        if (!this.lessonNoManuallyChanged && this.data.requiresLessonNo) {
          updates["form.lessonNo"] = String(nextLessonNo);
        } else if (!this.data.requiresLessonNo) {
          updates["form.lessonNo"] = "";
        }
        this.setData(updates);
      })
      .catch((err) => {
        if (requestId !== this.lessonNoSuggestionRequestId) return;
        console.error(err);
        this.setData({
          lessonNoTip: "",
          lessonTitleSuggestion: "",
          message: "加载遇到问题，请稍后重试",
        });
      });
  },

  applyLessonTitleSuggestion(e) {
    const title = String(e.currentTarget.dataset.title || "").trim();
    if (title) this.setData({ "form.title": title });
  },

  onDateChange(e) {
    this.setData({
      "form.lessonDate": e.detail.value,
    }, () => this.checkKetWeeklyStatus());
  },

  onInstitutionCourseChange(e) {
    this.setData({ "form.institutionCourse": e.detail.value === true });
  },

  toggleLessonRecord() {
    this.setData({ showLessonRecord: !this.data.showLessonRecord });
  },

  togglePreviousLessonReference() {
    this.setData({ showPreviousLessonReference: !this.data.showPreviousLessonReference });
  },

  onTaskFieldsChange(e) {
    const { updates, checkKet } = e.detail;
    const data = {};
    Object.keys(updates || {}).forEach((key) => {
      data[`form.${key}`] = updates[key];
    });
    this.setData(data, () => {
      if (checkKet) this.checkKetWeeklyStatus();
    });
  },

  checkKetWeeklyStatus() {
    const student = this.data.students[this.data.studentIndex];
    if (
      !student
      || this.data.form.lessonTemplateKey !== "molly_oral_ket"
      || !["ket_official", "ket_mock"].includes(this.data.form.recordingTaskType)
      || !this.data.form.lessonDate
    ) {
      this.setData({ ketWeeklyHint: "" });
      return;
    }
    callCloud({
      type: "getKetWeeklyStatus",
      data: { studentId: student._id, lessonDate: this.data.form.lessonDate },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) return;
      this.setData({
        ketWeeklyHint: result.alreadyAssigned
          ? `本周已在 ${result.existingLesson.lessonDate} 的“${result.existingLesson.title}”布置过一次 KET 口语；仍可继续保存。`
          : "本周还没有布置 KET 口语任务。",
      });
    }).catch(() => {});
  },

  submitLesson() {
    if (this.data.saving) return;
    const student = this.data.students[this.data.studentIndex];
    const form = this.data.form;
    const durationApplies = usesLessonDurationMinutes(student, form.lessonTemplateKey);
    if (!student || !form.title || !form.lessonDate || (this.data.requiresLessonNo && !form.lessonNo)) {
      wx.showToast({
        title: "请填写课程信息",
        icon: "none",
      });
      return;
    }
    const durationRequired = form.lessonTemplateKey === "vocabulary_coaching"
      || (durationApplies && form.institutionCourse !== true);
    if (durationApplies && (durationRequired || String(form.durationMinutes || "").trim())) {
      const durationMinutes = Number(form.durationMinutes);
      if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 300 || durationMinutes % 5 !== 0) {
        wx.showToast({ title: "时长请按 5 分钟填写", icon: "none" });
        return;
      }
    }
    if (form.recordingTaskEnabled && form.recordingTaskType === "follow_reading") {
      const itemCount = String(form.followReadingContent || "").split(/\r?\n/).filter((line) => line.trim()).length;
      if (!itemCount) {
        wx.showToast({ title: "请填写跟读内容", icon: "none" });
        return;
      }
      if (itemCount > 20) {
        wx.showToast({ title: "跟读内容最多 20 条", icon: "none" });
        return;
      }
    }

    if (!this.lessonRequestId) {
      this.lessonRequestId = `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    const lessonPayload = {
      studentId: student._id,
      title: form.title,
      subject: form.subject,
      lessonDate: form.lessonDate,
      lessonNo: form.lessonNo,
      institutionCourse: form.institutionCourse === true,
      summary: form.masterySummary || form.independentOutput || form.taughtContent || form.oralTopic,
      lessonTemplateKey: form.lessonTemplateKey,
      reviewContent: form.reviewContent,
      taughtContent: form.taughtContent,
      masterySummary: form.masterySummary,
      oralTopic: form.oralTopic,
      targetExpression: form.targetExpression,
      independentOutput: form.independentOutput,
      correctionNotes: form.correctionNotes,
      ketSkill: form.ketSkill,
      nextReview: form.nextReview,
      homeworkTask: form.homeworkTask,
      recordingTaskEnabled: form.recordingTaskEnabled,
      homeworkDueDays: form.homeworkDueDays,
      recordingTaskType: form.recordingTaskType,
      recordingPrompt: form.recordingPrompt,
      recordingRepeatCount: form.recordingRepeatCount,
      recordingPreparationSeconds: form.recordingPreparationSeconds,
      followReadingMode: form.followReadingMode,
      followReadingGapSeconds: form.followReadingGapSeconds,
      followReadingResponseSeconds: form.followReadingResponseSeconds,
      followReadingContent: form.followReadingContent,
      ketSpeakingTaskId: form.ketSpeakingTaskId,
      ketMockSetId: form.ketMockSetId,
      lessonFocusType: form.lessonFocusType,
      skillTargetIds: form.skillTargetIds,
      learningObservations: [],
      paperFileIds: [],
      requestId: this.lessonRequestId,
    };
    if (durationApplies) lessonPayload.durationMinutes = form.durationMinutes;
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中", mask: true });
    callCloud({
        type: "addLesson",
        data: lessonPayload,
      })
      .then((res) => {
        const result = res.result || {};
        if (result.success === false) {
          this.setData({
            message: result.message || "保存失败",
          });
          wx.showToast({
            title: result.message || "保存失败",
            icon: "none",
          });
          return;
        }
        this.lessonRequestId = "";
        wx.showToast({ title: "已保存" });
        setTimeout(() => {
          wx.redirectTo({
            url: "/pages/lesson-detail/index?id=" + encodeURIComponent(result._id),
          });
        }, 500);
      })
      .catch((err) => {
        console.error(err);
        const message = (err && err.message) || "保存遇到问题，请稍后重试";
        this.setData({ message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ saving: false });
      });
  },
});
