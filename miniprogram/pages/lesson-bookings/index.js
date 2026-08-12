const BOOKING_CONFIRMATION_TEMPLATE_ID = "RhVwzNsgM3T2KX_J6cGV7cyJi2HrCwgtcAiFYZZZXZE";
const LESSON_REMINDER_TEMPLATE_ID = "Ih535VWa2FCNlCCvZUYFJOt8fOA3EY3l7Pxoa9rszYA";
const BOOKING_FILTER_PREFERENCE_KEY = "lessonBookingTeacherFilter";

function emptySubscriptionSelection() {
  return {
    confirmationSubscribed: false,
    reminderSubscribed: false,
  };
}

function requestBookingSubscriptions(templateIds) {
  return new Promise((resolve) => {
    const tmplIds = Array.from(new Set((templateIds || []).filter((item) => item)));
    if (!tmplIds.length || typeof wx.requestSubscribeMessage !== "function") {
      resolve(emptySubscriptionSelection());
      return;
    }

    try {
      wx.requestSubscribeMessage({
        tmplIds,
        success: (res) => {
          resolve({
            confirmationSubscribed: res[BOOKING_CONFIRMATION_TEMPLATE_ID] === "accept",
            reminderSubscribed: res[LESSON_REMINDER_TEMPLATE_ID] === "accept",
          });
        },
        fail: (err) => {
          console.warn("requestSubscribeMessage failed", err);
          resolve(emptySubscriptionSelection());
        },
      });
    } catch (err) {
      console.warn("requestSubscribeMessage unavailable", err);
      resolve(emptySubscriptionSelection());
    }
  });
}

function parseBookingTimestamp(dateValue, timeValue) {
  const dateParts = String(dateValue || "").split("-").map(Number);
  const timeParts = String(timeValue || "").split(":").map(Number);
  if (
    dateParts.length !== 3
    || timeParts.length !== 2
    || dateParts.concat(timeParts).some((item) => !Number.isFinite(item))
  ) return 0;
  return Date.UTC(
    dateParts[0],
    dateParts[1] - 1,
    dateParts[2],
    timeParts[0] - 8,
    timeParts[1]
  );
}

function getNotificationPresentation(type, status, outdated) {
  const maps = {
    confirmation: {
      pending: ["等待老师确认后发送", "pending"],
      sending: ["正在发送", "pending"],
      sent: [outdated ? "已发送（改期后未重发）" : "已发送", outdated ? "warning" : "success"],
      failed: ["发送失败，可重新开启", "error"],
      not_subscribed: ["未开启", "muted"],
      cancelled: ["已取消", "muted"],
    },
    reminder: {
      waiting_confirmation: ["已开启，等待老师确认", "pending"],
      pending: ["已开启，课前约 10 分钟发送", "success"],
      sending: ["正在发送", "pending"],
      sent: ["已发送", "success"],
      failed: ["发送失败，可重新开启", "error"],
      delivery_unknown: ["投递结果待确认，请重新开启", "warning"],
      expired: ["已错过发送时间", "warning"],
      reauthorization_required: ["改期后需重新开启", "warning"],
      not_subscribed: ["未开启", "muted"],
      cancelled: ["已取消", "muted"],
    },
  };
  const fallback = ["状态未知", "muted"];
  const value = (maps[type] && maps[type][status]) || fallback;
  return { label: value[0], tone: value[1] };
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return year + "-" + (month < 10 ? "0" + month : month) + "-" + (day < 10 ? "0" + day : day);
}

function prepareBookings(bookings, focusBookingId) {
  const statusKeys = {
    "待确认": "pending",
    "已确认": "confirmed",
    "已取消": "cancelled",
  };
  const prepared = (bookings || []).map((item) => {
    const status = item.status || "待确认";
    const confirmedDate = item.confirmedDate || item.requestedDate || "";
    const confirmedTime = item.confirmedTime || item.requestedTime || "";
    const startAtMs = Number(item.confirmedStartAtMs) || parseBookingTimestamp(confirmedDate, confirmedTime);
    const isPast = startAtMs > 0 && startAtMs <= Date.now();
    const bucket = status === "待确认" ? "pending" : status === "已确认" && !isPast ? "upcoming" : "history";
    const confirmationStatus = item.confirmationNotifyStatus
      || (item.confirmationSubscribed ? "pending" : "not_subscribed");
    const reminderStatus = item.reminder10mNotifyStatus
      || (item.reminderSubscribed ? "waiting_confirmation" : "not_subscribed");
    const confirmationPresentation = getNotificationPresentation(
      "confirmation",
      confirmationStatus,
      item.confirmationNotifyOutdated === true
    );
    const reminderPresentation = getNotificationPresentation("reminder", reminderStatus, false);
    const canStillNotify = status !== "已取消" && !isPast;
    const needsConfirmationSubscription = canStillNotify
      && confirmationStatus !== "sent"
      && ["not_subscribed", "failed"].indexOf(confirmationStatus) >= 0;
    const needsReminderSubscription = canStillNotify
      && [
        "not_subscribed",
        "failed",
        "delivery_unknown",
        "expired",
        "reauthorization_required",
      ].indexOf(reminderStatus) >= 0;
    return Object.assign({}, item, {
      status,
      statusKey: statusKeys[status] || "pending",
      confirmedDate,
      confirmedTime,
      originalConfirmedDate: confirmedDate,
      originalConfirmedTime: confirmedTime,
      confirmedStartAtMs: startAtMs,
      bookingVersion: Number(item.bookingVersion) || 0,
      isPast,
      isLockedHistory: status === "已确认" && isPast,
      requestExpired: status === "待确认" && isPast,
      bucket,
      canCancel: status !== "已取消" && !isPast,
      confirmationNotifyStatus: confirmationStatus,
      reminder10mNotifyStatus: reminderStatus,
      confirmationNotifyLabel: confirmationPresentation.label,
      confirmationNotifyTone: confirmationPresentation.tone,
      reminderNotifyLabel: reminderPresentation.label,
      reminderNotifyTone: reminderPresentation.tone,
      needsConfirmationSubscription,
      needsReminderSubscription,
      needsSubscriptionAction: needsConfirmationSubscription || needsReminderSubscription,
      notificationActionLabel: ["reauthorization_required", "delivery_unknown"].indexOf(reminderStatus) >= 0
        ? "重新开启课前提醒"
        : "开启微信提醒",
    });
  });
  const focusIndex = prepared.findIndex((item) => item._id === focusBookingId);
  if (focusIndex <= 0) return prepared;
  return [prepared[focusIndex]].concat(prepared.slice(0, focusIndex), prepared.slice(focusIndex + 1));
}

function countBookingBuckets(bookings) {
  return (bookings || []).reduce(
    (counts, item) => {
      counts[item.bucket] += 1;
      return counts;
    },
    { pending: 0, upcoming: 0, history: 0 }
  );
}

function showSubmissionFeedback(selection) {
  const enabled = [];
  if (selection.confirmationSubscribed) enabled.push("老师确认提醒");
  if (selection.reminderSubscribed) enabled.push("课前约 10 分钟提醒");
  wx.showModal({
    title: "预约已提交",
    content: enabled.length
      ? `已开启：${enabled.join("、")}。`
            : "没有开启微信提醒，但仍可在预约列表查看安排。",
    showCancel: false,
    confirmText: "知道了",
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
    teacherFilter: "pending",
    bookingCounts: { pending: 0, upcoming: 0, history: 0 },
    teacherVisibleCount: 0,
    mode: "",
    previewStudentId: "",
    focusBookingId: "",
  },

  onLoad(options) {
    options = options || {};
    const today = formatDate(new Date());
    let teacherFilter = "pending";
    try {
      const savedFilter = wx.getStorageSync(BOOKING_FILTER_PREFERENCE_KEY);
      if (["pending", "upcoming", "history"].indexOf(savedFilter) >= 0) teacherFilter = savedFilter;
    } catch (err) {
      teacherFilter = "pending";
    }
    this.setData({
      minDate: today,
      "form.requestedDate": today,
      mode: options.mode || "",
      previewStudentId: options.previewStudentId || "",
      focusBookingId: options.bookingId || "",
      teacherFilter,
    });
  },

  onShow() {
    this.loadBookings();
  },

  onPullDownRefresh() {
    this.loadBookings().finally(() => wx.stopPullDownRefresh());
  },

  loadBookings() {
    const requestId = (this._loadRequestId || 0) + 1;
    this._loadRequestId = requestId;
    return wx.cloud
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
        if (requestId !== this._loadRequestId) return;
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            message: result.message || "读取预约失败",
            bookings: [],
            bookingCounts: { pending: 0, upcoming: 0, history: 0 },
            teacherVisibleCount: 0,
          });
          return;
        }
        const isTeacherPreview = result.role === "teacher" && result.isTeacherPreview;
        const bookings = prepareBookings(result.data, this.data.focusBookingId);
        const bookingCounts = countBookingBuckets(bookings);
        let teacherFilter = this.data.teacherFilter;
        if (result.role === "teacher" && !isTeacherPreview) {
          const focusedBooking = this.data.focusBookingId
            ? bookings.find((item) => item._id === this.data.focusBookingId)
            : null;
          if (focusedBooking && !this._focusApplied) {
            teacherFilter = focusedBooking.bucket;
            this._focusApplied = true;
          } else if (!bookingCounts[teacherFilter]) {
            teacherFilter = bookingCounts.pending
              ? "pending"
              : bookingCounts.upcoming ? "upcoming" : "history";
          }
        }
        if (result.role === "teacher" && !isTeacherPreview) {
          try {
            wx.setStorageSync(BOOKING_FILTER_PREFERENCE_KEY, teacherFilter);
          } catch (err) {
            console.warn("save booking filter preference failed", err);
          }
        }
        this.setData({
          role: result.role,
          isTeacher: result.role === "teacher" && !isTeacherPreview,
          isStudent: result.role === "student",
          isStudentView: result.role === "student" || isTeacherPreview,
          isTeacherPreview,
          student: result.student || null,
          bookings,
          bookingCounts,
          teacherFilter,
          teacherVisibleCount: bookingCounts[teacherFilter] || 0,
          message: "",
        });
      })
      .catch((err) => {
        console.error(err);
        if (requestId !== this._loadRequestId) return;
        this.setData({
          message: "网络异常，请下拉刷新后重试",
          bookings: [],
          bookingCounts: { pending: 0, upcoming: 0, history: 0 },
          teacherVisibleCount: 0,
        });
      });
  },

  onTeacherFilterTap(e) {
    const filter = e.currentTarget.dataset.filter;
    if (["pending", "upcoming", "history"].indexOf(filter) < 0) return;
    this.setData({
      teacherFilter: filter,
      teacherVisibleCount: this.data.bookingCounts[filter] || 0,
    });
    try {
      wx.setStorageSync(BOOKING_FILTER_PREFERENCE_KEY, filter);
    } catch (err) {
      console.warn("save booking filter preference failed", err);
    }
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
    const requestedStartAtMs = parseBookingTimestamp(form.requestedDate, form.requestedTime);
    if (!requestedStartAtMs || requestedStartAtMs <= Date.now()) {
      wx.showToast({ title: "预约时间必须晚于现在", icon: "none" });
      return;
    }
    const duplicate = this.data.bookings.some((item) => {
      return item.status !== "已取消"
        && item.requestedDate === form.requestedDate
        && item.requestedTime === form.requestedTime;
    });
    if (duplicate) {
      wx.showToast({ title: "这个时间已经预约过了", icon: "none" });
      return;
    }
    const bookingData = Object.assign({}, form, {
      mode: this.data.mode,
      previewStudentId: this.data.previewStudentId,
    });
    let subscriptionSelection = emptySubscriptionSelection();
    const subscriptionRequest = this.data.isStudent
      ? requestBookingSubscriptions([
        BOOKING_CONFIRMATION_TEMPLATE_ID,
        LESSON_REMINDER_TEMPLATE_ID,
      ])
      : Promise.resolve(emptySubscriptionSelection());
    this.setData({ submitting: true });
    subscriptionRequest
      .then((selection) => {
        subscriptionSelection = selection;
        wx.showLoading({ title: "提交中" });
        return wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "submitLessonBooking",
            data: Object.assign({}, bookingData, selection),
          },
        });
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          wx.showToast({ title: result.message || "提交失败", icon: "none" });
          return;
        }
        wx.hideLoading();
        if (this.data.isStudent) {
          showSubmissionFeedback({
            confirmationSubscribed: result.confirmationSubscribed === true
              || subscriptionSelection.confirmationSubscribed,
            reminderSubscribed: result.reminderSubscribed === true
              || subscriptionSelection.reminderSubscribed,
          });
        } else {
          wx.showModal({
            title: "预约已提交",
        content: "这是老师代为提交的预约，无法替学生开启微信提醒。",
            showCancel: false,
          });
        }
        this.setData({
          "form.requestedTime": "",
          "form.parentNote": "",
        });
        return this.loadBookings();
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
    const confirmedStartAtMs = parseBookingTimestamp(booking.confirmedDate, booking.confirmedTime);
    if (!confirmedStartAtMs || confirmedStartAtMs <= Date.now()) {
      wx.showToast({ title: "确认时间必须晚于现在", icon: "none" });
      return;
    }
    const scheduleChanged = booking.status === "已确认" && (
      booking.confirmedDate !== booking.originalConfirmedDate
      || booking.confirmedTime !== booking.originalConfirmedTime
    );
    const reminderNeedsReauthorization = booking.reminder10mNotifyStatus === "sent"
      || booking.reminder10mNotifyStatus === "reauthorization_required";
    const needsChangeWarning = scheduleChanged && (
      booking.confirmationNotifyStatus === "sent"
      || reminderNeedsReauthorization
    );
    if (needsChangeWarning) {
      wx.showModal({
        title: "确认改期",
        content: reminderNeedsReauthorization
        ? "改期后需要重新开启课前提醒。确定保存吗？"
        : "确认提醒不会重复发送，课前提醒会按新时间发送。确定保存吗？",
        confirmText: "确认改期",
        success: (modalRes) => {
          if (modalRes.confirm) this.saveBookingChanges(booking);
        },
      });
      return;
    }
    this.saveBookingChanges(booking);
  },

  saveBookingChanges(booking) {
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
            bookingVersion: booking.bookingVersion,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          wx.showToast({ title: result.message || "保存失败", icon: "none" });
          return;
        }
        wx.hideLoading();
        const notificationStatus = result.notificationStatus;
        if (result.reminderReauthorizationRequired) {
          wx.showModal({
            title: "改期已保存",
        content: "改期后需要在预约页重新开启课前提醒。",
            showCancel: false,
          });
        } else if (result.scheduleChanged && booking.confirmationNotifyStatus === "sent") {
          wx.showModal({
            title: "改期已保存",
        content: "确认提醒不会重复发送；课前提醒会按新时间发送。",
            showCancel: false,
          });
        } else if (notificationStatus === "sent") {
      wx.showToast({ title: "已保存并发送提醒" });
        } else if (notificationStatus === "not_subscribed") {
      wx.showToast({ title: "已保存，未开启提醒", icon: "none" });
        } else if (notificationStatus === "failed") {
          wx.showToast({ title: "已保存，提醒未发送", icon: "none" });
        } else {
          wx.showToast({ title: "安排已保存" });
        }
        return this.loadBookings();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: "网络异常，请重试", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ savingId: "" });
      });
  },

  enableBookingNotifications(e) {
    const index = Number(e.currentTarget.dataset.index);
    const booking = this.data.bookings[index];
    if (!booking || !this.data.isStudent || this.data.savingId) return;
    const templateIds = [];
    if (booking.needsConfirmationSubscription) templateIds.push(BOOKING_CONFIRMATION_TEMPLATE_ID);
    if (booking.needsReminderSubscription) templateIds.push(LESSON_REMINDER_TEMPLATE_ID);
    if (!templateIds.length) {
      wx.showToast({ title: "当前提醒已经开启", icon: "none" });
      return;
    }
    this.setData({ savingId: booking._id });
    requestBookingSubscriptions(templateIds)
      .then((selection) => {
        if (!selection.confirmationSubscribed && !selection.reminderSubscribed) {
          wx.showModal({
            title: "未开启提醒",
            content: "你没有允许新的微信提醒；预约本身不会受影响。",
            showCancel: false,
          });
          return null;
        }
        wx.showLoading({ title: "保存中" });
        return wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "subscribeLessonBookingNotifications",
            data: Object.assign({
              bookingId: booking._id,
              bookingVersion: booking.bookingVersion,
            }, selection),
          },
        });
      })
      .then((res) => {
        if (!res) return;
        const result = res.result || {};
        if (!result.success) {
          wx.showToast({ title: result.message || "开启失败", icon: "none" });
          return;
        }
        wx.hideLoading();
        const enabled = [];
        if (result.confirmationSubscribed) enabled.push("老师确认提醒");
        if (result.reminderSubscribed) enabled.push("课前提醒");
        wx.showModal({
            title: result.confirmationStatus === "failed" ? "提醒设置已保存" : "提醒已开启",
          content: result.confirmationStatus === "failed"
              ? "老师确认提醒暂时发送失败，课前提醒不受影响，可在列表查看状态。"
              : enabled.length ? `已开启：${enabled.join("、")}。` : "提醒状态已更新。",
          showCancel: false,
        });
        return this.loadBookings();
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({ title: "网络异常，请重试", icon: "none" });
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
    const scheduledDate = booking.status === "已确认" ? booking.confirmedDate : booking.requestedDate;
    const scheduledTime = booking.status === "已确认" ? booking.confirmedTime : booking.requestedTime;
    wx.showModal({
      title: "取消预约",
      content: `确定取消 ${scheduledDate} ${scheduledTime} 的预约吗？`,
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
              data: {
                bookingId: booking._id,
                bookingVersion: booking.bookingVersion,
              },
            },
          })
          .then((res) => {
            const result = res.result || {};
            if (!result.success) {
              wx.showToast({ title: result.message || "取消失败", icon: "none" });
              return;
            }
            wx.showToast({ title: "已取消" });
            return this.loadBookings();
          })
          .catch((err) => {
            console.error(err);
            wx.showToast({ title: "网络异常，请重试", icon: "none" });
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
