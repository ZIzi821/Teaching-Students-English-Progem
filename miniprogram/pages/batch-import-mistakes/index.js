const LOCAL_BRIDGE_ORIGIN = "http://127.0.0.1:3210";
const LOCAL_BRIDGE_PROTOCOL_VERSION = 1;
const LOCAL_BRIDGE_TOKEN = "8393a7c9ed00a70b5cb76a3b466dfb1a198e73a8a9393a3f";
const IMPORT_CHUNK_SIZE = 5;

Page({
  data: {
    lessonId: "",
    studentId: "",
    lesson: null,
    importText: "",
    jsonFileName: "",
    jsonValid: false,
    previewCount: 0,
    expectedImageCount: 0,
    selectedImageCount: 0,
    matchedImageCount: 0,
    missingImageNames: [],
    hasDeclaredImages: false,
    canImport: false,
    uploadProgressText: "",
    uploadedImageCount: 0,
    uploadTotalCount: 0,
    importedItemCount: 0,
    importTotalCount: 0,
    isDevTools: false,
    localBridgeLoading: false,
    localBridgeProgressText: "",
    localBridgeCompletedCount: 0,
    localBridgeTotalCount: 0,
    localBridgeError: "",
    message: "",
    importing: false,
  },

  onLoad(options) {
    this.selectedImagesByName = Object.create(null);
    this.uploadedImageCache = Object.create(null);
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
    wx.cloud
      .callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getLessonDetail",
          data: { lessonId: this.data.lessonId },
        },
      })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({ message: result.message || "课程读取失败" });
          return;
        }
        this.setData({ lesson: result.lesson, message: "" });
      })
      .catch((err) => {
        console.error(err);
        this.setData({ message: "课程读取失败" });
      });
  },

  parseImportText(importText) {
    const text = String(importText || "").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed && parsed.mistakes;
    if (!Array.isArray(items)) {
      throw new Error("导入内容必须是 JSON 数组");
    }
    return items;
  },

  getFilePath(file) {
    return (file && (file.path || file.tempFilePath)) || "";
  },

  getBasename(value) {
    const parts = String(value || "")
      .trim()
      .split(/[\\/]/)
      .filter((part) => part);
    return parts.length ? parts[parts.length - 1] : "";
  },

  normalizeImageName(value) {
    const raw = String(value == null ? "" : value).trim();
    return (this.getBasename(raw) || raw).toLowerCase();
  },

  getSourceImageName(item) {
    if (!item || typeof item !== "object") return "";
    return String(item.sourceImageName == null ? "" : item.sourceImageName).trim();
  },

  collectExpectedImages(items) {
    const seen = Object.create(null);
    const images = [];
    items.forEach((item) => {
      const rawName = this.getSourceImageName(item);
      if (!rawName) return;
      const normalizedName = this.normalizeImageName(rawName);
      if (seen[normalizedName]) return;
      seen[normalizedName] = true;
      images.push({
        normalizedName,
        displayName: this.getBasename(rawName) || rawName,
      });
    });
    return images;
  },

  ensureImageStores() {
    if (!this.selectedImagesByName) this.selectedImagesByName = Object.create(null);
    if (!this.uploadedImageCache) this.uploadedImageCache = Object.create(null);
  },

  refreshPreview(importText, extraData) {
    this.ensureImageStores();
    let items = [];
    let jsonValid = false;
    try {
      items = this.parseImportText(importText);
      jsonValid = true;
    } catch (err) {
      items = [];
    }

    const expectedImages = jsonValid ? this.collectExpectedImages(items) : [];
    const missingImageNames = expectedImages
      .filter((image) => !this.selectedImagesByName[image.normalizedName])
      .map((image) => image.displayName);
    const expectedImageCount = expectedImages.length;
    const matchedImageCount = expectedImageCount - missingImageNames.length;
    const previewCount = jsonValid ? items.length : 0;
    this.setData(
      Object.assign(
        {
          importText,
          jsonValid,
          previewCount,
          expectedImageCount,
          selectedImageCount: Object.keys(this.selectedImagesByName).length,
          matchedImageCount,
          missingImageNames,
          hasDeclaredImages: expectedImageCount > 0,
          canImport: jsonValid && previewCount > 0 && previewCount <= 50 && missingImageNames.length === 0,
        },
        extraData || {}
      )
    );
    return jsonValid;
  },

  onImportTextInput(e) {
    this.refreshPreview(e.detail.value, {
      jsonFileName: "",
      message: "",
      uploadProgressText: "",
    });
  },

  resolveLocalBridgeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) throw new Error("本地图片地址为空");
    if (/^https?:\/\//i.test(raw)) {
      if (raw.indexOf(LOCAL_BRIDGE_ORIGIN + "/") !== 0) {
        throw new Error("本地图片地址不是受信任的电脑地址");
      }
      return raw;
    }
    return LOCAL_BRIDGE_ORIGIN + (raw.charAt(0) === "/" ? raw : "/" + raw);
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
            reject(new Error("电脑本地导入助手响应异常"));
            return;
          }
          resolve(res.data || {});
        },
        fail: (err) => {
          const detail = String((err && err.errMsg) || "");
          const settingHint = /domain|https|合法域名/i.test(detail)
            ? "。请在开发者工具的本地设置中勾选“不校验合法域名”"
            : "";
          reject(new Error((detail ? "无法连接电脑本地导入助手：" + detail : "无法连接电脑本地导入助手") + settingHint));
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
          if (res.confirm) {
            resolve();
          } else {
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

  downloadLocalBridgeImage(image, index, total) {
    const displayName = this.getBasename(image && image.name);
    const normalizedName = this.normalizeImageName(displayName);
    if (!displayName || !normalizedName) {
      return Promise.reject(new Error("本地清单包含无效图片文件名"));
    }

    let url;
    try {
      url = this.resolveLocalBridgeUrl(image.url);
    } catch (err) {
      return Promise.reject(err);
    }

    this.setData({
      localBridgeProgressText: "正在从电脑读取 " + (index + 1) + "/" + total + "：" + displayName,
    });
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url,
        header: { "X-Local-Import-Token": LOCAL_BRIDGE_TOKEN },
        timeout: 30000,
        success: (res) => {
          if (!res || res.statusCode < 200 || res.statusCode >= 300 || !res.tempFilePath) {
            reject(new Error("图片读取失败：" + displayName));
            return;
          }
          resolve({
            normalizedName,
            file: {
              name: displayName,
              size: Number(image.size) || 0,
              path: res.tempFilePath,
              tempFilePath: res.tempFilePath,
            },
          });
        },
        fail: (err) => {
          const detail = String((err && err.errMsg) || "");
          reject(new Error("图片读取失败：" + displayName + (detail ? "（" + detail + "）" : "")));
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
      localBridgeProgressText: "正在连接电脑本地导入助手",
      localBridgeCompletedCount: 0,
      localBridgeTotalCount: 0,
      localBridgeError: "",
    });

    try {
      const manifest = await this.requestLocalBridgeManifest();
      if (manifest.success === false) {
        throw new Error(manifest.message || "电脑本地导入助手读取失败");
      }
      if (Number(manifest.protocolVersion) !== LOCAL_BRIDGE_PROTOCOL_VERSION) {
        throw new Error("电脑本地导入助手版本不一致，请关闭旧窗口并重新启动助手");
      }
      if (!manifest.ready) {
        throw new Error("本地导入助手尚未准备文件，请先在电脑端选择 JSON 和图片文件夹");
      }
      await this.confirmLocalDataset(manifest);
      this.localBridgeVersion = String(manifest.version || "");

      const importText = typeof manifest.importText === "string" ? manifest.importText : "";
      if (!importText) throw new Error("电脑端没有提供 JSON 内容");
      try {
        this.parseImportText(importText);
      } catch (err) {
        throw new Error("电脑端 JSON 格式不正确：" + err.message);
      }

      const images = Array.isArray(manifest.images) ? manifest.images : [];
      const downloadedImagesByName = Object.create(null);
      const seenNames = Object.create(null);
      this.setData({
        localBridgeProgressText: images.length ? "准备读取电脑图片" : "已读取 JSON，未发现题目截图",
        localBridgeTotalCount: images.length,
      });

      for (let i = 0; i < images.length; i++) {
        const normalizedName = this.normalizeImageName(images[i] && images[i].name);
        if (!normalizedName) throw new Error("本地清单包含无效图片文件名");
        if (seenNames[normalizedName]) throw new Error("本地清单包含同名图片：" + images[i].name);
        seenNames[normalizedName] = true;
        const downloaded = await this.downloadLocalBridgeImage(images[i], i, images.length);
        downloadedImagesByName[downloaded.normalizedName] = downloaded.file;
        this.setData({ localBridgeCompletedCount: i + 1 });
      }

      this.selectedImagesByName = downloadedImagesByName;
      this.uploadedImageCache = Object.create(null);
      const items = this.parseImportText(importText);
      const expectedImages = this.collectExpectedImages(items);
      const missingNames = expectedImages
        .filter((image) => !downloadedImagesByName[image.normalizedName])
        .map((image) => image.displayName);
      const localBridgeError = missingNames.length
        ? "电脑端仍缺少 " + missingNames.length + " 张截图：" + missingNames.join("、")
        : "";
      this.refreshPreview(importText, {
        jsonFileName: manifest.jsonFileName || "电脑本地 JSON",
        message: "",
        uploadProgressText: "",
        localBridgeProgressText: missingNames.length
          ? "电脑文件已读取，但截图未匹配完整"
          : "已从电脑读取“" + (manifest.datasetLabel || manifest.jsonFileName || "本地资料") + "”及 " + images.length + " 张截图",
        localBridgeError,
      });
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
        const filePath = this.getFilePath(file);
        if (!file || !filePath) {
          wx.showToast({ title: "没有读取到 JSON 文件", icon: "none" });
          return;
        }
        wx.getFileSystemManager().readFile({
          filePath,
          encoding: "utf8",
          success: (readRes) => {
            const importText = typeof readRes.data === "string" ? readRes.data : String(readRes.data || "");
            const jsonValid = this.refreshPreview(importText, {
              jsonFileName: file.name || this.getBasename(filePath) || "已选择 JSON",
              message: "",
              uploadProgressText: "",
            });
            if (!jsonValid) {
              this.setData({ message: "JSON 文件格式不正确" });
            }
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

  getFileSignature(file) {
    return [file.name || "", file.size || "", this.getFilePath(file)].join("|");
  },

  invalidateImageCache(normalizedName) {
    this.ensureImageStores();
    Object.keys(this.uploadedImageCache).forEach((cacheKey) => {
      if (this.uploadedImageCache[cacheKey].normalizedName === normalizedName) {
        delete this.uploadedImageCache[cacheKey];
      }
    });
  },

  chooseImages() {
    if (this.data.importing || this.data.localBridgeLoading) return;
    wx.chooseMessageFile({
      count: 100,
      type: "image",
      success: (res) => {
        this.ensureImageStores();
        const files = res.tempFiles || [];
        let acceptedCount = 0;
        files.forEach((file) => {
          const filePath = this.getFilePath(file);
          const displayName = file.name || this.getBasename(filePath);
          const normalizedName = this.normalizeImageName(displayName);
          if (!filePath || !normalizedName) return;
          const previous = this.selectedImagesByName[normalizedName];
          if (!previous || this.getFileSignature(previous) !== this.getFileSignature(file)) {
            this.invalidateImageCache(normalizedName);
          }
          this.selectedImagesByName[normalizedName] = file;
          acceptedCount += 1;
        });
        this.refreshPreview(this.data.importText, {
          message: acceptedCount ? "" : "没有读取到可用图片",
          uploadProgressText: "",
        });
      },
      fail: (err) => {
        if (String((err && err.errMsg) || "").indexOf("cancel") < 0) {
          wx.showToast({ title: "图片选择失败", icon: "none" });
        }
      },
    });
  },

  clearSelectedImages() {
    if (this.data.importing || this.data.localBridgeLoading) return;
    this.selectedImagesByName = Object.create(null);
    this.refreshPreview(this.data.importText, {
      message: "",
      uploadProgressText: "",
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

  sanitizeCloudSegment(value, fallback) {
    const sanitized = String(value || "")
      .replace(/[\\/]/g, "_")
      .replace(/[^0-9A-Za-z._-]/g, "_")
      .slice(0, 80);
    return sanitized || fallback;
  },

  sanitizeCloudFileName(value) {
    const basename = this.getBasename(value) || "image.png";
    const extensionMatch = basename.match(/(\.[^.]+)$/);
    const extension = extensionMatch ? extensionMatch[1].replace(/[^0-9A-Za-z.]/g, "").slice(0, 10) : ".png";
    const stem = extensionMatch ? basename.slice(0, -extensionMatch[1].length) : basename;
    const safeStem = stem.replace(/[^0-9A-Za-z._-]/g, "_").slice(0, 60) || "image";
    return safeStem + (extension || ".png");
  },

  buildCloudPath(importBatchId, image, file, index) {
    const number = ("000" + (index + 1)).slice(-3);
    const selectedName = file.name || this.getBasename(this.getFilePath(file)) || image.displayName;
    const uniqueName = number + "-" + this.hashText(image.normalizedName) + "-" + this.sanitizeCloudFileName(selectedName);
    return [
      "english-mistake-images/batch",
      this.sanitizeCloudSegment(this.data.studentId, "student"),
      this.sanitizeCloudSegment(importBatchId, "import"),
      uniqueName,
    ].join("/");
  },

  async uploadExpectedImages(expectedImages, importBatchId) {
    this.ensureImageStores();
    const fileIdsByName = Object.create(null);
    const uploadTotalCount = expectedImages.length;
    this.setData({ uploadedImageCount: 0, uploadTotalCount });

    for (let i = 0; i < expectedImages.length; i++) {
      const image = expectedImages[i];
      const file = this.selectedImagesByName[image.normalizedName];
      const filePath = this.getFilePath(file);
      if (!file || !filePath) {
        throw new Error("缺少截图：" + image.displayName);
      }

      const signature = this.getFileSignature(file);
      const cacheKey = importBatchId + "|" + image.normalizedName;
      const cached = this.uploadedImageCache[cacheKey];
      if (cached && cached.signature === signature && cached.fileID) {
        fileIdsByName[image.normalizedName] = cached.fileID;
        this.setData({
          uploadedImageCount: i + 1,
          uploadProgressText: "已复用截图 " + (i + 1) + "/" + uploadTotalCount + "：" + image.displayName,
        });
        continue;
      }

      this.setData({
        uploadProgressText: "正在上传截图 " + (i + 1) + "/" + uploadTotalCount + "：" + image.displayName,
      });
      wx.showLoading({ title: "上传 " + (i + 1) + "/" + uploadTotalCount, mask: true });
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: this.buildCloudPath(importBatchId, image, file, i),
        filePath,
      });
      if (!uploadRes || !uploadRes.fileID) {
        throw new Error("截图上传失败：" + image.displayName);
      }
      const checkRes = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "checkUploadedImage",
          data: { fileID: uploadRes.fileID },
        },
      });
      const checkResult = checkRes.result || {};
      if (checkResult.success === false) {
        throw new Error(checkResult.message || "截图未通过内容检查：" + image.displayName);
      }
      this.uploadedImageCache[cacheKey] = {
        normalizedName: image.normalizedName,
        signature,
        fileID: uploadRes.fileID,
      };
      fileIdsByName[image.normalizedName] = uploadRes.fileID;
      this.setData({ uploadedImageCount: i + 1 });
    }
    return fileIdsByName;
  },

  attachImageFileIds(items, fileIdsByName) {
    return items.map((item) => {
      const source = item && typeof item === "object" ? item : {};
      const sourceImageName = this.getSourceImageName(source);
      if (!sourceImageName) return Object.assign({}, source);
      return Object.assign({}, source, {
        questionImageFileId: fileIdsByName[this.normalizeImageName(sourceImageName)] || "",
      });
    });
  },

  async importMistakeChunks(items, importBatchId) {
    const batchTotal = Math.ceil(items.length / IMPORT_CHUNK_SIZE);
    const result = {
      success: true,
      importedCount: 0,
      addedCount: 0,
      updatedImageCount: 0,
      skippedCount: 0,
    };

    this.setData({
      importedItemCount: 0,
      importTotalCount: items.length,
    });

    for (let start = 0; start < items.length; start += IMPORT_CHUNK_SIZE) {
      const batchNo = Math.floor(start / IMPORT_CHUNK_SIZE) + 1;
      const end = Math.min(start + IMPORT_CHUNK_SIZE, items.length);
      this.setData({
        uploadProgressText: "正在导入第 " + batchNo + "/" + batchTotal + " 批（" + (start + 1) + "-" + end + "题）",
      });
      wx.showLoading({ title: "导入 " + batchNo + "/" + batchTotal, mask: true });

      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "batchImportMistakes",
          data: {
            studentId: this.data.studentId,
            lessonId: this.data.lessonId,
            importBatchId,
            importItemOffset: start,
            items: items.slice(start, end),
          },
        },
      });
      const batchResult = res.result || {};
      if (!batchResult.success) {
        const error = new Error(batchResult.message || "第 " + batchNo + " 批导入失败");
        error.importedItemCount = start;
        error.batchNo = batchNo;
        error.batchTotal = batchTotal;
        throw error;
      }

      result.importedCount += Number(batchResult.importedCount) || 0;
      result.addedCount += Number(batchResult.addedCount) || 0;
      result.updatedImageCount += Number(batchResult.updatedImageCount) || 0;
      result.skippedCount += Number(batchResult.skippedCount) || 0;
      this.setData({ importedItemCount: end });
    }

    return result;
  },

  async importMistakes() {
    if (this.data.importing || this.data.localBridgeLoading) return;
    let items;
    try {
      items = this.parseImportText(this.data.importText);
    } catch (err) {
      wx.showToast({ title: "导入内容格式不正确", icon: "none" });
      return;
    }
    if (!items.length) {
      wx.showToast({ title: "没有可导入的错题", icon: "none" });
      return;
    }
    if (items.length > 50) {
      wx.showToast({ title: "每次最多导入 50 道错题", icon: "none" });
      return;
    }
    if (!this.data.studentId || !this.data.lessonId) {
      wx.showToast({ title: "缺少学生或课程信息", icon: "none" });
      return;
    }

    const expectedImages = this.collectExpectedImages(items);
    const missingImageNames = expectedImages
      .filter((image) => !this.selectedImagesByName[image.normalizedName])
      .map((image) => image.displayName);
    if (missingImageNames.length) {
      this.setData({
        missingImageNames,
        message: "请先补齐全部题目截图",
      });
      wx.showToast({ title: "还有 " + missingImageNames.length + " 张截图未匹配", icon: "none" });
      return;
    }

    const importBatchId = this.createImportBatchId(this.data.importText);
    this.setData({
      importing: true,
      message: "",
      uploadProgressText: expectedImages.length ? "准备上传截图" : "正在导入文字内容",
      uploadedImageCount: 0,
      uploadTotalCount: expectedImages.length,
      importedItemCount: 0,
      importTotalCount: 0,
    });
    wx.showLoading({ title: expectedImages.length ? "准备上传" : "导入中", mask: true });

    let result;
    try {
      const fileIdsByName = await this.uploadExpectedImages(expectedImages, importBatchId);
      const itemsWithImages = this.attachImageFileIds(items, fileIdsByName);
      result = await this.importMistakeChunks(itemsWithImages, importBatchId);
    } catch (err) {
      console.error(err);
      const message = err.message || err.errMsg || "导入失败，请稍后重试";
      const completedCount = Number(err.importedItemCount) || this.data.importedItemCount || 0;
      const progressText = this.data.importTotalCount
        ? "已完成 " + completedCount + "/" + items.length + "，未完成部分可直接重试"
        : "导入未完成，可直接重试";
      this.setData({ message, uploadProgressText: progressText, importedItemCount: completedCount });
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
