const ROUTES = {
  learning: "/pages/index/index",
  achievements: "/engagement/pages/achievements/index",
  schedule: "/schedule/pages/index/index",
};

Component({
  properties: {
    current: {
      type: String,
      value: "learning",
    },
    mode: {
      type: String,
      value: "",
    },
    previewStudentId: {
      type: String,
      value: "",
    },
  },

  methods: {
    switchTab(event) {
      const key = String(event.currentTarget.dataset.key || "");
      if (!ROUTES[key] || key === this.properties.current) return;
      const params = [];
      if (this.properties.mode === "teacherPreview" && this.properties.previewStudentId) {
        params.push("mode=teacherPreview");
        params.push(`previewStudentId=${encodeURIComponent(this.properties.previewStudentId)}`);
      }
      const url = ROUTES[key] + (params.length ? `?${params.join("&")}` : "");
      wx.redirectTo({
        url,
        fail() {
          wx.reLaunch({ url });
        },
      });
    },
  },
});
