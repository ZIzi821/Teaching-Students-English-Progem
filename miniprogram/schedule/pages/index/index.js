const { WEEKDAY_LABELS, buildScheduleDays } = require("../../../utils/scheduleCalendar");

const TIMELINE_START_MINUTE = 9 * 60;
const TIMELINE_END_MINUTE = 23 * 60;
const PIXELS_PER_MINUTE = 1.8;
const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, index) => ({
  weekday: index + 1,
  label,
}));
const ARRANGEMENT_TYPES = [
  { value: "teacher", label: "老师安排" },
  { value: "booking", label: "学生临时课程" },
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

const buildFixedScheduleStudents = (students = [], schedules = []) => {
  const schedulesByStudent = new Map();
  schedules.forEach((item) => {
    const studentId = String(item.studentId || "");
    if (!studentId) return;
    if (!schedulesByStudent.has(studentId)) schedulesByStudent.set(studentId, []);
    schedulesByStudent.get(studentId).push(item);
  });
  return students.map((student) => {
    const rows = schedulesByStudent.get(String(student._id || "")) || [];
    const enabledCount = rows.filter((item) => item.enabled).length;
    return {
      studentId: student._id,
      studentName: student.name,
      colorKey: student.colorKey || (rows[0] && rows[0].colorKey) || "sage",
      enabledCount,
      summary: enabledCount ? `已开启 ${enabledCount} 天` : "暂未设置固定时间",
    };
  });
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
    availabilityVersion: 0,
    selectedDayBookingOpen: true,
    selectedDayAvailabilityLabel: "开放预约",
    formDayBookingOpen: true,
    availabilitySaving: false,
    student: null,
    students: [],
    fixedStudentSchedules: [],
    fixedScheduleStudents: [],
    showFixedScheduleForm: false,
    fixedScheduleEditingStudent: null,
    fixedScheduleDraft: [],
    fixedScheduleSaving: false,
    days: buildScheduleDays(),
    weekdayOptions: WEEKDAY_OPTIONS,
    selectedWeekday: 1,
    selectedDayWeekLabel: "",
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
    const days = buildScheduleDays(new Date());
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
      const availabilityByWeekday = new Map((result.dayAvailability || []).map((item) => [Number(item.weekday), item]));
      const days = buildScheduleDays(new Date()).map((day) => {
        const availability = availabilityByWeekday.get(day.weekday) || { bookingOpen: true, statusLabel: "开放预约" };
        return {
          ...day,
          bookingOpen: availability.bookingOpen !== false,
          availabilityLabel: availability.statusLabel || (availability.bookingOpen === false ? "暂停预约" : "开放预约"),
          eventCount: this.events.filter((item) => Number(item.weekday) === day.weekday).length,
        };
      });
      const students = result.students || [];
      const fixedStudentSchedules = result.fixedStudentSchedules || [];
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
        availabilityVersion: Math.max(0, Number(result.availabilityVersion) || 0),
        student: result.student || null,
        students,
        fixedStudentSchedules,
        fixedScheduleStudents: buildFixedScheduleStudents(students, fixedStudentSchedules),
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
    const day = (this.data.days || []).find((item) => Number(item.weekday) === weekday) || {};
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
      selectedDayWeekLabel: day.label || "",
      selectedDayEvents,
      selectedDayBookingOpen: day.bookingOpen !== false,
      selectedDayAvailabilityLabel: day.availabilityLabel || "开放预约",
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
      wx.showToast({ title: "家长端日程用于查看课程时间", icon: "none" });
      return;
    }
    if (this.data.actorRole !== "teacher" && !this.data.selectedDayBookingOpen) {
      wx.showToast({ title: "朱老师已暂停这一天的预约", icon: "none" });
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
    const formWeekday = (Number(this.data.form.weekdayIndex) || 0) + 1;
    const formDay = (this.data.days || []).find((item) => Number(item.weekday) === formWeekday) || {};
    const formDayBookingOpen = formDay.bookingOpen !== false;
    if (!student || this.data.formMode !== "booking") {
      this.setData({ bookingEndTime: "", formDayBookingOpen });
      return;
    }
    const startMinute = parseTime(this.data.form.startTime);
    const duration = Number(student.bookingDurationMinutes) || 60;
    this.setData({ bookingEndTime: formatMinute(startMinute + duration), formDayBookingOpen });
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
    if (!isTeacherBlock && this.data.actorRole !== "teacher" && !this.data.formDayBookingOpen) {
      const day = this.data.days[Number(form.weekdayIndex) || 0] || {};
      wx.showToast({ title: `${day.label || "这一天"}已暂停预约`, icon: "none" });
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

  openFixedScheduleForm(event) {
    if (!this.data.isTeacher || !this.data.canWrite) return;
    const studentId = String(event.currentTarget.dataset.studentId || "");
    const student = (this.data.students || []).find((item) => String(item._id) === studentId);
    if (!student) {
      wx.showToast({ title: "学生信息已变化，请刷新", icon: "none" });
      return;
    }
    const existingRows = (this.data.fixedStudentSchedules || [])
      .filter((item) => String(item.studentId || "") === studentId);
    const existingByWeekday = new Map(existingRows.map((item) => [Number(item.weekday), item]));
    const firstExisting = existingRows[0] || null;
    const defaultStartTime = firstExisting && firstExisting.startTime || "18:00";
    const defaultDuration = Number(student.bookingDurationMinutes) || 60;
    const defaultEndTime = formatMinute(parseTime(defaultStartTime) + defaultDuration);
    const fixedScheduleDraft = WEEKDAY_OPTIONS.map((option) => {
      const current = existingByWeekday.get(option.weekday);
      return {
        weekday: option.weekday,
        label: option.label,
        enabled: current ? current.enabled === true : false,
        startTime: current && current.startTime || defaultStartTime,
        endTime: current && current.endTime || defaultEndTime,
        eventId: current && current._id || "",
        expectedVersion: current ? Number(current.version) || 1 : 0,
      };
    });
    this.setData({
      showFixedScheduleForm: true,
      fixedScheduleEditingStudent: student,
      fixedScheduleDraft,
    });
  },

  closeFixedScheduleForm() {
    if (this.data.fixedScheduleSaving) return;
    this.setData({
      showFixedScheduleForm: false,
      fixedScheduleEditingStudent: null,
      fixedScheduleDraft: [],
    });
  },

  onFixedScheduleDayToggle(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.fixedScheduleDraft.length) return;
    this.setData({ [`fixedScheduleDraft[${index}].enabled`]: Boolean(event.detail.value) });
  },

  onFixedScheduleTimeChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = String(event.currentTarget.dataset.field || "");
    const rows = this.data.fixedScheduleDraft || [];
    const row = rows[index];
    if (!row || ["startTime", "endTime"].indexOf(field) < 0) return;
    const value = event.detail.value;
    if (field === "startTime") {
      const previousDuration = Math.max(5, parseTime(row.endTime) - parseTime(row.startTime));
      this.setData({
        [`fixedScheduleDraft[${index}].startTime`]: value,
        [`fixedScheduleDraft[${index}].endTime`]: formatMinute(Math.min(23 * 60, parseTime(value) + previousDuration)),
      });
      return;
    }
    this.setData({ [`fixedScheduleDraft[${index}].endTime`]: value });
  },

  submitFixedStudentSchedule() {
    if (this.data.fixedScheduleSaving) return;
    const student = this.data.fixedScheduleEditingStudent;
    const entries = this.data.fixedScheduleDraft || [];
    if (!student || entries.length !== 7) {
      wx.showToast({ title: "固定课表信息不完整", icon: "none" });
      return;
    }
    const invalid = entries.find((item) => {
      const start = parseTime(item.startTime);
      const end = parseTime(item.endTime);
      return start < 9 * 60 || end > 23 * 60 || end <= start || start % 5 || end % 5;
    });
    if (invalid) {
      wx.showToast({ title: `${invalid.label}的时间不正确`, icon: "none" });
      return;
    }
    this.setData({ fixedScheduleSaving: true });
    wx.showLoading({ title: "保存固定课表", mask: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "saveFixedStudentSchedule",
        data: {
          studentId: student._id,
          mode: this.mode,
          entries: entries.map((item) => ({
            weekday: item.weekday,
            enabled: item.enabled,
            startTime: item.startTime,
            endTime: item.endTime,
            eventId: item.eventId,
            expectedVersion: item.expectedVersion,
          })),
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "固定课表保存失败");
      this.setData({
        showFixedScheduleForm: false,
        fixedScheduleEditingStudent: null,
        fixedScheduleDraft: [],
      });
      wx.showToast({ title: "固定课表已更新", icon: "success" });
      this.loadSchedule();
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "固定课表保存失败", icon: "none", duration: 2800 });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ fixedScheduleSaving: false });
    });
  },

  toggleSelectedDayAvailability() {
    if (!this.data.isTeacher || this.data.availabilitySaving) return;
    const weekday = Number(this.data.selectedWeekday) || 1;
    const day = (this.data.days || []).find((item) => Number(item.weekday) === weekday) || {};
    const nextBookingOpen = day.bookingOpen === false;
    wx.showModal({
      title: nextBookingOpen ? `重新开放每${day.label || "周"}预约？` : `暂停每${day.label || "周"}预约？`,
      content: nextBookingOpen
        ? "开放后，学生可以在这一天的空白时段预约。"
        : "暂停后，该星期停止新增与调整；现有课程继续保留。设置会按星期持续生效。",
      confirmText: nextBookingOpen ? "重新开放" : "暂停预约",
      confirmColor: nextBookingOpen ? "#4f8f73" : "#b4544d",
      success: (modal) => {
        if (!modal.confirm) return;
        this.setData({ availabilitySaving: true });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "setScheduleDayAvailability",
            data: {
              weekday,
              bookingOpen: nextBookingOpen,
              expectedVersion: this.data.availabilityVersion,
            },
          },
        }).then((res) => {
          const result = res.result || {};
          if (!result.success) throw new Error(result.message || "预约状态保存失败");
          wx.showToast({ title: nextBookingOpen ? "已开放预约" : "已暂停预约", icon: "success" });
          this.loadSchedule();
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "预约状态保存失败", icon: "none" });
        }).finally(() => this.setData({ availabilitySaving: false }));
      },
    });
  },

  goBackToTeacher() {
    wx.reLaunch({ url: "/pages/index/index" });
  },
});
