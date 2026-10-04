const formatTime = (timestamp) => {
  const date = new Date(Number(timestamp || 0));
  if (!timestamp || Number.isNaN(date.getTime())) return "刚刚";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

Page({
  data: {
    studentId: "",
    student: null,
    loading: true,
    saving: false,
    message: "",
    activeReminders: [],
    historyReminders: [],
    editingReminderId: "",
    form: {
      title: "",
      content: "",
    },
  },

  onLoad(options) {
    this.setData({ studentId: String(options.studentId || "") });
  },

  onShow() {
    this.loadReminders();
  },

  loadReminders() {
    if (!this.data.studentId) {
      this.setData({ loading: false, message: "学生信息不完整，请返回后重试" });
      return;
    }
    this.setData({ loading: true, message: "" });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "listStudentReminders",
        data: { studentId: this.data.studentId },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "提醒暂时无法加载");
      const reminders = (result.reminders || []).map((item) => Object.assign({}, item, {
        timeLabel: formatTime(item.updatedAtMs || item.createdAtMs),
      }));
      this.setData({
        loading: false,
        message: "",
        student: result.student || null,
        activeReminders: reminders.filter((item) => item.status === "active"),
        historyReminders: reminders.filter((item) => item.status === "withdrawn").slice(0, 20),
      });
    }).catch((err) => {
      console.error(err);
      this.setData({
        loading: false,
        message: err.message || "提醒暂时无法加载",
        activeReminders: [],
        historyReminders: [],
      });
    });
  },

  onTitleInput(event) {
    this.setData({ "form.title": event.detail.value });
  },

  onContentInput(event) {
    this.setData({ "form.content": event.detail.value });
  },

  editReminder(event) {
    const reminderId = String(event.currentTarget.dataset.id || "");
    const reminder = this.data.activeReminders.find((item) => item._id === reminderId);
    if (!reminder || this.data.saving) return;
    this.setData({
      editingReminderId: reminderId,
      form: { title: reminder.title || "", content: reminder.content || "" },
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 250 });
  },

  cancelEdit() {
    if (this.data.saving) return;
    this.setData({
      editingReminderId: "",
      form: { title: "", content: "" },
    });
  },

  submitReminder() {
    if (this.data.saving) return;
    const title = String(this.data.form.title || "").trim();
    const content = String(this.data.form.content || "").trim();
    if (!title || !content) {
      wx.showToast({ title: "请填写标题和内容", icon: "none" });
      return;
    }
    const isEditing = Boolean(this.data.editingReminderId);
    wx.showModal({
      title: isEditing ? "保存修改？" : "发布提醒？",
      content: isEditing
        ? "保存后会以最新内容重新出现在学生的“我的新动态”中。"
        : "学生下次打开学习首页时会在“我的新动态”中看到这条提醒。",
      confirmText: isEditing ? "保存" : "发布",
      confirmColor: "#4f8f73",
      success: (modalResult) => {
        if (!modalResult.confirm) return;
        this.saveReminder({ title, content, isEditing });
      },
    });
  },

  saveReminder({ title, content, isEditing }) {
    this.setData({ saving: true });
    wx.showLoading({ title: isEditing ? "保存中" : "发布中", mask: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "saveStudentReminder",
        data: {
          studentId: this.data.studentId,
          reminderId: this.data.editingReminderId,
          title,
          content,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "提醒保存失败");
      this.setData({
        editingReminderId: "",
        form: { title: "", content: "" },
      });
      wx.showToast({ title: isEditing ? "已更新提醒" : "提醒已发布", icon: "success" });
      this.loadReminders();
    }).catch((err) => {
      console.error(err);
      wx.showToast({ title: err.message || "提醒保存失败", icon: "none" });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ saving: false });
    });
  },

  withdrawReminder(event) {
    const reminderId = String(event.currentTarget.dataset.id || "");
    const reminder = this.data.activeReminders.find((item) => item._id === reminderId);
    if (!reminder || this.data.saving) return;
    wx.showModal({
      title: "撤回提醒？",
      content: `撤回“${reminder.title}”后，学生端会立即停止显示；历史记录仍保留在教师端。`,
      confirmText: "撤回",
      confirmColor: "#a04f43",
      success: (modalResult) => {
        if (!modalResult.confirm) return;
        this.setData({ saving: true });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "withdrawStudentReminder",
            data: { reminderId },
          },
        }).then((res) => {
          const result = res.result || {};
          if (!result.success) throw new Error(result.message || "撤回失败");
          if (this.data.editingReminderId === reminderId) {
            this.setData({
              editingReminderId: "",
              form: { title: "", content: "" },
            });
          }
          wx.showToast({ title: "提醒已撤回", icon: "success" });
          this.loadReminders();
        }).catch((err) => {
          console.error(err);
          wx.showToast({ title: err.message || "撤回失败", icon: "none" });
        }).finally(() => {
          this.setData({ saving: false });
        });
      },
    });
  },
});
