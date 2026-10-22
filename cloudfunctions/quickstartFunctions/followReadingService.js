const crypto = require("crypto");
const followReading = require("./followReading");

const createFollowReadingService = ({
  db,
  cloud,
  courseWorkflow,
  createError,
  createOneCollection,
  deleteUnsafeFiles,
  ensureEnglishCourseAccess,
  ensureStudentAccess,
  ensureTeacher,
  getIdentity,
  getOptionalTransactionDocument,
}) => {
  const loadAllByField = async (collectionName, field, value) => {
    const documents = [];
    const pageSize = 100;
    for (let skip = 0; ; skip += pageSize) {
      const result = await db.collection(collectionName).where({ [field]: value }).skip(skip).limit(pageSize).get();
      const items = result.data || [];
      documents.push(...items);
      if (items.length < pageSize) break;
    }
    return documents;
  };

  const attachAudioUrls = async (items) => {
    const safeItems = Array.isArray(items) ? items : [];
    const fileIDs = Array.from(new Set(safeItems.map((item) => item && item.fileID).filter(Boolean)));
    if (!fileIDs.length) return safeItems.map((item) => Object.assign({}, item, { audioUrl: "" }));
    const urlByFileID = new Map();
    for (let offset = 0; offset < fileIDs.length; offset += 50) {
      try {
        const result = await cloud.getTempFileURL({ fileList: fileIDs.slice(offset, offset + 50) });
        (result.fileList || []).forEach((file) => {
          if (file && file.status === 0 && file.fileID && file.tempFileURL) {
            urlByFileID.set(String(file.fileID), String(file.tempFileURL));
          }
        });
      } catch (err) {
        console.error("get follow-reading audio urls failed", err);
      }
    }
    return safeItems.map((item) => Object.assign({}, item, {
      audioUrl: urlByFileID.get(String(item && item.fileID || "")) || "",
    }));
  };

  const getAssignedLesson = async (lessonId, data = {}) => {
    if (!lessonId) throw createError("INVALID_LESSON", "课程信息不完整，请返回后重试");
    const identity = await getIdentity();
    if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
    const lessonResult = await db.collection("lessons").doc(lessonId).get();
    const lesson = lessonResult.data;
    if (!lesson || lesson.deleting === true) throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
    if (lesson.recordingTaskEnabled !== true || lesson.recordingTaskType !== "follow_reading") {
      throw createError("FOLLOW_READING_NOT_ASSIGNED", "老师尚未为这节课布置跟读任务");
    }
    const isTeacherPreview = identity.role === "teacher" && data.mode === "teacherPreview";
    if (identity.role === "teacher" && !isTeacherPreview && data.studentView === true) {
      throw createError("PERMISSION_DENIED", "请从教师预览入口进入学生跟读页");
    }
    if (isTeacherPreview && data.previewStudentId && lesson.studentId !== data.previewStudentId) {
      throw createError("PERMISSION_DENIED", "请从对应学生的课程页进入跟读任务");
    }
    if (identity.role === "student" && (!identity.student || identity.student._id !== lesson.studentId)) {
      throw createError("PERMISSION_DENIED", "请使用当前学生账号完成跟读任务");
    }
    await ensureStudentAccess(lesson.studentId);
    const studentResult = await db.collection("students").doc(lesson.studentId).get();
    if (!studentResult.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    ensureEnglishCourseAccess(identity, studentResult.data, data);
    const task = followReading.normalizeTask(lesson);
    if (!task.followReadingItems.length) {
      throw createError("FOLLOW_READING_EMPTY", "跟读内容为空，请联系老师重新布置");
    }
    return { identity, isTeacherPreview, lesson, student: studentResult.data, task };
  };

  const loadLessonAssets = async (lessonId, withUrls = false) => {
    await createOneCollection("followReadingAssets");
    const assets = await loadAllByField("followReadingAssets", "lessonId", lessonId);
    return withUrls ? attachAudioUrls(assets) : assets;
  };

  const getLessonSummary = async (lesson) => {
    if (!lesson || lesson.recordingTaskType !== "follow_reading") return null;
    const task = followReading.normalizeTask(lesson);
    const assets = await loadLessonAssets(lesson._id, false);
    const completeness = followReading.buildAssetCompleteness(task, assets);
    return {
      readyCount: completeness.readyCount,
      totalCount: completeness.totalCount,
      complete: completeness.complete,
    };
  };

  const getAudioManager = async (event) => {
    await ensureTeacher();
    const lessonId = String(event.data && event.data.lessonId || "").trim();
    const context = await getAssignedLesson(lessonId);
    const assets = await loadLessonAssets(lessonId, true);
    const completeness = followReading.buildAssetCompleteness(context.task, assets);
    return {
      success: true,
      lesson: {
        _id: context.lesson._id,
        title: context.lesson.title || "英语课",
        lessonDate: context.lesson.lessonDate || "",
        lessonNo: context.lesson.lessonNo || "",
      },
      student: { _id: context.student._id, name: context.student.name || "学生" },
      mode: context.task.followReadingMode,
      gapSeconds: context.task.followReadingGapSeconds,
      responseSeconds: context.task.followReadingResponseSeconds,
      readyCount: completeness.readyCount,
      totalCount: completeness.totalCount,
      audioComplete: completeness.complete,
      items: completeness.items.map((item) => ({
        id: item.id,
        order: item.order,
        text: item.text,
        audioReady: item.audioReady,
        audioUrl: item.audioAsset && item.audioAsset.audioUrl || "",
        audioFileName: item.audioAsset && item.audioAsset.fileName || "",
        audioUpdatedAtMs: Number(item.audioAsset && item.audioAsset.updatedAtMs || 0),
      })),
    };
  };

  const saveDemoAudio = async (event) => {
    await ensureTeacher();
    await createOneCollection("followReadingAssets");
    const data = event.data || {};
    const lessonId = String(data.lessonId || "").trim();
    const context = await getAssignedLesson(lessonId);
    const item = context.task.followReadingItems.find((candidate) => candidate.id === String(data.itemId || ""));
    const fileID = String(data.fileID || "").trim();
    const cloudPath = String(data.cloudPath || "").trim().slice(0, 500);
    if (!item || !fileID) throw createError("INVALID_FOLLOW_READING_AUDIO", "示范音频所属内容或文件信息不完整");
    if (cloudPath && !cloudPath.startsWith("follow-reading-assets/")) {
      throw createError("INVALID_FOLLOW_READING_AUDIO", "示范音频的云端目录不正确，请重新上传");
    }
    const assetId = followReading.getAssetDocumentId(lessonId, item.id);
    const nowMs = Date.now();
    const previous = await db.runTransaction(async (transaction) => {
      const ref = transaction.collection("followReadingAssets").doc(assetId);
      const current = await getOptionalTransactionDocument(ref);
      await ref.set({
        data: {
          lessonId,
          studentId: context.lesson.studentId,
          itemId: item.id,
          itemOrder: item.order,
          itemTextHash: item.textHash,
          itemTextSnapshot: item.text,
          fileID,
          cloudPath,
          fileName: String(data.fileName || "teacher-demo.mp3").trim().slice(0, 180),
          fileSize: Math.max(0, Number(data.fileSize) || 0),
          updatedAt: db.serverDate(),
          updatedAtMs: nowMs,
        },
      });
      return current;
    });
    if (previous && previous.fileID && previous.fileID !== fileID) await deleteUnsafeFiles([previous.fileID]);
    return { success: true, assetId, lessonId, itemId: item.id };
  };

  const deleteDemoAudio = async (event) => {
    await ensureTeacher();
    await createOneCollection("followReadingAssets");
    const data = event.data || {};
    const lessonId = String(data.lessonId || "").trim();
    const context = await getAssignedLesson(lessonId);
    const item = context.task.followReadingItems.find((candidate) => candidate.id === String(data.itemId || ""));
    if (!item) throw createError("INVALID_FOLLOW_READING_AUDIO", "跟读内容已经变化，请刷新后重试");
    const assetId = followReading.getAssetDocumentId(lessonId, item.id);
    const current = await getOptionalTransactionDocument(db.collection("followReadingAssets").doc(assetId));
    if (!current) return { success: true, alreadyDeleted: true };
    await db.collection("followReadingAssets").doc(assetId).remove();
    await deleteUnsafeFiles([current.fileID]);
    return { success: true, assetId };
  };

  const getPractice = async (event) => {
    const data = event.data || {};
    const lessonId = String(data.lessonId || "").trim();
    const context = await getAssignedLesson(lessonId, Object.assign({}, data, { studentView: true }));
    if (context.identity.role === "teacher" && !context.isTeacherPreview) {
      throw createError("PERMISSION_DENIED", "请从教师预览入口进入学生跟读页");
    }
    const assets = await loadLessonAssets(lessonId, true);
    const task = followReading.sanitizeTaskForStudent(context.task, assets);
    if (!task.audioComplete) {
      throw createError("FOLLOW_READING_AUDIO_INCOMPLETE", `老师还需准备 ${task.totalCount - task.readyCount} 段示范音频，完成后才能开始`);
    }
    await createOneCollection("lessonSubmissions");
    const taskVersion = Math.max(1, Number(context.lesson.homeworkTaskVersion) || 1);
    const submissions = (await loadAllByField("lessonSubmissions", "lessonId", lessonId))
      .filter((item) => (
        item.studentId === context.lesson.studentId
        && item.recordingMode === "follow_reading"
        && Number(item.homeworkTaskVersion || 1) === taskVersion
      ));
    const previousAttemptCount = new Set(submissions.map((item) => item.batchId).filter(Boolean)).size;
    return {
      success: true,
      role: context.identity.role,
      isTeacherPreview: context.isTeacherPreview,
      lesson: {
        _id: context.lesson._id,
        title: context.lesson.title || "英语课",
        lessonDate: context.lesson.lessonDate || "",
        lessonNo: context.lesson.lessonNo || "",
        recordingPrompt: context.lesson.recordingPrompt || "",
        homeworkTaskVersion: taskVersion,
      },
      student: { _id: context.student._id, name: context.student.name || "学生" },
      task,
      previousAttemptCount,
      nextAttemptNo: previousAttemptCount + 1,
    };
  };

  const normalizeResponses = (task, responses) => {
    const expectedIds = task.followReadingItems.map((item) => item.id);
    const items = Array.isArray(responses) ? responses : [];
    const seen = new Set();
    const normalized = items.map((response) => {
      const item = task.followReadingItems.find((candidate) => candidate.id === String(response && response.itemId || ""));
      if (!item || seen.has(item.id)) throw createError("INVALID_FOLLOW_READING_RESPONSES", "跟读录音顺序不完整，请重新练习");
      seen.add(item.id);
      const fileID = String(response.fileID || "").trim();
      const cloudPath = String(response.cloudPath || "").trim().slice(0, 500);
      if (!fileID || !cloudPath.startsWith("follow-reading-submissions/")) {
        throw createError("INVALID_FOLLOW_READING_RESPONSES", "有一段跟读录音没有成功上传，请重试");
      }
      const duration = Math.max(0, Math.min(60000, Number(response.duration) || 0));
      if (duration < 300) {
        throw createError("INVALID_FOLLOW_READING_RESPONSES", "有一段跟读录音时间太短，请重新练习");
      }
      return {
        itemId: item.id,
        itemOrder: item.order,
        itemText: item.text,
        fileID,
        cloudPath,
        fileName: String(response.fileName || `${item.id}.mp3`).slice(0, 180),
        duration,
        fileSize: Math.max(0, Number(response.fileSize) || 0),
      };
    });
    if (normalized.length !== expectedIds.length || expectedIds.some((itemId) => !seen.has(itemId))) {
      throw createError("INVALID_FOLLOW_READING_RESPONSES", "跟读录音数量不完整，请重新练习");
    }
    return normalized.sort((left, right) => left.itemOrder - right.itemOrder);
  };

  const submitBatch = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "student" || !identity.student) {
      throw createError("PERMISSION_DENIED", "当前为教师预览，请使用学生账号提交跟读录音");
    }
    const data = event.data || {};
    const lessonId = String(data.lessonId || "").trim();
    const context = await getAssignedLesson(lessonId, data);
    const responses = normalizeResponses(context.task, data.responses);
    const requestId = String(data.requestId || "").trim().slice(0, 100);
    if (!requestId) throw createError("INVALID_FOLLOW_READING_REQUEST", "本次跟读记录不完整，请重新练习");
    await createOneCollection("lessonSubmissions");
    const taskVersion = Math.max(1, Number(context.lesson.homeworkTaskVersion) || 1);
    const batchId = `follow_batch_${crypto.createHash("sha1")
      .update(`${identity.student._id}\n${lessonId}\n${taskVersion}\n${requestId}`)
      .digest("hex")}`;
    const existing = (await loadAllByField("lessonSubmissions", "batchId", batchId))
      .filter((item) => item.studentId === identity.student._id && item.lessonId === lessonId);
    if (existing.length >= responses.length) {
      return {
        success: true,
        alreadySubmitted: true,
        batchId,
        attemptNo: Math.max(1, Number(existing[0] && existing[0].attemptNo) || 1),
        submittedLate: existing.some((item) => item.submittedLate === true),
      };
    }
    const currentSubmissions = (await loadAllByField("lessonSubmissions", "lessonId", lessonId))
      .filter((item) => (
        item.studentId === identity.student._id
        && item.recordingMode === "follow_reading"
        && Number(item.homeworkTaskVersion || 1) === taskVersion
      ));
    const attemptNo = new Set(currentSubmissions.map((item) => item.batchId).filter(Boolean)).size + 1;
    const submittedAtMs = Date.now();
    const submittedLate = courseWorkflow.isLateHomeworkSubmission(context.lesson, submittedAtMs);
    await db.runTransaction(async (transaction) => {
      const lessonRef = transaction.collection("lessons").doc(lessonId);
      const currentLesson = await getOptionalTransactionDocument(lessonRef);
      if (
        !currentLesson
        || currentLesson.deleting === true
        || currentLesson.studentId !== identity.student._id
        || currentLesson.recordingTaskType !== "follow_reading"
        || Number(currentLesson.homeworkTaskVersion || 1) !== taskVersion
      ) throw createError("FOLLOW_READING_NOT_ASSIGNED", "跟读任务已经变化，请返回课程页重新进入");
      for (let index = 0; index < responses.length; index += 1) {
        const response = responses[index];
        const submissionId = `submission_${crypto.createHash("sha1")
          .update(`${batchId}\n${response.itemId}`)
          .digest("hex")}`;
        const submissionRef = transaction.collection("lessonSubmissions").doc(submissionId);
        await submissionRef.set({
          data: {
            studentId: identity.student._id,
            lessonId,
            kind: "audio",
            recordingMode: "follow_reading",
            followReadingMode: context.task.followReadingMode,
            followReadingItemId: response.itemId,
            followReadingItemOrder: response.itemOrder,
            followReadingItemText: response.itemText,
            batchId,
            fileID: response.fileID,
            fileName: response.fileName,
            fileSize: response.fileSize,
            duration: response.duration,
            cloudPath: response.cloudPath,
            organizedVersion: 2,
            studentNameSnapshot: String(identity.student.name || "学生").slice(0, 100),
            lessonTitleSnapshot: String(currentLesson.title || "英语课").slice(0, 200),
            lessonDateSnapshot: String(currentLesson.lessonDate || "").slice(0, 30),
            lessonNoSnapshot: String(currentLesson.lessonNo || "").slice(0, 30),
            homeworkTaskVersion: taskVersion,
            attemptNo,
            status: "待检查",
            teacherFeedback: "",
            submittedLate,
            createdAt: db.serverDate(),
            createdAtMs: submittedAtMs + index,
          },
        });
      }
      const firstSubmittedAtMs = Number(currentLesson.homeworkFirstSubmittedAtMs || 0) || submittedAtMs;
      await lessonRef.update({
        data: {
          homeworkFirstSubmittedAtMs: firstSubmittedAtMs,
          homeworkLastSubmittedAtMs: submittedAtMs,
          homeworkSubmittedLate: courseWorkflow.isLateHomeworkSubmission(currentLesson, firstSubmittedAtMs),
        },
      });
    });
    return { success: true, batchId, attemptNo, submittedLate };
  };

  const deleteLessonAssets = async (lessonId) => {
    await createOneCollection("followReadingAssets");
    const assets = await loadAllByField("followReadingAssets", "lessonId", lessonId);
    for (let index = 0; index < assets.length; index += 20) {
      await Promise.all(assets.slice(index, index + 20).map((asset) => (
        db.collection("followReadingAssets").doc(asset._id).remove()
      )));
    }
    await deleteUnsafeFiles(assets.map((asset) => asset.fileID).filter(Boolean));
    return { deletedAssetCount: assets.length };
  };

  return {
    deleteDemoAudio,
    deleteLessonAssets,
    getAudioManager,
    getLessonSummary,
    getPractice,
    saveDemoAudio,
    submitBatch,
  };
};

module.exports = { createFollowReadingService };
