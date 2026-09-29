const assert = require("assert");
const crypto = require("crypto");
const {
  ALGORITHM_VERSION,
  FRENCH_PROGRESS_COLLECTION,
  createFrenchLearningService,
  getProgressId,
  getProgressRecords,
} = require("../frenchLearning");
const {
  normalizeFrenchCanonical,
  normalizeFrenchSearch,
} = require("../frenchContent");

const makeDatabase = () => {
  const recordsByCollection = new Map();
  let transactionQueue = Promise.resolve();
  const getCollection = (name) => {
    if (!recordsByCollection.has(name)) recordsByCollection.set(name, new Map());
    return recordsByCollection.get(name);
  };
  const createCollectionApi = (name) => {
    const createQuery = (query, offset = 0, limit = Infinity) => ({
      skip: (nextOffset) => createQuery(query, nextOffset, limit),
      limit: (nextLimit) => createQuery(query, offset, nextLimit),
      get: async () => ({
        data: Array.from(getCollection(name).values())
          .filter((record) => Object.keys(query).every((key) => record[key] === query[key]))
          .slice(offset, offset + limit),
      }),
    });
    return {
      where: (query) => createQuery(query),
      doc: (id) => ({
        get: async () => {
          const record = getCollection(name).get(id);
          if (!record) throw new Error("document not found");
          return { data: record };
        },
        set: async ({ data }) => {
          getCollection(name).set(id, Object.assign({ _id: id }, data));
        },
        update: async ({ data }) => {
          const current = getCollection(name).get(id);
          if (!current) throw new Error("document not found");
          getCollection(name).set(id, Object.assign({}, current, data));
        },
      }),
    };
  };
  const db = {
    serverDate: () => "mock-server-date",
    createCollection: async () => {},
    collection: createCollectionApi,
    runTransaction: (callback) => {
      const run = transactionQueue.then(() => callback({ collection: createCollectionApi }));
      transactionQueue = run.catch(() => {});
      return run;
    },
    seed: (name, id, data) => getCollection(name).set(id, Object.assign({ _id: id }, data)),
    all: (name) => Array.from(getCollection(name).values()),
  };
  return db;
};

const createError = (code, message) => Object.assign(new Error(message), { code });
const teacherLearnerKey = (openid) => `teacher:${crypto.createHash("sha256").update(openid).digest("hex")}`;

const run = async () => {
  const db = makeDatabase();
  let identity = { role: "teacher", openid: "teacher-openid" };
  const service = createFrenchLearningService({
    db,
    cloud: {
      getTempFileURL: async ({ fileList }) => ({
        fileList: fileList.map((fileID) => ({ status: 0, fileID, tempFileURL: `https://example.test/${encodeURIComponent(fileID)}` })),
      }),
    },
    getIdentity: async () => identity,
    createError,
    isPrimaryTeacherOpenId: (openid) => openid === "teacher-openid",
  });

  const overview = await service.getOverview();
  assert.strictEqual(overview.isTeacher, true);
  assert.strictEqual(overview.enabled, true);
  assert.strictEqual(overview.wordSummary.totalCount, 400);
  assert.strictEqual(overview.wordSummary.byLevel.A1.totalCount, 180);
  assert.strictEqual(overview.wordSummary.byLevel.A2.totalCount, 220);
  assert.strictEqual(overview.sentenceSummary.totalCount, 98);
  assert.strictEqual(overview.dashboard.levelProgress.length, 2);
  assert.strictEqual(overview.dashboard.levelProgress[0].disclaimer.includes("不是官方"), true);
  assert.strictEqual(overview.dashboard.memoryOverview.reviewedWordCount, 0);
  assert.strictEqual(overview.dashboard.dailyPath.steps.length, 3);
  assert(overview.dailySpotlight && overview.dailySpotlight.text);
  assert(overview.dailySpotlight.audioKey);
  assert.strictEqual(overview.dailySpotlight.cefrLevel, "A1", "New learners should receive an A1 daily phrase");

  const a1Words = await service.getWords({ data: { level: "A1" } });
  const a2Words = await service.getWords({ data: { level: "A2" } });
  const allWords = await service.getWords({ data: { level: "ALL" } });
  assert.strictEqual(a1Words.words.length, 180);
  assert.strictEqual(a2Words.words.length, 220);
  assert.strictEqual(allWords.words.length, 400);
  assert(a1Words.words.every((word) => word.cefrLevel === "A1"));
  assert(a2Words.words.every((word) => word.cefrLevel === "A2"));

  assert.notStrictEqual(normalizeFrenchCanonical("a"), normalizeFrenchCanonical("à"));
  assert.notStrictEqual(normalizeFrenchCanonical("ou"), normalizeFrenchCanonical("où"));
  assert.notStrictEqual(getProgressId("student:unicode", "word", "a"), getProgressId("student:unicode", "word", "à"));
  assert.notStrictEqual(getProgressId("student:unicode", "word", "ou"), getProgressId("student:unicode", "word", "où"));
  const supportedFrenchUnicode = "é è ê ë à â ù û ç î ï ô œ æ";
  assert.strictEqual(normalizeFrenchCanonical(supportedFrenchUnicode), supportedFrenchUnicode);
  assert.strictEqual(normalizeFrenchSearch("école"), "ecole");
  assert.strictEqual(normalizeFrenchSearch("français"), "francais");
  assert.strictEqual(normalizeFrenchSearch("garçon"), "garcon");
  assert.strictEqual(normalizeFrenchSearch("être"), "etre");
  assert.strictEqual(normalizeFrenchSearch("cœur"), "coeur");
  assert.strictEqual(normalizeFrenchSearch("cætera"), "caetera");
  const ecoleSearch = await service.getWords({ data: { query: "ecole" } });
  assert(ecoleSearch.words.some((word) => word.lemma === "école"));
  assert(ecoleSearch.words.every((word) => word.lemma.normalize("NFC") === word.lemma));

  const queue = await service.getReviewQueue({ data: { level: "A1" } });
  assert.strictEqual(queue.counts.new, 10);
  assert.strictEqual(queue.counts.dueToday, 0);
  assert.strictEqual(queue.queue.length, 10);

  const firstWord = a1Words.words[0];
  const review = await service.reviewWord({ data: { wordId: firstWord.id, result: "good" } });
  assert.strictEqual(review.progress.algorithmVersion, ALGORITHM_VERSION);
  assert.strictEqual(review.progress.reviewCount, 1);
  assert.strictEqual(review.today.reviewActionCount, 1);
  assert.strictEqual(review.today.newWordCount, 1);
  assert.strictEqual(review.today.successfulRecallCount, 1);

  const [parallelOne, parallelTwo] = await Promise.all([
    service.reviewWord({ data: { wordId: firstWord.id, result: "hard" } }),
    service.reviewWord({ data: { wordId: firstWord.id, result: "easy" } }),
  ]);
  assert(parallelOne.progress.reviewCount >= 2);
  assert.strictEqual(parallelTwo.progress.reviewCount, 3, "Transactions must not lose concurrent review increments");

  const dashboardAfterReview = await service.getDashboard();
  assert.strictEqual(dashboardAfterReview.dashboard.today.reviewedCount, 3);
  assert.strictEqual(dashboardAfterReview.dashboard.today.newWordCount, 1);
  assert.strictEqual(dashboardAfterReview.dashboard.today.newRemainingCount, 9);
  assert(dashboardAfterReview.dashboard.today.activityCount >= 3);
  assert(dashboardAfterReview.dashboard.levelProgress[0].dimensions.vocabulary.percent > 0);
  assert.strictEqual(dashboardAfterReview.dashboard.levelProgress[1].dimensions.vocabulary.percent, 0);
  assert.strictEqual(dashboardAfterReview.dashboard.memoryOverview.reviewedWordCount, 1);
  assert.strictEqual(dashboardAfterReview.dashboard.memoryOverview.points.length, 4);
  const teacherMemoryPoints = dashboardAfterReview.dashboard.memoryOverview.points.map((point) => point.value);

  const difficultSeed = a1Words.words[2];
  await service.reviewWord({ data: { wordId: difficultSeed.id, result: "again" } });
  const difficultQueue = await service.getReviewQueue({ data: { level: "A1", mode: "difficult" } });
  assert.strictEqual(difficultQueue.reviewMode, "difficult");
  assert.strictEqual(difficultQueue.counts.new, 0);
  assert(difficultQueue.queue.some((word) => word.id === difficultSeed.id));
  assert(difficultQueue.queue.every((word) => word.progress.isNew === false));

  const memory = await service.getWordMemory({ data: { wordId: firstWord.id } });
  assert.strictEqual(memory.memory.reviewCount, 3);
  assert(memory.curve.length >= 4);
  assert(memory.curve[0].retentionPercent >= memory.curve[memory.curve.length - 1].retentionPercent);
  assert(memory.disclaimer.includes("估算"));

  const grammarA1 = await service.getGrammar({ data: { level: "A1" } });
  const grammarA2 = await service.getGrammar({ data: { level: "A2" } });
  const expressions = await service.getExpressions({ data: { level: "A2" } });
  const readings = await service.getReadings({ data: { level: "A2" } });
  const writing = await service.getWritingActivities({ data: { level: "A2" } });
  const sentencesA1 = await service.getSentences({ data: { level: "A1" } });
  const sentencesA2 = await service.getSentences({ data: { level: "A2" } });
  assert.strictEqual(grammarA1.items.length, 16);
  assert.strictEqual(grammarA2.items.length, 18);
  assert.strictEqual(expressions.items.length, 32);
  assert.strictEqual(readings.items.length, 10);
  assert.strictEqual(writing.items.length, 16);
  assert.strictEqual(sentencesA1.sentences.length, 45);
  assert.strictEqual(sentencesA2.sentences.length, 53);
  assert(grammarA1.items[0].shortExplanationCN);
  assert(Array.isArray(readings.items[0].comprehension));
  assert(Array.isArray(writing.items[0].scrambledTokens));

  const writingAttempt = await service.completeActivity({
    data: { contentType: "writing", contentId: writing.items[0].id, correct: false },
  });
  assert.strictEqual(writingAttempt.progress.completed, false, "An incorrect writing attempt must not count as completed");
  const writingSuccess = await service.completeActivity({
    data: { contentType: "writing", contentId: writing.items[0].id, correct: true },
  });
  assert.strictEqual(writingSuccess.progress.completed, true);

  const grammarCompletion = await service.completeActivity({
    data: { contentType: "grammar", contentId: grammarA1.items[0].id },
  });
  assert.strictEqual(grammarCompletion.progress.completed, true);
  const sentenceCompletion = await service.completeSentence({
    data: { sentenceId: sentencesA1.sentences[0].id },
  });
  assert.strictEqual(sentenceCompletion.progress.completed, true);
  const sentenceRepeat = await service.completeSentence({
    data: { sentenceId: sentencesA1.sentences[0].id },
  });
  assert.strictEqual(sentenceRepeat.progress.repeatCount, 2);

  const existingAudio = await service.getAudioUrl({ data: { audioKey: firstWord.audioKey } });
  assert.strictEqual(existingAudio.available, true);
  const newAudioWord = a2Words.words.find((word) => word.audioKey.startsWith("a2-"));
  const newAudio = await service.getAudioUrl({ data: { audioKey: newAudioWord.audioKey } });
  assert.strictEqual(newAudio.available, true, "Uploaded v2 audio must return a temporary URL");
  assert(newAudio.tempUrl.startsWith("https://example.test/"));

  const legacyWord = a1Words.words[1];
  const teacherKey = teacherLearnerKey("teacher-openid");
  const legacyId = getProgressId(teacherKey, "word", legacyWord.id);
  db.seed(FRENCH_PROGRESS_COLLECTION, legacyId, {
    learnerKey: teacherKey,
    learnerType: "teacher",
    contentType: "word",
    contentId: legacyWord.id,
    stage: 3,
    reviewCount: 4,
    lastResult: "good",
    lastReviewedAtMs: Date.now() - 2 * 86400000,
    nextReviewAtMs: Date.now() + 5 * 86400000,
  });
  const wordsAfterMigration = await service.getWords({ data: { level: "A1" } });
  const migratedPublic = wordsAfterMigration.words.find((word) => word.id === legacyWord.id);
  const migratedStored = (await db.collection(FRENCH_PROGRESS_COLLECTION).doc(legacyId).get()).data;
  assert.strictEqual(migratedPublic.progress.reviewCount, 4);
  assert.strictEqual(migratedStored.algorithmVersion, ALGORITHM_VERSION);
  assert.strictEqual(migratedStored.migratedFromAlgorithmVersion, "legacy-v1");
  assert.strictEqual(migratedStored.nextReviewAtMs > Date.now(), true);

  const paginationDb = makeDatabase();
  for (let index = 0; index < 205; index += 1) {
    paginationDb.seed(FRENCH_PROGRESS_COLLECTION, `record-${index}`, {
      learnerKey: "student:pagination",
      contentType: "daily",
      contentId: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}-${index}`,
    });
  }
  assert.strictEqual((await getProgressRecords(paginationDb, "student:pagination")).length, 205);

  db.seed("students", "disabled-student", { frenchLearningEnabled: false });
  identity = { role: "student", student: { _id: "disabled-student" } };
  const disabledOverview = await service.getOverview();
  assert.strictEqual(disabledOverview.enabled, false);
  await assert.rejects(() => service.getWords({ data: {} }), (err) => err && err.code === "FRENCH_LEARNING_DISABLED");
  await assert.rejects(() => service.getDashboard(), (err) => err && err.code === "FRENCH_LEARNING_DISABLED");
  await assert.rejects(
    () => service.completeActivity({ data: { contentType: "grammar", contentId: grammarA1.items[0].id } }),
    (err) => err && err.code === "FRENCH_LEARNING_DISABLED"
  );

  db.seed("students", "enabled-student", {
    name: "Jason梁",
    frenchLearningEnabled: true,
    teacherOpenId: "teacher-openid",
  });
  identity = { role: "student", student: { _id: "enabled-student" } };
  const studentWords = await service.getWords({ data: { level: "A1" } });
  assert.strictEqual(studentWords.words[0].progress.reviewCount, 0, "Student progress must be isolated from teacher progress");
  const studentDashboardBeforeReview = await service.getDashboard();
  assert.strictEqual(studentDashboardBeforeReview.dashboard.memoryOverview.reviewedWordCount, 0);
  await service.reviewWord({ data: { wordId: studentWords.words[0].id, result: "again" } });
  const studentDashboardAfterReview = await service.getDashboard();
  assert.strictEqual(studentDashboardAfterReview.dashboard.memoryOverview.reviewedWordCount, 1);
  assert.notDeepStrictEqual(
    studentDashboardAfterReview.dashboard.memoryOverview.points.map((point) => point.value),
    teacherMemoryPoints,
    "Each learner must receive a curve calculated from their own review state"
  );
  const learnerKeys = new Set(db.all(FRENCH_PROGRESS_COLLECTION)
    .filter((item) => item.contentType === "word" && item.contentId === firstWord.id)
    .map((item) => item.learnerKey));
  assert(learnerKeys.has(teacherKey));
  assert(learnerKeys.has("student:enabled-student"));

  identity = { role: "teacher", openid: "teacher-openid" };
  const previewEvent = { data: { mode: "teacherPreview", previewStudentId: "enabled-student" } };
  const previewOverview = await service.getOverview(previewEvent);
  const previewDashboard = await service.getDashboard(previewEvent);
  assert.strictEqual(previewOverview.isTeacherPreview, true);
  assert.strictEqual(previewOverview.learnerName, "Jason梁");
  assert.strictEqual(previewDashboard.dashboard.memoryOverview.reviewedWordCount, 1);
  await assert.rejects(
    () => service.reviewWord({ data: Object.assign({}, previewEvent.data, { wordId: firstWord.id, result: "good" }) }),
    (err) => err && err.code === "TEACHER_PREVIEW_READ_ONLY"
  );
  await assert.rejects(
    () => service.completeActivity({ data: Object.assign({}, previewEvent.data, {
      contentType: "grammar",
      contentId: grammarA1.items[0].id,
    }) }),
    (err) => err && err.code === "TEACHER_PREVIEW_READ_ONLY"
  );
  await assert.rejects(
    () => service.updatePreferences({ data: Object.assign({}, previewEvent.data, { dailyNewWordLimit: 5 }) }),
    (err) => err && err.code === "TEACHER_PREVIEW_READ_ONLY"
  );

  identity = { role: "teacher", openid: "other-teacher-openid" };
  await assert.rejects(
    () => service.getDashboard(previewEvent),
    (err) => err && err.code === "PERMISSION_DENIED"
  );

  identity = { role: "teacher", openid: "teacher-openid" };
  db.seed("students", "legacy-student", { frenchLearningEnabled: false });
  const settings = await service.setSettings({ data: { studentId: "legacy-student", enabled: true } });
  assert.strictEqual(settings.enabled, true);
  assert.strictEqual(
    (await db.collection("students").doc("legacy-student").get()).data.teacherOpenId,
    "teacher-openid"
  );
  identity = { role: "teacher", openid: "other-teacher-openid" };
  await assert.rejects(
    () => service.setSettings({ data: { studentId: "enabled-student", enabled: false } }),
    (err) => err && err.code === "PERMISSION_DENIED"
  );

  console.log("frenchLearning.test.js: passed");
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
