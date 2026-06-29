Page({
  data: {
    mistakeId: "",
    mistake: null,
    message: "",
  },

  onLoad(options) {
    this.setData({
      mistakeId: options.id || "",
    });
    this.loadMistake();
  },

  loadMistake() {
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getMistakeDetail",
          data: {
            mistakeId: this.data.mistakeId,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({
            message: result.message || "无权查看该错题",
          });
          return;
        }
        this.setData({
          mistake: this.prepareMistake(result.mistake),
          message: "",
        });
      })
      .catch((err) => {
        console.error(err);
        this.setData({
          message: "请先上传并部署云函数",
        });
      });
  },

  prepareMistake(mistake) {
    return Object.assign({}, mistake, {
      displayTitle: mistake.questionTitle || "英语题目图片",
    });
  },
});
