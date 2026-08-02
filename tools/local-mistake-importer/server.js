"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 3210;
const ORIGIN = `http://${HOST}:${PORT}`;
const PROTOCOL_VERSION = 1;
const BRIDGE_TOKEN = "8393a7c9ed00a70b5cb76a3b466dfb1a198e73a8a9393a3f";
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 150 * 1024 * 1024;
const MAX_IMAGE_COUNT = 100;
const INDEX_HTML = Buffer.from(
  fs.readFileSync(path.join(__dirname, "index.html"), "utf8").replace(/__LOCAL_IMPORT_TOKEN__/g, BRIDGE_TOKEN)
);

let session = createEmptySession();

function createEmptySession() {
  return {
    version: "",
    ready: false,
    datasetLabel: "",
    jsonFileName: "",
    importText: "",
    expectedImages: [],
    imagesByName: new Map(),
  };
}

function getBasename(value) {
  return String(value || "")
    .trim()
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() || "";
}

function normalizeName(value) {
  return getBasename(value).toLowerCase();
}

function collectExpectedImages(items) {
  const seen = new Set();
  const result = [];
  items.forEach((item) => {
    const displayName = getBasename(item && item.sourceImageName);
    const normalizedName = normalizeName(displayName);
    if (!displayName || !normalizedName || seen.has(normalizedName)) return;
    seen.add(normalizedName);
    result.push({ displayName, normalizedName });
  });
  return result;
}

function parseImportItems(importText) {
  const text = String(importText || "").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : parsed && parsed.mistakes;
  if (!Array.isArray(items)) throw new Error("JSON 必须是错题数组");
  if (!items.length || items.length > 50) throw new Error("每次请选择包含 1 至 50 道错题的 JSON");
  return items;
}

function isAllowedHost(req) {
  const host = String(req.headers.host || "").toLowerCase();
  return host === `${HOST}:${PORT}` || host === `localhost:${PORT}`;
}

function setCommonHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  setCommonHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

function sendBuffer(res, statusCode, body, contentType) {
  setCommonHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": body.length,
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let tooLarge = false;

    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (tooLarge) return;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (tooLarge) {
        const err = new Error(`文件超过 ${Math.ceil(limit / 1024 / 1024)} MB 限制`);
        err.statusCode = 413;
        reject(err);
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function readJsonBody(req, limit) {
  const body = await readBody(req, limit);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function contentTypeForName(name, providedType) {
  const supplied = String(providedType || "").split(";")[0].trim().toLowerCase();
  if (supplied.startsWith("image/")) return supplied;
  const extension = path.extname(name).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

function currentImageBytes(exceptNormalizedName) {
  let total = 0;
  session.imagesByName.forEach((image, normalizedName) => {
    if (normalizedName !== exceptNormalizedName) total += image.buffer.length;
  });
  return total;
}

async function handleCreateSession(req, res) {
  const data = await readJsonBody(req, MAX_JSON_BYTES + 64 * 1024);
  const importText = String(data.importText || "");
  if (Buffer.byteLength(importText, "utf8") > MAX_JSON_BYTES) {
    throw new Error("JSON 文件超过 2 MB");
  }
  const items = parseImportItems(importText);
  const expectedImages = collectExpectedImages(items);
  if (expectedImages.length > MAX_IMAGE_COUNT) {
    throw new Error(`截图不能超过 ${MAX_IMAGE_COUNT} 张`);
  }
  session = {
    version: crypto.randomBytes(12).toString("hex"),
    ready: false,
    datasetLabel: String(data.datasetLabel || "").trim().slice(0, 120) || getBasename(data.jsonFileName) || "未命名资料",
    jsonFileName: getBasename(data.jsonFileName) || "mistakes.json",
    importText,
    expectedImages,
    imagesByName: new Map(),
  };
  sendJson(res, 200, {
    success: true,
    protocolVersion: PROTOCOL_VERSION,
    version: session.version,
    questionCount: items.length,
    expectedImages: expectedImages.map((item) => item.displayName),
  });
}

async function handleUploadImage(req, res, url) {
  const version = String(url.searchParams.get("version") || "");
  const displayName = getBasename(url.searchParams.get("name"));
  const normalizedName = normalizeName(displayName);
  if (!session.version || version !== session.version) throw new Error("本地导入会话已失效，请重新准备文件");
  const expected = session.expectedImages.find((item) => item.normalizedName === normalizedName);
  if (!expected) throw new Error(`JSON 中没有引用图片：${displayName || "未命名图片"}`);
  const extension = path.extname(displayName).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
    throw new Error(`不支持的图片格式：${displayName}`);
  }
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    const err = new Error(`单张图片不能超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB：${displayName}`);
    err.statusCode = 413;
    throw err;
  }
  if (contentLength && currentImageBytes(normalizedName) + contentLength > MAX_TOTAL_IMAGE_BYTES) {
    const err = new Error("全部图片合计不能超过 150 MB");
    err.statusCode = 413;
    throw err;
  }
  const body = await readBody(req, MAX_IMAGE_BYTES);
  if (!body.length) throw new Error(`图片为空：${displayName}`);
  if (currentImageBytes(normalizedName) + body.length > MAX_TOTAL_IMAGE_BYTES) {
    throw new Error("全部图片合计超过 150 MB");
  }
  session.imagesByName.set(normalizedName, {
    name: expected.displayName,
    buffer: body,
    contentType: contentTypeForName(displayName, req.headers["content-type"]),
  });
  sendJson(res, 200, {
    success: true,
    protocolVersion: PROTOCOL_VERSION,
    uploadedCount: session.imagesByName.size,
    expectedCount: session.expectedImages.length,
  });
}

async function handleReady(req, res) {
  const data = await readJsonBody(req, 16 * 1024);
  if (!session.version || String(data.version || "") !== session.version) {
    throw new Error("本地导入会话已失效，请重新准备文件");
  }
  const missing = session.expectedImages
    .filter((item) => !session.imagesByName.has(item.normalizedName))
    .map((item) => item.displayName);
  if (missing.length) throw new Error(`仍缺少 ${missing.length} 张截图：${missing.join("、")}`);
  session.ready = true;
  sendJson(res, 200, {
    success: true,
    protocolVersion: PROTOCOL_VERSION,
    ready: true,
    questionCount: parseImportItems(session.importText).length,
    imageCount: session.imagesByName.size,
  });
}

function handleManifest(res) {
  if (!session.ready) {
    sendJson(res, 200, { success: true, protocolVersion: PROTOCOL_VERSION, ready: false });
    return;
  }
  sendJson(res, 200, {
    success: true,
    protocolVersion: PROTOCOL_VERSION,
    ready: true,
    version: session.version,
    datasetLabel: session.datasetLabel,
    jsonFileName: session.jsonFileName,
    importText: session.importText,
    images: session.expectedImages.map((item) => {
      const image = session.imagesByName.get(item.normalizedName);
      return {
        name: image.name,
        size: image.buffer.length,
        url: `/api/image?name=${encodeURIComponent(image.name)}&version=${session.version}`,
      };
    }),
  });
}

function handleDownloadImage(res, url) {
  const version = String(url.searchParams.get("version") || "");
  const normalizedName = normalizeName(url.searchParams.get("name"));
  if (!session.ready || !session.version || version !== session.version) {
    sendJson(res, 404, { success: false, message: "本地导入会话不存在或尚未准备完成" });
    return;
  }
  const image = session.imagesByName.get(normalizedName);
  if (!image) {
    sendJson(res, 404, { success: false, message: "图片不存在" });
    return;
  }
  sendBuffer(res, 200, image.buffer, image.contentType);
}

async function handleRequest(req, res) {
  if (!isAllowedHost(req)) {
    sendJson(res, 403, { success: false, message: "只允许本机访问" });
    return;
  }

  const url = new URL(req.url, ORIGIN);
  if (url.pathname.startsWith("/api/") && req.headers["x-local-import-token"] !== BRIDGE_TOKEN) {
    sendJson(res, 403, { success: false, message: "本地导入请求未授权" });
    return;
  }
  if (req.method === "GET" && url.pathname === "/") {
    sendBuffer(res, 200, INDEX_HTML, "text/html; charset=utf-8");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/manifest") {
    handleManifest(res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/image") {
    handleDownloadImage(res, url);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/session") {
    await handleCreateSession(req, res);
    return;
  }
  if (req.method === "PUT" && url.pathname === "/api/image") {
    await handleUploadImage(req, res, url);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/ready") {
    await handleReady(req, res);
    return;
  }
  if (req.method === "DELETE" && url.pathname === "/api/session") {
    const version = String(url.searchParams.get("version") || "");
    if (version && session.version && version !== session.version) {
      sendJson(res, 409, { success: false, message: "本地导入会话已经更新" });
      return;
    }
    session = createEmptySession();
    sendJson(res, 200, { success: true, protocolVersion: PROTOCOL_VERSION });
    return;
  }
  sendJson(res, 404, { success: false, message: "地址不存在" });
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, err.statusCode || 400, { success: false, message: err.message || "本地导入失败" });
      } else {
        res.end();
      }
    });
  });
}

function openBrowser() {
  if (process.argv.includes("--no-open")) return;
  if (process.platform === "win32") {
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", ORIGIN], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }
}

if (require.main === module) {
  const server = createServer();
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`端口 ${PORT} 已被占用。请关闭旧的本地导入助手后再试。`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log("电脑本地错题导入助手已启动：");
    console.log(ORIGIN);
    console.log("请在浏览器选择文件；完成后保持此窗口开启，直到小程序显示读取成功。");
    console.log("按 Ctrl+C 可关闭助手。");
    openBrowser();
  });
}

module.exports = { createServer };
