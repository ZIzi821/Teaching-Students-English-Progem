const formatCompletedTime = (timestamp) => {
  const value = Number(timestamp) || 0;
  if (!value) return "";
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const HOMEWORK_SECTION_DEFINITIONS = Object.freeze([
  { key: "returned", title: "老师让你继续完成", hint: "老师已经检查，请按反馈补充或重新提交。", tone: "returned" },
  { key: "overdue", title: "已逾期", hint: "这些任务已经超过截止时间，请优先完成。", tone: "overdue" },
  { key: "today", title: "今天截止", hint: "今天完成并提交，就不会变成逾期。", tone: "today" },
  { key: "upcoming", title: "即将到期", hint: "按截止时间从近到远排列。", tone: "upcoming" },
  { key: "noDeadline", title: "其他待完成", hint: "老师暂时没有设置截止日期。", tone: "neutral" },
  { key: "awaitingReview", title: "已提交，等待老师", hint: "不需要重复提交；老师检查后会更新结果。", tone: "awaiting" },
]);

const inferHomeworkListGroup = (lesson = {}, completed = false) => {
  if (completed) return "completed";
  if (String(lesson.homeworkTeacherReviewStatus || "") === "incomplete") return "returned";
  const hasSubmission = lesson.homeworkHasSubmission === true
    || Number(lesson.homeworkFirstSubmittedAtMs || 0) > 0;
  if (hasSubmission) return "awaitingReview";
  const dueStatus = String(lesson.homeworkDueStatus || "none");
  if (["overdue", "today", "upcoming"].includes(dueStatus)) return dueStatus;
  return "noDeadline";
};

const buildHomeworkSections = (lessons = []) => HOMEWORK_SECTION_DEFINITIONS
  .map((section) => Object.assign({}, section, {
    lessons: lessons.filter((lesson) => lesson.homeworkListGroup === section.key),
  }))
  .filter((section) => section.lessons.length);

const resolveSummaryCount = (value, fallback) => {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : fallback;
};

Page({
  data: {
    studentId: "",
    previewStudentId: "",
    mode: "",
    loading: true,
    message: "",
    readOnly: false,
    isTeacherPreview: false,
    student: null,
    pendingLessons: [],
    completedLessons: [],
    taskSections: [],
    showCompleted: false,
    summary: {
      actionableCount: 0,
      awaitingReviewCount: 0,
      pendingCount: 0,
      completedCount: 0,
      totalCount: 0,
    },
  },

  onLoad(options) {
    this.setData({
      studentId: String(options.studentId || ""),
      previewStudentId: String(options.previewStudentId || ""),
      mode: String(options.mode || ""),
    });
    this.loadHomework();
  },

  onShow() {
    if (this.hasShown) this.loadHomework();
    this.hasShown = true;
  },

  loadHomework() {
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "listStudentHomework",
        data: {
          studentId: this.data.studentId,
          previewStudentId: this.data.previewStudentId,
          mode: this.data.mode,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "暂时无法读取课后任务");
      const pendingLessons = (result.pendingLessons || []).map((item) => this.prepareLesson(item, false));
      const completedLessons = (result.completedLessons || []).map((item) => this.prepareLesson(item, true));
      const actionableCount = pendingLessons.filter((item) => item.homeworkListGroup !== "awaitingReview").length;
      const awaitingReviewCount = pendingLessons.length - actionableCount;
      const cloudSummary = result.summary || {};
      this.setData({
        loading: false,
        readOnly: result.readOnly === true,
        isTeacherPreview: result.role === "teacher" && this.data.mode === "teacherPreview",
        student: result.student || null,
        pendingLessons,
        completedLessons,
        taskSections: buildHomeworkSections(pendingLessons),
        summary: {
          actionableCount: resolveSummaryCount(cloudSummary.actionableCount, actionableCount),
          awaitingReviewCount: resolveSummaryCount(cloudSummary.awaitingReviewCount, awaitingReviewCount),
          pendingCount: resolveSummaryCount(cloudSummary.pendingCount, pendingLessons.length),
          completedCount: resolveSummaryCount(cloudSummary.completedCount, completedLessons.length),
          totalCount: resolveSummaryCount(
            cloudSummary.totalCount,
            pendingLessons.length + completedLessons.length,
          ),
        },
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ loading: false, message: err.message || "暂时无法读取课后任务" });
    });
  },

  prepareLesson(lesson, completed) {
    const teacherStatus = lesson.homeworkTeacherReviewStatus || "unreviewed";
    const hasSubmission = lesson.homeworkHasSubmission === true
      || Number(lesson.homeworkFirstSubmittedAtMs || 0) > 0;
    const homeworkListGroup = String(lesson.homeworkListGroup || "")
      || inferHomeworkListGroup(lesson, completed);
    let statusLabel = completed ? "已提交" : "待完成";
    if (teacherStatus === "completed") statusLabel = "老师已确认";
    if (teacherStatus === "incomplete") statusLabel = "老师要求继续完成";
    if (!completed && teacherStatus === "unreviewed" && homeworkListGroup === "awaitingReview") {
      statusLabel = lesson.recordingTaskType === "ket_mock" ? "已提交待评分" : "已提交待检查";
    }
    const submittedLate = lesson.homeworkSubmittedLate === true;
    const deadlineLabel = submittedLate
      ? "逾期提交"
      : completed || homeworkListGroup === "awaitingReview" ? "" : String(lesson.homeworkDueLabel || "");
    const deadlineTone = submittedLate ? "late" : String(lesson.homeworkDueStatus || "none");
    let recordingLabel = lesson.recordingTaskType === "ket_mock"
      ? "KET Part 1 + Part 2 模拟"
      : lesson.recordingTaskType === "ket_official" ? "KET 官方样题录音" : "需要提交录音";
    if (hasSubmission) {
      recordingLabel = lesson.recordingTaskType === "ket_mock"
        ? "KET 回答已提交"
        : lesson.recordingTaskType === "ket_official" ? "KET 录音已提交" : "录音已提交";
    }
    if (homeworkListGroup === "returned" && lesson.recordingTaskEnabled) {
      recordingLabel = "请按老师反馈补充或重新提交";
    }
    return Object.assign({}, lesson, {
      completed,
      homeworkListGroup,
      statusLabel,
      deadlineLabel,
      deadlineTone,
      completedLabel: formatCompletedTime(lesson.homeworkCompletedAtMs),
      taskPreview: String(lesson.homeworkTask || "").trim()
        || (lesson.recordingTaskType === "ket_mock"
          ? "完成本次 KET 口语全流程模拟"
          : lesson.recordingTaskType === "ket_official" ? "完成本次 KET 口语录音" : "完成本节课录音任务"),
      recordingLabel,
      taskActionLabel: completed
        ? "查看记录 →"
        : homeworkListGroup === "awaitingReview" ? "查看提交记录 →"
          : homeworkListGroup === "returned" ? "继续完成 →" : "查看并完成 →",
    });
  },

  toggleCompleted() {
    this.setData({ showCompleted: !this.data.showCompleted });
  },

  goLesson(e) {
    const lessonId = String(e.currentTarget.dataset.id || "");
    if (!lessonId) return;
    const query = [`id=${encodeURIComponent(lessonId)}`];
    if (this.data.isTeacherPreview) {
      query.push("mode=teacherPreview", `previewStudentId=${encodeURIComponent(this.data.previewStudentId)}`);
    }
    wx.navigateTo({ url: `/pages/lesson-detail/index?${query.join("&")}` });
  },

  goBackToTeacher() {
    wx.navigateBack({ fail() { wx.reLaunch({ url: "/pages/index/index" }); } });
  },
});
