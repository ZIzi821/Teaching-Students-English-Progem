function formatDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return year + "-" + (month < 10 ? "0" + month : month) + "-" + (day < 10 ? "0" + day : day);
}

function prepareBookings(bookings) {
  const statusKeys = {
    "待确认": "pending",
    "已确认": "confirmed",
    "已取消": "cancelled",
  };
  return (bookings || []).map((item) => {
    return Object.assign({}, item, {
      statusKey: statusKeys[item.status] || "pending",
      confirmedDate: item.confirmedDate || item.requestedDate || "",
      confirmedTime: item.confirmedTime || item.requestedTime || "",
    });
  });
}

Page({
  data: {
    role: "loading",
    isTeacher: false,
    isStudent: false,
    isStudentView: false,
    isTeacherPreview: false,
    student: null,
    bookings: [],
    minDate: "",
    form: {
      requestedDate: "",
      requestedTime: "",
      parentNote: "",
    },
    message: "",
    submitting: false,
    savingId: "",
    mode: "",
    previewStudentId: "",
  },

  onLoad(options) {
    options = options || {};
    const today = formatDate(new Date());
    this.setData({
      minDate: today,
      "form.requestedDate": today,
      mode: options.mode || "",
      previewStudentId: options.previewStudentId || "",
    });
  },

  onShow() {
    this.loadBookings();
  },

  loadBookings() {
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "listLessonBookings",
          data: {
            mode: this.data.mode,
            previewStudentId: this.data.previewStudentId,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            message: result.message || "读取预约失败",
            bookings: [],
          });
          return;
        }
        const isTeacherPreview = result.role === "teacher" && result.isTeacherPreview;
        this.setData({
          role: result.role,
          isTeacher: result.role === "teacher" && !isTeacherPreview,
          isStudent: result.role === "student",
          isStudentView: result.role === "student" || isTeacherPreview,
          isTeacherPreview,
          student: result.student || null,
          bookings: prepareBookings(result.data),
          message: "",
        });
      })
      .catch((err) => {
        console.error(err);
        this.setData({ message: "请先上传并部署云函数" });
      });
  },

  onRequestDateChange(e) {
    this.setData({ "form.requestedDate": e.detail.value });
  },

  onRequestTimeChange(e) {
    this.setData({ "form.requestedTime": e.detail.value });
  },

  onParentNoteInput(e) {
    this.setData({ "form.parentNote": e.detail.value });
  },

  submitBooking() {
    if (this.data.submitting) return;
    const form = this.data.form;
    if (!form.requestedDate || !form.requestedTime) {
      wx.showToast({ title: "请选择日期和时间", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中" });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "submitLessonBooking",
          data: Object.assign({}, form, {
            mode: this.data.mode,
            previewStudentId: this.data.previewStudentId,
          }),
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          wx.showToast({ title: result.message || "提交失败", icon: "none" });
          return;
        }
        wx.showToast({ title: "已提交" });
        this.setData({
          "form.requestedTime": "",
          "form.parentNote": "",
        });
        this.loadBookings();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: "提交失败", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  },

  onConfirmedDateChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`bookings[${index}].confirmedDate`]: e.detail.value });
  },

  onConfirmedTimeChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`bookings[${index}].confirmedTime`]: e.detail.value });
  },

  onMeetingNoInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`bookings[${index}].meetingNo`]: e.detail.value });
  },

  saveBooking(e) {
    const index = Number(e.currentTarget.dataset.index);
    const booking = this.data.bookings[index];
    if (!booking || this.data.savingId) return;
    this.setData({ savingId: booking._id });
    wx.showLoading({ title: "保存中" });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "updateLessonBooking",
          data: {
            bookingId: booking._id,
            confirmedDate: booking.confirmedDate,
            confirmedTime: booking.confirmedTime,
            meetingNo: booking.meetingNo,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          wx.showToast({ title: result.message || "保存失败", icon: "none" });
          return;
        }
        wx.showToast({ title: "安排已保存" });
        this.loadBookings();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: "保存失败", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ savingId: "" });
      });
  },

  cancelBooking(e) {
    const index = Number(e.currentTarget.dataset.index);
    const booking = this.data.bookings[index];
    if (!booking || this.data.savingId) return;
    wx.showModal({
      title: "取消预约",
      content: `确定取消 ${booking.requestedDate} ${booking.requestedTime} 的预约吗？`,
      confirmColor: "#b64a3a",
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ savingId: booking._id });
        wx.showLoading({ title: "取消中" });
        wx.cloud
          .callFunction({
            name: "quickstartFunctions",
            data: {
              type: "cancelLessonBooking",
              data: { bookingId: booking._id },
            },
          })
          .then((res) => {
            const result = res.result || {};
            if (!result.success) {
              wx.showToast({ title: result.message || "取消失败", icon: "none" });
              return;
            }
            wx.showToast({ title: "已取消" });
            this.loadBookings();
          })
          .catch((err) => {
            console.error(err);
            wx.showToast({ title: "取消失败", icon: "none" });
          })
          .finally(() => {
            wx.hideLoading();
            this.setData({ savingId: "" });
          });
      },
    });
  },

  copyMeetingNo(e) {
    const meetingNo = e.currentTarget.dataset.value;
    if (!meetingNo) return;
    wx.setClipboardData({ data: String(meetingNo) });
  },
});
