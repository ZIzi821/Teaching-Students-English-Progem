Page({
  data: {
    form: {
      name: "",
      nickname: "",
      grade: "",
      parentName: "",
      status: "在读",
    },
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      ["form." + field]: e.detail.value,
    });
  },

  submitStudent() {
    const form = this.data.form;
    if (!form.name || !form.grade) {
      wx.showToast({
        title: "请填写姓名和年级",
        icon: "none",
      });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({
        title: "当前基础库不支持云开发",
        icon: "none",
      });
      return;
    }

    const db = wx.cloud.database();
    wx.showLoading({ title: "保存中" });
    db.collection("students")
      .add({
        data: {
          name: form.name,
          nickname: form.nickname,
          grade: form.grade,
          parentName: form.parentName,
          status: form.status || "在读",
          createdAt: db.serverDate(),
        },
      })
      .then(() => {
        wx.showToast({ title: "已保存" });
        setTimeout(() => {
          wx.navigateBack();
        }, 500);
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({
          title: "保存失败，请检查集合权限",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },
});
