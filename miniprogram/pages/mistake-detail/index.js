Page({
  data: {
    mistakeId: "",
    mistake: null,
    role: "",
    message: "",
    imageLoadFailed: false,
    deleting: false,
    reviewSaving: false,
    isReadOnly: false,
  },

  onLoad(options) {
    this.setData({
      mistakeId: options.id || "",
      isReadOnly: options.readOnly === "1",
    });
    this.loadMistake();
  },

  onShow() {
    if (this.hasShown && this.data.mistakeId) this.loadMistake();
    this.hasShown = true;
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
        const mistake = this.prepareMistake(result.mistake);
        this.setData({
          mistake,
          role: result.role || "",
          message: "",
          imageLoadFailed: false,
        });
        if (!mistake.questionImageUrl) {
          this.resolveQuestionImage(mistake.questionImageFileId);
        }
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
      displayTitle: mistake.questionNo || mistake.questionTitle || "英语题目",
      questionImageSrc: mistake.questionImageUrl || mistake.questionImageFileId || "",
      entryStatus: mistake.entryStatus || (mistake.studentAnswer && mistake.correctAnswer ? "已整理" : "待整理"),
    });
  },

  resolveQuestionImage(fileId) {
    if (!fileId || fileId.indexOf("cloud://") !== 0) return;
    wx.cloud
      .getTempFileURL({
        fileList: [fileId],
      })
      .then((res) => {
        const file = res.fileList && res.fileList[0];
        if (!file || file.status !== 0 || !file.tempFileURL) {
          this.setData({ imageLoadFailed: true });
          return;
        }
        this.setData({
          "mistake.questionImageSrc": file.tempFileURL,
          imageLoadFailed: false,
        });
      })
      .catch((err) => {
        console.error(err);
        this.setData({ imageLoadFailed: true });
      });
  },

  onQuestionImageError(e) {
    console.error("question image load failed", e.detail);
    this.setData({ imageLoadFailed: true });
  },

  updateReviewStatus(e) {
    const reviewStatus = e.currentTarget.dataset.status;
    if (!this.data.mistakeId || !reviewStatus || this.data.reviewSaving) return;
    this.setData({ reviewSaving: true });
    wx.showLoading({ title: "保存中", mask: true });
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "updateMistakeReviewStatus",
          data: {
            mistakeId: this.data.mistakeId,
            reviewStatus,
          },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          wx.showToast({
            title: result.message || "保存失败",
            icon: "none",
          });
          return;
        }
        this.setData({
          "mistake.reviewStatus": result.reviewStatus,
          "mistake.status": result.reviewStatus,
          "mistake.reviewCount": result.reviewCount,
        });
        wx.showToast({ title: "已更新" });
      })
      .catch((err) => {
        console.error(err);
        wx.showToast({
          title: "保存失败",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ reviewSaving: false });
      });
  },

  editMistake() {
    wx.navigateTo({
      url: "/pages/add-mistake/index?id=" + this.data.mistakeId,
    });
  },

  deleteMistake() {
    if (this.data.deleting || !this.data.mistakeId) return;
    wx.showModal({
      title: "删除这道错题？",
      content: "删除后无法恢复，关联的题目图片也会一并删除。",
      confirmText: "删除",
      confirmColor: "#b94a48",
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ deleting: true });
        wx.showLoading({ title: "删除中", mask: true });
        wx.cloud
          .callFunction({
            name: "quickstartFunctions",
            data: {
              type: "deleteMistake",
              data: { mistakeId: this.data.mistakeId },
            },
          })
          .then((res) => {
            const result = res.result || {};
            if (!result.success) {
              wx.showToast({ title: result.message || "删除失败", icon: "none" });
              return;
            }
            wx.showToast({ title: "已删除" });
            setTimeout(() => wx.navigateBack(), 500);
          })
          .catch((err) => {
            console.error(err);
            wx.showToast({ title: "删除失败", icon: "none" });
          })
          .finally(() => {
            wx.hideLoading();
            this.setData({ deleting: false });
          });
      },
    });
  },
});
