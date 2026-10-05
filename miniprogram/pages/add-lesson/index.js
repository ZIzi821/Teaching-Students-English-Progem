const {
  LESSON_TEMPLATE_OPTIONS,
  findTemplate,
  inferLessonTemplateKey,
} = require("../../utils/lessonTemplates");
const { KET_SPEAKING_TASKS } = require("../../utils/ketSpeakingTasks");
const { KET_MOCK_SETS } = require("../../utils/ketMockSets");

const BASIC_RECORDING_TASK_TYPE_OPTIONS = [
  { value: "manual", label: "独立朗读（不播放示范）" },
  { value: "follow_reading", label: "跟读（先听老师示范）" },
];
const KET_RECORDING_TASK_TYPE_OPTIONS = [
  ...BASIC_RECORDING_TASK_TYPE_OPTIONS,
  { value: "ket_official", label: "KET 官方样题" },
  { value: "ket_mock", label: "KET 全流程模拟" },
];
const FOLLOW_READING_MODE_OPTIONS = [
  { value: "automatic", label: "自动连续跟读" },
  { value: "manual", label: "手动逐条播放" },
];

const HOMEWORK_DUE_OPTIONS = [
  { value: -1, label: "暂不设置" },
  { value: 0, label: "当天截止" },
  { value: 1, label: "1 天后截止" },
  { value: 2, label: "2 天后截止" },
  { value: 3, label: "3 天后截止" },
  { value: 4, label: "4 天后截止" },
  { value: 5, label: "5 天后截止" },
  { value: 6, label: "6 天后截止" },
  { value: 7, label: "7 天后截止" },
];

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
    recordingRepeatOptions: [1, 2, 3, 4, 5],
    recordingPreparationOptions: [0, 3, 5, 10, 15],
    recordingRepeatIndex: 1,
    recordingPreparationIndex: 2,
    recordingTaskTypeOptions: BASIC_RECORDING_TASK_TYPE_OPTIONS,
    recordingTaskTypeIndex: 0,
    ketSpeakingTasks: KET_SPEAKING_TASKS,
    ketSpeakingTaskIndex: 0,
    selectedKetSpeakingTask: KET_SPEAKING_TASKS[0],
    ketMockSets: KET_MOCK_SETS,
    ketMockSetIndex: 0,
    selectedKetMockSet: KET_MOCK_SETS[0],
    ketWeeklyHint: "",
    homeworkDueOptions: HOMEWORK_DUE_OPTIONS,
    homeworkDueIndex: 8,
    lessonNoTip: "",
    previousLessonReference: null,
    showPreviousLessonReference: true,
    message: "",
    saving: false,
    followReadingModeOptions: FOLLOW_READING_MODE_OPTIONS,
    followReadingModeIndex: 0,
    followReadingGapOptions: [1, 2, 3],
    followReadingGapIndex: 1,
    followReadingResponseOptions: [3, 5, 8, 10, 15, 20],
    followReadingResponseIndex: 2,
    showLessonRecord: false,
    form: {
      title: "",
      subject: "英语",
      lessonDate: "",
      lessonNo: "",
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
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "listStudents",
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            message: result.message || "只有朱老师可以添加课程",
          });
          return;
        }
        this.applyStudents(result.data || []);
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "服务暂时不可用，请稍后再试",
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
      this.applyLessonTemplate(students[studentIndex]);
      this.updateLessonNoSuggestion();
      this.checkKetWeeklyStatus();
    });
  },

  onStudentChange(e) {
    const studentIndex = Number(e.detail.value);
    const student = this.data.students[studentIndex];
    this.setData({
      studentIndex,
      selectedStudentName: student ? student.name : "请选择学生",
      previousLessonReference: null,
    }, () => {
      this.applyLessonTemplate(student);
      this.updateLessonNoSuggestion();
      this.checkKetWeeklyStatus();
    });
  },

  applyLessonTemplate(student, explicitKey) {
    const key = explicitKey || inferLessonTemplateKey(student);
    const index = Math.max(0, LESSON_TEMPLATE_OPTIONS.findIndex((item) => item.key === key));
    const recordingTaskTypeOptions = key === "molly_oral_ket"
      ? KET_RECORDING_TASK_TYPE_OPTIONS
      : BASIC_RECORDING_TASK_TYPE_OPTIONS;
    const currentType = this.data.form.recordingTaskType;
    const safeType = recordingTaskTypeOptions.some((item) => item.value === currentType)
      ? currentType
      : "manual";
    const updates = {
      lessonTemplateIndex: index,
      lessonTemplate: findTemplate(key),
      "form.lessonTemplateKey": key,
      recordingTaskTypeOptions,
      recordingTaskTypeIndex: Math.max(0, recordingTaskTypeOptions.findIndex((item) => item.value === safeType)),
      "form.recordingTaskType": safeType,
    };
    if (safeType === "manual" && currentType !== "manual") {
      Object.assign(updates, {
        ketWeeklyHint: "",
        "form.ketSpeakingTaskId": "",
        "form.ketMockSetId": "",
      });
    }
    this.setData(updates);
  },

  onLessonTemplateChange(e) {
    const option = LESSON_TEMPLATE_OPTIONS[Number(e.detail.value)] || LESSON_TEMPLATE_OPTIONS[0];
    this.applyLessonTemplate(null, option.key);
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

  updateLessonNoSuggestion() {
    const student = this.data.students[this.data.studentIndex];
    this.lessonNoManuallyChanged = false;
    if (!student) {
      this.setData({
        lessonNoTip: "",
        previousLessonReference: null,
        "form.lessonNo": "",
      });
      return;
    }

    const requestId = (this.lessonNoSuggestionRequestId || 0) + 1;
    this.lessonNoSuggestionRequestId = requestId;
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getNextLessonNo",
          data: {
            studentId: student._id,
          },
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
        const updates = {
          lessonNoTip,
          previousLessonReference: result.previousLesson || null,
          showPreviousLessonReference: Boolean(result.previousLesson),
        };
        if (!this.lessonNoManuallyChanged) {
          updates["form.lessonNo"] = String(nextLessonNo);
        }
        this.setData(updates);
      })
      .catch((err) => {
        if (requestId !== this.lessonNoSuggestionRequestId) return;
        console.error(err);
        this.setData({
          lessonNoTip: "",
          message: "服务暂时不可用，请稍后再试",
        });
      });
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

  onRecordingTaskChange(e) {
    const enabled = Boolean(e.detail.value);
    const updates = { "form.recordingTaskEnabled": enabled };
    if (enabled && Number(this.data.form.homeworkDueDays) < 0) {
      updates.homeworkDueIndex = 8;
      updates["form.homeworkDueDays"] = 7;
    }
    this.setData(updates);
  },

  onHomeworkDueChange(e) {
    const index = Number(e.detail.value);
    const option = HOMEWORK_DUE_OPTIONS[index] || HOMEWORK_DUE_OPTIONS[8];
    this.setData({
      homeworkDueIndex: index,
      "form.homeworkDueDays": option.value,
    });
  },

  onRecordingTaskTypeChange(e) {
    const index = Number(e.detail.value);
    const option = this.data.recordingTaskTypeOptions[index] || this.data.recordingTaskTypeOptions[0];
    this.setData({
      recordingTaskTypeIndex: index,
      "form.recordingTaskType": option.value,
    }, () => {
      if (option.value === "ket_official") this.applyKetSpeakingTask(this.data.ketSpeakingTaskIndex);
      else if (option.value === "ket_mock") this.applyKetMockSet(this.data.ketMockSetIndex);
      else this.setData({ "form.ketSpeakingTaskId": "", "form.ketMockSetId": "", ketWeeklyHint: "" });
    });
  },

  onKetSpeakingTaskChange(e) {
    this.applyKetSpeakingTask(Number(e.detail.value));
  },

  applyKetSpeakingTask(index) {
    const safeIndex = Math.max(0, Math.min(KET_SPEAKING_TASKS.length - 1, Number(index) || 0));
    const task = KET_SPEAKING_TASKS[safeIndex];
    const preparationIndex = Math.max(0, this.data.recordingPreparationOptions.indexOf(task.preparationSeconds));
    this.setData({
      ketSpeakingTaskIndex: safeIndex,
      selectedKetSpeakingTask: task,
      recordingRepeatIndex: 0,
      recordingPreparationIndex: preparationIndex,
      "form.ketSpeakingTaskId": task.id,
      "form.ketMockSetId": "",
      "form.recordingPrompt": task.prompt,
      "form.recordingRepeatCount": 1,
      "form.recordingPreparationSeconds": task.preparationSeconds,
      "form.ketSkill": `${task.part} · ${task.topic}`,
    }, () => this.checkKetWeeklyStatus());
  },

  onKetMockSetChange(e) {
    this.applyKetMockSet(Number(e.detail.value));
  },

  applyKetMockSet(index) {
    const safeIndex = Math.max(0, Math.min(KET_MOCK_SETS.length - 1, Number(index) || 0));
    const set = KET_MOCK_SETS[safeIndex];
    this.setData({
      ketMockSetIndex: safeIndex,
      selectedKetMockSet: set,
      recordingRepeatIndex: 0,
      recordingPreparationIndex: 0,
      "form.ketSpeakingTaskId": "",
      "form.ketMockSetId": set.id,
      "form.recordingPrompt": `${set.title}：按完整考试流程完成 Part 1 与 Part 2。`,
      "form.recordingRepeatCount": 1,
      "form.recordingPreparationSeconds": 0,
      "form.ketSkill": `Speaking Part 1 + Part 2 · ${set.topic}`,
    }, () => this.checkKetWeeklyStatus());
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
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getKetWeeklyStatus",
        data: { studentId: student._id, lessonDate: this.data.form.lessonDate },
      },
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

  copyKetSource() {
    const task = this.data.selectedKetSpeakingTask;
    if (!task || !task.sourceUrl) return;
    wx.setClipboardData({ data: task.sourceUrl });
  },

  onRecordingRepeatChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      recordingRepeatIndex: index,
      "form.recordingRepeatCount": this.data.recordingRepeatOptions[index],
    });
  },

  onRecordingPreparationChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      recordingPreparationIndex: index,
      "form.recordingPreparationSeconds": this.data.recordingPreparationOptions[index],
    });
  },

  onFollowReadingModeChange(e) {
    const index = Number(e.detail.value);
    const option = FOLLOW_READING_MODE_OPTIONS[index] || FOLLOW_READING_MODE_OPTIONS[0];
    this.setData({
      followReadingModeIndex: index,
      "form.followReadingMode": option.value,
    });
  },

  onFollowReadingGapChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      followReadingGapIndex: index,
      "form.followReadingGapSeconds": this.data.followReadingGapOptions[index],
    });
  },

  onFollowReadingResponseChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      followReadingResponseIndex: index,
      "form.followReadingResponseSeconds": this.data.followReadingResponseOptions[index],
    });
  },

  submitLesson() {
    if (this.data.saving) return;
    const student = this.data.students[this.data.studentIndex];
    const form = this.data.form;
    if (!student || !form.title || !form.lessonDate || !form.lessonNo) {
      wx.showToast({
        title: "请填写课程信息",
        icon: "none",
      });
      return;
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
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中", mask: true });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "addLesson",
          data: {
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
            learningObservations: [],
            paperFileIds: [],
            requestId: this.lessonRequestId,
          },
        },
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
        this.setData({
          message: "服务暂时不可用，请稍后再试",
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ saving: false });
      });
  },
});
