const { buildWeekDays } = require("../../../utils/scheduleCalendar");

const TIMELINE_START_MINUTE = 6 * 60;
const TIMELINE_END_MINUTE = 23 * 60;
const PIXELS_PER_MINUTE = 1.8;
const ARRANGEMENT_TYPES = [
  { value: "teacher", label: "老师安排" },
  { value: "booking", label: "帮学生预约" },
];

const pad2 = (value) => String(value).padStart(2, "0");
const formatMinute = (value) => {
  const minute = Math.max(0, Number(value) || 0);
  return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
};
const parseTime = (value) => {
  const matched = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  return matched ? Number(matched[1]) * 60 + Number(matched[2]) : 0;
};

Page({
  data: {
    loading: true,
    mode: "",
    previewStudentId: "",
    message: "",
    role: "",
    actorRole: "",
    isTeacher: false,
    isStudent: false,
    isTeacherPreview: false,
    canWrite: false,
    student: null,
    students: [],
    days: buildWeekDays(),
    selectedWeekday: 1,
    selectedDayLabel: "",
    selectedDayEvents: [],
    timelineHours: [],
    timelineHeight: (TIMELINE_END_MINUTE - TIMELINE_START_MINUTE) * PIXELS_PER_MINUTE,
    showForm: false,
    arrangementTypes: ARRANGEMENT_TYPES,
    formMode: "booking",
    formModeIndex: 1,
    formStudentIndex: 0,
    bookingStudent: null,
    editingId: "",
    editingVersion: 0,
    form: {
      weekdayIndex: 0,
      startTime: "16:00",
      endTime: "17:00",
      title: "",
      note: "",
    },
    bookingEndTime: "",
    saving: false,
    cancellingId: "",
  },

  onLoad(options) {
    this.mode = options.mode || "";
    this.previewStudentId = options.previewStudentId || options.studentId || "";
    const days = buildWeekDays(new Date());
    const today = days.find((item) => item.isToday) || days[0];
    const timelineHours = [];
    for (let hour = TIMELINE_START_MINUTE / 60; hour <= TIMELINE_END_MINUTE / 60; hour += 1) {
      timelineHours.push({
        label: `${pad2(hour)}:00`,
        topRpx: (hour * 60 - TIMELINE_START_MINUTE) * PIXELS_PER_MINUTE,
      });
    }
    this.setData({
      mode: this.mode,
      previewStudentId: this.previewStudentId,
      days,
      selectedWeekday: today.weekday,
      selectedDayLabel: today.fullLabel,
      timelineHours,
      "form.weekdayIndex": today.weekday - 1,
    });
  },

  onShow() {
    this.loadSchedule();
  },

  loadSchedule() {
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getWeeklySchedule",
        data: {
          mode: this.mode,
          previewStudentId: this.previewStudentId,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "日程暂时无法加载");
      this.events = result.events || [];
      const days = buildWeekDays(new Date()).map((day) => ({
        ...day,
        eventCount: this.events.filter((item) => Number(item.weekday) === day.weekday).length,
      }));
      const students = result.students || [];
      const previousStudentId = this.data.bookingStudent && this.data.bookingStudent._id;
      const bookingStudent = result.student
        || students.find((item) => item._id === previousStudentId)
        || students[0]
        || null;
      const formStudentIndex = Math.max(0, students.findIndex((item) => bookingStudent && item._id === bookingStudent._id));
      this.setData({
        loading: false,
        role: result.role,
        actorRole: result.actorRole || result.role,
        isTeacher: result.role === "teacher",
        isStudent: result.role === "student",
        isTeacherPreview: result.isTeacherPreview === true,
        canWrite: result.canWrite === true,
        student: result.student || null,
        students,
        days,
        bookingStudent,
        formStudentIndex,
      }, () => {
        this.refreshSelectedDay();
        this.refreshBookingEndTime();
      });
    }).catch((err) => {
      console.error(err);
      this.events = [];
      this.setData({
        loading: false,
        message: err.message || "日程暂时无法加载，请稍后再试",
        selectedDayEvents: [],
      });
    });
  },

  refreshSelectedDay() {
    const weekday = Number(this.data.selectedWeekday) || 1;
    const day = (this.data.days || [])[weekday - 1] || {};
    const selectedDayEvents = (this.events || [])
      .filter((item) => Number(item.weekday) === weekday)
      .map((item) => ({
        ...item,
        actionable: item.canEdit === true || item.canCancel === true,
        topRpx: Math.max(0, (Number(item.startMinute) - TIMELINE_START_MINUTE) * PIXELS_PER_MINUTE),
        heightRpx: Math.max(56, (Number(item.endMinute) - Number(item.startMinute)) * PIXELS_PER_MINUTE),
      }));
    this.setData({
      selectedDayLabel: day.fullLabel || day.label || "",
      selectedDayEvents,
    });
  },

  selectDay(event) {
    const weekday = Number(event.currentTarget.dataset.weekday) || 1;
    this.setData({
      selectedWeekday: weekday,
      "form.weekdayIndex": weekday - 1,
    }, () => this.refreshSelectedDay());
  },

  openForm() {
    if (!this.data.canWrite) {
      wx.showToast({ title: "当前学生暂未开放预约", icon: "none" });
      return;
    }
    const formMode = this.data.isTeacher ? "teacher" : "booking";
    this.scheduleRequestId = "";
    this.setData({
      showForm: true,
      formMode,
      formModeIndex: formMode === "teacher" ? 0 : 1,
      editingId: "",
      editingVersion: 0,
      form: {
        weekdayIndex: this.data.selectedWeekday - 1,
        startTime: formMode === "teacher" ? "17:00" : "16:00",
        endTime: formMode === "teacher" ? "18:00" : "17:00",
        title: "",
        note: "",
      },
    }, () => this.refreshBookingEndTime());
  },

  openEditForm(item) {
    if (!item || !item.canEdit) return;
    const formMode = item.eventType === "lesson_booking" ? "booking" : "teacher";
    let bookingStudent = this.data.student || this.data.bookingStudent;
    let formStudentIndex = this.data.formStudentIndex;
    if (this.data.isTeacher && formMode === "booking") {
      const matchedIndex = this.data.students.findIndex((student) => student._id === item.studentId);
      if (matchedIndex >= 0) {
        formStudentIndex = matchedIndex;
        bookingStudent = this.data.students[matchedIndex];
      } else {
        bookingStudent = {
          _id: item.studentId,
          name: item.studentName || "学生",
          bookingDurationMinutes: Number(item.durationMinutes) || 60,
        };
      }
    }
    this.scheduleRequestId = "";
    this.setData({
      showForm: true,
      formMode,
      formModeIndex: formMode === "teacher" ? 0 : 1,
      formStudentIndex,
      bookingStudent,
      editingId: item._id,
      editingVersion: Number(item.version) || 1,
      form: {
        weekdayIndex: Number(item.weekday) - 1,
        startTime: item.startTime,
        endTime: item.endTime,
        title: formMode === "teacher" ? item.title : "",
        note: item.note || "",
      },
    }, () => this.refreshBookingEndTime());
  },

  closeForm() {
    if (this.data.saving) return;
    this.setData({ showForm: false, editingId: "", editingVersion: 0 });
  },

  stopPropagation() {},

  onFormModeChange(event) {
    if (!this.data.isTeacher || this.data.editingId) return;
    const formModeIndex = Number(event.detail.value) || 0;
    const option = ARRANGEMENT_TYPES[formModeIndex] || ARRANGEMENT_TYPES[0];
    this.setData({
      formModeIndex,
      formMode: option.value,
      "form.title": option.value === "teacher" ? this.data.form.title : "",
    }, () => this.refreshBookingEndTime());
  },

  onFormStudentChange(event) {
    const formStudentIndex = Number(event.detail.value) || 0;
    const bookingStudent = this.data.students[formStudentIndex] || null;
    this.setData({ formStudentIndex, bookingStudent }, () => this.refreshBookingEndTime());
  },

  onFormDayChange(event) {
    const weekdayIndex = Number(event.detail.value) || 0;
    this.setData({
      "form.weekdayIndex": weekdayIndex,
      selectedWeekday: weekdayIndex + 1,
    }, () => {
      this.refreshSelectedDay();
      this.refreshBookingEndTime();
    });
  },

  onStartTimeChange(event) {
    this.setData({ "form.startTime": event.detail.value }, () => this.refreshBookingEndTime());
  },

  onEndTimeChange(event) {
    this.setData({ "form.endTime": event.detail.value });
  },

  onFormInput(event) {
    const field = String(event.currentTarget.dataset.field || "");
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  refreshBookingEndTime() {
    const student = this.data.bookingStudent;
    if (!student || this.data.formMode !== "booking") {
      this.setData({ bookingEndTime: "" });
      return;
    }
    const startMinute = parseTime(this.data.form.startTime);
    const duration = Number(student.bookingDurationMinutes) || 60;
    this.setData({ bookingEndTime: formatMinute(startMinute + duration) });
  },

  submitForm() {
    if (this.data.saving) return;
    if (!this.data.canWrite) {
      wx.showToast({ title: "当前日程不可修改", icon: "none" });
      return;
    }
    const form = this.data.form;
    const isTeacherBlock = this.data.formMode === "teacher";
    const isEditing = Boolean(this.data.editingId);
    if (isTeacherBlock && !String(form.title || "").trim()) {
      wx.showToast({ title: "请填写事项名称", icon: "none" });
      return;
    }
    if (!isTeacherBlock && !this.data.bookingStudent) {
      wx.showToast({ title: "请选择需要预约的学生", icon: "none" });
      return;
    }
    if (!isEditing && !this.scheduleRequestId) {
      this.scheduleRequestId = `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    const type = isEditing
      ? "updateScheduleEvent"
      : isTeacherBlock ? "saveTeacherScheduleBlock" : "createScheduleBooking";
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中", mask: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type,
        data: {
          eventId: this.data.editingId,
          expectedVersion: this.data.editingVersion,
          studentId: this.data.bookingStudent ? this.data.bookingStudent._id : "",
          previewStudentId: this.previewStudentId,
          weekday: Number(form.weekdayIndex) + 1,
          startTime: form.startTime,
          endTime: form.endTime,
          title: form.title,
          note: form.note,
          requestId: this.scheduleRequestId,
          mode: this.mode,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "保存失败");
      this.scheduleRequestId = "";
      this.setData({ showForm: false, editingId: "", editingVersion: 0 });
      wx.showToast({ title: isEditing ? "日程已更新" : isTeacherBlock ? "已加入日程" : "预约成功", icon: "success" });
      this.loadSchedule();
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "保存失败", icon: "none", duration: 2600 });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ saving: false });
    });
  },

  handleEventTap(event) {
    const eventId = String(event.currentTarget.dataset.id || "");
    const item = (this.data.selectedDayEvents || []).find((entry) => entry._id === eventId);
    if (!item || !item.actionable || this.data.cancellingId) return;
    const actions = [];
    if (item.canEdit) actions.push({ type: "edit", label: "编辑这段日程" });
    if (item.canCancel) actions.push({ type: "cancel", label: this.data.isStudent ? "取消这次预约" : "移除这段日程" });
    wx.showActionSheet({
      itemList: actions.map((action) => action.label),
      success: (result) => {
        const action = actions[result.tapIndex];
        if (!action) return;
        if (action.type === "edit") this.openEditForm(item);
        if (action.type === "cancel") this.confirmCancelEvent(item);
      },
    });
  },

  confirmCancelEvent(item) {
    wx.showModal({
      title: this.data.isTeacher ? "移除这段日程？" : "取消这次预约？",
      content: `${item.timeLabel} · ${item.title}`,
      confirmText: "确认取消",
      confirmColor: "#b4544d",
      success: (modal) => {
        if (modal.confirm) this.cancelEvent(item);
      },
    });
  },

  cancelEvent(item) {
    this.setData({ cancellingId: item._id });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "cancelScheduleEvent",
        data: {
          eventId: item._id,
          expectedVersion: Number(item.version) || 1,
          mode: this.mode,
          previewStudentId: this.previewStudentId,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "取消失败");
      wx.showToast({ title: "已取消", icon: "success" });
      this.loadSchedule();
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "取消失败", icon: "none" });
    }).finally(() => this.setData({ cancellingId: "" }));
  },

  goBackToTeacher() {
    wx.reLaunch({ url: "/pages/index/index" });
  },
});
