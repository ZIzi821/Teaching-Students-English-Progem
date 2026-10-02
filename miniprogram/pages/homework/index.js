const formatCompletedTime = (timestamp) => {
  const value = Number(timestamp) || 0;
  if (!value) return "";
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
    summary: { pendingCount: 0, completedCount: 0, totalCount: 0 },
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
      this.setData({
        loading: false,
        readOnly: result.readOnly === true,
        isTeacherPreview: result.role === "teacher" && this.data.mode === "teacherPreview",
        student: result.student || null,
        pendingLessons: (result.pendingLessons || []).map((item) => this.prepareLesson(item, false)),
        completedLessons: (result.completedLessons || []).map((item) => this.prepareLesson(item, true)),
        summary: result.summary || { pendingCount: 0, completedCount: 0, totalCount: 0 },
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ loading: false, message: err.message || "暂时无法读取课后任务" });
    });
  },

  prepareLesson(lesson, completed) {
    const teacherStatus = lesson.homeworkTeacherReviewStatus || "unreviewed";
    let statusLabel = completed ? "已提交" : "待完成";
    if (teacherStatus === "completed") statusLabel = "老师已确认";
    if (teacherStatus === "incomplete") statusLabel = "老师要求继续完成";
    const submittedLate = lesson.homeworkSubmittedLate === true;
    const deadlineLabel = submittedLate
      ? "逾期提交"
      : completed || lesson.homeworkHasSubmission ? "" : String(lesson.homeworkDueLabel || "");
    const deadlineTone = submittedLate ? "late" : String(lesson.homeworkDueStatus || "none");
    return Object.assign({}, lesson, {
      completed,
      statusLabel,
      deadlineLabel,
      deadlineTone,
      completedLabel: formatCompletedTime(lesson.homeworkCompletedAtMs),
      taskPreview: String(lesson.homeworkTask || "").trim()
        || (lesson.recordingTaskType === "ket_official" ? "完成本次 KET 口语录音" : "完成本节课录音任务"),
      recordingLabel: lesson.recordingTaskType === "ket_official" ? "KET 官方样题录音" : "需要提交录音",
    });
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
