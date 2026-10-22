"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 3211;
const ORIGIN = `http://${HOST}:${PORT}`;
const PROTOCOL_VERSION = 1;
const BRIDGE_TOKEN = "fd5b0c8301b641b5b28651b0d6b414ee637f0c4e6a5fb984";
const MAX_FILE_COUNT = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".ppt", ".pptx", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp3", ".m4a", ".wav", ".aac"]);
const INDEX_HTML = Buffer.from(
  fs.readFileSync(path.join(__dirname, "index.html"), "utf8").replace(/__LOCAL_MATERIAL_TOKEN__/g, BRIDGE_TOKEN)
);

let session = createEmptySession();

function createEmptySession() {
  return { version: "", ready: false, label: "", files: [] };
}

function basename(value) {
  return String(value || "").trim().split(/[\\/]/).filter(Boolean).pop() || "";
}

function contentTypeForName(name, supplied) {
  const provided = String(supplied || "").split(";")[0].trim().toLowerCase();
  if (/^(application\/pdf|application\/vnd\.|image\/|audio\/)/.test(provided)) return provided;
  const extension = path.extname(name).toLowerCase();
  const types = {
    ".pdf": "application/pdf", ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".aac": "audio/aac",
  };
  return types[extension] || "application/octet-stream";
}

function isAllowedHost(req) {
  const host = String(req.headers.host || "").toLowerCase();
  return host === `${HOST}:${PORT}` || host === `localhost:${PORT}`;
}

function setHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  setHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
  res.end(body);
}

function sendBuffer(res, status, body, contentType) {
  setHeaders(res);
  res.writeHead(status, { "Content-Type": contentType, "Content-Length": body.length });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (tooLarge) {
        const err = new Error(`单个文件上限为 ${Math.round(limit / 1024 / 1024)} MB`);
        err.statusCode = 413;
        reject(err);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

async function readJson(req, limit = 128 * 1024) {
  const body = await readBody(req, limit);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

async function createSession(req, res) {
  const data = await readJson(req);
  const sourceFiles = Array.isArray(data.files) ? data.files : [];
  if (!sourceFiles.length || sourceFiles.length > MAX_FILE_COUNT) {
    throw new Error(`每次请选择 1 至 ${MAX_FILE_COUNT} 个资料文件`);
  }
  let total = 0;
  const files = sourceFiles.map((item, index) => {
    const name = basename(item && item.name);
    const size = Math.max(0, Number(item && item.size) || 0);
    const extension = path.extname(name).toLowerCase();
    if (!name || !ALLOWED_EXTENSIONS.has(extension)) throw new Error(`请选择支持的文件格式：${name || `第 ${index + 1} 个文件`}`);
    if (size > MAX_FILE_BYTES) throw new Error(`文件超过 50 MB：${name}`);
    total += size;
    return { index, name, size, contentType: contentTypeForName(name, item && item.type), buffer: null };
  });
  if (total > MAX_TOTAL_BYTES) throw new Error("全部资料合计上限为 250 MB");
  session = {
    version: crypto.randomBytes(12).toString("hex"),
    ready: false,
    label: String(data.label || "").trim().slice(0, 120) || "电脑本地资料",
    files,
  };
  sendJson(res, 200, { success: true, protocolVersion: PROTOCOL_VERSION, version: session.version, fileCount: files.length });
}

async function uploadFile(req, res, url) {
  const version = String(url.searchParams.get("version") || "");
  const index = Number(url.searchParams.get("index"));
  if (!session.version || version !== session.version) throw new Error("本地资料会话已失效，请重新准备文件");
  const file = session.files[index];
  if (!file) throw new Error("资料序号无效");
  const body = await readBody(req, MAX_FILE_BYTES);
  if (!body.length) throw new Error(`文件为空：${file.name}`);
  const total = session.files.reduce((sum, item) => sum + (item.index === index ? 0 : item.buffer ? item.buffer.length : 0), 0) + body.length;
  if (total > MAX_TOTAL_BYTES) throw new Error("全部资料合计上限为 250 MB");
  file.buffer = body;
  file.size = body.length;
  file.contentType = contentTypeForName(file.name, req.headers["content-type"]);
  sendJson(res, 200, { success: true, uploadedCount: session.files.filter((item) => item.buffer).length, fileCount: session.files.length });
}

async function markReady(req, res) {
  const data = await readJson(req, 16 * 1024);
  if (!session.version || String(data.version || "") !== session.version) throw new Error("本地资料会话已失效，请重新准备文件");
  const missing = session.files.filter((item) => !item.buffer).map((item) => item.name);
  if (missing.length) throw new Error(`仍有 ${missing.length} 个文件未准备完成：${missing.join("、")}`);
  session.ready = true;
  sendJson(res, 200, { success: true, protocolVersion: PROTOCOL_VERSION, ready: true, fileCount: session.files.length });
}

function manifest(res) {
  if (!session.ready) {
    sendJson(res, 200, { success: true, protocolVersion: PROTOCOL_VERSION, ready: false });
    return;
  }
  sendJson(res, 200, {
    success: true,
    protocolVersion: PROTOCOL_VERSION,
    ready: true,
    version: session.version,
    label: session.label,
    files: session.files.map((file) => ({
      index: file.index,
      name: file.name,
      size: file.buffer.length,
      contentType: file.contentType,
      url: `/api/material-file?index=${file.index}&version=${session.version}`,
    })),
  });
}

function downloadFile(res, url) {
  const version = String(url.searchParams.get("version") || "");
  const file = session.files[Number(url.searchParams.get("index"))];
  if (!session.ready || !file || !file.buffer || version !== session.version) {
    sendJson(res, 404, { success: false, message: "本地资料不存在或尚未准备完成" });
    return;
  }
  sendBuffer(res, 200, file.buffer, file.contentType);
}

async function handleRequest(req, res) {
  if (!isAllowedHost(req)) return sendJson(res, 403, { success: false, message: "只允许本机访问" });
  const url = new URL(req.url, ORIGIN);
  if (url.pathname.startsWith("/api/") && req.headers["x-local-material-token"] !== BRIDGE_TOKEN) {
    return sendJson(res, 403, { success: false, message: "本地资料请求未授权" });
  }
  if (req.method === "GET" && url.pathname === "/") return sendBuffer(res, 200, INDEX_HTML, "text/html; charset=utf-8");
  if (req.method === "POST" && url.pathname === "/api/material-session") return createSession(req, res);
  if (req.method === "PUT" && url.pathname === "/api/material-file") return uploadFile(req, res, url);
  if (req.method === "POST" && url.pathname === "/api/material-ready") return markReady(req, res);
  if (req.method === "GET" && url.pathname === "/api/material-manifest") return manifest(res);
  if (req.method === "GET" && url.pathname === "/api/material-file") return downloadFile(res, url);
  if (req.method === "DELETE" && url.pathname === "/api/material-session") {
    session = createEmptySession();
    return sendJson(res, 200, { success: true, protocolVersion: PROTOCOL_VERSION });
  }
  return sendJson(res, 404, { success: false, message: "地址不存在" });
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, err.statusCode || 400, { success: false, message: err.message || "本地资料准备失败" });
      else res.end();
    });
  });
}

function openBrowser() {
  if (process.argv.includes("--no-open")) return;
  if (process.platform === "win32") {
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", ORIGIN], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  }
}

if (require.main === module) {
  const server = createServer();
  server.on("error", (err) => {
    console.error(err.code === "EADDRINUSE" ? `端口 ${PORT} 已被占用，请关闭旧的电脑资料上传助手后再试。` : err);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log("电脑课程资料上传助手已启动：");
    console.log(ORIGIN);
    console.log("浏览器准备完成后，请保持此窗口开启，再到微信开发者工具读取。按 Ctrl+C 关闭。");
    openBrowser();
  });
}

module.exports = { createServer };
