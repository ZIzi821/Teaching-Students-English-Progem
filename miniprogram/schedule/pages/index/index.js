const DAYS = [
  { weekday: 1, short: "一", label: "周一" },
  { weekday: 2, short: "二", label: "周二" },
  { weekday: 3, short: "三", label: "周三" },
  { weekday: 4, short: "四", label: "周四" },
  { weekday: 5, short: "五", label: "周五" },
  { weekday: 6, short: "六", label: "周六" },
  { weekday: 7, short: "日", label: "周日" },
];
const TIMELINE_START_MINUTE = 6 * 60;
const TIMELINE_END_MINUTE = 23 * 60;
const PIXELS_PER_MINUTE = 1.8;

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
    isTeacher: false,
    isStudent: false,
    isTeacherPreview: false,
    canWrite: false,
    student: null,
    days: DAYS,
    selectedWeekday: 1,
    selectedDayLabel: "周一",
    selectedDayEvents: [],
    timelineHours: [],
    timelineHeight: (TIMELINE_END_MINUTE - TIMELINE_START_MINUTE) * PIXELS_PER_MINUTE,
    showForm: false,
    formMode: "booking",
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
    const jsDay = new Date().getDay();
    const selectedWeekday = jsDay === 0 ? 7 : jsDay;
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
      selectedWeekday,
      selectedDayLabel: DAYS[selectedWeekday - 1].label,
      timelineHours,
      "form.weekdayIndex": selectedWeekday - 1,
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
      const days = DAYS.map((day) => ({
        ...day,
        eventCount: this.events.filter((item) => Number(item.weekday) === day.weekday).length,
      }));
      this.setData({
        loading: false,
        role: result.role,
        isTeacher: result.role === "teacher",
        isStudent: result.role === "student",
        isTeacherPreview: result.isTeacherPreview === true,
        canWrite: result.canWrite === true || result.role === "teacher",
        student: result.student || null,
        days,
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
    const selectedDayEvents = (this.events || [])
      .filter((item) => Number(item.weekday) === weekday)
      .map((item) => ({
        ...item,
        topRpx: Math.max(0, (Number(item.startMinute) - TIMELINE_START_MINUTE) * PIXELS_PER_MINUTE),
        heightRpx: Math.max(56, (Number(item.endMinute) - Number(item.startMinute)) * PIXELS_PER_MINUTE),
      }));
    this.setData({
      selectedDayLabel: DAYS[weekday - 1].label,
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
    if (this.data.isTeacherPreview) {
      wx.showToast({ title: "教师预览不会保存日程", icon: "none" });
      return;
    }
    const isTeacher = this.data.isTeacher;
    this.scheduleRequestId = "";
    this.setData({
      showForm: true,
      formMode: isTeacher ? "teacher" : "booking",
      form: {
        weekdayIndex: this.data.selectedWeekday - 1,
        startTime: isTeacher ? "17:00" : "16:00",
        endTime: isTeacher ? "18:00" : "17:00",
        title: "",
        note: "",
      },
    }, () => this.refreshBookingEndTime());
  },

  closeForm() {
    if (this.data.saving) return;
    this.setData({ showForm: false });
  },

  stopPropagation() {},

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
    if (!this.data.student) {
      this.setData({ bookingEndTime: "" });
      return;
    }
    const startMinute = parseTime(this.data.form.startTime);
    const duration = Number(this.data.student.bookingDurationMinutes) || 60;
    this.setData({ bookingEndTime: formatMinute(startMinute + duration) });
  },

  submitForm() {
    if (this.data.saving) return;
    if (this.data.isTeacherPreview || !this.data.canWrite) {
      wx.showToast({ title: "当前为只读预览", icon: "none" });
      return;
    }
    const form = this.data.form;
    const isTeacher = this.data.formMode === "teacher";
    if (isTeacher && !String(form.title || "").trim()) {
      wx.showToast({ title: "请填写事项名称", icon: "none" });
      return;
    }
    if (!this.scheduleRequestId) {
      this.scheduleRequestId = `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中", mask: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: isTeacher ? "saveTeacherScheduleBlock" : "createScheduleBooking",
        data: {
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
      this.setData({ showForm: false });
      wx.showToast({ title: isTeacher ? "已加入日程" : "预约成功", icon: "success" });
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
    if (!item || !item.canCancel || this.data.cancellingId) return;
    wx.showModal({
      title: this.data.isTeacher ? "移除这段日程？" : "取消这次预约？",
      content: `${item.timeLabel} · ${item.title}`,
      confirmText: "确认取消",
      confirmColor: "#b4544d",
      success: (modal) => {
        if (!modal.confirm) return;
        this.cancelEvent(item);
      },
    });
  },

  cancelEvent(item) {
    this.setData({ cancellingId: item._id });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "cancelScheduleEvent",
        data: { eventId: item._id, mode: this.mode },
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
