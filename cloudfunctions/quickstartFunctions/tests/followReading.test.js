const assert = require("assert");
const followReading = require("../followReading");

const automatic = followReading.normalizeTask({
  followReadingMode: "automatic",
  followReadingGapSeconds: 3,
  followReadingResponseSeconds: 10,
  followReadingContent: "apple\nI go to school by bus.\napple",
});

assert.strictEqual(automatic.followReadingMode, "automatic");
assert.strictEqual(automatic.followReadingGapSeconds, 3);
assert.strictEqual(automatic.followReadingResponseSeconds, 10);
assert.strictEqual(automatic.followReadingItems.length, 3);
assert.notStrictEqual(automatic.followReadingItems[0].id, automatic.followReadingItems[2].id, "duplicate lines need unique item ids");

const reordered = followReading.normalizeTask({
  followReadingMode: "manual",
  followReadingContent: "I go to school by bus.\napple",
});
assert.strictEqual(
  reordered.followReadingItems[0].id,
  automatic.followReadingItems[1].id,
  "unchanged unique text should keep its audio item id when reordered"
);
assert.strictEqual(reordered.followReadingMode, "manual");
assert.strictEqual(reordered.followReadingGapSeconds, 2);
assert.strictEqual(reordered.followReadingResponseSeconds, 8);

const firstItem = automatic.followReadingItems[0];
const matchingAsset = {
  lessonId: "lesson-1",
  itemId: firstItem.id,
  itemTextHash: firstItem.textHash,
  fileID: "cloud://teacher-demo",
  audioUrl: "https://example.test/demo.mp3",
};
const matching = followReading.buildAssetCompleteness({ followReadingItems: [firstItem] }, [matchingAsset]);
assert.strictEqual(matching.complete, true);

const stale = followReading.buildAssetCompleteness({ followReadingItems: [firstItem] }, [
  Object.assign({}, matchingAsset, { itemTextHash: followReading.textHash("changed text") }),
]);
assert.strictEqual(stale.complete, false, "changed text must invalidate the old teacher audio");

const studentTask = followReading.sanitizeTaskForStudent(automatic, [matchingAsset]);
assert.strictEqual(studentTask.items[0].audioUrl, matchingAsset.audioUrl);
assert.ok(!Object.prototype.hasOwnProperty.call(studentTask.items[0], "audioAsset"));
assert.ok(!JSON.stringify(studentTask).includes("cloud://teacher-demo"), "student payload must not expose cloud file ids");

console.log("follow-reading logic tests passed");
