"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 3210;
const ORIGIN = `http://${HOST}:${PORT}`;
const PROTOCOL_VERSION = 2;
const BRIDGE_TOKEN = "8393a7c9ed00a70b5cb76a3b466dfb1a198e73a8a9393a3f";
const MAX_JSON_BYTES = 2 * 1024 * 1024;
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
    questionCount: 0,
  };
}

function getBasename(value) {
  return String(value || "").trim().split(/[\\/]/).filter(Boolean).pop() || "";
}

function parseImportItems(importText) {
  const text = String(importText || "").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : parsed && parsed.mistakes;
  if (!Array.isArray(items)) throw new Error("JSON 必须是错题数组");
  if (!items.length || items.length > 50) throw new Error("每次请选择包含 1 至 50 道错题的 JSON");
  const missing = items.map((item, index) => (
    item && typeof item === "object" && String(item.questionText || "").trim() ? 0 : index + 1
  )).filter((index) => index);
  if (missing.length) throw new Error(`第 ${missing.join("、")} 条缺少完整题目文字和选项`);
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
    let tooLarge = false;
    req.on("data", (chunk) => {
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
      if (tooLarge) {
        const err = new Error(`JSON 文件超过 ${Math.ceil(limit / 1024 / 1024)} MB 限制`);
        err.statusCode = 413;
        reject(err);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

async function readJsonBody(req, limit) {
  const body = await readBody(req, limit);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

async function handleCreateSession(req, res) {
  const data = await readJsonBody(req, MAX_JSON_BYTES + 64 * 1024);
  const importText = String(data.importText || "");
  if (Buffer.byteLength(importText, "utf8") > MAX_JSON_BYTES) throw new Error("JSON 文件超过 2 MB");
  const items = parseImportItems(importText);
  session = {
    version: crypto.randomBytes(12).toString("hex"),
    ready: true,
    datasetLabel: String(data.datasetLabel || "").trim().slice(0, 120) || getBasename(data.jsonFileName) || "未命名资料",
    jsonFileName: getBasename(data.jsonFileName) || "mistakes.json",
    importText,
    questionCount: items.length,
  };
  sendJson(res, 200, {
    success: true,
    protocolVersion: PROTOCOL_VERSION,
    version: session.version,
    ready: true,
    questionCount: session.questionCount,
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
    questionCount: session.questionCount,
  });
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
  if (req.method === "POST" && url.pathname === "/api/session") {
    await handleCreateSession(req, res);
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
      if (!res.headersSent) sendJson(res, err.statusCode || 400, { success: false, message: err.message || "本地导入失败" });
      else res.end();
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
    if (err.code === "EADDRINUSE") console.error(`端口 ${PORT} 已被占用。请关闭旧的本地导入助手后再试。`);
    else console.error(err);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log("电脑本地错题 JSON 导入助手已启动：");
    console.log(ORIGIN);
    console.log("请选择 JSON；完成后保持此窗口开启，直到小程序显示读取成功。");
    console.log("按 Ctrl+C 可关闭助手。");
    openBrowser();
  });
}

module.exports = { createServer };
