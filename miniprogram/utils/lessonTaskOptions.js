const BASIC_RECORDING_TASK_TYPE_OPTIONS = [
  { value: "manual", label: "独立朗读（学生直接开始）" },
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
  { value: -1, label: "以后设置" },
  { value: 0, label: "当天截止" },
  { value: 1, label: "1 天后截止" },
  { value: 2, label: "2 天后截止" },
  { value: 3, label: "3 天后截止" },
  { value: 4, label: "4 天后截止" },
  { value: 5, label: "5 天后截止" },
  { value: 6, label: "6 天后截止" },
  { value: 7, label: "7 天后截止" },
];
const RECORDING_REPEAT_OPTIONS = [1, 2, 3, 4, 5];
const RECORDING_PREPARATION_OPTIONS = [0, 3, 5, 10, 15];
const FOLLOW_READING_GAP_OPTIONS = [1, 2, 3];
const FOLLOW_READING_RESPONSE_OPTIONS = [3, 5, 8, 10, 15, 20];

const getRecordingTaskTypeOptions = (templateKey) => (
  templateKey === "molly_oral_ket" ? KET_RECORDING_TASK_TYPE_OPTIONS : BASIC_RECORDING_TASK_TYPE_OPTIONS
);

// 模板切换后，录音任务类型若不在新模板的可选范围内，回到独立朗读。
const getSafeRecordingTaskType = (templateKey, currentType) => (
  getRecordingTaskTypeOptions(templateKey).some((item) => item.value === currentType) ? currentType : "manual"
);

module.exports = {
  FOLLOW_READING_GAP_OPTIONS,
  FOLLOW_READING_MODE_OPTIONS,
  FOLLOW_READING_RESPONSE_OPTIONS,
  HOMEWORK_DUE_OPTIONS,
  RECORDING_PREPARATION_OPTIONS,
  RECORDING_REPEAT_OPTIONS,
  getRecordingTaskTypeOptions,
  getSafeRecordingTaskType,
};
