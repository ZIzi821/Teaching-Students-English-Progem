Page({
  data: {
    accessCode: "",
    message: "",
  },

  onInput(e) {
    this.setData({
      accessCode: e.detail.value,
    });
  },

  bindAccessCode() {
    const accessCode = this.data.accessCode.trim();
    if (!accessCode) {
      wx.showToast({
        title: "请输入 accessCode",
        icon: "none",
      });
      return;
    }
    wx.showLoading({ title: "绑定中" });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "bindAccessCode",
          data: {
            accessCode,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            message: result.message || "绑定失败",
          });
          wx.showToast({
            title: "绑定失败",
            icon: "none",
          });
          return;
        }
        wx.showToast({
          title: "绑定成功",
        });
        setTimeout(() => {
          wx.reLaunch({
            url: "/pages/index/index",
          });
        }, 600);
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "请先上传并部署云函数后再绑定",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },
});
