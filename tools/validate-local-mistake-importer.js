const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createServer } = require("./local-mistake-importer/server");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const serverSource = read("tools/local-mistake-importer/server.js");
const pageSource = read("tools/local-mistake-importer/index.html");
const token = "8393a7c9ed00a70b5cb76a3b466dfb1a198e73a8a9393a3f";

assert(serverSource.includes("const PROTOCOL_VERSION = 2"));
assert(!serverSource.includes('pathname === "/api/image"'));
assert(!pageSource.includes('type="file" accept="image/'));
assert(pageSource.includes("不再读取、传输或上传题目截图"));

const request = (port, method, pathname, payload) => new Promise((resolve, reject) => {
  const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
  const req = http.request({
    hostname: "127.0.0.1",
    port,
    method,
    path: pathname,
    headers: {
      Host: "127.0.0.1:3210",
      "X-Local-Import-Token": token,
      ...(body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}),
    },
  }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve({ statusCode: res.statusCode, data: text ? JSON.parse(text) : {} });
    });
  });
  req.on("error", reject);
  if (body) req.write(body);
  req.end();
});

const run = async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  try {
    const created = await request(port, "POST", "/api/session", {
      jsonFileName: "mistakes.json",
      datasetLabel: "测试资料",
      importText: JSON.stringify([{ questionNo: "1", questionText: "Question? A. One B. Two", correctAnswer: "B" }]),
    });
    assert.strictEqual(created.statusCode, 200);
    assert.strictEqual(created.data.protocolVersion, 2);
    assert.strictEqual(created.data.questionCount, 1);
    const manifest = await request(port, "GET", "/api/manifest");
    assert.strictEqual(manifest.data.ready, true);
    assert.strictEqual(manifest.data.questionCount, 1);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest.data, "images"), false);
    const invalid = await request(port, "POST", "/api/session", {
      jsonFileName: "invalid.json",
      importText: JSON.stringify([{ questionNo: "2", correctAnswer: "A" }]),
    });
    assert.strictEqual(invalid.statusCode, 400);
    assert(String(invalid.data.message).includes("完整题目文字"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("local mistake importer validation passed");
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
