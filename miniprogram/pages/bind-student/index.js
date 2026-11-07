const { callCloud } = require("../../utils/cloud");
Page({
  data: {
    accessCode: "",
    message: "",
  },

  onLoad(options) {
    if (options && options.signedOut === "1") {
      this.setData({ message: "已退出原身份，请输入要进入账号的访问码。" });
    }
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
        title: "请输入访问码",
        icon: "none",
      });
      return;
    }
    wx.showLoading({ title: "绑定中" });
    callCloud({
        type: "bindAccessCode",
        data: {
          accessCode,
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
          message: "加载遇到问题，请稍后重试",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },
});
