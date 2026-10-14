const LOCAL_BRIDGE_ORIGIN = "http://127.0.0.1:3210";
const LOCAL_BRIDGE_PROTOCOL_VERSION = 2;
const LOCAL_BRIDGE_TOKEN = "8393a7c9ed00a70b5cb76a3b466dfb1a198e73a8a9393a3f";
const IMPORT_CHUNK_SIZE = 5;
const IMPORT_TRANSACTION_RETRY_DELAYS_MS = [800, 1600];

Page({
  data: {
    lessonId: "",
    studentId: "",
    lesson: null,
    importText: "",
    jsonFileName: "",
    jsonValid: false,
    previewCount: 0,
    missingQuestionTextNumbers: [],
    missingQuestionTextLabel: "",
    canImport: false,
    progressText: "",
    importedItemCount: 0,
    importTotalCount: 0,
    isDevTools: false,
    localBridgeLoading: false,
    localBridgeProgressText: "",
    localBridgeError: "",
    message: "",
    importing: false,
  },

  onLoad(options) {
    this.localBridgeVersion = "";
    this.setData({
      lessonId: options.lessonId || "",
      studentId: options.studentId || "",
      isDevTools: this.isDevToolsEnvironment(),
    });
    this.loadLesson();
  },

  isDevToolsEnvironment() {
    try {
      const deviceInfo = typeof wx.getDeviceInfo === "function" ? wx.getDeviceInfo() : wx.getSystemInfoSync();
      return String((deviceInfo && deviceInfo.platform) || "").toLowerCase() === "devtools";
    } catch (err) {
      console.error("detect devtools failed", err);
      return false;
    }
  },

  loadLesson() {
    wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getLessonDetail", data: { lessonId: this.data.lessonId } },
    }).then((res) => {
      const result = res.result || {};
      if (!result.success) {
        this.setData({ message: result.message || "课程读取失败" });
        return;
      }
      this.setData({ lesson: result.lesson, message: "" });
    }).catch((err) => {
      console.error(err);
      this.setData({ message: "课程读取失败" });
    });
  },

  parseImportText(importText) {
    const text = String(importText || "").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed && parsed.mistakes;
    if (!Array.isArray(items)) throw new Error("导入内容必须是 JSON 数组");
    return items;
  },

  refreshPreview(importText, extraData) {
    let items = [];
    let jsonValid = false;
    let parseMessage = "";
    try {
      items = this.parseImportText(importText);
      jsonValid = true;
    } catch (err) {
      parseMessage = importText ? "JSON 格式不正确：" + err.message : "";
    }
    const missingQuestionTextNumbers = jsonValid
      ? items.map((item, index) => (
        item && typeof item === "object" && String(item.questionText || "").trim() ? 0 : index + 1
      )).filter((index) => index)
      : [];
    const previewCount = jsonValid ? items.length : 0;
    this.setData(Object.assign({
      importText,
      jsonValid,
      previewCount,
      missingQuestionTextNumbers,
      missingQuestionTextLabel: missingQuestionTextNumbers.join("、"),
      canImport: jsonValid
        && previewCount > 0
        && previewCount <= 50
        && missingQuestionTextNumbers.length === 0,
      message: parseMessage,
    }, extraData || {}));
    return jsonValid;
  },

  onImportTextInput(e) {
    this.refreshPreview(e.detail.value, {
      jsonFileName: "",
      progressText: "",
      localBridgeError: "",
    });
  },

  requestLocalBridgeManifest() {
    return new Promise((resolve, reject) => {
      wx.request({
        url: LOCAL_BRIDGE_ORIGIN + "/api/manifest",
        method: "GET",
        header: { "X-Local-Import-Token": LOCAL_BRIDGE_TOKEN },
        timeout: 5000,
        success: (res) => {
          if (!res || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error("电脑导入助手响应异常"));
            return;
          }
          resolve(res.data || {});
        },
        fail: (err) => {
          const detail = String((err && err.errMsg) || "");
          const settingHint = /domain|https|合法域名/i.test(detail)
            ? "。请在开发者工具的本地设置中勾选“不校验合法域名”"
            : "";
          reject(new Error((detail ? "无法连接电脑导入助手：" + detail : "无法连接电脑导入助手") + settingHint));
        },
      });
    });
  },

  confirmLocalDataset(manifest) {
    const datasetLabel = String(manifest.datasetLabel || manifest.jsonFileName || "未命名资料");
    const lesson = this.data.lesson || {};
    const lessonLabel = [lesson.title, lesson.lessonDate].filter((item) => item).join(" · ") || "当前打开的课程";
    return new Promise((resolve, reject) => {
      wx.showModal({
        title: "确认电脑资料",
        content: "电脑资料：" + datasetLabel + "\n当前课程：" + lessonLabel + "\n请确认学生和课程正确。",
        confirmText: "确认读取",
        cancelText: "取消",
        success: (res) => {
          if (res.confirm) resolve();
          else {
            const err = new Error("已取消读取电脑资料");
            err.isCancelled = true;
            reject(err);
          }
        },
        fail: reject,
      });
    });
  },

  clearLocalBridgeSession() {
    const version = this.localBridgeVersion;
    if (!version) return Promise.resolve();
    return new Promise((resolve) => {
      wx.request({
        url: LOCAL_BRIDGE_ORIGIN + "/api/session?version=" + encodeURIComponent(version),
        method: "DELETE",
        header: { "X-Local-Import-Token": LOCAL_BRIDGE_TOKEN },
        complete: () => {
          this.localBridgeVersion = "";
          resolve();
        },
      });
    });
  },

  async loadFromComputer() {
    if (this.data.importing || this.data.localBridgeLoading) return;
    if (!this.data.isDevTools) {
      wx.showToast({ title: "请在微信开发者工具中使用", icon: "none" });
      return;
    }
    this.setData({
      localBridgeLoading: true,
      localBridgeProgressText: "正在连接电脑导入助手",
      localBridgeError: "",
    });
    try {
      const manifest = await this.requestLocalBridgeManifest();
      if (manifest.success === false) throw new Error(manifest.message || "电脑导入助手读取失败");
      if (Number(manifest.protocolVersion) !== LOCAL_BRIDGE_PROTOCOL_VERSION) {
        throw new Error("电脑导入助手版本不一致，请关闭旧窗口并重新启动助手");
      }
      if (!manifest.ready) throw new Error("本地导入助手尚未准备 JSON，请先在电脑端选择文件");
      await this.confirmLocalDataset(manifest);
      this.localBridgeVersion = String(manifest.version || "");
      const importText = typeof manifest.importText === "string" ? manifest.importText : "";
      if (!importText) throw new Error("电脑端没有提供 JSON 内容");
      if (!this.refreshPreview(importText, {
        jsonFileName: manifest.jsonFileName || "电脑本地 JSON",
        localBridgeProgressText: "已从电脑读取“" + (manifest.datasetLabel || manifest.jsonFileName || "本地资料") + "”",
        localBridgeError: "",
        progressText: "",
      })) {
        throw new Error("电脑端 JSON 格式不正确");
      }
    } catch (err) {
      console.error(err);
      const message = err.message || err.errMsg || "电脑本地文件读取失败";
      this.setData({
        localBridgeProgressText: err.isCancelled ? "已取消读取电脑资料" : "电脑本地读取未完成",
        localBridgeError: message,
      });
      if (!err.isCancelled) wx.showToast({ title: "电脑本地读取失败", icon: "none" });
    } finally {
      this.setData({ localBridgeLoading: false });
    }
  },

  chooseJsonFile() {
    if (this.data.importing || this.data.localBridgeLoading) return;
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["json"],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        const filePath = (file && (file.path || file.tempFilePath)) || "";
        if (!filePath) {
          wx.showToast({ title: "没有读取到 JSON 文件", icon: "none" });
          return;
        }
        wx.getFileSystemManager().readFile({
          filePath,
          encoding: "utf8",
          success: (readRes) => {
            const importText = typeof readRes.data === "string" ? readRes.data : String(readRes.data || "");
            this.refreshPreview(importText, {
              jsonFileName: file.name || "已选择 JSON",
              progressText: "",
              localBridgeError: "",
            });
          },
          fail: (err) => {
            console.error(err);
            wx.showToast({ title: "JSON 文件读取失败", icon: "none" });
          },
        });
      },
      fail: (err) => {
        if (String((err && err.errMsg) || "").indexOf("cancel") < 0) {
          wx.showToast({ title: "JSON 文件选择失败", icon: "none" });
        }
      },
    });
  },

  hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  },

  createImportBatchId(importText) {
    const source = this.data.lessonId + "|" + importText;
    return "import-" + this.hashText(source) + "-" + source.length;
  },

  isImportTransactionBusyError(err) {
    const code = String((err && (err.code || err.errCode || err.errcode)) || "").toUpperCase();
    const message = String((err && (err.message || err.errMsg)) || "");
    return code === "TRANSACTION_BUSY"
      || code === "-501001"
      || /\btransaction\s+(?:is\s+)?busy\b/i.test(message);
  },

  waitForImportRetry(waitMs) {
    return new Promise((resolve) => setTimeout(resolve, waitMs));
  },

  async requestMistakeImportChunk(payload, batchNo, batchTotal) {
    let lastError;
    for (let attempt = 0; attempt <= IMPORT_TRANSACTION_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const res = await wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: { type: "batchImportMistakes", data: payload },
        });
        const batchResult = res.result || {};
        if (!batchResult.success) {
          const error = new Error(batchResult.message || "第 " + batchNo + " 批导入失败");
          error.code = batchResult.code || "";
          throw error;
        }
        return batchResult;
      } catch (err) {
        lastError = err;
        if (!this.isImportTransactionBusyError(err) || attempt >= IMPORT_TRANSACTION_RETRY_DELAYS_MS.length) throw err;
        const waitMs = IMPORT_TRANSACTION_RETRY_DELAYS_MS[attempt];
        this.setData({
          progressText: "云端繁忙，正在自动重试第 " + batchNo + "/" + batchTotal
            + " 批（" + (attempt + 1) + "/" + IMPORT_TRANSACTION_RETRY_DELAYS_MS.length + "）",
        });
        wx.showLoading({ title: "正在重试 " + batchNo + "/" + batchTotal, mask: true });
        await this.waitForImportRetry(waitMs);
      }
    }
    throw lastError;
  },

  async importMistakeChunks(items, importBatchId) {
    const batchTotal = Math.ceil(items.length / IMPORT_CHUNK_SIZE);
    const result = { success: true, importedCount: 0, addedCount: 0, skippedCount: 0 };
    this.setData({ importedItemCount: 0, importTotalCount: items.length });
    for (let start = 0; start < items.length; start += IMPORT_CHUNK_SIZE) {
      const batchNo = Math.floor(start / IMPORT_CHUNK_SIZE) + 1;
      const end = Math.min(start + IMPORT_CHUNK_SIZE, items.length);
      this.setData({ progressText: "正在导入第 " + batchNo + "/" + batchTotal + " 批（" + (start + 1) + "-" + end + "题）" });
      wx.showLoading({ title: "导入 " + batchNo + "/" + batchTotal, mask: true });
      let batchResult;
      try {
        batchResult = await this.requestMistakeImportChunk({
          studentId: this.data.studentId,
          lessonId: this.data.lessonId,
          importBatchId,
          importItemOffset: start,
          items: items.slice(start, end),
        }, batchNo, batchTotal);
      } catch (error) {
        error.importedItemCount = start;
        throw error;
      }
      result.importedCount += Number(batchResult.importedCount) || 0;
      result.addedCount += Number(batchResult.addedCount) || 0;
      result.skippedCount += Number(batchResult.skippedCount) || 0;
      this.setData({ importedItemCount: end });
    }
    return result;
  },

  async importMistakes() {
    if (this.data.importing || this.data.localBridgeLoading || !this.data.canImport) return;
    let items;
    try {
      items = this.parseImportText(this.data.importText);
    } catch (err) {
      wx.showToast({ title: "导入内容格式不正确", icon: "none" });
      return;
    }
    if (!this.data.studentId || !this.data.lessonId) {
      wx.showToast({ title: "缺少学生或课程信息", icon: "none" });
      return;
    }
    const importBatchId = this.createImportBatchId(this.data.importText);
    this.setData({
      importing: true,
      message: "",
      progressText: "正在导入文字内容",
      importedItemCount: 0,
      importTotalCount: items.length,
    });
    wx.showLoading({ title: "导入中", mask: true });
    let result;
    try {
      result = await this.importMistakeChunks(items, importBatchId);
    } catch (err) {
      console.error(err);
      const message = err.message || err.errMsg || "导入失败，请稍后重试";
      const completedCount = Number(err.importedItemCount) || this.data.importedItemCount || 0;
      this.setData({
        message,
        progressText: "已完成 " + completedCount + "/" + items.length + "，未完成部分可直接重试",
        importedItemCount: completedCount,
      });
      wx.showToast({ title: message, icon: "none" });
      return;
    } finally {
      wx.hideLoading();
      this.setData({ importing: false });
    }
    await this.clearLocalBridgeSession();
    wx.showToast({ title: "已导入 " + result.importedCount + " 道", icon: "none" });
    setTimeout(() => wx.navigateBack(), 600);
  },
});
