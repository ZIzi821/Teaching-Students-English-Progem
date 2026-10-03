const assert = require("assert");
const ketMock = require("../ketMock");

assert.deepStrictEqual(ketMock.validateCatalogue(), []);
assert.strictEqual(ketMock.KET_MOCK_SETS.length, 8);
assert.strictEqual(ketMock.KET_MOCK_SETS[0].sourceType, "official_public_adapted");
assert.ok(ketMock.KET_MOCK_SETS.slice(1).every((set) => set.sourceType === "current_format_original"));

ketMock.KET_MOCK_SETS.forEach((set) => {
  assert.strictEqual(set.cues.length, 9);
  assert.strictEqual(set.cues.filter((cue) => cue.responseExpected).length, 7);
  assert.ok(set.cues.some((cue) => cue.part === 1));
  assert.ok(set.cues.some((cue) => cue.part === 2));
});

const firstSet = ketMock.KET_MOCK_SETS[0];
const assets = firstSet.cues.map((cue) => ({ setId: firstSet.id, cueId: cue.id, fileID: `cloud://${cue.id}` }));
assert.strictEqual(ketMock.buildAssetCompleteness(firstSet, assets).complete, true);
assert.strictEqual(ketMock.buildAssetCompleteness(firstSet, assets.slice(1)).complete, false);

const assessment = ketMock.normalizeAssessment({
  grammarVocabulary: 3.5,
  pronunciation: 4,
  interactiveCommunication: 3,
  globalAchievement: 4.5,
  strengths: "Clear answers",
  nextFocus: "Ask one more question",
  comment: "Good progress",
});
assert.strictEqual(assessment.average, 3.8);
assert.throws(() => ketMock.normalizeAssessment({
  grammarVocabulary: 6,
  pronunciation: 4,
  interactiveCommunication: 3,
  globalAchievement: 4,
}));

console.log("ket mock tests passed");
