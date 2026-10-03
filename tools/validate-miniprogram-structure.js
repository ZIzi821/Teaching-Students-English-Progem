const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(root, "miniprogram");
const appConfig = JSON.parse(fs.readFileSync(path.join(miniprogramRoot, "app.json"), "utf8"));
const subpackagePages = (appConfig.subpackages || appConfig.subPackages || []).flatMap((subpackage) => (
  (subpackage.pages || []).map((page) => `${String(subpackage.root || "").replace(/\/$/, "")}/${page}`)
));
const allPages = (appConfig.pages || []).concat(subpackagePages);
const registeredPages = new Set(allPages);
const voidTags = new Set(["input", "import", "include", "icon"]);

const validateWxmlTags = (filePath) => {
  const source = fs.readFileSync(filePath, "utf8").replace(/<!--[^]*?-->/g, "");
  const stack = [];
  const tagPattern = /<\/?([a-zA-Z][\w-]*)(?:\s[^<>]*?)?\s*\/?>/g;
  let match;
  while ((match = tagPattern.exec(source))) {
    const full = match[0];
    const tag = match[1];
    if (full.startsWith("</")) {
      const opened = stack.pop();
      assert.strictEqual(opened, tag, `${filePath}: expected </${opened}> before </${tag}>`);
    } else if (!full.endsWith("/>") && !voidTags.has(tag)) {
      stack.push(tag);
    }
  }
  assert.strictEqual(stack.length, 0, `${filePath}: unclosed <${stack[stack.length - 1]}>`);
};

const validatePage = (pagePath) => {
  const basePath = path.join(miniprogramRoot, pagePath);
  [".js", ".json", ".wxml", ".wxss"].forEach((extension) => {
    assert(fs.existsSync(basePath + extension), `missing page file: ${pagePath}${extension}`);
  });
  const jsSource = fs.readFileSync(basePath + ".js", "utf8");
  new vm.Script(jsSource, { filename: basePath + ".js" });
  JSON.parse(fs.readFileSync(basePath + ".json", "utf8"));
  validateWxmlTags(basePath + ".wxml");

  const wxml = fs.readFileSync(basePath + ".wxml", "utf8");
  const handlerPattern = /(?:bind|catch)(?:tap|input|change|confirm|submit|load|error|longpress)="([A-Za-z_$][\w$]*)"/g;
  let match;
  while ((match = handlerPattern.exec(wxml))) {
    const methodPattern = new RegExp(`\\b${match[1]}\\s*\\(`);
    assert(methodPattern.test(jsSource), `${pagePath}: missing handler ${match[1]}`);
  }

  const routePattern = /["'`]\/([\w/-]+\/index)(?:\?[^"'`]*)?["'`]/g;
  while ((match = routePattern.exec(jsSource))) {
    assert(registeredPages.has(match[1]), `${pagePath}: unregistered route ${match[1]}`);
  }
};

allPages.forEach(validatePage);
console.log(`miniprogram structure validation passed (${allPages.length} pages)`);
