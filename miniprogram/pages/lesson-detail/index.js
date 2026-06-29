const sampleData = require("../../utils/sampleData");

Page({
  data: {
    lessonId: "",
    lesson: null,
    papers: [],
    mistakes: [],
    hasPaperArea: false,
    isSample: true,
  },

  onLoad(options) {
    this.setData({
      lessonId: options.id || "",
    });
    this.loadLesson();
  },

  loadLesson() {
    const lessonId = this.data.lessonId;
    const sampleLesson = sampleData.lessons.find((item) => item._id === lessonId) || sampleData.lessons[0];
    this.setData({
      lesson: sampleLesson,
      papers: this.preparePapers(sampleData.papers.filter((item) => item.lessonId === sampleLesson._id)),
      mistakes: this.prepareMistakes(sampleData.mistakes.filter((item) => item.lessonId === sampleLesson._id)),
      hasPaperArea: sampleData.papers.some((item) => item.lessonId === sampleLesson._id) || Boolean(sampleLesson.paperFileIds && sampleLesson.paperFileIds.length),
      isSample: true,
    });

    if (!wx.cloud || lessonId.indexOf("sample-") === 0) return;
    const db = wx.cloud.database();
    Promise.all([
      db.collection("lessons").doc(lessonId).get(),
      db.collection("papers").where({ lessonId }).orderBy("createdAt", "desc").get(),
      db.collection("mistakes").where({ lessonId }).orderBy("createdAt", "desc").get(),
    ])
      .then((res) => {
        this.setData({
          lesson: res[0].data,
          papers: this.preparePapers(res[1].data || []),
          mistakes: this.prepareMistakes(res[2].data || []),
          hasPaperArea: Boolean((res[1].data && res[1].data.length) || (res[0].data.paperFileIds && res[0].data.paperFileIds.length)),
          isSample: false,
        });
      })
      .catch(() => {
        console.log("读取课程详情失败，保留示例数据");
      });
  },

  preparePapers(papers) {
    return papers.map((item) => {
      return Object.assign({}, item, {
        fileCount: item.fileIds ? item.fileIds.length : 0,
      });
    });
  },

  prepareMistakes(mistakes) {
    return mistakes.map((item) => {
      return Object.assign({}, item, {
        displayTitle: item.questionTitle || "错题记录",
      });
    });
  },

  goMistake(e) {
    wx.navigateTo({
      url: "/pages/mistake-detail/index?id=" + e.currentTarget.dataset.id,
    });
  },

  goAddMistake() {
    wx.navigateTo({
      url: "/pages/add-mistake/index?lessonId=" + this.data.lessonId + "&studentId=" + this.data.lesson.studentId,
    });
  },
});
