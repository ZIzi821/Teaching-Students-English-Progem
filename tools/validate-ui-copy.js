const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const scanTargets = [
  path.join(root, "miniprogram"),
  path.join(root, "cloudfunctions", "quickstartFunctions"),
  path.join(root, "cloudfunctions", "lessonReminder"),
  path.join(root, "tools", "local-material-uploader"),
  path.join(root, "tools", "local-mistake-importer"),
];
const allowedExtensions = new Set([".js", ".json", ".wxml", ".html"]);
const skippedDirectories = new Set(["node_modules", "tests"]);

const defensivePhrases = [
  "只读预览",
  "不会写入",
  "不会改动",
  "不会改变",
  "不会保存",
  "不会删除",
  "不会影响",
  "不能代学生",
  "不能提交录音",
  "不允许返回",
  "请不要",
  "不要离开",
  "当前微信版本不支持",
  "无权查看",
  "无权管理",
  "仅教师端可",
  "你只能",
  "只有朱老师",
  "只有教师账号",
  "只有老师可以",
  "仅老师可见",
  "仅教师可见",
  "老师预览不会",
  "学生端不会",
  "不能手动",
  "不代表考试",
  "不是 Cambridge 官方",
  "不是官方 CEFR",
  "不是对真实记忆",
  "它不是学生成绩",
  "不再读取、传输或上传",
  "没有写入按钮",
  "只控制",
  "不是微信消息推送",
  "只用于安排复习",
];

function collectFiles(target, result = []) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (allowedExtensions.has(path.extname(target))) result.push(target);
    return result;
  }

  fs.readdirSync(target, { withFileTypes: true }).forEach((entry) => {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) return;
    collectFiles(path.join(target, entry.name), result);
  });
  return result;
}

const files = scanTargets.flatMap((target) => collectFiles(target));
const violations = [];

files.forEach((file) => {
  const content = fs.readFileSync(file, "utf8");
  defensivePhrases.forEach((phrase) => {
    if (content.includes(phrase)) {
      violations.push(`${path.relative(root, file)}: ${phrase}`);
    }
  });
});

assert.strictEqual(
  violations.length,
  0,
  `Defensive Chinese UI copy remains:\n${violations.join("\n")}`
);

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
assert(read("miniprogram/components/teacher-preview-banner/index.wxml").includes("老师预览"));
assert(read("miniprogram/pages/index/index.wxml").includes("体验结果在预览页单独呈现"));
assert(read("miniprogram/insights/pages/memory-evaluation/index.wxml").includes("参数调整由老师结合课堂表现决定"));
assert(read("miniprogram/ket-mock/pages/review/index.wxml").includes("教师练习评分，用于后续学习调整"));
assert(read("miniprogram/engagement/pages/manager/index.wxml").includes("按 1:1 生成"));
assert(read("miniprogram/engagement/pages/reminders/index.wxml").includes("微信订阅消息由课后任务页单独开启"));
assert(read("cloudfunctions/quickstartFunctions/englishMemoryAnalytics.js").includes("该指标用于评估记忆调度算法"));
assert(read("cloudfunctions/quickstartFunctions/frenchLearning.js").includes("用于安排个人复习节奏"));
assert(read("tools/local-material-uploader/index.html").includes("文件通过本机助手交给微信开发者工具读取"));

// These are factual learning states and irreversible-action consequences, not defensive copy.
assert(read("miniprogram/pages/lesson-detail/index.js").includes("删除后无法恢复"));
assert(read("miniprogram/pages/lesson-detail/index.js").includes('"暂时不会"'));

console.log(`UI copy validation passed across ${files.length} interface source files.`);
