const { callCloud } = require("../../utils/cloud");
const FILTERS = [
  { key: "all", label: "全部" },
  { key: "recording", label: "录音" },
  { key: "homework", label: "作业" },
  { key: "vocabulary", label: "单词" },
  { key: "inactivity", label: "学习关注" },
];

const CATEGORY_LABELS = {
  recording: "录音",
  homework: "作业",
  vocabulary: "单词",
  inactivity: "学习关注",
};

const formatActivityTime = (timestamp) => {
  const value = Number(timestamp || 0);
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - value);
  if (diffMs < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diffMs / 60000))} 分钟前`;
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

Page({
  data: {
    loading: true,
    isTeacher: false,
    noPermission: false,
    message: "",
    activeFilter: "all",
    filters: FILTERS.map((item) => Object.assign({}, item, { count: 0 })),
    visibleTodos: [],
    summary: {
      totalCount: 0,
      recordingCount: 0,
      homeworkCount: 0,
      vocabularyCount: 0,
      inactivityCount: 0,
      urgentCount: 0,
      studentCount: 0,
    },
  },

  onShow() {
    this.loadTodos();
  },

  loadTodos() {
    this.setData({ loading: true, message: "" });
    callCloud({ type: "getTeacherTodos" }).then((res) => {
      const result = res.result || {};
      if (!result.success) {
        this.allTodos = [];
        this.setData({
          loading: false,
          isTeacher: false,
          noPermission: true,
          message: result.message || "请使用教师账号查看待办",
          visibleTodos: [],
        });
        return;
      }
      this.allTodos = (result.items || []).map((item) => Object.assign({}, item, {
        categoryLabel: CATEGORY_LABELS[item.category] || "待办",
        timeLabel: formatActivityTime(item.activityAtMs),
      }));
      this.setData({
        loading: false,
        isTeacher: true,
        noPermission: false,
        summary: Object.assign({}, this.data.summary, result.summary || {}),
        message: "",
      });
      this.applyFilter(this.data.activeFilter);
    }).catch((err) => {
      console.error(err);
      this.allTodos = [];
      this.setData({
        loading: false,
        isTeacher: false,
        noPermission: true,
        message: "待办暂时无法加载，请稍后再试",
        visibleTodos: [],
      });
    });
  },

  applyFilter(filterKey) {
    const allTodos = this.allTodos || [];
    const activeFilter = FILTERS.some((item) => item.key === filterKey) ? filterKey : "all";
    const filters = FILTERS.map((item) => Object.assign({}, item, {
      count: item.key === "all"
        ? allTodos.length
        : allTodos.filter((todo) => todo.category === item.key).length,
    }));
    this.setData({
      activeFilter,
      filters,
      visibleTodos: activeFilter === "all"
        ? allTodos
        : allTodos.filter((item) => item.category === activeFilter),
    });
  },

  chooseFilter(event) {
    this.applyFilter(String(event.currentTarget.dataset.key || "all"));
  },

  openTodo(event) {
    const item = this.data.visibleTodos[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    if (item.actionType === "lesson" && item.lessonId) {
      const focus = item.kind === "recording_review"
        ? "recordings"
        : item.kind === "homework_review" ? "homework-review" : "homework";
      wx.navigateTo({
        url: "/pages/lesson-detail/index?id=" + encodeURIComponent(item.lessonId) + "&focus=" + focus,
      });
      return;
    }
    if (item.actionType === "ket_mock" && item.sessionId) {
      wx.navigateTo({
        url: "/ket-mock/pages/review/index?sessionId=" + encodeURIComponent(item.sessionId),
      });
      return;
    }
    if (item.actionType === "vocabulary" && item.studentId) {
      wx.navigateTo({
        url: "/pages/teacher-vocabulary-detail/index?studentId=" + encodeURIComponent(item.studentId),
      });
      return;
    }
    if (item.studentId) {
      wx.navigateTo({ url: "/pages/student-detail/index?id=" + encodeURIComponent(item.studentId) });
    }
  },
});
