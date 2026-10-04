const EMPTY_PROFILE = Object.freeze({
  name: "",
  weeklyBaseScore: "0",
  dailyIncrement: "0",
  enabled: true,
});

Page({
  data: {
    loading: true,
    message: "",
    week: null,
    studentRows: [],
    challengeProfiles: [],
    limits: { nameLength: 18, weeklyBaseScoreMax: 1000, dailyIncrementMax: 100 },
    savingStudentId: "",
    savingProfile: false,
    deletingProfileId: "",
    editingProfileId: "",
    showProfileForm: false,
    profileForm: Object.assign({}, EMPTY_PROFILE),
  },

  onShow() {
    this.loadManager();
  },

  onPullDownRefresh() {
    this.loadManager({ stopRefresh: true });
  },

  loadManager(options = {}) {
    this.setData({ loading: true, message: "" });
    return wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getTeacherEngagementManager", data: {} },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "无法读取成就与 PK 设置");
      this.setData({
        loading: false,
        message: "",
        week: result.week || null,
        studentRows: result.studentRows || [],
        challengeProfiles: result.challengeProfiles || [],
        limits: result.limits || this.data.limits,
      });
    }).catch((error) => {
      console.error(error);
      this.setData({ loading: false, message: error.message || "成就与 PK 设置暂时无法打开" });
    }).finally(() => {
      if (options.stopRefresh) wx.stopPullDownRefresh();
    });
  },

  toggleStudentPk(event) {
    const studentId = String(event.currentTarget.dataset.id || "");
    const pkEnabled = event.detail.value === true;
    if (!studentId || this.data.savingStudentId) return;
    this.setData({ savingStudentId: studentId });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "saveStudentPkEligibility", data: { studentId, pkEnabled } },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "参榜设置保存失败");
      wx.showToast({ title: pkEnabled ? "已加入 PK" : "已移出 PK" });
      return this.loadManager();
    }).catch((error) => {
      console.error(error);
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
      this.loadManager();
    }).finally(() => this.setData({ savingStudentId: "" }));
  },

  previewStudent(event) {
    const studentId = String(event.currentTarget.dataset.id || "");
    if (!studentId) return;
    wx.navigateTo({
      url: `/engagement/pages/achievements/index?mode=teacherPreview&previewStudentId=${encodeURIComponent(studentId)}`,
    });
  },

  startCreateProfile() {
    this.setData({
      showProfileForm: true,
      editingProfileId: "",
      profileForm: Object.assign({}, EMPTY_PROFILE),
    });
  },

  editProfile(event) {
    const profileId = String(event.currentTarget.dataset.id || "");
    const profile = this.data.challengeProfiles.find((item) => item._id === profileId);
    if (!profile) return;
    this.setData({
      showProfileForm: true,
      editingProfileId: profileId,
      profileForm: {
        name: profile.name,
        weeklyBaseScore: String(profile.weeklyBaseScore),
        dailyIncrement: String(profile.dailyIncrement),
        enabled: profile.enabled !== false,
      },
    });
  },

  cancelProfileEdit() {
    if (this.data.savingProfile) return;
    this.setData({
      showProfileForm: false,
      editingProfileId: "",
      profileForm: Object.assign({}, EMPTY_PROFILE),
    });
  },

  onProfileInput(event) {
    const field = String(event.currentTarget.dataset.field || "");
    if (!field) return;
    this.setData({ [`profileForm.${field}`]: event.detail.value });
  },

  onProfileEnabledChange(event) {
    this.setData({ "profileForm.enabled": event.detail.value === true });
  },

  saveProfile() {
    if (this.data.savingProfile) return;
    const form = this.data.profileForm;
    const name = String(form.name || "").trim();
    const weeklyBaseScore = Number(form.weeklyBaseScore);
    const dailyIncrement = Number(form.dailyIncrement);
    const limits = this.data.limits;
    if (!name) return wx.showToast({ title: "请填写挑战选手名称", icon: "none" });
    if (!Number.isInteger(weeklyBaseScore) || weeklyBaseScore < 0 || weeklyBaseScore > limits.weeklyBaseScoreMax) {
      return wx.showToast({ title: `起始分应为 0–${limits.weeklyBaseScoreMax}`, icon: "none" });
    }
    if (!Number.isInteger(dailyIncrement) || dailyIncrement < 0 || dailyIncrement > limits.dailyIncrementMax) {
      return wx.showToast({ title: `每日增幅应为 0–${limits.dailyIncrementMax}`, icon: "none" });
    }
    this.setData({ savingProfile: true });
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "savePkChallengeProfile",
        data: {
          profileId: this.data.editingProfileId,
          name,
          weeklyBaseScore,
          dailyIncrement,
          enabled: form.enabled !== false,
        },
      },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) throw new Error(result.message || "挑战选手保存失败");
      wx.showToast({ title: this.data.editingProfileId ? "已更新" : "已创建" });
      this.setData({
        showProfileForm: false,
        editingProfileId: "",
        profileForm: Object.assign({}, EMPTY_PROFILE),
      });
      return this.loadManager();
    }).catch((error) => {
      console.error(error);
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    }).finally(() => this.setData({ savingProfile: false }));
  },

  deleteProfile(event) {
    const profileId = String(event.currentTarget.dataset.id || "");
    const name = String(event.currentTarget.dataset.name || "这位挑战选手");
    if (!profileId || this.data.deletingProfileId) return;
    wx.showModal({
      title: "删除挑战选手？",
      content: `删除“${name}”后会立即从学生 PK 榜消失，不影响任何真实学生积分。`,
      confirmText: "删除",
      confirmColor: "#b6534b",
      success: (modal) => {
        if (!modal.confirm) return;
        this.setData({ deletingProfileId: profileId });
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: { type: "deletePkChallengeProfile", data: { profileId } },
        }).then((res) => {
          const result = res.result || {};
          if (!result.success) throw new Error(result.message || "删除失败");
          wx.showToast({ title: "已删除" });
          return this.loadManager();
        }).catch((error) => {
          console.error(error);
          wx.showToast({ title: error.message || "删除失败", icon: "none" });
        }).finally(() => this.setData({ deletingProfileId: "" }));
      },
    });
  },
});
