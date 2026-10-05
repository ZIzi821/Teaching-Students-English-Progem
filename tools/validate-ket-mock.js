const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const directoryBytes = (directory) => fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
  const entryPath = path.join(directory, entry.name);
  return sum + (entry.isDirectory() ? directoryBytes(entryPath) : fs.statSync(entryPath).size);
}, 0);
const frontend = require(path.join(root, "miniprogram", "utils", "ketMockSets"));
const ketMockLogic = require(path.join(root, "cloudfunctions", "quickstartFunctions", "ketMock"));
const cloudSets = JSON.parse(read("cloudfunctions", "quickstartFunctions", "data", "ket-mock-sets.json"));
const app = JSON.parse(read("miniprogram", "app.json"));

assert.strictEqual(frontend.KET_MOCK_SETS.length, 12, "KET mock catalogue must expose 12 sets");
assert.strictEqual(cloudSets.length, 12, "Cloud KET mock catalogue must expose 12 sets");
assert.deepStrictEqual(frontend.KET_MOCK_SETS, cloudSets, "Frontend and cloud KET mock catalogues must stay identical");
assert.strictEqual(frontend.KET_MOCK_SETS[0].sourceType, "official_public_adapted", "Set 1 source boundary is missing");
assert.ok(frontend.KET_MOCK_SETS.slice(1, 8).every((set) => set.sourceType === "exclusive_original" && set.sourceBadge === "独家原创题目"), "Sets 2-8 must use the exclusive-original category");
assert.ok(frontend.KET_MOCK_SETS.slice(8).every((set) => set.sourceType === "institution_exclusive_original" && set.sourceBadge === "机构-独家原创题"), "Sets 9-12 must use the institution-grade exclusive-original category");
assert.strictEqual(frontend.KET_MOCK_SETS.filter((set) => set.order >= 9).length, 4, "Four enhanced original sets are required");

const cloudById = new Map(cloudSets.map((set) => [set.id, set]));
let imageBytes = 0;
frontend.KET_MOCK_SETS.forEach((set) => {
  const cloudSet = cloudById.get(set.id);
  const enhancedSet = set.order >= 9;
  assert.ok(cloudSet, `Cloud catalogue is missing ${set.id}`);
  assert.strictEqual(set.cues.length, enhancedSet ? 10 : 9, `${set.id} has an unexpected examiner cue count`);
  assert.strictEqual(set.cues.filter((cue) => cue.responseExpected).length, enhancedSet ? 8 : 7, `${set.id} has an unexpected recorded-answer count`);
  assert.strictEqual(set.teacherGuide.scoreGuidance.length, 4, `${set.id} must expose four teacher scoring anchors`);
  if (enhancedSet) {
    assert.ok(set.cues.filter((cue) => cue.responseExpected)
      .every((cue) => cue.backupPrompts.length >= 2 && cue.modelAnswer), `${set.id} is missing enhanced teacher support`);
  }
  assert.deepStrictEqual(
    set.cues.map((cue) => [cue.id, cue.part, cue.script, cue.responseExpected]),
    cloudSet.cues.map((cue) => [cue.id, cue.part, cue.script, cue.responseExpected]),
    `${set.id} differs between frontend and cloud catalogues`
  );
  const imagePath = path.join(root, "miniprogram", set.visualAsset.replace(/^\//, ""));
  assert.ok(fs.existsSync(imagePath), `${set.id} visual asset is missing`);
  const size = fs.statSync(imagePath).size;
  imageBytes += size;
  assert.ok(size <= 250000, `${set.id} visual asset is too large for the mini-program package`);
});
assert.ok(imageBytes <= 1800000, "KET mock visual assets exceed the package budget");

const miniprogramRoot = path.join(root, "miniprogram");
const ketSubpackageRoot = path.join(miniprogramRoot, "ket-mock");
const ketSubpackageBytes = directoryBytes(ketSubpackageRoot);
const subpackageRoots = new Set((app.subpackages || app.subPackages || []).map((subpackage) => subpackage.root));
const mainPackageBytes = fs.readdirSync(miniprogramRoot, { withFileTypes: true }).reduce((sum, entry) => {
  if (subpackageRoots.has(entry.name)) return sum;
  const entryPath = path.join(miniprogramRoot, entry.name);
  return sum + (entry.isDirectory() ? directoryBytes(entryPath) : fs.statSync(entryPath).size);
}, 0);
assert.ok(ketSubpackageBytes <= 2 * 1024 * 1024, "KET subpackage exceeds the 2 MiB package limit");
assert.ok(mainPackageBytes <= 2 * 1024 * 1024, "Main package exceeds the 2 MiB package limit");
(app.subpackages || app.subPackages || []).forEach((subpackage) => {
  const subpackageBytes = directoryBytes(path.join(miniprogramRoot, subpackage.root));
  assert.ok(subpackageBytes <= 2 * 1024 * 1024, `${subpackage.name || subpackage.root} subpackage exceeds the 2 MiB package limit`);
});

const registeredSubpages = (app.subpackages || app.subPackages || []).flatMap((subpackage) => (
  (subpackage.pages || []).map((page) => `${subpackage.root}/${page}`)
));
[
  "ket-mock/pages/library/index",
  "ket-mock/pages/exam/index",
  "ket-mock/pages/review/index",
].forEach((page) => assert.ok(registeredSubpages.includes(page), `${page} is not registered in the KET subpackage`));

const cloudIndex = read("cloudfunctions", "quickstartFunctions", "index.js");
const catalogueBuilder = read("tools", "build-ket-mock-catalogue.js");
[
  "getKetMockLibrary",
  "saveKetMockCueAudio",
  "getKetMockExam",
  "startKetMockSession",
  "completeKetMockSession",
  "getKetMockSessionDetail",
  "reviewKetMockSession",
].forEach((action) => assert.ok(cloudIndex.includes(`case \"${action}\"`), `Cloud action ${action} is missing`));
assert.ok(cloudIndex.includes('"ketMockAssets"'), "ketMockAssets collection is not initialized");
assert.ok(cloudIndex.includes('"ketMockSessions"'), "ketMockSessions collection is not initialized");
assert.ok(catalogueBuilder.includes("JSON.stringify(KET_MOCK_SETS"), "KET mock catalogue builder is missing");

const addLessonJs = read("miniprogram", "pages", "add-lesson", "index.js");
const lessonDetailJs = read("miniprogram", "pages", "lesson-detail", "index.js");
const workbenchJs = read("miniprogram", "pages", "teacher-workbench", "index.js");
const libraryWxml = read("miniprogram", "ket-mock", "pages", "library", "index.wxml");
const examJs = read("miniprogram", "ket-mock", "pages", "exam", "index.js");
const examWxml = read("miniprogram", "ket-mock", "pages", "exam", "index.wxml");
const reviewJs = read("miniprogram", "ket-mock", "pages", "review", "index.js");
const reviewWxml = read("miniprogram", "ket-mock", "pages", "review", "index.wxml");
const recordingPracticeJs = read("miniprogram", "pages", "recording-practice", "index.js");
const trendWxml = read("miniprogram", "components", "ket-score-trend", "index.wxml");
const trendWxss = read("miniprogram", "components", "ket-score-trend", "index.wxss");

assert.ok(addLessonJs.includes('value: "ket_mock"'), "Lesson creation cannot assign a full mock");
assert.ok(lessonDetailJs.includes("/ket-mock/pages/exam/index?lessonId="), "Lesson detail does not open the mock exam");
assert.ok(workbenchJs.includes("/ket-mock/pages/library/index"), "Teacher workbench does not open the audio library");
assert.ok(libraryWxml.includes("官方公开样题结构改编") && libraryWxml.includes("独家原创题目") && libraryWxml.includes("机构-独家原创题"), "Teacher library does not explain all three source categories");
assert.ok(libraryWxml.includes("教师备用追问 · 无需预录"), "Teacher library does not expose optional backup prompts");
assert.ok(libraryWxml.includes("下一段提示音开头") && libraryWxml.includes("不要使用 “Good / 不错”"), "Teacher library lacks neutral transition guidance");
assert.ok(examJs.includes("playReliableAudio") && examJs.includes("onEnded"), "Exam does not verify and advance after examiner audio ends");
assert.ok(examJs.includes("startExamAudioPreload"), "Exam does not preload examiner audio when the page opens");
assert.ok(examJs.includes("this.startRecording(cue)"), "Exam does not start the microphone automatically");
assert.ok(examJs.includes("interruptExam"), "Exam has no interruption handling");
assert.ok(examWxml.includes("中途不能暂停、回放或重录"), "Exam rules do not explain the no-replay rule");
assert.ok(examWxml.includes("虚拟搭档"), "Automated Part 2 boundary is not disclosed");
assert.ok(!examWxml.includes("{{currentCue.script}}"), "Student exam must not display the examiner script");
assert.ok(reviewJs.includes("grammarVocabulary") && reviewJs.includes("interactiveCommunication"), "Four-dimension scoring fields are missing");
assert.ok(reviewJs.includes("scoreTrend") && reviewWxml.includes("ket-score-trend"), "KET review does not expose the multi-session score trend");
assert.strictEqual(app.usingComponents && app.usingComponents["ket-score-trend"], "/components/ket-score-trend/index", "KET score trend component is not registered");
assert.ok(trendWxml.includes("KET 四维成绩趋势") && trendWxml.includes("dimension.points"), "KET score trend does not render all four histories");
assert.ok(trendWxss.includes("fill-grammar") && trendWxss.includes("fill-pronunciation") && trendWxss.includes("fill-interaction") && trendWxss.includes("fill-global"), "KET score dimensions are not visually distinguishable");
assert.strictEqual(ketMockLogic.buildScoreTrend([]).hasData, false, "Empty KET histories must remain renderable");
assert.ok(reviewWxml.includes("不是 Cambridge 官方考试成绩"), "Practice-score disclaimer is missing");
assert.ok(reviewWxml.includes("A2 参考示范 · 不要求照背"), "Teacher review does not expose model-answer guidance");
assert.ok(reviewWxml.includes("四项分数锚点"), "Teacher review does not expose scoring anchors");
assert.ok(!examWxml.includes("modelAnswer") && !examWxml.includes("backupPrompts"), "Teacher-only guidance leaked into the student exam template");
assert.ok(recordingPracticeJs.includes("/ket-mock/pages/exam/index?lessonId="), "Legacy recording route does not redirect full mocks to the exam");
assert.ok(cloudIndex.includes('lesson.recordingTaskType === "ket_mock"'), "Normal recording submissions are not blocked for full mocks");

console.log(`KET mock validation passed (12 sets, ${imageBytes} image bytes, main ${(mainPackageBytes / 1048576).toFixed(3)} MiB, KET ${(ketSubpackageBytes / 1048576).toFixed(3)} MiB)`);
