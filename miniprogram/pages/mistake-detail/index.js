const sampleData = require("../../utils/sampleData");

Page({
  data: {
    mistakeId: "",
    mistake: null,
    isSample: true,
  },

  onLoad(options) {
    this.setData({
      mistakeId: options.id || "",
    });
    this.loadMistake();
  },

  loadMistake() {
    const mistakeId = this.data.mistakeId;
    const sampleMistake = sampleData.mistakes.find((item) => item._id === mistakeId) || sampleData.mistakes[0];
    this.setData({
      mistake: this.prepareMistake(sampleMistake),
      isSample: true,
    });

    if (!wx.cloud || mistakeId.indexOf("sample-") === 0) return;
    wx.cloud
      .database()
      .collection("mistakes")
      .doc(mistakeId)
      .get()
      .then((res) => {
        this.setData({
          mistake: this.prepareMistake(res.data),
          isSample: false,
        });
      })
      .catch(() => {
        console.log("读取错题详情失败，保留示例数据");
      });
  },

  prepareMistake(mistake) {
    return Object.assign({}, mistake, {
      displayTitle: mistake.questionTitle || "题目图片",
    });
  },
});
