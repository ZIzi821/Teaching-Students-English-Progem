const {
  LESSON_TEMPLATE_OPTIONS,
  findTemplate,
} = require("../../utils/lessonTemplates");
const { KET_SPEAKING_TASKS, findKetSpeakingTask } = require("../../utils/ketSpeakingTasks");
const { KET_MOCK_SETS, findKetMockSet } = require("../../utils/ketMockSets");

const HOMEWORK_REMINDER_TEMPLATE_ID = "Ih535VWa2FCNlCCvZUYFJOt8fOA3EY3l7Pxoa9rszYA";
const MATERIAL_PREFERENCES_KEY = "lessonMaterialPreferencesV2";
const LOCAL_MATERIAL_ORIGIN = "http://127.0.0.1:3211";
const LOCAL_MATERIAL_TOKEN = "fd5b0c8301b641b5b28651b0d6b414ee637f0c4e6a5fb984";
const LOCAL_MATERIAL_PROTOCOL_VERSION = 1;

const OBSERVATION_STATUSES = ["独立完成", "提示后完成", "暂未掌握"];
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
const RECORDING_FEEDBACK_OPTIONS = [
  { label: "发音准确", statuses: ["朗读正确"] },
  { label: "语速自然", statuses: ["朗读正确"] },
  { label: "声音清楚", statuses: ["朗读正确"] },
  { label: "比上次进步", statuses: ["朗读正确"] },
  { label: "注意尾音", statuses: ["朗读正确", "需要重录"] },
  { label: "注意单词重音", statuses: ["朗读正确", "需要重录"] },
  { label: "语速再慢一点", statuses: ["朗读正确", "需要重录"] },
  { label: "句子读完整", statuses: ["需要重录"] },
];
const MAX_RECORDING_FEEDBACK_TAGS = 5;
const MATERIAL_PURPOSES = [
  { label: "学生参考", value: "student_reference", hint: "学生端可以打开" },
  { label: "听力／跟读", value: "listening", hint: "听力或示范音频" },
  { label: "学校试卷", value: "school_exam", hint: "保留学校原卷" },
  { label: "板书／课堂照片", value: "board_photo", hint: "课堂照片或板书" },
  { label: "仅教师留存", value: "teacher_only", hint: "学生端不会显示" },
];

const MATERIAL_TYPE_LABELS = { pdf: "PDF", document: "课件", image: "图片", canva: "图片", audio: "音频" };
const DOCUMENT_EXTENSIONS = ["ppt", "pptx", "doc", "docx", "xls", "xlsx"];

const getFileExtension = (name) => {
  const matched = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return matched ? matched[1] : "";
};

const detectMaterialType = (fileName) => {
  const extension = getFileExtension(fileName);
  if (extension === "pdf") return "pdf";
  if (DOCUMENT_EXTENSIONS.indexOf(extension) >= 0) return "document";
  if (["mp3", "m4a", "wav", "aac"].indexOf(extension) >= 0) return "audio";
  if (["jpg", "jpeg", "png", "webp", "gif"].indexOf(extension) >= 0) return "image";
  return "";
};

const looksHashedFileName = (fileName) => {
  const baseName = String(fileName || "").replace(/\.[^.]+$/, "");
  return /^[a-f0-9_-]{24,}$/i.test(baseName) || /^wxfile_[a-z0-9_-]{16,}$/i.test(baseName);
};

const stripFileExtension = (fileName) => String(fileName || "").replace(/\.[^.]+$/, "");

const padMaterialIndex = (value) => String(Math.max(1, Number(value) || 1)).padStart(2, "0");

const formatDuration = (duration) => {
  const totalSeconds = Math.max(0, Math.round((Number(duration) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}分${seconds ? seconds + "秒" : ""}` : `${seconds}秒`;
};

const formatDateTime = (timestamp) => {
  const value = Number(timestamp) || 0;
  if (!value) return "";
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const buildRecordingFeedbackOptions = (status, selectedTags) => RECORDING_FEEDBACK_OPTIONS
  .filter((item) => item.statuses.includes(status))
  .map((item) => Object.assign({}, item, {
    selected: (selectedTags || []).includes(item.label),
  }));

Page({
  data: {
    lessonId: "",
    previewStudentId: "",
    mode: "",
    role: "",
    isTeacher: false,
    isTeacherPreview: false,
    isStudent: false,
    mistakeLearningEnabled: true,
    lesson: null,
    student: null,
    materialGroups: [],
    hasPapers: false,
    materialCount: 0,
    mistakes: [],
    submissions: [],
    ketMockSessions: [],
    ketMockLatestSession: null,
    message: "",
    deletingLesson: false,
    savingWorkspace: false,
    showWorkspaceEditor: false,
    previousLessonReference: null,
    showPreviousLessonReference: true,
    showMaterialUploader: false,
    showMaterialAdvanced: false,
    uploadingMaterial: false,
    readingLocalMaterials: false,
    isDevTools: false,
    materialPurposes: MATERIAL_PURPOSES,
    selectedPurpose: "student_reference",
    selectedPurposeLabel: "学生参考",
    paperForm: { paperTitle: "", term: "" },
    lessonTemplateOptions: LESSON_TEMPLATE_OPTIONS,
    lessonTemplateIndex: 0,
    lessonTemplate: findTemplate("general"),
    workspaceForm: {
      title: "",
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
      homeworkDueDays: -1,
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
      learningObservations: [],
    },
    observationStatuses: OBSERVATION_STATUSES,
    recordingRepeatOptions: [1, 2, 3, 4, 5],
    recordingPreparationOptions: [0, 3, 5, 10, 15],
    recordingRepeatIndex: 1,
    recordingPreparationIndex: 2,
    recordingTaskTypeOptions: BASIC_RECORDING_TASK_TYPE_OPTIONS,
    recordingTaskTypeIndex: 0,
    followReadingModeOptions: FOLLOW_READING_MODE_OPTIONS,
    followReadingModeIndex: 0,
    followReadingGapOptions: [1, 2, 3],
    followReadingGapIndex: 1,
    followReadingResponseOptions: [3, 5, 8, 10, 15, 20],
    followReadingResponseIndex: 2,
    homeworkDueOptions: HOMEWORK_DUE_OPTIONS,
    homeworkDueIndex: 0,
    ketSpeakingTasks: KET_SPEAKING_TASKS,
    ketSpeakingTaskIndex: 0,
    selectedKetSpeakingTask: KET_SPEAKING_TASKS[0],
    ketMockSets: KET_MOCK_SETS,
    ketMockSetIndex: 0,
    selectedKetMockSet: KET_MOCK_SETS[0],
    ketWeeklyHint: "",
    hasLegacySubmissions: false,
    organizingRecordings: false,
    deletingSubmissionId: "",
    showRecordingReviewEditor: false,
    savingRecordingReview: false,
    recordingFeedbackOptions: buildRecordingFeedbackOptions("朗读正确", []),
    recordingReviewEditor: {
      submissionId: "",
      displayAttemptNo: 0,
      durationLabel: "",
      status: "朗读正确",
      selectedTags: [],
      note: "",
    },
    reviewingHomeworkStatus: "",
    subscribingHomeworkReminder: false,
    playingSubmissionId: "",
    playingMaterialId: "",
  },

  onLoad(options) {
    let isDevTools = false;
    try {
      isDevTools = wx.getSystemInfoSync().platform === "devtools";
    } catch (_) {}
    this.setData({
      lessonId: options.id || "",
      previewStudentId: options.previewStudentId || "",
      mode: options.mode || "",
      isDevTools,
    });
    this.focusSection = ["recordings", "homework", "homework-review"].includes(options.focus)
      ? options.focus
      : "";
    this.restoreMaterialPreferences();
    this.loadLesson();
  },

  onShow() {
    if (this.hasShown && this.data.lessonId) this.loadLesson();
    this.hasShown = true;
  },

  onUnload() {
    this.isUnloading = true;
    if (this.audioStartTimer) clearTimeout(this.audioStartTimer);
    if (this.audioContext) this.audioContext.destroy();
  },

  restoreMaterialPreferences() {
    const preferences = wx.getStorageSync(MATERIAL_PREFERENCES_KEY) || {};
    const purpose = MATERIAL_PURPOSES.some((item) => item.value === preferences.purpose)
      ? preferences.purpose
      : "student_reference";
    const found = MATERIAL_PURPOSES.find((item) => item.value === purpose);
    this.setData({
      selectedPurpose: purpose,
      selectedPurposeLabel: found.label,
      "paperForm.term": preferences.term || "",
    });
  },

  rememberMaterialPreferences() {
    wx.setStorageSync(MATERIAL_PREFERENCES_KEY, {
      purpose: this.data.selectedPurpose,
      term: this.data.paperForm.term,
    });
  },

  loadLesson() {
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getLessonDetail",
        data: {
          lessonId: this.data.lessonId,
          previewStudentId: this.data.previewStudentId,
          mode: this.data.mode,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) {
        this.setData({ message: result.message || "无权查看该课程" });
        return;
      }
      const isTeacherPreview = result.role === "teacher" && this.data.mode === "teacherPreview";
      const isTeacher = result.role === "teacher" && !isTeacherPreview;
      const lesson = this.prepareLesson(result.lesson || {});
      const papers = this.preparePapers(result.papers || []);
      const lessonTemplate = findTemplate(lesson.lessonTemplateKey);
      const lessonTemplateIndex = Math.max(0, LESSON_TEMPLATE_OPTIONS.findIndex((item) => item.key === lessonTemplate.key));
      const submissions = this.prepareSubmissions(result.submissions || []);
      const recordingRepeatIndex = Math.max(0, this.data.recordingRepeatOptions.indexOf(lesson.recordingRepeatCount));
      const recordingPreparationIndex = Math.max(0, this.data.recordingPreparationOptions.indexOf(lesson.recordingPreparationSeconds));
      const recordingTaskTypeOptions = lesson.lessonTemplateKey === "molly_oral_ket"
        ? KET_RECORDING_TASK_TYPE_OPTIONS
        : BASIC_RECORDING_TASK_TYPE_OPTIONS;
      const recordingTaskTypeIndex = Math.max(0, recordingTaskTypeOptions.findIndex((item) => item.value === lesson.recordingTaskType));
      const followReadingModeIndex = Math.max(0, FOLLOW_READING_MODE_OPTIONS.findIndex((item) => item.value === lesson.followReadingMode));
      const followReadingGapIndex = Math.max(0, this.data.followReadingGapOptions.indexOf(lesson.followReadingGapSeconds));
      const followReadingResponseIndex = Math.max(0, this.data.followReadingResponseOptions.indexOf(lesson.followReadingResponseSeconds));
      const homeworkDueIndex = Math.max(0, HOMEWORK_DUE_OPTIONS.findIndex((item) => (
        item.value === Number(lesson.homeworkDueDays)
      )));
      const selectedKetSpeakingTask = findKetSpeakingTask(lesson.ketSpeakingTaskId) || KET_SPEAKING_TASKS[0];
      const ketSpeakingTaskIndex = Math.max(0, KET_SPEAKING_TASKS.findIndex((item) => item.id === selectedKetSpeakingTask.id));
      const selectedKetMockSet = findKetMockSet(lesson.ketMockSetId) || KET_MOCK_SETS[0];
      const ketMockSetIndex = Math.max(0, KET_MOCK_SETS.findIndex((item) => item.id === selectedKetMockSet.id));
      this.setData({
        role: result.role,
        isTeacher,
        isTeacherPreview,
        isStudent: result.role === "student",
        mistakeLearningEnabled: result.mistakeLearningEnabled !== false,
        lesson,
        previousLessonReference: result.previousLesson || null,
        showPreviousLessonReference: Boolean(result.previousLesson),
        student: result.student || null,
        materialGroups: this.groupPapers(papers),
        hasPapers: papers.length > 0,
        materialCount: papers.length,
        mistakes: this.prepareMistakes(result.mistakes || []),
        submissions,
        hasLegacySubmissions: submissions.some((item) => item.organizedVersion !== 2),
        workspaceForm: this.createWorkspaceForm(lesson),
        lessonTemplate,
        lessonTemplateIndex,
        recordingRepeatIndex,
        recordingPreparationIndex,
        recordingTaskTypeOptions,
        recordingTaskTypeIndex,
        followReadingModeIndex,
        followReadingGapIndex,
        followReadingResponseIndex,
        homeworkDueIndex,
        selectedKetSpeakingTask,
        ketSpeakingTaskIndex,
        selectedKetMockSet,
        ketMockSetIndex,
        message: "",
      }, () => {
        if (lesson.recordingTaskType === "ket_mock") this.loadKetMockSessions();
        else this.setData({ ketMockSessions: [], ketMockLatestSession: null });
        this.scrollToFocusedSection();
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ message: "服务暂时不可用，请稍后再试" });
    });
  },

  scrollToFocusedSection() {
    const focusSection = this.focusSection;
    if (!focusSection) return;
    this.focusSection = "";
    setTimeout(() => {
      const selectors = {
        recordings: "#recording-submissions",
        homework: "#homework-section",
        "homework-review": "#teacher-homework-review",
      };
      wx.pageScrollTo({
        selector: selectors[focusSection],
        duration: 280,
      });
    }, 80);
  },

  prepareLesson(lesson) {
    const hasStructuredRecord = Boolean(
      lesson.reviewContent
      || lesson.taughtContent
      || lesson.masterySummary
      || lesson.oralTopic
      || lesson.targetExpression
      || lesson.independentOutput
      || lesson.correctionNotes
      || lesson.ketSkill
      || lesson.nextReview
      || lesson.homeworkTask
      || (lesson.learningObservations && lesson.learningObservations.length)
    );
    const lessonTemplate = findTemplate(lesson.lessonTemplateKey);
    return Object.assign({}, lesson, {
      lessonTemplateKey: lessonTemplate.key,
      lessonTemplateLabel: lessonTemplate.label,
      reviewContent: lesson.reviewContent || "",
      taughtContent: lesson.taughtContent || "",
      masterySummary: lesson.masterySummary || (!hasStructuredRecord ? lesson.summary || "" : ""),
      oralTopic: lesson.oralTopic || "",
      targetExpression: lesson.targetExpression || "",
      independentOutput: lesson.independentOutput || "",
      correctionNotes: lesson.correctionNotes || "",
      ketSkill: lesson.ketSkill || "",
      nextReview: lesson.nextReview || "",
      homeworkTask: lesson.homeworkTask || "",
      recordingTaskEnabled: lesson.recordingTaskEnabled === true,
      homeworkDueDays: Number.isInteger(Number(lesson.homeworkDueDays))
        ? Number(lesson.homeworkDueDays)
        : -1,
      recordingTaskType: ["follow_reading", "ket_official", "ket_mock"].includes(lesson.recordingTaskType)
        ? lesson.recordingTaskType
        : "manual",
      recordingPrompt: lesson.recordingPrompt || "",
      recordingRepeatCount: Math.max(1, Math.min(5, Number(lesson.recordingRepeatCount) || 2)),
      recordingPreparationSeconds: [0, 3, 5, 10, 15].includes(Number(lesson.recordingPreparationSeconds))
        ? Number(lesson.recordingPreparationSeconds)
        : 5,
      recordingSuggestedSeconds: Math.max(0, Number(lesson.recordingSuggestedSeconds) || 0),
      followReadingMode: lesson.followReadingMode === "manual" ? "manual" : "automatic",
      followReadingGapSeconds: [1, 2, 3].includes(Number(lesson.followReadingGapSeconds))
        ? Number(lesson.followReadingGapSeconds)
        : 2,
      followReadingResponseSeconds: [3, 5, 8, 10, 15, 20].includes(Number(lesson.followReadingResponseSeconds))
        ? Number(lesson.followReadingResponseSeconds)
        : 8,
      followReadingItems: Array.isArray(lesson.followReadingItems) ? lesson.followReadingItems : [],
      followReadingContent: (Array.isArray(lesson.followReadingItems) ? lesson.followReadingItems : [])
        .map((item) => item.text || "")
        .filter(Boolean)
        .join("\n"),
      followReadingAudioReadyCount: Math.max(0, Number(lesson.followReadingAudioReadyCount) || 0),
      followReadingAudioTotalCount: Math.max(0, Number(lesson.followReadingAudioTotalCount) || 0),
      followReadingAudioComplete: lesson.followReadingAudioComplete === true,
      ketSpeakingTaskId: lesson.ketSpeakingTaskId || "",
      ketSpeakingTask: lesson.ketSpeakingTask || findKetSpeakingTask(lesson.ketSpeakingTaskId),
      ketMockSetId: lesson.ketMockSetId || "",
      ketMockSet: lesson.ketMockSet || findKetMockSet(lesson.ketMockSetId),
      hasHomeworkTask: Boolean(String(lesson.homeworkTask || "").trim() || lesson.recordingTaskEnabled === true),
      homeworkCompleted: lesson.homeworkCompleted === true || Number(lesson.homeworkCompletedAtMs) > 0,
      homeworkCompletedAtMs: Number(lesson.homeworkCompletedAtMs) || 0,
      homeworkCompletedLabel: formatDateTime(lesson.homeworkCompletedAtMs),
      homeworkCompletedFrom: lesson.homeworkCompletedFrom || "",
      homeworkTeacherReviewStatus: lesson.homeworkTeacherReviewStatus || "unreviewed",
      homeworkTeacherReviewedAtMs: Number(lesson.homeworkTeacherReviewedAtMs) || 0,
      homeworkTeacherReviewedLabel: formatDateTime(lesson.homeworkTeacherReviewedAtMs),
      homeworkReminderNotifyStatus: lesson.homeworkReminderNotifyStatus || "not_subscribed",
      homeworkReminderTargetDate: lesson.homeworkReminderTargetDate || "",
      homeworkDueDate: lesson.homeworkDueDate || "",
      homeworkDueStatus: lesson.homeworkDueStatus || "none",
      homeworkDueLabel: lesson.homeworkDueLabel || "",
      homeworkHasSubmission: lesson.homeworkHasSubmission === true,
      homeworkSubmittedOnTime: lesson.homeworkSubmittedOnTime === true,
      homeworkSubmittedLate: lesson.homeworkSubmittedLate === true,
      homeworkSubmissionTimingLabel: lesson.homeworkSubmissionTimingLabel || "",
      learningObservations: Array.isArray(lesson.learningObservations) ? lesson.learningObservations : [],
      hasStructuredRecord,
    });
  },

  createWorkspaceForm(lesson) {
    return {
      title: lesson.title || "",
      lessonTemplateKey: lesson.lessonTemplateKey || "general",
      reviewContent: lesson.reviewContent || "",
      taughtContent: lesson.taughtContent || "",
      masterySummary: lesson.masterySummary || "",
      oralTopic: lesson.oralTopic || "",
      targetExpression: lesson.targetExpression || "",
      independentOutput: lesson.independentOutput || "",
      correctionNotes: lesson.correctionNotes || "",
      ketSkill: lesson.ketSkill || "",
      nextReview: lesson.nextReview || "",
      homeworkTask: lesson.homeworkTask || "",
      recordingTaskEnabled: lesson.recordingTaskEnabled === true,
      homeworkDueDays: Number.isInteger(Number(lesson.homeworkDueDays))
        ? Number(lesson.homeworkDueDays)
        : -1,
      recordingTaskType: ["follow_reading", "ket_official", "ket_mock"].includes(lesson.recordingTaskType)
        ? lesson.recordingTaskType
        : "manual",
      recordingPrompt: lesson.recordingPrompt || "",
      recordingRepeatCount: lesson.recordingRepeatCount || 2,
      recordingPreparationSeconds: [0, 3, 5, 10, 15].includes(Number(lesson.recordingPreparationSeconds))
        ? Number(lesson.recordingPreparationSeconds)
        : 5,
      followReadingMode: lesson.followReadingMode === "manual" ? "manual" : "automatic",
      followReadingGapSeconds: [1, 2, 3].includes(Number(lesson.followReadingGapSeconds))
        ? Number(lesson.followReadingGapSeconds)
        : 2,
      followReadingResponseSeconds: [3, 5, 8, 10, 15, 20].includes(Number(lesson.followReadingResponseSeconds))
        ? Number(lesson.followReadingResponseSeconds)
        : 8,
      followReadingContent: (lesson.followReadingItems || []).map((item) => item.text || "").filter(Boolean).join("\n"),
      ketSpeakingTaskId: lesson.ketSpeakingTaskId || "",
      ketMockSetId: lesson.ketMockSetId || "",
      learningObservations: (lesson.learningObservations || []).map((item) => Object.assign({}, item)),
    };
  },

  preparePapers(papers) {
    return papers.map((item) => {
      const purpose = MATERIAL_PURPOSES.some((option) => option.value === item.purpose)
        ? item.purpose
        : "student_reference";
      const purposeOption = MATERIAL_PURPOSES.find((option) => option.value === purpose);
      return Object.assign({}, item, {
        purpose,
        purposeLabel: purposeOption.label,
        displayTitle: item.paperTitle || item.title || item.fileName || "课程资料",
        displayType: item.type === "document"
          ? (getFileExtension(item.fileName).toUpperCase() || MATERIAL_TYPE_LABELS.document)
          : MATERIAL_TYPE_LABELS[item.type] || "文件",
        studentVisible: item.studentVisible !== false,
        visibilityLabel: item.studentVisible === false ? "仅教师" : "学生可见",
        fileID: item.fileID || (item.fileIds && item.fileIds.length ? item.fileIds[0] : ""),
        fileExtension: item.fileExtension || getFileExtension(item.fileName),
        displayFileName: item.fileName && !looksHashedFileName(item.fileName) ? item.fileName : "",
        previewUrl: item.previewUrl || item.fileUrl || "",
        fileUrl: item.fileUrl || "",
      });
    });
  },

  groupPapers(papers) {
    return MATERIAL_PURPOSES.map((purpose) => ({
      value: purpose.value,
      label: purpose.label,
      papers: papers.filter((item) => item.purpose === purpose.value),
    })).filter((group) => group.papers.length);
  },

  prepareMistakes(mistakes) {
    return mistakes.map((item) => Object.assign({}, item, {
      displayTitle: item.questionNo || item.questionTitle || "英语错题记录",
      displayMeta: [item.paperSection, item.questionType].filter(Boolean).join(" · "),
      displayTags: item.skillTags && item.skillTags.length ? item.skillTags : item.tags || [],
      status: item.reviewStatus || item.status || "待复习",
      entryStatus: item.entryStatus || (item.studentAnswer && item.correctAnswer ? "已整理" : "待整理"),
    }));
  },

  prepareSubmissions(submissions) {
    return submissions.map((item, index) => {
      const teacherFeedbackTags = Array.isArray(item.teacherFeedbackTags)
        ? item.teacherFeedbackTags.map((tag) => String(tag || "").trim()).filter(Boolean)
        : [];
      const teacherFeedbackNote = typeof item.teacherFeedbackNote === "string"
        ? item.teacherFeedbackNote
        : teacherFeedbackTags.length ? "" : String(item.teacherFeedback || "");
      const status = item.status || "待检查";
      const isFollowReading = item.recordingMode === "follow_reading";
      return Object.assign({}, item, {
        durationLabel: formatDuration(item.duration),
        displayAttemptNo: Number(item.attemptNo) || submissions.length - index,
        displayName: isFollowReading
          ? `第 ${Number(item.attemptNo) || 1} 轮 · 第 ${Number(item.followReadingItemOrder) || index + 1} 条`
          : `第 ${Number(item.attemptNo) || submissions.length - index} 次录音`,
        displayPrompt: isFollowReading ? String(item.followReadingItemText || "") : "",
        status,
        teacherFeedback: item.teacherFeedback || "",
        teacherFeedbackTags,
        teacherFeedbackNote,
        hasTeacherFeedback: Boolean(teacherFeedbackTags.length || teacherFeedbackNote),
        reviewedLabel: formatDateTime(item.reviewedAtMs),
        reviewActionLabel: status === "待检查" ? "填写反馈" : "修改反馈",
        submittedLate: item.submittedLate === true,
      });
    });
  },

  toggleWorkspaceEditor() {
    if (!this.data.isTeacher) return;
    const opening = !this.data.showWorkspaceEditor;
    const homeworkDueIndex = Math.max(0, HOMEWORK_DUE_OPTIONS.findIndex((item) => (
      item.value === Number(this.data.lesson.homeworkDueDays)
    )));
    const recordingTaskTypeOptions = this.data.lesson.lessonTemplateKey === "molly_oral_ket"
      ? KET_RECORDING_TASK_TYPE_OPTIONS
      : BASIC_RECORDING_TASK_TYPE_OPTIONS;
    this.setData({
      showWorkspaceEditor: opening,
      workspaceForm: this.createWorkspaceForm(this.data.lesson),
      homeworkDueIndex,
      recordingTaskTypeOptions,
      recordingTaskTypeIndex: Math.max(0, recordingTaskTypeOptions.findIndex((item) => item.value === this.data.lesson.recordingTaskType)),
      followReadingModeIndex: Math.max(0, FOLLOW_READING_MODE_OPTIONS.findIndex((item) => item.value === this.data.lesson.followReadingMode)),
      followReadingGapIndex: Math.max(0, this.data.followReadingGapOptions.indexOf(this.data.lesson.followReadingGapSeconds)),
      followReadingResponseIndex: Math.max(0, this.data.followReadingResponseOptions.indexOf(this.data.lesson.followReadingResponseSeconds)),
    }, () => {
      if (opening) this.checkKetWeeklyStatus();
    });
  },

  togglePreviousLessonReference() {
    this.setData({ showPreviousLessonReference: !this.data.showPreviousLessonReference });
  },

  onWorkspaceInput(e) {
    this.setData({ [`workspaceForm.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  applyLessonTitleSuggestion(e) {
    const title = String(e.currentTarget.dataset.title || "").trim();
    if (title) this.setData({ "workspaceForm.title": title });
  },

  onWorkspaceTemplateChange(e) {
    const option = LESSON_TEMPLATE_OPTIONS[Number(e.detail.value)] || LESSON_TEMPLATE_OPTIONS[0];
    const recordingTaskTypeOptions = option.key === "molly_oral_ket"
      ? KET_RECORDING_TASK_TYPE_OPTIONS
      : BASIC_RECORDING_TASK_TYPE_OPTIONS;
    const currentType = this.data.workspaceForm.recordingTaskType;
    const safeType = recordingTaskTypeOptions.some((item) => item.value === currentType)
      ? currentType
      : "manual";
    const updates = {
      lessonTemplateIndex: LESSON_TEMPLATE_OPTIONS.indexOf(option),
      lessonTemplate: option,
      "workspaceForm.lessonTemplateKey": option.key,
      recordingTaskTypeOptions,
      recordingTaskTypeIndex: Math.max(0, recordingTaskTypeOptions.findIndex((item) => item.value === safeType)),
      "workspaceForm.recordingTaskType": safeType,
    };
    if (safeType === "manual" && currentType !== "manual") {
      Object.assign(updates, {
        ketWeeklyHint: "",
        "workspaceForm.ketSpeakingTaskId": "",
        "workspaceForm.ketMockSetId": "",
      });
    }
    this.setData(updates);
  },

  onRecordingTaskChange(e) {
    const enabled = Boolean(e.detail.value);
    const updates = { "workspaceForm.recordingTaskEnabled": enabled };
    if (enabled && Number(this.data.workspaceForm.homeworkDueDays) < 0) {
      updates.homeworkDueIndex = 8;
      updates["workspaceForm.homeworkDueDays"] = 7;
    }
    this.setData(updates);
  },

  onHomeworkDueChange(e) {
    const index = Number(e.detail.value);
    const option = HOMEWORK_DUE_OPTIONS[index] || HOMEWORK_DUE_OPTIONS[0];
    this.setData({
      homeworkDueIndex: index,
      "workspaceForm.homeworkDueDays": option.value,
    });
  },

  onRecordingTaskTypeChange(e) {
    const index = Number(e.detail.value);
    const option = this.data.recordingTaskTypeOptions[index] || this.data.recordingTaskTypeOptions[0];
    this.setData({
      recordingTaskTypeIndex: index,
      "workspaceForm.recordingTaskType": option.value,
    }, () => {
      if (option.value === "ket_official") this.applyKetSpeakingTask(this.data.ketSpeakingTaskIndex);
      else if (option.value === "ket_mock") this.applyKetMockSet(this.data.ketMockSetIndex);
      else this.setData({ "workspaceForm.ketSpeakingTaskId": "", "workspaceForm.ketMockSetId": "", ketWeeklyHint: "" });
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
      "workspaceForm.ketSpeakingTaskId": task.id,
      "workspaceForm.ketMockSetId": "",
      "workspaceForm.recordingPrompt": task.prompt,
      "workspaceForm.recordingRepeatCount": 1,
      "workspaceForm.recordingPreparationSeconds": task.preparationSeconds,
      "workspaceForm.ketSkill": `${task.part} · ${task.topic}`,
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
      "workspaceForm.ketSpeakingTaskId": "",
      "workspaceForm.ketMockSetId": set.id,
      "workspaceForm.recordingPrompt": `${set.title}：按完整考试流程完成 Part 1 与 Part 2。`,
      "workspaceForm.recordingRepeatCount": 1,
      "workspaceForm.recordingPreparationSeconds": 0,
      "workspaceForm.ketSkill": `Speaking Part 1 + Part 2 · ${set.topic}`,
    }, () => this.checkKetWeeklyStatus());
  },

  checkKetWeeklyStatus() {
    const lesson = this.data.lesson;
    if (
      !lesson
      || this.data.workspaceForm.lessonTemplateKey !== "molly_oral_ket"
      || !["ket_official", "ket_mock"].includes(this.data.workspaceForm.recordingTaskType)
    ) {
      this.setData({ ketWeeklyHint: "" });
      return;
    }
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getKetWeeklyStatus",
        data: {
          studentId: lesson.studentId,
          lessonDate: lesson.lessonDate,
          lessonId: lesson._id,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) return;
      this.setData({
        ketWeeklyHint: result.alreadyAssigned
          ? `本周已在 ${result.existingLesson.lessonDate} 的“${result.existingLesson.title}”布置过一次 KET 口语；仍可继续保存。`
          : "本周还没有在其他课程布置 KET 口语任务。",
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
      "workspaceForm.recordingRepeatCount": this.data.recordingRepeatOptions[index],
    });
  },

  onRecordingPreparationChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      recordingPreparationIndex: index,
      "workspaceForm.recordingPreparationSeconds": this.data.recordingPreparationOptions[index],
    });
  },

  onFollowReadingModeChange(e) {
    const index = Number(e.detail.value);
    const option = FOLLOW_READING_MODE_OPTIONS[index] || FOLLOW_READING_MODE_OPTIONS[0];
    this.setData({
      followReadingModeIndex: index,
      "workspaceForm.followReadingMode": option.value,
    });
  },

  onFollowReadingGapChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      followReadingGapIndex: index,
      "workspaceForm.followReadingGapSeconds": this.data.followReadingGapOptions[index],
    });
  },

  onFollowReadingResponseChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      followReadingResponseIndex: index,
      "workspaceForm.followReadingResponseSeconds": this.data.followReadingResponseOptions[index],
    });
  },

  addObservation() {
    const observations = this.data.workspaceForm.learningObservations.slice();
    observations.push({ content: "", status: OBSERVATION_STATUSES[0], note: "" });
    this.setData({ "workspaceForm.learningObservations": observations });
  },

  removeObservation(e) {
    const observations = this.data.workspaceForm.learningObservations.slice();
    observations.splice(Number(e.currentTarget.dataset.index), 1);
    this.setData({ "workspaceForm.learningObservations": observations });
  },

  onObservationInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    this.setData({ [`workspaceForm.learningObservations[${index}].${field}`]: e.detail.value });
  },

  onObservationStatusChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({
      [`workspaceForm.learningObservations[${index}].status`]: OBSERVATION_STATUSES[Number(e.detail.value)],
    });
  },

  saveWorkspace() {
    if (!this.data.isTeacher || this.data.savingWorkspace) return;
    const form = this.data.workspaceForm;
    if (!String(form.title || "").trim()) {
      wx.showToast({ title: "请填写课程名称", icon: "none" });
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
    this.setData({ savingWorkspace: true });
    wx.showLoading({ title: "保存中", mask: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "updateLessonWorkspace",
        data: Object.assign({ lessonId: this.data.lessonId }, form, {
          learningObservations: form.learningObservations.filter((item) => String(item.content || "").trim()),
        }),
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "课后记录保存失败");
      wx.showToast({ title: "课程已保存" });
      this.setData({ showWorkspaceEditor: false });
      this.loadLesson();
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "保存失败", icon: "none" });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ savingWorkspace: false });
    });
  },

  toggleMaterialUploader() {
    if (this.data.isTeacher) this.setData({ showMaterialUploader: !this.data.showMaterialUploader });
  },

  toggleMaterialAdvanced() {
    this.setData({ showMaterialAdvanced: !this.data.showMaterialAdvanced });
  },

  chooseMaterialPurpose(e) {
    const purpose = e.currentTarget.dataset.value;
    const found = MATERIAL_PURPOSES.find((item) => item.value === purpose);
    if (!found) return;
    this.setData({ selectedPurpose: purpose, selectedPurposeLabel: found.label });
    this.rememberMaterialPreferences();
  },

  onPaperMetaInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`paperForm.${field}`]: e.detail.value });
    if (field === "term") this.rememberMaterialPreferences();
  },

  chooseMaterialFile() {
    if (this.data.uploadingMaterial) return;
    wx.chooseMessageFile({
      count: 9,
      type: "all",
      success: (res) => {
        const unsupported = [];
        const files = (res.tempFiles || []).map((tempFile) => {
          const fileName = tempFile.name || "material-" + Date.now();
          const type = detectMaterialType(fileName);
          if (!type) unsupported.push(fileName);
          return { type, filePath: tempFile.path, fileName, fileSize: tempFile.size || 0 };
        }).filter((file) => file.type);
          if (unsupported.length) wx.showToast({ title: "仅支持 PPT、PDF、图片和音频", icon: "none" });
        this.uploadSelectedFiles(files);
      },
    });
  },

  choosePhotoMaterial() {
    if (this.data.uploadingMaterial) return;
    wx.chooseMedia({
      count: 9,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const files = (res.tempFiles || []).map((tempFile, index) => ({
          type: "image",
          filePath: tempFile.tempFilePath,
          fileName: `课堂照片-${Date.now()}-${index + 1}.jpg`,
          fileSize: tempFile.size || 0,
        }));
        this.uploadSelectedFiles(files);
      },
    });
  },

  readComputerMaterials() {
    if (!this.data.isTeacher || !this.data.isDevTools || this.data.uploadingMaterial || this.data.readingLocalMaterials) return;
    this.setData({ readingLocalMaterials: true });
    wx.showLoading({ title: "读取电脑资料", mask: true });
    wx.request({
      url: `${LOCAL_MATERIAL_ORIGIN}/api/material-manifest`,
      method: "GET",
      header: { "X-Local-Material-Token": LOCAL_MATERIAL_TOKEN },
      timeout: 8000,
      success: (res) => {
        try {
          const manifest = res.data || {};
          if (res.statusCode !== 200 || manifest.success === false) throw new Error(manifest.message || "本地助手返回异常");
          if (manifest.protocolVersion !== LOCAL_MATERIAL_PROTOCOL_VERSION) throw new Error("电脑资料助手版本不匹配，请使用项目中的最新助手");
          if (!manifest.ready || !Array.isArray(manifest.files) || !manifest.files.length) {
            throw new Error("电脑资料尚未准备好，请先在浏览器选择文件并点击准备");
          }
          if (manifest.files.length > 20) throw new Error("每次最多读取 20 个资料");
          const unsupported = manifest.files.find((item) => !detectMaterialType(item.name));
          if (unsupported) throw new Error(`不支持的文件格式：${unsupported.name}`);
          wx.hideLoading();
          wx.showModal({
            title: "核对电脑资料",
            content: `${manifest.label || "电脑本地资料"}\n共 ${manifest.files.length} 个文件\n当前课程：${this.data.lesson.title}\n用途：${this.data.selectedPurposeLabel}`,
            confirmText: "确认上传",
            success: (result) => {
              if (result.confirm) this.uploadLocalMaterialManifest(manifest);
            },
          });
        } catch (err) {
          wx.showToast({ title: err.message || "电脑资料读取失败", icon: "none" });
        }
      },
      fail: (err) => {
        const detail = String((err && err.errMsg) || "");
        wx.showToast({
          title: /domain|合法域名/i.test(detail)
            ? "请开启开发者工具的不校验合法域名"
            : "请先启动电脑资料上传助手",
          icon: "none",
        });
      },
      complete: () => {
        wx.hideLoading();
        this.setData({ readingLocalMaterials: false });
      },
    });
  },

  uploadLocalMaterialManifest(manifest) {
    if (this.data.uploadingMaterial) return;
    this.currentMaterialBatchId = `batch_${Date.now()}`;
    this.setData({ uploadingMaterial: true });
    let successCount = 0;
    const failedFiles = [];
    let chain = Promise.resolve();
    manifest.files.forEach((item, index) => {
      chain = chain.then(() => {
        wx.showLoading({ title: `上传 ${index + 1}/${manifest.files.length}`, mask: true });
        return this.downloadLocalMaterial(item).then((file) => {
          return this.uploadSelectedFile(file, manifest.files.length, index)
            .then(() => { successCount += 1; })
            .catch((err) => { console.error(err); failedFiles.push(item.name); })
            .finally(() => this.removeTemporaryFile(file.filePath));
        }).catch((err) => {
          console.error(err);
          failedFiles.push(item.name);
        });
      });
    });
    chain.finally(() => {
      wx.hideLoading();
      this.clearLocalMaterialSession();
      this.currentMaterialBatchId = "";
      this.setData({ uploadingMaterial: false, "paperForm.paperTitle": "" });
      if (successCount) this.loadLesson();
      if (failedFiles.length) {
        wx.showModal({
          title: `已上传 ${successCount} 个，失败 ${failedFiles.length} 个`,
          content: `未成功：${failedFiles.slice(0, 8).join("、")}${failedFiles.length > 8 ? "等" : ""}\n请不要离开本页，重新选择这些文件。`,
          showCancel: false,
        });
      } else {
        wx.showToast({ title: `${successCount} 个资料已上传`, icon: "none" });
      }
    });
  },

  downloadLocalMaterial(item) {
    return new Promise((resolve, reject) => {
      const url = String(item.url || "").startsWith("/") ? LOCAL_MATERIAL_ORIGIN + item.url : item.url;
      wx.downloadFile({
        url,
        header: { "X-Local-Material-Token": LOCAL_MATERIAL_TOKEN },
        timeout: 60000,
        success: (res) => {
          if (res.statusCode !== 200 || !res.tempFilePath) {
            reject(new Error(`读取失败：${item.name}`));
            return;
          }
          resolve({
            type: detectMaterialType(item.name),
            filePath: res.tempFilePath,
            fileName: item.name,
            fileSize: Number(item.size) || 0,
          });
        },
        fail: () => reject(new Error(`读取失败：${item.name}`)),
      });
    });
  },

  removeTemporaryFile(filePath) {
    if (!filePath || typeof wx.getFileSystemManager !== "function") return;
    try { wx.getFileSystemManager().unlink({ filePath, fail() {} }); } catch (_) {}
  },

  clearLocalMaterialSession() {
    wx.request({
      url: `${LOCAL_MATERIAL_ORIGIN}/api/material-session`,
      method: "DELETE",
      header: { "X-Local-Material-Token": LOCAL_MATERIAL_TOKEN },
      timeout: 3000,
      fail() {},
    });
  },

  uploadSelectedFiles(files) {
    if (!files.length || this.data.uploadingMaterial) return;
    this.currentMaterialBatchId = `batch_${Date.now()}`;
    this.setData({ uploadingMaterial: true });
    let successCount = 0;
    const failedFiles = [];
    let task = Promise.resolve();
    files.forEach((file, index) => {
      task = task.then(() => {
        wx.showLoading({ title: `上传 ${index + 1}/${files.length}`, mask: true });
        return this.uploadSelectedFile(file, files.length, index)
          .then(() => { successCount += 1; })
          .catch((err) => { console.error(err); failedFiles.push(file.fileName); });
      });
    });
    task.finally(() => {
      wx.hideLoading();
      this.currentMaterialBatchId = "";
      this.setData({ uploadingMaterial: false, "paperForm.paperTitle": "" });
      if (successCount) this.loadLesson();
      if (failedFiles.length) {
        wx.showModal({
          title: `已上传 ${successCount} 个，失败 ${failedFiles.length} 个`,
          content: `未成功：${failedFiles.slice(0, 8).join("、")}${failedFiles.length > 8 ? "等" : ""}\n请重新选择这些文件。`,
          showCancel: false,
        });
      } else {
        wx.showToast({ title: `${successCount} 个资料已上传`, icon: "none" });
      }
    });
  },

  createMaterialDisplayName(file, selectedCount, selectedIndex) {
    const customTitle = String(this.data.paperForm.paperTitle || "").trim();
    if (customTitle) {
      return selectedCount > 1 ? `${customTitle} · 第${padMaterialIndex(selectedIndex + 1)}份` : customTitle;
    }
    if (!looksHashedFileName(file.fileName)) return stripFileExtension(file.fileName) || "课程资料";
    const lessonTitle = String((this.data.lesson && this.data.lesson.title) || "本节课").trim();
    const suffix = file.type === "image" ? "页" : "份";
    return `${lessonTitle}-课件-第${padMaterialIndex(selectedIndex + 1)}${suffix}`;
  },

  compressMaterialImage(file) {
    if (!file || file.type !== "image" || typeof wx.compressImage !== "function") return Promise.resolve(file.filePath);
    return new Promise((resolve) => {
      wx.compressImage({
        src: file.filePath,
        quality: 72,
        success: (res) => resolve(res.tempFilePath || file.filePath),
        fail: () => resolve(file.filePath),
      });
    });
  },

  uploadSelectedFile(file, selectedCount, selectedIndex) {
    if (!this.data.lesson) return Promise.reject(new Error("课程尚未加载"));
    const fileExtension = getFileExtension(file.fileName) || (file.type === "image" ? "jpg" : "bin");
    const uploadBatchId = this.currentMaterialBatchId || `batch_${Date.now()}`;
    this.currentMaterialBatchId = uploadBatchId;
    const cloudBase = `lesson-materials/${this.data.lesson.studentId}/${this.data.lessonId}/${uploadBatchId}-${padMaterialIndex(selectedIndex + 1)}`;
    const cloudPath = `${cloudBase}-original.${fileExtension}`;
    let previewUpload;
    return wx.cloud.uploadFile({ cloudPath, filePath: file.filePath })
      .then((res) => {
        if (file.type !== "image") return res;
        return this.compressMaterialImage(file).then((previewPath) => {
          if (!previewPath || previewPath === file.filePath) return res;
          return wx.cloud.uploadFile({
            cloudPath: `${cloudBase}-preview.jpg`,
            filePath: previewPath,
          }).then((previewRes) => {
            previewUpload = previewRes;
            this.removeTemporaryFile(previewPath);
            return res;
          });
        });
      })
      .then((res) => {
        const purpose = this.data.selectedPurpose;
        return wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "addPaper",
            data: {
              studentId: this.data.lesson.studentId,
              lessonId: this.data.lessonId,
              title: this.createMaterialDisplayName(file, selectedCount, selectedIndex),
              paperTitle: this.createMaterialDisplayName(file, selectedCount, selectedIndex),
              type: file.type,
              purpose,
              studentVisible: purpose !== "teacher_only",
              paperType: purpose === "listening" ? "listening" : purpose === "school_exam" ? "written" : "mixed",
              source: purpose === "school_exam" ? "school_exam" : "practice",
              term: this.data.paperForm.term,
              fileID: res.fileID,
              previewFileID: previewUpload ? previewUpload.fileID : res.fileID,
              fileName: file.fileName,
              originalFileName: file.fileName,
              fileExtension,
              fileSize: file.fileSize,
              uploadBatchId,
              batchIndex: selectedIndex,
              uploadedAtMs: Date.now(),
            },
          },
        });
      })
      .then((res) => {
        const result = res.result || {};
        if (result.success === false) throw new Error(result.message || "保存失败");
        return result;
      });
  },

  openMaterial(e) {
    const group = this.data.materialGroups[Number(e.currentTarget.dataset.groupIndex)];
    const material = group && group.papers[Number(e.currentTarget.dataset.paperIndex)];
    if (!material || !material.fileID) return;
    if (material.type === "pdf" || material.type === "document") this.openDocumentMaterial(material);
    else if (material.type === "image" || material.type === "canva") {
      const imageMaterials = this.data.materialGroups.reduce((all, item) => all.concat(item.papers || []), [])
        .filter((item) => (item.type === "image" || item.type === "canva") && (item.previewUrl || item.fileUrl || item.fileID));
      const urls = imageMaterials.map((item) => item.previewUrl || item.fileUrl || item.fileID);
      const current = material.previewUrl || material.fileUrl || material.fileID;
      wx.previewImage({ urls, current });
    } else if (material.type === "audio") {
      if (!material.audioUrl) {
        wx.showToast({ title: "音频地址暂不可用，请重新进入本页", icon: "none" });
        return;
      }
      this.playCloudAudio(material.audioUrl, { materialId: material._id, directUrl: true });
    }
  },

  openDocumentMaterial(material) {
    wx.showLoading({ title: "打开中" });
    wx.cloud.downloadFile({ fileID: material.fileID })
      .then((res) => wx.openDocument({
        filePath: res.tempFilePath,
        fileType: material.fileExtension || getFileExtension(material.fileName) || undefined,
        showMenu: true,
      }))
      .catch((err) => { console.error(err); wx.showToast({ title: "课件打开失败", icon: "none" }); })
      .finally(() => wx.hideLoading());
  },

  saveMaterial(e) {
    const group = this.data.materialGroups[Number(e.currentTarget.dataset.groupIndex)];
    const material = group && group.papers[Number(e.currentTarget.dataset.paperIndex)];
    if (!material || !material.fileID) return;
    if (material.type === "image" || material.type === "canva") {
      wx.showLoading({ title: "保存原图中", mask: true });
      wx.cloud.downloadFile({ fileID: material.fileID })
        .then((res) => new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath, success: resolve, fail: reject });
        }))
        .then(() => wx.showToast({ title: "已保存到相册" }))
        .catch((err) => {
          console.error(err);
          wx.showToast({ title: "保存失败，请检查相册权限", icon: "none" });
        })
        .finally(() => wx.hideLoading());
      return;
    }
    if (material.type === "pdf" || material.type === "document") {
      wx.showModal({
        title: "下载课件",
        content: "打开后点击右上角菜单，可转发或保存到手机。",
        showCancel: false,
        success: () => this.openDocumentMaterial(material),
      });
      return;
    }
    wx.showToast({ title: "请先打开音频播放", icon: "none" });
  },

  manageMaterial(e) {
    if (!this.data.isTeacher) return;
    const group = this.data.materialGroups[Number(e.currentTarget.dataset.groupIndex)];
    const material = group.papers[Number(e.currentTarget.dataset.paperIndex)];
    wx.showActionSheet({
      itemList: ["重命名", "更换分类", material.studentVisible ? "改为仅教师可见" : "改为学生可见", "替换文件", "删除资料"],
      success: (res) => {
        if (res.tapIndex === 0) this.renameMaterial(material);
        if (res.tapIndex === 1) this.changeMaterialPurpose(material);
        if (res.tapIndex === 2) this.updateMaterial(material, { studentVisible: !material.studentVisible });
        if (res.tapIndex === 3) this.replaceMaterial(material);
        if (res.tapIndex === 4) this.deleteMaterial(material);
      },
    });
  },

  renameMaterial(material) {
    wx.showModal({
      title: "资料名称",
      editable: true,
      placeholderText: "输入学生容易看懂的名称",
      content: material.displayTitle,
      success: (res) => {
        const title = String(res.content || "").trim();
        if (res.confirm && title) this.updateMaterial(material, { paperTitle: title });
      },
    });
  },

  changeMaterialPurpose(material) {
    wx.showActionSheet({
      itemList: MATERIAL_PURPOSES.map((item) => item.label),
      success: (res) => {
        const purpose = MATERIAL_PURPOSES[res.tapIndex];
        if (!purpose) return;
        this.updateMaterial(material, {
          purpose: purpose.value,
          studentVisible: purpose.value === "teacher_only" ? false : material.studentVisible,
        });
      },
    });
  },

  updateMaterial(material, updates) {
    wx.showLoading({ title: "保存中", mask: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "updatePaper", data: Object.assign({ paperId: material._id }, updates) },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "资料更新失败");
      wx.showToast({ title: "资料已更新" });
      this.loadLesson();
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "保存失败", icon: "none" });
    }).finally(() => wx.hideLoading());
  },

  replaceMaterial(material) {
    wx.showActionSheet({
      itemList: ["从微信聊天选择", "拍照／从相册选择"],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.chooseMessageFile({
            count: 1,
            type: "all",
            success: (fileRes) => {
              const tempFile = fileRes.tempFiles && fileRes.tempFiles[0];
              if (!tempFile) return;
              const fileName = tempFile.name || "replacement-" + Date.now();
              const type = detectMaterialType(fileName);
              if (!type) {
                wx.showToast({ title: "仅支持 PPT、PDF、图片和音频", icon: "none" });
                return;
              }
              this.uploadReplacement(material, {
                type,
                filePath: tempFile.path,
                fileName,
                fileSize: tempFile.size || 0,
              });
            },
          });
        } else {
          wx.chooseMedia({
            count: 1,
            mediaType: ["image"],
            sourceType: ["album", "camera"],
            success: (mediaRes) => {
              const tempFile = mediaRes.tempFiles && mediaRes.tempFiles[0];
              if (!tempFile) return;
              this.uploadReplacement(material, {
                type: "image",
                filePath: tempFile.tempFilePath,
                fileName: `替换图片-${Date.now()}.jpg`,
                fileSize: tempFile.size || 0,
              });
            },
          });
        }
      },
    });
  },

  uploadReplacement(material, file) {
    const safeFileName = String(file.fileName || "replacement").replace(/[\\/:*?"<>|\s]+/g, "-");
    const cloudPath = `lesson-materials/${this.data.lesson.studentId}/${this.data.lessonId}/${Date.now()}-${safeFileName}`;
    wx.showLoading({ title: "替换中", mask: true });
    wx.cloud.uploadFile({ cloudPath, filePath: file.filePath })
      .then((uploadRes) => wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "replacePaperFile",
          data: {
            paperId: material._id,
            expectedOldFileID: material.fileID,
            fileID: uploadRes.fileID,
            fileName: file.fileName,
            fileSize: file.fileSize,
            fileExtension: getFileExtension(file.fileName),
            type: file.type,
          },
        },
      }))
      .then((res) => {
        const result = res.result || {};
        if (!result.success) throw new Error(result.message || "替换失败");
        wx.showToast({ title: "文件已替换" });
        this.loadLesson();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: err.message || "替换失败", icon: "none" });
      })
      .finally(() => wx.hideLoading());
  },

  deleteMaterial(material) {
    wx.showModal({
      title: "删除资料？",
      content: `将删除“${material.displayTitle}”及云端文件。`,
      confirmText: "删除",
      confirmColor: "#b6534b",
      success: (res) => {
        if (!res.confirm) return;
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: { type: "deletePaper", data: { paperId: material._id, lessonId: this.data.lessonId } },
        }).then((callRes) => {
          const result = callRes.result || {};
          if (!result.success) throw new Error(result.message || "删除失败");
          wx.showToast({ title: "资料已删除" });
          this.loadLesson();
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "删除失败", icon: "none" });
        });
      },
    });
  },

  deleteAllLessonMaterials() {
    if (!this.data.isTeacher || !this.data.materialCount) return;
    wx.showModal({
      title: "清空本节全部课件？",
      content: `将删除当前课程的 ${this.data.materialCount} 份资料及对应云端文件，删除后无法恢复。`,
      confirmText: "全部删除",
      confirmColor: "#b6534b",
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: "删除中", mask: true });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: { type: "deleteLessonPapers", data: { lessonId: this.data.lessonId } },
        }).then((callRes) => {
          const result = callRes.result || {};
          if (!result.success) throw new Error(result.message || "删除失败");
          wx.showToast({ title: `已删除 ${result.deletedPaperCount || 0} 份资料`, icon: "none" });
          this.loadLesson();
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "删除失败", icon: "none" });
        }).finally(() => wx.hideLoading());
      },
    });
  },

  goRecordingPractice() {
    if ((!this.data.isStudent && !this.data.isTeacherPreview) || !this.data.lesson || !this.data.lesson.recordingTaskEnabled) return;
    if (this.data.lesson.recordingTaskType === "follow_reading") {
      if (!this.data.lesson.followReadingAudioComplete) {
        wx.showToast({ title: "老师还没有准备完整示范音频", icon: "none" });
        return;
      }
      const previewQuery = this.data.isTeacherPreview
        ? `&mode=teacherPreview&previewStudentId=${encodeURIComponent(this.data.previewStudentId || this.data.lesson.studentId || "")}`
        : "";
      wx.navigateTo({
        url: `/follow-reading/pages/practice/index?lessonId=${encodeURIComponent(this.data.lessonId)}${previewQuery}`,
      });
      return;
    }
    if (this.data.isTeacherPreview) {
      wx.showToast({ title: "教师预览中不能代学生录音", icon: "none" });
      return;
    }
    if (this.data.lesson.recordingTaskType === "ket_mock") {
      wx.navigateTo({
        url: `/ket-mock/pages/exam/index?lessonId=${encodeURIComponent(this.data.lessonId)}`,
      });
      return;
    }
    wx.navigateTo({
      url: `/pages/recording-practice/index?lessonId=${encodeURIComponent(this.data.lessonId)}`,
    });
  },

  goFollowReadingAudioManager() {
    if (!this.data.isTeacher || !this.data.lesson || this.data.lesson.recordingTaskType !== "follow_reading") return;
    wx.navigateTo({
      url: `/follow-reading/pages/audio-manager/index?lessonId=${encodeURIComponent(this.data.lessonId)}`,
    });
  },

  loadKetMockSessions() {
    if (!this.data.lessonId) return;
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "listKetMockSessions", data: { lessonId: this.data.lessonId } },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) return;
      const statusLabels = {
        started: "考试进行中",
        interrupted: "考试未完成",
        submitted: "等待老师评分",
        reviewed: "老师已评分",
      };
      const sessions = (result.sessions || []).map((session) => Object.assign({}, session, {
        statusLabel: statusLabels[session.status] || "状态未知",
        submittedLabel: formatDateTime(session.submittedAtMs || session.startedAtMs),
        canOpen: !this.data.isTeacherPreview && ["submitted", "reviewed"].includes(session.status),
        actionLabel: this.data.isTeacherPreview
          ? "只读预览"
          : ["submitted", "reviewed"].includes(session.status)
            ? (this.data.isTeacher ? "回听评分" : "查看")
            : "可重新开始",
      }));
      this.setData({ ketMockSessions: sessions, ketMockLatestSession: sessions[0] || null });
    }).catch((err) => console.error("load KET mock sessions failed", err));
  },

  openKetMockSession(e) {
    if (this.data.isTeacherPreview) {
      wx.showToast({ title: "教师预览中不进入评分页", icon: "none" });
      return;
    }
    const session = this.data.ketMockSessions[Number(e.currentTarget.dataset.index)];
    if (!session || !session.canOpen) return;
    wx.navigateTo({
      url: `/ket-mock/pages/review/index?sessionId=${encodeURIComponent(session._id)}`,
    });
  },

  playSubmission(e) {
    const submission = this.data.submissions[Number(e.currentTarget.dataset.index)];
    if (!submission) return;
    if (!submission.audioUrl) {
      wx.showToast({ title: "录音地址暂不可用，请重新进入本页", icon: "none" });
      return;
    }
    this.playCloudAudio(submission.audioUrl, { submissionId: submission._id, directUrl: true });
  },

  startAudioPlayback(source, options = {}) {
    if (this.audioStartTimer) clearTimeout(this.audioStartTimer);
    if (this.audioContext) this.audioContext.destroy();
    let started = false;
    const audioContext = wx.createInnerAudioContext();
    this.audioContext = audioContext;
    audioContext.autoplay = false;
    audioContext.obeyMuteSwitch = false;
    const requestPlay = () => {
      if (started || this.audioContext !== audioContext) return;
      started = true;
      wx.hideLoading();
      audioContext.play();
    };
    audioContext.onCanplay(requestPlay);
    audioContext.onPlay(() => {
      if (this.audioStartTimer) clearTimeout(this.audioStartTimer);
      wx.hideLoading();
      this.setData({
        playingSubmissionId: options.submissionId || "",
        playingMaterialId: options.materialId || "",
      });
    });
    const clearPlaying = () => this.setData({ playingSubmissionId: "", playingMaterialId: "" });
    audioContext.onEnded(clearPlaying);
    audioContext.onStop(clearPlaying);
    audioContext.onError((err) => {
      if (this.audioStartTimer) clearTimeout(this.audioStartTimer);
      console.error(err);
      wx.hideLoading();
      clearPlaying();
      wx.showToast({
        title: options.submissionId ? "录音暂不能播放，请刷新后重试" : "音频暂不能播放",
        icon: "none",
      });
    });
    audioContext.src = source;
    this.audioStartTimer = setTimeout(requestPlay, 1200);
  },

  playCloudAudio(source, options = {}) {
    wx.showLoading({ title: options.directUrl ? "正在打开录音" : "加载音频" });
    if (options.directUrl || /^https?:\/\//i.test(String(source || ""))) {
      this.startAudioPlayback(source, options);
      return;
    }
    wx.cloud.downloadFile({ fileID: source })
      .then((res) => this.startAudioPlayback(res.tempFilePath, options))
      .catch((err) => {
        console.error(err);
        wx.hideLoading();
        wx.showToast({ title: "音频下载失败", icon: "none" });
      });
  },

  organizeLegacyRecordings() {
    if (!this.data.isTeacher || !this.data.hasLegacySubmissions || this.data.organizingRecordings) return;
    wx.showModal({
      title: "整理旧录音文件？",
      content: "系统会按学生姓名、课程日期和录音次数复制到清晰目录；数据库更新成功后才删除旧文件。录音内容不会改变。",
      confirmText: "开始整理",
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ organizingRecordings: true });
        wx.showLoading({ title: "正在整理", mask: true });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "organizeLessonRecordingFiles",
            data: { lessonId: this.data.lessonId },
          },
        }).then((res) => {
          const result = res.result || {};
          if (!result.success && !result.organizedCount) throw new Error(result.message || "旧录音整理失败");
          if (result.failedCount) {
            wx.showModal({
              title: "部分录音未整理",
              content: result.message || "请稍后重试未完成的录音。",
              showCancel: false,
            });
          } else {
            wx.showToast({ title: result.message || "旧录音已整理", icon: "none" });
          }
          this.loadLesson();
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "旧录音整理失败", icon: "none" });
        }).finally(() => {
          wx.hideLoading();
          this.setData({ organizingRecordings: false });
        });
      },
    });
  },

  markRecordingReviewed(e) {
    if (!this.data.isTeacher || this.data.savingRecordingReview) return;
    const submission = this.data.submissions[Number(e.currentTarget.dataset.index)];
    if (!submission) return;
    const status = submission.status === "需要重录" ? "需要重录" : "朗读正确";
    const allowedLabels = RECORDING_FEEDBACK_OPTIONS
      .filter((item) => item.statuses.includes(status))
      .map((item) => item.label);
    const selectedTags = (submission.teacherFeedbackTags || [])
      .filter((label) => allowedLabels.includes(label))
      .slice(0, MAX_RECORDING_FEEDBACK_TAGS);
    const note = typeof submission.teacherFeedbackNote === "string"
      ? submission.teacherFeedbackNote
      : selectedTags.length ? "" : String(submission.teacherFeedback || "");
    this.setData({
      showRecordingReviewEditor: true,
      recordingFeedbackOptions: buildRecordingFeedbackOptions(status, selectedTags),
      recordingReviewEditor: {
        submissionId: submission._id,
        displayAttemptNo: submission.displayAttemptNo,
        durationLabel: submission.durationLabel,
        status,
        selectedTags,
        note,
      },
    });
  },

  selectRecordingReviewStatus(e) {
    if (this.data.savingRecordingReview) return;
    const status = e.currentTarget.dataset.status === "需要重录" ? "需要重录" : "朗读正确";
    const allowedLabels = RECORDING_FEEDBACK_OPTIONS
      .filter((item) => item.statuses.includes(status))
      .map((item) => item.label);
    const selectedTags = (this.data.recordingReviewEditor.selectedTags || [])
      .filter((label) => allowedLabels.includes(label));
    this.setData({
      "recordingReviewEditor.status": status,
      "recordingReviewEditor.selectedTags": selectedTags,
      recordingFeedbackOptions: buildRecordingFeedbackOptions(status, selectedTags),
    });
  },

  toggleRecordingFeedbackTag(e) {
    if (this.data.savingRecordingReview) return;
    const label = String(e.currentTarget.dataset.label || "");
    if (!label) return;
    const selectedTags = (this.data.recordingReviewEditor.selectedTags || []).slice();
    const existingIndex = selectedTags.indexOf(label);
    if (existingIndex >= 0) {
      selectedTags.splice(existingIndex, 1);
    } else if (selectedTags.length >= MAX_RECORDING_FEEDBACK_TAGS) {
      wx.showToast({ title: `最多选择 ${MAX_RECORDING_FEEDBACK_TAGS} 项`, icon: "none" });
      return;
    } else {
      selectedTags.push(label);
    }
    this.setData({
      "recordingReviewEditor.selectedTags": selectedTags,
      recordingFeedbackOptions: buildRecordingFeedbackOptions(
        this.data.recordingReviewEditor.status,
        selectedTags
      ),
    });
  },

  onRecordingFeedbackNoteInput(e) {
    this.setData({ "recordingReviewEditor.note": String(e.detail.value || "").slice(0, 300) });
  },

  keepRecordingReviewEditor() {},

  closeRecordingReviewEditor() {
    if (this.data.savingRecordingReview) return;
    this.setData({ showRecordingReviewEditor: false });
  },

  submitRecordingReview() {
    const editor = this.data.recordingReviewEditor || {};
    if (!this.data.isTeacher || this.data.savingRecordingReview || !editor.submissionId) return;
    this.setData({ savingRecordingReview: true });
    wx.showLoading({ title: "正在保存", mask: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "reviewLessonRecording",
        data: {
          submissionId: editor.submissionId,
          status: editor.status,
          teacherFeedbackTags: editor.selectedTags || [],
          teacherFeedbackNote: editor.note || "",
        },
      },
    }).then((callRes) => {
      const result = callRes.result || {};
      if (!result.success) throw new Error(result.message || "反馈保存失败");
      wx.hideLoading();
      this.setData({ showRecordingReviewEditor: false });
      wx.showToast({ title: "反馈已保存", icon: "success" });
      this.loadLesson();
    }).catch((err) => {
      console.error(err);
      wx.hideLoading();
      wx.showToast({ title: err.message || "反馈保存失败", icon: "none" });
    }).finally(() => {
      this.setData({ savingRecordingReview: false });
    });
  },

  deleteRecording(e) {
    if (!this.data.isTeacher || this.data.deletingSubmissionId) return;
    const submission = this.data.submissions[Number(e.currentTarget.dataset.index)];
    if (!submission) return;
    const label = `第 ${submission.displayAttemptNo} 次录音（${submission.durationLabel}）`;
    wx.showModal({
      title: "删除这条学生录音？",
      content: `你将删除${label}。请先确认没有选错录音。`,
      confirmText: "继续确认",
      confirmColor: "#b6534b",
      success: (firstResult) => {
        if (!firstResult.confirm) return;
        wx.showModal({
          title: "再次确认永久删除",
          content: `${label}删除后无法恢复；如果这是最后一条必交录音，课后任务会重新变为未完成。`,
          confirmText: "永久删除",
          confirmColor: "#b6534b",
          success: (secondResult) => {
            if (!secondResult.confirm) return;
            this.setData({ deletingSubmissionId: submission._id });
            wx.showLoading({ title: "正在删除", mask: true });
            if (this.data.playingSubmissionId === submission._id && this.audioContext) {
              this.audioContext.stop();
            }
            wx.cloud.callFunction({
              name: "quickstartFunctions",
              data: {
                type: "deleteLessonRecording",
                data: { lessonId: this.data.lessonId, submissionId: submission._id },
              },
            }).then((res) => {
              const result = res.result || {};
              if (!result.success) throw new Error(result.message || "录音删除失败");
              wx.showToast({ title: result.homeworkReset ? "已删除，任务已重置" : "录音已删除", icon: "none" });
              this.loadLesson();
            }).catch((err) => {
              console.error(err);
              wx.showToast({ title: err.message || "录音删除失败", icon: "none" });
            }).finally(() => {
              wx.hideLoading();
              this.setData({ deletingSubmissionId: "" });
            });
          },
        });
      },
    });
  },

  reviewHomeworkCompletion(e) {
    if (!this.data.isTeacher || !this.data.lesson || this.data.reviewingHomeworkStatus) return;
    const status = e.currentTarget.dataset.status;
    if (status !== "completed" && status !== "incomplete") return;
    const markCompleted = status === "completed";
    wx.showModal({
      title: markCompleted ? "确认学生已完成？" : "确认学生未完成？",
      content: markCompleted
        ? "确认后，学生端会显示本节课后任务已完成。"
        : "确认后，学生端会恢复为待完成；已有任务内容和录音不会被删除。",
      // 微信真机要求 showModal 的按钮文字不超过 4 个汉字；超长时弹窗可能无法打开。
      confirmText: markCompleted ? "已完成" : "未完成",
      confirmColor: markCompleted ? "#4f8f73" : "#b36b3f",
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ reviewingHomeworkStatus: status });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "reviewLessonHomeworkCompletion",
            data: { lessonId: this.data.lessonId, status },
          },
        }).then((res) => {
          const result = res.result || {};
          if (!result.success) throw new Error(result.message || "任务状态保存失败");
          wx.showToast({ title: markCompleted ? "已标记完成" : "已标记未完成", icon: "none" });
          this.loadLesson();
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "批改失败，请重试", icon: "none" });
        }).finally(() => this.setData({ reviewingHomeworkStatus: "" }));
      },
      fail: (err) => {
        console.error("打开任务批改确认框失败", err);
        wx.showToast({ title: "确认框打开失败，请重试", icon: "none" });
      },
    });
  },

  enableHomeworkReminder() {
    if (!this.data.isStudent || !this.data.lesson || this.data.lesson.homeworkCompleted || this.data.subscribingHomeworkReminder) return;
    if (typeof wx.requestSubscribeMessage !== "function") {
      wx.showToast({ title: "当前微信版本不支持订阅提醒", icon: "none" });
      return;
    }
    this.setData({ subscribingHomeworkReminder: true });
    wx.requestSubscribeMessage({
      tmplIds: [HOMEWORK_REMINDER_TEMPLATE_ID],
      success: (subscribeRes) => {
        const status = subscribeRes[HOMEWORK_REMINDER_TEMPLATE_ID];
        if (status !== "accept" && status !== "acceptWithAudio") {
          this.setData({ subscribingHomeworkReminder: false });
          wx.showModal({
            title: "没有开启提醒",
            content: "课后任务仍然保留，但微信不会在18:00发送这一次提醒。",
            showCancel: false,
          });
          return;
        }
        wx.showLoading({ title: "保存提醒", mask: true });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "subscribeHomeworkReminder",
            data: { lessonId: this.data.lessonId, subscribed: true },
          },
        }).then((res) => {
          const result = res.result || {};
          if (!result.success) throw new Error(result.message || "提醒保存失败");
          wx.showModal({
            title: "18:00提醒已开启",
            content: `${result.targetDate || "下一次"} 18:00 若任务仍未完成，微信会发送一次提醒。一次授权只能发送一次。`,
            showCancel: false,
          });
          this.loadLesson();
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "提醒保存失败", icon: "none" });
        }).finally(() => {
          wx.hideLoading();
          this.setData({ subscribingHomeworkReminder: false });
        });
      },
      fail: (err) => {
        console.error(err);
        this.setData({ subscribingHomeworkReminder: false });
        wx.showToast({ title: "微信提醒授权失败", icon: "none" });
      },
    });
  },

  goMistake(e) {
    let url = "/pages/mistake-detail/index?id=" + e.currentTarget.dataset.id;
    if (this.data.isTeacherPreview) url += "&readOnly=1";
    wx.navigateTo({ url });
  },

  goAddMistake() {
    wx.navigateTo({
      url: `/pages/add-mistake/index?lessonId=${this.data.lessonId}&studentId=${this.data.lesson.studentId}`,
    });
  },

  goBatchImportMistakes() {
    wx.navigateTo({
      url: `/pages/batch-import-mistakes/index?lessonId=${this.data.lessonId}&studentId=${this.data.lesson.studentId}`,
    });
  },

  deleteLesson() {
    const lesson = this.data.lesson;
    if (!this.data.isTeacher || !lesson || this.data.deletingLesson) return;
    wx.showModal({
      title: "删除这节课？",
      content: `将永久删除“${lesson.title}”、本课资料、学生录音和错题，删除后无法恢复。`,
      confirmText: "确认删除",
      confirmColor: "#b6534b",
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ deletingLesson: true });
        wx.showLoading({ title: "删除中", mask: true });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "deleteLesson",
            data: { lessonId: this.data.lessonId, expectedTitle: lesson.title },
          },
        }).then((res) => {
          const result = res.result || {};
          if (!result.success) throw new Error(result.message || "课程删除失败");
          wx.showToast({ title: "课程已删除" });
          setTimeout(() => {
            wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: "/pages/index/index" }) });
          }, 500);
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "课程删除失败", icon: "none" });
        }).finally(() => {
          wx.hideLoading();
          this.setData({ deletingLesson: false });
        });
      },
    });
  },
});
