const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "miniprogram");
const FONT_SIZES = new Set([24, 26, 30, 34, 44, 56]);
const RADII = new Set([12, 16, 24, 999]);
const CHART_FILE = path.join("components", "ket-score-trend", "index.wxss");

const walk = (dir, found = []) => {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "images") walk(full, found);
    } else if (entry.name.endsWith(".wxss")) {
      found.push(full);
    }
  });
  return found;
};

walk(root).forEach((file) => {
  const relative = path.relative(root, file);
  const css = fs.readFileSync(file, "utf8");
  assert(!/box-shadow/.test(css), `${relative}: use borders instead of shadows`);
  assert(!/gradient\(/.test(css), `${relative}: use a flat design token instead of a gradient`);
  if (relative === "app.wxss") return;
  if (relative !== CHART_FILE) {
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/);
    assert(!hex, `${relative}: hard-coded colour ${hex && hex[0]}; add or reuse a token in app.wxss`);
  }
  for (const match of css.matchAll(/font-size:\s*(\d+)rpx/g)) {
    const size = Number(match[1]);
    assert(FONT_SIZES.has(size) || size > 60, `${relative}: font-size ${size}rpx is outside the type scale`);
  }
  for (const match of css.matchAll(/border-radius:\s*([^;}]+)/g)) {
    for (const value of match[1].matchAll(/(\d+)rpx/g)) {
      const radius = Number(value[1]);
      assert(RADII.has(radius) || radius <= 6, `${relative}: border-radius ${radius}rpx is outside the scale`);
    }
  }
});

console.log("design token validation passed");
