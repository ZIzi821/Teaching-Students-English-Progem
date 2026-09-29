const TABS = {
  home: "/pages/index/index",
  students: "/pages/students/index",
  workbench: "/pages/teacher-workbench/index",
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
