const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const frontend = require(path.join(root, "miniprogram", "utils", "ketMockSets"));
const cloudSets = JSON.parse(read("cloudfunctions", "quickstartFunctions", "data", "ket-mock-sets.json"));
const app = JSON.parse(read("miniprogram", "app.json"));

assert.strictEqual(frontend.KET_MOCK_SETS.length, 8, "KET mock catalogue must expose 8 sets");
assert.strictEqual(cloudSets.length, 8, "Cloud KET mock catalogue must expose 8 sets");
assert.deepStrictEqual(frontend.KET_MOCK_SETS, cloudSets, "Frontend and cloud KET mock catalogues must stay identical");
assert.strictEqual(frontend.KET_MOCK_SETS[0].sourceType, "official_public_adapted", "Set 1 source boundary is missing");
assert.ok(frontend.KET_MOCK_SETS.slice(1).every((set) => set.sourceType === "current_format_original"), "Sets 2-8 must be clearly labelled original");

const cloudById = new Map(cloudSets.map((set) => [set.id, set]));
let imageBytes = 0;
frontend.KET_MOCK_SETS.forEach((set) => {
  const cloudSet = cloudById.get(set.id);
  assert.ok(cloudSet, `Cloud catalogue is missing ${set.id}`);
  assert.strictEqual(set.cues.length, 9, `${set.id} must contain 9 examiner audio cues`);
  assert.strictEqual(set.cues.filter((cue) => cue.responseExpected).length, 7, `${set.id} must contain 7 recorded answers`);
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
assert.ok(imageBytes <= 1500000, "KET mock visual assets exceed the package budget");

const registeredSubpages = (app.subpackages || app.subPackages || []).flatMap((subpackage) => (
  (subpackage.pages || []).map((page) => `${subpackage.root}/${page}`)
));
[
  "ket-mock/pages/library/index",
  "ket-mock/pages/exam/index",
  "ket-mock/pages/review/index",
].forEach((page) => assert.ok(registeredSubpages.includes(page), `${page} is not registered in the KET subpackage`));

const cloudIndex = read("cloudfunctions", "quickstartFunctions", "index.js");
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

const addLessonJs = read("miniprogram", "pages", "add-lesson", "index.js");
const lessonDetailJs = read("miniprogram", "pages", "lesson-detail", "index.js");
const workbenchJs = read("miniprogram", "pages", "teacher-workbench", "index.js");
const examJs = read("miniprogram", "ket-mock", "pages", "exam", "index.js");
const examWxml = read("miniprogram", "ket-mock", "pages", "exam", "index.wxml");
const reviewJs = read("miniprogram", "ket-mock", "pages", "review", "index.js");
const reviewWxml = read("miniprogram", "ket-mock", "pages", "review", "index.wxml");
const recordingPracticeJs = read("miniprogram", "pages", "recording-practice", "index.js");

assert.ok(addLessonJs.includes('value: "ket_mock"'), "Lesson creation cannot assign a full mock");
assert.ok(lessonDetailJs.includes("/ket-mock/pages/exam/index?lessonId="), "Lesson detail does not open the mock exam");
assert.ok(workbenchJs.includes("/ket-mock/pages/library/index"), "Teacher workbench does not open the audio library");
assert.ok(examJs.includes("audio.onEnded"), "Exam does not advance after examiner audio ends");
assert.ok(examJs.includes("this.startRecording(cue)"), "Exam does not start the microphone automatically");
assert.ok(examJs.includes("interruptExam"), "Exam has no interruption handling");
assert.ok(examWxml.includes("中途不能暂停、回放或重录"), "Exam rules do not explain the no-replay rule");
assert.ok(examWxml.includes("虚拟搭档"), "Automated Part 2 boundary is not disclosed");
assert.ok(!examWxml.includes("{{currentCue.script}}"), "Student exam must not display the examiner script");
assert.ok(reviewJs.includes("grammarVocabulary") && reviewJs.includes("interactiveCommunication"), "Four-dimension scoring fields are missing");
assert.ok(reviewWxml.includes("不是 Cambridge 官方考试成绩"), "Practice-score disclaimer is missing");
assert.ok(recordingPracticeJs.includes("/ket-mock/pages/exam/index?lessonId="), "Legacy recording route does not redirect full mocks to the exam");
assert.ok(cloudIndex.includes('lesson.recordingTaskType === "ket_mock"'), "Normal recording submissions are not blocked for full mocks");

console.log(`KET mock validation passed (8 sets, ${imageBytes} image bytes)`);
