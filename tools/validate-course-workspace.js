const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const backend = read("cloudfunctions/quickstartFunctions/index.js");
const reminderBackend = read("cloudfunctions/lessonReminder/index.js");
const reminderPackage = JSON.parse(read("cloudfunctions/lessonReminder/package.json"));
const homeWxml = read("miniprogram/pages/index/index.wxml");
const homeJs = read("miniprogram/pages/index/index.js");
const lessonJs = read("miniprogram/pages/lesson-detail/index.js");
const lessonWxml = read("miniprogram/pages/lesson-detail/index.wxml");
const recordingJs = read("miniprogram/pages/recording-practice/index.js");
const recordingWxml = read("miniprogram/pages/recording-practice/index.wxml");
const studentJs = read("miniprogram/pages/student-detail/index.js");
const studentWxml = read("miniprogram/pages/student-detail/index.wxml");
const addLessonJs = read("miniprogram/pages/add-lesson/index.js");
const addLessonWxml = read("miniprogram/pages/add-lesson/index.wxml");
const homeworkJs = read("miniprogram/pages/homework/index.js");
const homeworkWxml = read("miniprogram/pages/homework/index.wxml");
const appJson = JSON.parse(read("miniprogram/app.json"));
const lessonTemplates = require(path.join(root, "miniprogram", "utils", "lessonTemplates"));
const { KET_SPEAKING_TASKS } = require(path.join(root, "miniprogram", "utils", "ketSpeakingTasks"));
const cloudKetTasks = JSON.parse(read("cloudfunctions/quickstartFunctions/data/ket-speaking-tasks.json"));

[
  "setEnglishCourseSettings",
  "setStudentLessonTemplate",
  "updateLessonWorkspace",
  "updatePaper",
  "deletePaper",
  "deleteLessonPapers",
  "replacePaperFile",
  "submitLessonRecording",
  "markHomeworkActivitiesViewed",
  "organizeLessonRecordingFiles",
  "reviewLessonRecording",
  "deleteLessonRecording",
  "reviewLessonHomeworkCompletion",
  "subscribeHomeworkReminder",
  "listStudentHomework",
  "listKetSpeakingTasks",
  "getKetWeeklyStatus",
].forEach((type) => {
  assert(backend.includes(`case \"${type}\"`), `Missing cloud action: ${type}`);
});

assert(backend.includes("const getOptionalTransactionDocument = async"), "Shared transaction document reader is missing");
assert(backend.includes('"lessonSubmissions"'), "lessonSubmissions collection is not registered");
assert(backend.includes("paperTitle: data.paperTitle"), "Material title is not persisted");
assert(backend.includes("studentVisible"), "Material visibility is not persisted");
assert(backend.includes("isEnglishCourseEnabled"), "Course access is not isolated from mistakes");
assert(backend.includes("feng_beginner"), "Feng Jiawen lesson template is missing");
assert(backend.includes("molly_oral_ket"), "Molly lesson template is missing");
assert(backend.includes("cloud.getTempFileURL"), "Authorized recording playback URLs are not generated server-side");
assert(backend.includes("attachLessonPaperUrls"), "Course materials do not receive authorized preview/download URLs");
assert(backend.includes("previewFileID"), "Image materials do not keep a fast preview copy");
assert(backend.includes("buildReadableRecordingCloudPath"), "Legacy recordings do not have a readable migration path");
assert(lessonJs.includes("item.paperTitle || item.title"), "Displayed material title does not prefer paperTitle");
assert(lessonJs.includes("submission.audioUrl"), "Teacher playback does not use the authorized recording URL");
assert(recordingJs.includes("wx.getRecorderManager"), "Student recorder is not initialized on the practice page");
assert(recordingJs.includes("lesson-submissions/${studentFolder}/${lessonFolder}"), "New recordings do not use readable cloud folders");
assert(recordingJs.includes("startPreparationCountdown"), "Recording preparation countdown is missing");
assert(recordingJs.includes("countdown <= 0"), "Exam-style immediate speaking start is missing");
assert(recordingWxml.includes("请朗读"), "Recording prompt is not visible during practice");
assert(recordingWxml.includes("朗读 ' + repeatCount + ' 遍"), "Recording repetition guidance is missing");
assert(lessonJs.includes("readComputerMaterials"), "Desktop material reader is missing");
assert(lessonJs.includes("127.0.0.1:3211"), "Desktop material bridge is not isolated on localhost");
assert(lessonJs.includes('"pptx"') && lessonJs.includes('"document"'), "PPT/PPTX courseware support is missing");
assert(lessonJs.includes("wx.compressImage"), "Image preview compression is missing");
assert(lessonJs.includes("wx.saveImageToPhotosAlbum"), "Parent image saving is missing");
assert(lessonWxml.includes('class="material-image-preview"'), "Course images are not displayed inline");
assert(lessonWxml.includes('bindtap="openMaterial"'), "Inline course images cannot open full-screen preview");
assert(lessonWxml.includes('show-menu-by-longpress="{{true}}"'), "Inline course images do not expose the native long-press menu");
assert(lessonWxml.includes("保存原图"), "Inline course images do not expose original-image saving");
assert(/\.material-image-preview\s*\{[\s\S]*?height:\s*380rpx/.test(read("miniprogram/pages/lesson-detail/index.wxss")), "Inline course image preview has no stable readable height");
assert(lessonWxml.includes("不再显示乱码名"), "Friendly multi-file naming guidance is missing");
assert(lessonWxml.includes("bindtap=\"saveMaterial\""), "Material save action is missing");
assert(lessonWxml.includes("学生已提交"), "Teacher recording list is missing");
assert(lessonWxml.includes("删除录音"), "Teacher recording delete action is missing");
assert(lessonJs.includes("再次确认永久删除"), "Recording deletion does not have a second confirmation");
assert(!lessonWxml.includes("我已完成全部课后任务"), "Student can still confirm homework completion");
assert(lessonWxml.includes("完成情况由老师检查确认"), "Student homework page does not explain teacher-only confirmation");
assert(lessonWxml.includes("学生已完成课后任务"), "Teacher completed-homework review action is missing");
assert(lessonWxml.includes("学生没有完成课后任务"), "Teacher incomplete-homework review action is missing");
assert(lessonWxml.includes("朗读内容"), "Readable recording prompt label is missing");
assert(lessonWxml.includes("要完成的任务"), "Readable homework task label is missing");
assert(/\.recording-task-prompt\s*\{[\s\S]*?font-size:\s*32rpx/.test(read("miniprogram/pages/lesson-detail/index.wxss")), "Recording prompt text is too small for students");
assert(/\.recording-task-prompt\s*\{[\s\S]*?white-space:\s*pre-wrap/.test(read("miniprogram/pages/lesson-detail/index.wxss")), "Recording prompt line breaks are not preserved");
assert(lessonJs.includes("reviewHomeworkCompletion"), "Teacher homework review handler is missing");
assert(backend.includes("homeworkTeacherReviewStatus"), "Teacher homework review state is not persisted");
assert(!backend.includes('case "completeLessonHomework"'), "Student homework completion API is still callable");
assert(!backend.includes('buildHomeworkCompletedFields("student")'), "Student homework completion can still be persisted");
assert(!backend.includes('buildHomeworkCompletedFields("recording")'), "Recording submission can still auto-complete the whole homework task");
assert(backend.includes('lesson.homeworkTeacherReviewStatus === "completed"'), "Homework completion is not derived from teacher confirmation");
assert(lessonJs.includes("wx.requestSubscribeMessage"), "Student homework reminder authorization is missing");
assert(backend.includes("cancelled_completed"), "Homework completion does not cancel pending reminders");
assert(reminderBackend.includes("processHomeworkReminders"), "Daily homework reminder processor is missing");
assert(reminderBackend.includes("课后任务待完成"), "Homework reminder message is missing");
assert(reminderBackend.includes("HOMEWORK_REMINDER_PAGE"), "Homework reminder does not link to the lesson workspace");
assert(reminderBackend.includes("HOMEWORK_LATE_SEND_WINDOW_MS"), "Stale homework reminders can be sent at the wrong time");
assert(!reminderBackend.includes("bookingReminderResult = await processBookingReminders(now)"), "Removed booking reminder queue is still active");
assert(
  Number(reminderPackage.cloudfunctionConfig && reminderPackage.cloudfunctionConfig.timeout
    || reminderPackage["cloudfunction-config"] && reminderPackage["cloudfunction-config"].timeout) >= 60,
  "lessonReminder timeout is too short for the homework reminder queue"
);
assert(homeWxml.includes("待查看的新动态"), "Teacher home does not show unread homework activities");
assert(homeWxml.includes('bindtap="goHomeworkActivity"'), "Teacher homework activity does not open and mark itself viewed");
assert(homeWxml.includes('catchtap="dismissHomeworkActivities"'), "Teacher homework activities cannot be dismissed together");
assert(homeJs.includes("markHomeworkActivitiesViewed"), "Teacher homework activity read state is not persisted");
assert(backend.includes('activityText: "提交了录音"'), "Recording submissions are missing from teacher homework activities");
assert(backend.includes("createdAtMs: Date.now()"), "New recording submissions do not keep a stable numeric activity time");
assert(homeWxml.includes("今天怎么学？"), "Student home does not show the numbered daily plan");
assert(homeJs.includes('title: "查看课后任务"'), "Student home does not include homework as a learning step");
assert(homeJs.includes("prefetchTodayVocabularyAudio"), "Student home does not start today's audio prefetch");
assert(homeJs.includes("prefetchVocabularyAudio(todayWords"), "Student home does not cache today's direct word audio");
assert(homeWxml.includes("真实学生首页"), "Teacher preview does not identify the shared student home");
assert(lessonWxml.includes("学习观察"), "Learning observation UI is missing");
assert(lessonWxml.includes("课件与资料"), "Collapsed material area is missing");
assert(studentJs.includes("onCourseLearningChange"), "Course feature switch handler is missing");
assert(studentJs.includes("onStudentLessonTemplateChange"), "Student lesson template handler is missing");
assert(studentWxml.includes("英语课程与作业功能"), "Course feature switch UI is missing");
assert(addLessonJs.includes("wx.redirectTo"), "New lesson does not open the course workspace");
assert(addLessonJs.includes("inferLessonTemplateKey"), "New lessons do not inherit the student template");
assert(appJson.pages.includes("pages/recording-practice/index"), "Recording practice page is not registered");
assert(appJson.pages.includes("pages/homework/index"), "Homework list page is not registered");
assert(homeworkJs.includes("listStudentHomework"), "Homework list does not use the protected cloud endpoint");
assert(!homeworkJs.includes("saveLearningReminderSubscription"), "Removed long-term reminder action is still present");
assert(!backend.includes("learningReminderSubscriptions"), "Removed long-term reminder storage is still registered");
assert(homeworkWxml.includes("现在要完成"), "Homework list pending section is missing");
assert(!homeworkWxml.includes("家长长期学习提醒"), "Removed long-term reminder entry is still visible");
assert(addLessonWxml.includes("Molly 的录音任务类型") && addLessonWxml.includes("选择官方口语样题"), "Molly KET task selector is missing from lesson creation");
assert(addLessonWxml.includes('maxlength="2000"'), "New-lesson recording prompt limit is too short");
assert(lessonWxml.includes('maxlength="2000"'), "Lesson-edit recording prompt limit is too short");
assert(backend.includes("normalizeLessonText(data.recordingPrompt, 2000)"), "Cloud recording prompt limit is too short");
assert(lessonWxml.includes("KET 口语录音"), "KET speaking metadata is missing from lesson detail");
assert(!appJson.pages.includes("pages/lesson-bookings/index"), "Removed booking page is still registered");
assert(!homeWxml.includes("goLessonBookings") && !studentWxml.includes("goLessonBookings"), "Removed booking entry is still visible");
assert(!backend.includes('case "submitLessonBooking"') && !backend.includes('case "listLessonBookings"'), "Removed booking API is still callable");
assert.strictEqual(KET_SPEAKING_TASKS.length, 3, "Unexpected local KET speaking catalog size");
assert.deepStrictEqual(
  cloudKetTasks,
  KET_SPEAKING_TASKS,
  "Cloud and mini-program KET catalogs are out of sync"
);
KET_SPEAKING_TASKS.forEach((task) => {
  assert.strictEqual(task.sourceYear, 2020, "Official task year must be explicit");
  assert(/cambridgeenglish\.org/.test(task.sourceUrl), "KET task source must be an official Cambridge URL");
  assert(/Test 1/.test(task.sourceReference) && /第/.test(task.sourceReference), "KET official page reference is missing");
  assert(task.timingLabel, "KET task timing explanation is missing");
});
assert.strictEqual(lessonTemplates.inferLessonTemplateKey({ name: "冯嘉文" }), "feng_beginner");
assert.strictEqual(lessonTemplates.inferLessonTemplateKey({ name: "Molly" }), "molly_oral_ket");
assert.strictEqual(lessonTemplates.inferLessonTemplateKey({ name: "新同学" }), "general");
assert.strictEqual(
  lessonTemplates.inferLessonTemplateKey({ name: "冯嘉文", lessonTemplateKey: "general" }),
  "general",
  "An explicit teacher selection must override name-based compatibility"
);
assert(fs.existsSync(path.join(root, "tools/local-material-uploader/server.js")), "Desktop material helper is missing");
assert(
  appJson.permission && appJson.permission["scope.record"],
  "Microphone permission description is missing"
);

const handlerNames = Array.from(lessonWxml.matchAll(/(?:bind|catch)(?:tap|input|change)="([A-Za-z0-9_]+)"/g))
  .map((match) => match[1]);
handlerNames.forEach((handler) => {
  assert(new RegExp(`\\n\\s*${handler}\\s*\\(`).test(lessonJs), `Missing lesson-detail handler: ${handler}`);
});

const modalConfirmTexts = Array.from(lessonJs.matchAll(/confirmText:\s*["']([^"']+)["']/g))
  .map((match) => match[1]);
modalConfirmTexts.forEach((label) => {
  assert(Array.from(label).length <= 4, `wx.showModal confirmText exceeds 4 characters: ${label}`);
});
assert(
  /reviewHomeworkCompletion\s*\([\s\S]*?confirmText:\s*markCompleted\s*\?\s*"已完成"\s*:\s*"未完成"/.test(lessonJs),
  "Teacher homework review modal must use WeChat-compatible confirmation labels"
);

const recordingHandlerNames = Array.from(recordingWxml.matchAll(/(?:bind|catch)(?:tap|input|change)="([A-Za-z0-9_]+)"/g))
  .map((match) => match[1]);
recordingHandlerNames.forEach((handler) => {
  assert(new RegExp(`\\n\\s*${handler}\\s*\\(`).test(recordingJs), `Missing recording-practice handler: ${handler}`);
});

console.log("course workspace validation passed");
