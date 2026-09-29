// app.js
App({
  onLaunch: function () {
    this.globalData = {
      env: "cloud1-d0gg6whoj379ba8b8",
      // 老师身份由云函数校验。请在 cloudfunctions/quickstartFunctions/config.js
      // 中填写朱老师的 openid，前端这里只保存云环境等非敏感配置。
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
    if (typeof wx.setInnerAudioOption === "function") {
      wx.setInnerAudioOption({
        obeyMuteSwitch: false,
        mixWithOther: true,
        fail(error) {
          console.warn("configure mini program audio output failed", error);
        },
      });
    }
  },
});
