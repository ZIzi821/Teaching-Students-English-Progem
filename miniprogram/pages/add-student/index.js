const { callCloud } = require("../../utils/cloud");
Page({
  data: {
    message: "",
    operationPending: false,
    form: {
      name: "",
      nickname: "",
      grade: "",
      parentName: "",
      status: "在读",
      accessCode: "",
      studentOpenId: "",
      teacherName: "朱老师",
      subject: "English",
      plannedLessonCount: "",
      completedLessonCount: "",
    },
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      ["form." + field]: e.detail.value,
    });
  },

  submitStudent() {
    if (this.data.operationPending) return;
    const form = this.data.form;
    if (!form.name || !form.grade || !form.accessCode) {
      wx.showToast({
        title: "请填写姓名、年级和访问码",
        icon: "none",
      });
      return;
    }

    this.setData({ operationPending: true });
    wx.showLoading({ title: "保存中", mask: true });
    callCloud({
        type: "addStudent",
        data: form,
      })
      .then((res) => {
        const result = res.result || {};
        if (result.success === false) {
          this.setData({
            message: result.message || "保存失败",
          });
          wx.showToast({
            title: result.message || "保存失败",
            icon: "none",
          });
          return;
        }
        wx.showToast({ title: "已保存" });
        setTimeout(() => {
          wx.navigateBack();
        }, 500);
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "加载遇到问题，请稍后重试",
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ operationPending: false });
      });
  },

  seedStudents() {
    if (this.data.operationPending) return;
    this.setData({ operationPending: true });
    wx.showLoading({ title: "导入中", mask: true });
    callCloud({
        type: "seedStudents",
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            message: result.message || "导入失败",
          });
          wx.showToast({
            title: "导入失败",
            icon: "none",
          });
          return;
        }
        this.setData({
          message: result.message || "导入完成",
        });
        wx.showToast({
          title: "导入完成",
        });
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "加载遇到问题，请稍后重试",
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ operationPending: false });
      });
  },
});
