const fs = require("fs");
const path = require("path");
const vm = require("vm");

const cloudSource = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "utils", "cloud.js"), "utf8");
const cloudError = require(path.join(__dirname, "..", "miniprogram", "utils", "cloudError"));

// 在验证器的页面沙箱里加载 utils/cloud.js，使 callCloud 使用沙箱提供的 wx 桩对象。
const loadSandboxCloud = (wx) => {
  const module = { exports: {} };
  vm.runInNewContext(cloudSource, {
    module,
    exports: module.exports,
    wx,
    require: (request) => {
      if (request === "./cloudError") return cloudError;
      throw new Error(`Unexpected cloud helper dependency: ${request}`);
    },
  });
  return module.exports;
};

module.exports = {
  loadSandboxCloud,
};
