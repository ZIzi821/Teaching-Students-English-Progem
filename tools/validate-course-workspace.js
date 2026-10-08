const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const backend = read("cloudfunctions/quickstartFunctions/index.js");
const reminderBackend = read("cloudfunctions/lessonReminder/index.js");
const reminderPackage = JSON.parse(read("cloudfunctions/lessonReminder/package.json"));
const quickstartPackage = JSON.parse(read("cloudfunctions/quickstartFunctions/package.json"));
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
const courseWorkflow = require(path.join(root, "cloudfunctions", "quickstartFunctions", "courseWorkflow"));
const { buildNextLessonTitleSuggestion } = require(path.join(root, "miniprogram", "utils", "lessonTitle"));
const lessonDuration = require(path.join(root, "miniprogram", "utils", "lessonDuration"));

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
assert(backend.includes("getMaterialSafetyImageFileID"), "Course material safety checks do not use the matching compressed preview");
assert(backend.includes("buildLessonPaperId"), "Course material registration is not idempotent");
assert(lessonJs.includes("registerUploadedMaterial") && lessonJs.includes("currentAttempt >= 2"), "Course material registration does not retry transient failures");
assert(
  Number(quickstartPackage["cloudfunction-config"] && quickstartPackage["cloudfunction-config"].timeout) >= 60,
  "quickstartFunctions timeout is too short for image safety checks"
);
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
assert(lessonJs.includes("compressedWidth") && lessonJs.includes("compressedHeight") && lessonJs.includes("maxEdge = 1600"), "Image safety previews are not resized before upload");
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
assert(homeWxml.includes('bindtap="goLearningActivity"'), "Teacher learning activity does not open and mark itself viewed");
assert(homeWxml.includes('catchtap="dismissLearningActivities"'), "Teacher learning activities cannot be dismissed together");
assert(homeJs.includes("markLearningActivitiesViewed"), "Teacher learning activity read state is not persisted");
assert(backend.includes('activityText: "提交了录音"'), "Recording submissions are missing from teacher homework activities");
assert(backend.includes("createdAtMs: submittedAtMs"), "New recording submissions do not keep a stable numeric activity time");
assert(homeWxml.includes("今天怎么学？"), "Student home does not show the numbered daily plan");
assert(!homeWxml.includes(">英语课程与作业<"), "Removed student course-and-homework shortcut is still visible");
assert(homeWxml.includes('bindtap="goHomeworkTasks">全部课后任务'), "Student homework shortcut does not open the dedicated list");
assert(homeWxml.includes('bindtap="goMistakeReview">错题复习'), "Student mistake shortcut does not open the dedicated review page");
assert(homeJs.includes("/pages/review-dashboard/index?studentId="), "Student mistake shortcut does not route directly to review");
assert(studentJs.includes('result.role === "student" || isTeacherPreview'), "Legacy student-detail route does not leave the removed student interface");
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
assert(addLessonWxml.includes("上一节课对照") && addLessonWxml.includes("不会自动复制"), "Previous-lesson read-only reference is missing");
assert(backend.includes("buildPreviousLessonReference"), "Previous lesson data is not returned by the protected teacher endpoint");
assert.strictEqual(buildNextLessonTitleSuggestion("基础句型与个人表达-5"), "基础句型与个人表达-6", "Lesson title sequence did not advance");
assert.strictEqual(buildNextLessonTitleSuggestion("单词阶段-1"), "单词阶段-2", "A teacher-created lesson stage did not advance");
assert.strictEqual(buildNextLessonTitleSuggestion("Unit 09"), "Unit 10", "Padded lesson title sequence did not advance");
assert.strictEqual(buildNextLessonTitleSuggestion("没有编号的课程"), "", "A title without a trailing number should not be guessed");
assert(addLessonJs.includes("lessonTitleSuggestion") && addLessonWxml.includes("lessonTitleSuggestion"), "New lessons do not show the previous-title sequence suggestion");
assert(addLessonWxml.includes("机构课程") && lessonWxml.includes("机构课程"), "Institution-course controls are missing from lesson creation or editing");
assert(addLessonJs.includes("institutionCourse: form.institutionCourse === true") && lessonJs.includes('"workspaceForm.institutionCourse"'), "Institution-course state is not submitted by both teacher forms");
assert.strictEqual(lessonDuration.usesLessonDurationMinutes({ name: "冯嘉文", progressUnit: "lesson" }, "feng_beginner"), false);
assert.strictEqual(lessonDuration.usesLessonDurationMinutes({ name: "冯嘉文", progressUnit: "lesson" }, "vocabulary_coaching"), true);
assert.strictEqual(lessonDuration.usesLessonDurationMinutes({ name: "徐浩成", progressUnit: "minute" }, "general"), true);
assert(addLessonJs.includes("if (!showDurationMinutes)") && addLessonJs.includes("if (durationApplies) lessonPayload.durationMinutes"), "New-lesson duration state can leak into an unrelated student or template");
assert(lessonJs.includes("if (!durationApplies) delete workspacePayload.durationMinutes"), "Lesson editing still submits a hidden duration field");
assert(backend.includes("options.acceptDurationMinutes === false") && backend.includes("courseWorkflow.usesLessonDurationMinutes"), "Cloud lesson writes do not enforce contextual duration ownership");
assert(backend.includes("courseWorkflow.withApplicableLessonDuration"), "Existing stray duration values are not hidden from unrelated lesson views");
assert(backend.includes('progressUnit: lessonAccountingMode === "minute" ? "minute" : "lesson"'), "Lesson detail does not expose Xu Haocheng's minute-accounting mode to the editor");
assert(backend.includes("Number(value) === 0"), "Normalized empty lesson durations cannot be fingerprinted safely");
assert(backend.includes("countLessonProgressRecords") && backend.includes("sync lesson count after course type update failed"), "Institution courses do not trigger an authoritative lesson-progress recount");
assert.strictEqual(courseWorkflow.countLessonProgressRecords([{}, { institutionCourse: true }, { institutionCourse: false }]), 2, "Institution courses must be the only lesson records excluded from progress");
assert(homeWxml.includes("不计入个人课程进度") && studentWxml.includes("不计入个人课程进度"), "Institution courses are not labelled in English course records");
assert(addLessonWxml.includes("录音作业期限") && lessonWxml.includes("录音作业期限"), "Teacher recording deadline controls are missing");
assert(backend.includes("homeworkDueDays") && backend.includes("syncLessonSubmissionTiming"), "Homework deadline or late-submission state is not persisted");
assert(homeworkWxml.includes("deadlineLabel") && lessonWxml.includes("逾期提交"), "Student deadline and late-submission labels are missing");
assert(homeWxml.includes("lesson-progress-marker") && studentWxml.includes("progress-marker"), "Subtle lesson-balance progress markers are missing");
assert(!homeWxml.includes("续费") && !studentWxml.includes("续费"), "Parent-visible progress UI contains renewal wording");
assert(appJson.pages.includes("pages/recording-practice/index"), "Recording practice page is not registered");
assert(appJson.pages.includes("pages/homework/index"), "Homework list page is not registered");
assert(homeworkJs.includes("listStudentHomework"), "Homework list does not use the protected cloud endpoint");
assert(!homeworkJs.includes("saveLearningReminderSubscription"), "Removed long-term reminder action is still present");
assert(!backend.includes("learningReminderSubscriptions"), "Removed long-term reminder storage is still registered");
[
  "老师让你继续完成",
  "已逾期",
  "今天截止",
  "即将到期",
  "已提交，等待老师",
  "已经完成",
].forEach((label) => {
  assert(homeworkJs.includes(label) || homeworkWxml.includes(label), `Homework physical group is missing: ${label}`);
});
assert(homeworkWxml.includes("summary.actionableCount") && homeworkWxml.includes("summary.awaitingReviewCount"), "Homework summary does not separate student actions from teacher review");
assert(homeworkJs.includes("inferHomeworkListGroup") && homeworkJs.includes("taskSections"), "Homework list does not build deterministic physical sections");
assert(backend.includes("buildHomeworkListGrouping"), "Cloud homework list does not return deterministic grouping metadata");
assert(homeworkWxml.includes('bindtap="toggleCompleted"') && homeworkJs.includes("showCompleted: false"), "Completed homework is not collapsed by default");
assert(!homeworkWxml.includes("家长长期学习提醒"), "Removed long-term reminder entry is still visible");
assert(addLessonWxml.includes("录音任务类型") && addLessonWxml.includes("Molly 还可选择 KET") && addLessonWxml.includes("选择官方口语样题"), "Molly KET task selector is missing from lesson creation");
assert(addLessonWxml.includes('maxlength="2000"'), "New-lesson recording prompt limit is too short");
assert(lessonWxml.includes('maxlength="2000"'), "Lesson-edit recording prompt limit is too short");
assert(backend.includes("normalizeLessonText(data.recordingPrompt, 2000)"), "Cloud recording prompt limit is too short");
assert(lessonWxml.includes('data-field="title"'), "Teacher course editor cannot change the lesson title");
assert(lessonJs.includes("buildNextLessonTitleSuggestion") && lessonWxml.includes("lessonTitleSuggestion"), "Lesson title shortcuts are not derived from the previous lesson");
assert(!lessonWxml.includes('student.name === \'Molly\''), "Lesson title suggestions are still restricted to one student");
assert(lessonJs.includes('"workspaceForm.title": title'), "Lesson title shortcut does not update the course form");
assert(lessonJs.includes("title: lesson.title || \"\""), "Existing course title is not loaded into the teacher editor");
assert(backend.includes("title: normalizeLessonText(data.title, 100)"), "Updated course title is not normalized server-side");
assert(backend.includes('if (!workspace.title) throw createError("INVALID_LESSON_TITLE"'), "Blank course titles are not rejected");
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
assert.strictEqual(courseWorkflow.getLessonPackageSize({ name: "Molly" }), 5);
assert.strictEqual(courseWorkflow.getLessonPackageSize({ name: "冯嘉文" }), 3);
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
