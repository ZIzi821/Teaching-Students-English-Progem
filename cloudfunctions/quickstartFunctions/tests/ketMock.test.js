const assert = require("assert");
const ketMock = require("../ketMock");

assert.deepStrictEqual(ketMock.validateCatalogue(), []);
assert.strictEqual(ketMock.KET_MOCK_SETS.length, 12);
assert.strictEqual(ketMock.KET_MOCK_SETS[0].sourceType, "official_public_adapted");
assert.ok(ketMock.KET_MOCK_SETS.slice(1, 8).every((set) => set.sourceType === "exclusive_original"));
assert.ok(ketMock.KET_MOCK_SETS.slice(8).every((set) => set.sourceType === "institution_exclusive_original"));

ketMock.KET_MOCK_SETS.forEach((set) => {
  const enhancedSet = set.order >= 9;
  assert.strictEqual(set.cues.length, enhancedSet ? 10 : 9);
  assert.strictEqual(set.cues.filter((cue) => cue.responseExpected).length, enhancedSet ? 8 : 7);
  assert.ok(set.cues.some((cue) => cue.part === 1));
  assert.ok(set.cues.some((cue) => cue.part === 2));
  assert.strictEqual(set.teacherGuide.scoreGuidance.length, 4);
});

const enhancedSets = ketMock.KET_MOCK_SETS.slice(8);
assert.strictEqual(enhancedSets.length, 4);
assert.ok(enhancedSets.every((set) => set.sourceBadge === "机构-独家原创题"));
assert.ok(enhancedSets.every((set) => set.cues.filter((cue) => cue.responseExpected)
  .every((cue) => cue.backupPrompts.length >= 2 && cue.modelAnswer)));

const firstSet = ketMock.KET_MOCK_SETS[0];
const assets = firstSet.cues.map((cue) => ({ setId: firstSet.id, cueId: cue.id, fileID: `cloud://${cue.id}` }));
assert.strictEqual(ketMock.buildAssetCompleteness(firstSet, assets).complete, true);
assert.strictEqual(ketMock.buildAssetCompleteness(firstSet, assets.slice(1)).complete, false);

const enhancedSet = enhancedSets[0];
const studentSet = ketMock.sanitizeSetForStudent(enhancedSet, []);
assert.strictEqual(Object.prototype.hasOwnProperty.call(studentSet, "teacherGuide"), false);
assert.ok(studentSet.cues.every((cue) => !cue.backupPrompts && !cue.modelAnswer));

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
