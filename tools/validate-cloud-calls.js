const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "miniprogram");
const helper = path.join(root, "utils", "cloud.js");

const walk = (dir, found = []) => {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["images", "data"].includes(entry.name)) walk(full, found);
    } else if (entry.name.endsWith(".js")) {
      found.push(full);
    }
  });
  return found;
};

walk(root).forEach((file) => {
  if (file === helper) return;
  const source = fs.readFileSync(file, "utf8");
  assert(
    !/wx\.cloud\s*\.\s*callFunction\(/.test(source),
    `${path.relative(root, file)}: call quickstartFunctions through utils/cloud.js callCloud()`
  );
});

const helperSource = fs.readFileSync(helper, "utf8");
assert(helperSource.includes("isTransactionBusyError(err)) throw err"), "transaction-busy errors must keep their raw shape for retries");
assert(helperSource.includes("getFriendlyCloudErrorMessage"), "cloud failures must surface a friendly message");

console.log("cloud call validation passed");
