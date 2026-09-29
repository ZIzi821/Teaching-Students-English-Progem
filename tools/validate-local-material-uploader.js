const assert = require("assert");
const http = require("http");
const { createServer } = require("./local-material-uploader/server");

const HOST = "127.0.0.1";
const PORT = 3211;
const TOKEN = "fd5b0c8301b641b5b28651b0d6b414ee637f0c4e6a5fb984";

const request = ({ method = "GET", path, body, authorized = true, contentType = "application/json" }) => new Promise((resolve, reject) => {
  const payload = body == null
    ? null
    : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const headers = {};
  if (authorized) headers["X-Local-Material-Token"] = TOKEN;
  if (payload) {
    headers["Content-Type"] = contentType;
    headers["Content-Length"] = payload.length;
  }
  const req = http.request({ host: HOST, port: PORT, method, path, headers }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on("error", reject);
  if (payload) req.write(payload);
  req.end();
});

const parseJson = (response) => JSON.parse(response.body.toString("utf8"));

async function run() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });
  try {
    const unauthorized = await request({ path: "/api/material-manifest", authorized: false });
    assert.strictEqual(unauthorized.status, 403);

    const createdResponse = await request({
      method: "POST",
      path: "/api/material-session",
      body: { label: "测试资料", files: [{ name: "lesson.pdf", size: 8, type: "application/pdf" }] },
    });
    assert.strictEqual(createdResponse.status, 200);
    const created = parseJson(createdResponse);
    assert(created.version);

    const sample = Buffer.from("%PDF-test");
    const uploaded = await request({
      method: "PUT",
      path: `/api/material-file?index=0&version=${created.version}`,
      body: sample,
      contentType: "application/pdf",
    });
    assert.strictEqual(uploaded.status, 200);

    const ready = await request({ method: "POST", path: "/api/material-ready", body: { version: created.version } });
    assert.strictEqual(ready.status, 200);

    const manifestResponse = await request({ path: "/api/material-manifest" });
    assert.strictEqual(manifestResponse.status, 200);
    const manifest = parseJson(manifestResponse);
    assert.strictEqual(manifest.ready, true);
    assert.strictEqual(manifest.files.length, 1);
    assert.strictEqual(manifest.files[0].name, "lesson.pdf");

    const downloaded = await request({ path: manifest.files[0].url });
    assert.strictEqual(downloaded.status, 200);
    assert.deepStrictEqual(downloaded.body, sample);

    const pptxSessionResponse = await request({
      method: "POST",
      path: "/api/material-session",
      body: {
        label: "Molly 课件",
        files: [{
          name: "Molly-KET-week-1.pptx",
          size: 9,
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }],
      },
    });
    assert.strictEqual(pptxSessionResponse.status, 200);
    const pptxSession = parseJson(pptxSessionResponse);
    const pptx = Buffer.from("PPTX-test");
    const pptxUploaded = await request({
      method: "PUT",
      path: `/api/material-file?index=0&version=${pptxSession.version}`,
      body: pptx,
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    assert.strictEqual(pptxUploaded.status, 200);
    const pptxReady = await request({ method: "POST", path: "/api/material-ready", body: { version: pptxSession.version } });
    assert.strictEqual(pptxReady.status, 200);
    const pptxManifest = parseJson(await request({ path: "/api/material-manifest" }));
    assert.strictEqual(pptxManifest.files[0].name, "Molly-KET-week-1.pptx");
    assert.strictEqual(pptxManifest.files[0].contentType, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    console.log("local material uploader validation passed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
