const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const app = JSON.parse(read("miniprogram", "app.json"));
const registeredSubpages = (app.subpackages || app.subPackages || []).flatMap((subpackage) => (
  (subpackage.pages || []).map((page) => `${subpackage.root}/${page}`)
));

[
  "follow-reading/pages/audio-manager/index",
  "follow-reading/pages/practice/index",
].forEach((page) => assert.ok(registeredSubpages.includes(page), `${page} is not registered`));

const cloudIndex = read("cloudfunctions", "quickstartFunctions", "index.js");
const service = read("cloudfunctions", "quickstartFunctions", "followReadingService.js");
const logic = read("cloudfunctions", "quickstartFunctions", "followReading.js");
const addLesson = read("miniprogram", "pages", "add-lesson", "index.js")
  + read("miniprogram", "utils", "lessonTaskOptions.js")
  + read("miniprogram", "components", "lesson-task-fields", "index.js");
const lessonDetail = read("miniprogram", "pages", "lesson-detail", "index.js");
const lessonDetailWxml = read("miniprogram", "pages", "lesson-detail", "index.wxml");
const practice = read("miniprogram", "follow-reading", "pages", "practice", "index.js");
const practiceWxml = read("miniprogram", "follow-reading", "pages", "practice", "index.wxml");
const manager = read("miniprogram", "follow-reading", "pages", "audio-manager", "index.js");
const reliableAudio = read("miniprogram", "utils", "reliableAudio.js");
const ketExam = read("miniprogram", "ket-mock", "pages", "exam", "index.js");
const ketLibrary = read("miniprogram", "ket-mock", "pages", "library", "index.wxml");

assert.ok(cloudIndex.includes('"followReadingAssets"'), "followReadingAssets collection is not initialized");
[
  "getFollowReadingAudioManager",
  "saveFollowReadingDemoAudio",
  "deleteFollowReadingDemoAudio",
  "getFollowReadingPractice",
  "submitFollowReadingBatch",
].forEach((action) => assert.ok(cloudIndex.includes(`case "${action}"`), `cloud action ${action} is missing`));

assert.ok(addLesson.includes('value: "follow_reading"'), "lesson creation cannot assign follow-reading");
assert.ok(addLesson.includes("followReadingGapSeconds"), "lesson creation has no 1-3 second gap setting");
assert.ok(lessonDetail.includes("goFollowReadingAudioManager"), "lesson detail cannot open teacher audio management");
assert.ok(lessonDetail.includes("mode=teacherPreview"), "teacher preview route is missing");
assert.ok(lessonDetailWxml.includes("独立朗读录音") && lessonDetailWxml.includes("教师示范跟读"), "ordinary reading and follow-reading are not clearly distinguished");

assert.ok(service.includes('identity.role !== "student"'), "teacher preview is not blocked from saving student recordings");
assert.ok(service.includes('recordingMode: "follow_reading"'), "follow-reading submissions are not tagged");
assert.ok(service.includes('cloudPath.startsWith("follow-reading-submissions/")'), "follow-reading upload paths are not validated");
assert.ok(logic.includes("itemTextHash"), "teacher audio is not tied to current item text");
assert.ok(manager.includes("saveFollowReadingDemoAudio"), "teacher cannot save per-item demo audio");

assert.ok(practice.includes("preloadAudioSources"), "student demo audio is not preloaded");
assert.ok(practice.includes('task.mode === "automatic"'), "automatic mode is missing");
assert.ok(practice.includes('"awaiting_play"'), "manual play mode is missing");
assert.ok(practice.includes("this.startGapCountdown()"), "audio does not lead into the 1-3 second preparation gap");
assert.ok(practice.includes("this.recorder.start"), "microphone does not start automatically");
assert.ok(practiceWxml.includes("播放老师示范") && practiceWxml.includes("麦克风随后自动打开并开始录音"), "student instructions do not explain manual playback and automatic recording");
assert.ok(practiceWxml.includes("学生的完成记录保持原状态"), "preview result handling is not explained");

assert.ok(reliableAudio.includes("onTimeUpdate"), "reliable audio playback does not confirm real timeline progress");
assert.ok(reliableAudio.includes("AUDIO_NO_PROGRESS"), "silent playback fallback is missing");
assert.ok(ketExam.includes("startExamAudioPreload") && ketExam.includes("playReliableAudio"), "KET exam does not use background preload and verified playback");
assert.ok(ketLibrary.includes("衔接保持中性") && ketLibrary.includes("下一段提示音开头"), "KET neutral transition recording guidance is missing");

console.log("follow-reading validation passed");
