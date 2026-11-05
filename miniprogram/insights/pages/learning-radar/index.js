const { callCloud } = require("../../../utils/cloud");

Page({
  data: {
    studentId: "",
    loading: true,
    message: "",
    radar: null,
  },

  onLoad(options) {
    this.setData({ studentId: String(options.studentId || "") });
    this.loadRadar();
  },

  onShow() {
    if (this.hasShown && this.data.studentId) this.loadRadar();
    this.hasShown = true;
  },

  loadRadar() {
    if (!this.data.studentId) {
      this.setData({ loading: false, message: "学生信息不完整，请返回后重试" });
      return;
    }
    this.setData({ loading: true, message: "" });
    callCloud({
      type: "getStudentLearningRadar",
      data: { studentId: this.data.studentId },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "学习计划加载失败");
      const radar = result.radar || {};
      this.setData({
        radar: radar.available ? radar : null,
        message: radar.available ? "" : (radar.reason || "当前课程模板还没有阶段计划"),
      });
    }).catch((err) => {
      console.error(err);
      this.setData({ radar: null, message: err.message || "加载遇到问题，请稍后重试" });
    }).finally(() => {
      this.setData({ loading: false });
    });
  },
});
