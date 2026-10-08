const TABS = {
  home: "/pages/index/index",
  todos: "/pages/teacher-todos/index",
  workbench: "/pages/teacher-workbench/index",
  schedule: "/schedule/pages/index/index",
};

Component({
  properties: {
    current: {
      type: String,
      value: "home",
    },
  },

  methods: {
    switchTab(event) {
      const key = String(event.currentTarget.dataset.key || "");
      const url = TABS[key];
      if (!url || key === this.properties.current) return;
      wx.reLaunch({ url });
    },
  },
});
