const { KET_SPEAKING_TASKS } = require("../../utils/ketSpeakingTasks");
const { KET_MOCK_SETS } = require("../../utils/ketMockSets");
const {
  FOLLOW_READING_GAP_OPTIONS,
  FOLLOW_READING_MODE_OPTIONS,
  FOLLOW_READING_RESPONSE_OPTIONS,
  HOMEWORK_DUE_OPTIONS,
  RECORDING_PREPARATION_OPTIONS,
  RECORDING_REPEAT_OPTIONS,
  getRecordingTaskTypeOptions,
} = require("../../utils/lessonTaskOptions");

const indexOrZero = (index) => Math.max(0, index);

// 新建课程与编辑课程共用的“课后整理 + 课后任务 + 录音设置”表单。
// 组件只根据 form 推导选择器下标，所有修改通过 change 事件交给页面写回自己的表单。
Component({
  properties: {
    form: {
      type: Object,
      value: {},
    },
    mode: {
      type: String,
      value: "create",
    },
    recordingPlaceholder: {
      type: String,
      value: "",
    },
    ketWeeklyHint: {
      type: String,
      value: "",
    },
  },

  data: {
    homeworkDueOptions: HOMEWORK_DUE_OPTIONS,
    ketSpeakingTasks: KET_SPEAKING_TASKS,
    ketMockSets: KET_MOCK_SETS,
    followReadingModeOptions: FOLLOW_READING_MODE_OPTIONS,
    followReadingGapOptions: FOLLOW_READING_GAP_OPTIONS,
    followReadingResponseOptions: FOLLOW_READING_RESPONSE_OPTIONS,
    recordingRepeatOptions: RECORDING_REPEAT_OPTIONS,
    recordingPreparationOptions: RECORDING_PREPARATION_OPTIONS,
    recordingTaskTypeOptions: getRecordingTaskTypeOptions(""),
    recordingTaskTypeIndex: 0,
    homeworkDueIndex: 0,
    ketSpeakingTaskIndex: 0,
    selectedKetSpeakingTask: KET_SPEAKING_TASKS[0],
    ketMockSetIndex: 0,
    selectedKetMockSet: KET_MOCK_SETS[0],
    followReadingModeIndex: 0,
    followReadingGapIndex: 0,
    followReadingResponseIndex: 0,
    recordingRepeatIndex: 0,
    recordingPreparationIndex: 0,
  },

  observers: {
    form(form) {
      const source = form || {};
      const recordingTaskTypeOptions = getRecordingTaskTypeOptions(source.lessonTemplateKey);
      const ketSpeakingTaskIndex = indexOrZero(KET_SPEAKING_TASKS.findIndex((item) => item.id === source.ketSpeakingTaskId));
      const ketMockSetIndex = indexOrZero(KET_MOCK_SETS.findIndex((item) => item.id === source.ketMockSetId));
      this.setData({
        recordingTaskTypeOptions,
        recordingTaskTypeIndex: indexOrZero(recordingTaskTypeOptions.findIndex((item) => item.value === source.recordingTaskType)),
        homeworkDueIndex: indexOrZero(HOMEWORK_DUE_OPTIONS.findIndex((item) => item.value === Number(source.homeworkDueDays))),
        ketSpeakingTaskIndex,
        selectedKetSpeakingTask: KET_SPEAKING_TASKS[ketSpeakingTaskIndex],
        ketMockSetIndex,
        selectedKetMockSet: KET_MOCK_SETS[ketMockSetIndex],
        followReadingModeIndex: indexOrZero(FOLLOW_READING_MODE_OPTIONS.findIndex((item) => item.value === source.followReadingMode)),
        followReadingGapIndex: indexOrZero(FOLLOW_READING_GAP_OPTIONS.indexOf(Number(source.followReadingGapSeconds))),
        followReadingResponseIndex: indexOrZero(FOLLOW_READING_RESPONSE_OPTIONS.indexOf(Number(source.followReadingResponseSeconds))),
        recordingRepeatIndex: indexOrZero(RECORDING_REPEAT_OPTIONS.indexOf(Number(source.recordingRepeatCount))),
        recordingPreparationIndex: indexOrZero(RECORDING_PREPARATION_OPTIONS.indexOf(Number(source.recordingPreparationSeconds))),
      });
    },
  },

  methods: {
    emit(updates, checkKet) {
      this.triggerEvent("change", { updates, checkKet: checkKet === true });
    },

    onInput(e) {
      this.emit({ [e.currentTarget.dataset.field]: e.detail.value });
    },

    onRecordingTaskChange(e) {
      const enabled = Boolean(e.detail.value);
      const updates = { recordingTaskEnabled: enabled };
      if (enabled && Number(this.data.form.homeworkDueDays) < 0) updates.homeworkDueDays = 7;
      this.emit(updates);
    },

    onHomeworkDueChange(e) {
      const option = HOMEWORK_DUE_OPTIONS[Number(e.detail.value)] || HOMEWORK_DUE_OPTIONS[0];
      this.emit({ homeworkDueDays: option.value });
    },

    onRecordingTaskTypeChange(e) {
      const options = this.data.recordingTaskTypeOptions;
      const option = options[Number(e.detail.value)] || options[0];
      if (option.value === "ket_official") {
        this.emit(Object.assign({ recordingTaskType: option.value }, this.buildKetSpeakingTaskUpdates(this.data.ketSpeakingTaskIndex)), true);
      } else if (option.value === "ket_mock") {
        this.emit(Object.assign({ recordingTaskType: option.value }, this.buildKetMockSetUpdates(this.data.ketMockSetIndex)), true);
      } else {
        this.emit({ recordingTaskType: option.value, ketSpeakingTaskId: "", ketMockSetId: "" }, true);
      }
    },

    onKetSpeakingTaskChange(e) {
      this.emit(this.buildKetSpeakingTaskUpdates(Number(e.detail.value)), true);
    },

    buildKetSpeakingTaskUpdates(index) {
      const task = KET_SPEAKING_TASKS[Math.max(0, Math.min(KET_SPEAKING_TASKS.length - 1, Number(index) || 0))];
      return {
        ketSpeakingTaskId: task.id,
        ketMockSetId: "",
        recordingPrompt: task.prompt,
        recordingRepeatCount: 1,
        recordingPreparationSeconds: task.preparationSeconds,
        ketSkill: `${task.part} · ${task.topic}`,
      };
    },

    onKetMockSetChange(e) {
      this.emit(this.buildKetMockSetUpdates(Number(e.detail.value)), true);
    },

    buildKetMockSetUpdates(index) {
      const set = KET_MOCK_SETS[Math.max(0, Math.min(KET_MOCK_SETS.length - 1, Number(index) || 0))];
      return {
        ketSpeakingTaskId: "",
        ketMockSetId: set.id,
        recordingPrompt: `${set.title}：按完整考试流程完成 Part 1 与 Part 2。`,
        recordingRepeatCount: 1,
        recordingPreparationSeconds: 0,
        ketSkill: `Speaking Part 1 + Part 2 · ${set.topic}`,
      };
    },

    copyKetSource() {
      const task = this.data.selectedKetSpeakingTask;
      if (task && task.sourceUrl) wx.setClipboardData({ data: task.sourceUrl });
    },

    onRecordingRepeatChange(e) {
      this.emit({ recordingRepeatCount: RECORDING_REPEAT_OPTIONS[Number(e.detail.value)] });
    },

    onRecordingPreparationChange(e) {
      this.emit({ recordingPreparationSeconds: RECORDING_PREPARATION_OPTIONS[Number(e.detail.value)] });
    },

    onFollowReadingModeChange(e) {
      const option = FOLLOW_READING_MODE_OPTIONS[Number(e.detail.value)] || FOLLOW_READING_MODE_OPTIONS[0];
      this.emit({ followReadingMode: option.value });
    },

    onFollowReadingGapChange(e) {
      this.emit({ followReadingGapSeconds: FOLLOW_READING_GAP_OPTIONS[Number(e.detail.value)] });
    },

    onFollowReadingResponseChange(e) {
      this.emit({ followReadingResponseSeconds: FOLLOW_READING_RESPONSE_OPTIONS[Number(e.detail.value)] });
    },
  },
});
