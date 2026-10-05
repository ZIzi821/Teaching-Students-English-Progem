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

const emptyTrend = ketMock.buildScoreTrend([]);
assert.strictEqual(emptyTrend.hasData, false, "A new student without KET history needs a stable empty trend");
assert.strictEqual(emptyTrend.dimensions.length, 4);

const scoreTrend = ketMock.buildScoreTrend([
  {
    _id: "newer",
    status: "reviewed",
    setId: "mock-2",
    lessonDateSnapshot: "2026-10-05",
    reviewedAtMs: 200,
    assessment: {
      grammarVocabulary: 3,
      pronunciation: 3.5,
      interactiveCommunication: 3.5,
      globalAchievement: 4,
    },
  },
  {
    _id: "not-reviewed",
    status: "submitted",
    reviewedAtMs: 300,
    assessment: {
      grammarVocabulary: 5,
      pronunciation: 5,
      interactiveCommunication: 5,
      globalAchievement: 5,
    },
  },
  {
    _id: "older",
    status: "reviewed",
    setId: "mock-1",
    lessonDateSnapshot: "2026-09-28",
    reviewedAtMs: 100,
    assessment: {
      grammarVocabulary: 2,
      pronunciation: 2.5,
      interactiveCommunication: 3,
      globalAchievement: 2.5,
    },
  },
]);
assert.strictEqual(scoreTrend.hasComparison, true);
assert.strictEqual(scoreTrend.reviewedCount, 2, "Only fully reviewed sessions may enter the score trend");
assert.deepStrictEqual(scoreTrend.sessions.map((item) => item.key), ["older", "newer"]);
assert.strictEqual(scoreTrend.latestAverage, 3.5);
assert.strictEqual(scoreTrend.averageChangeLabel, "+1");
assert.strictEqual(scoreTrend.dimensions.find((item) => item.key === "grammarVocabulary").changeLabel, "+1");
assert.strictEqual(scoreTrend.sessions[1].dateLabel, "10/5");

console.log("ket mock tests passed");
