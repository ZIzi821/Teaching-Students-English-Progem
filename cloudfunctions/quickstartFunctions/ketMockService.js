const ketMock = require("./ketMock");

const createKetMockService = ({
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
  assertContentSafe,
}) => {
  const loadAllByField = async (collectionName, field, value) => {
    const documents = [];
    const pageSize = 100;
    for (let skip = 0; ; skip += pageSize) {
      const res = await db.collection(collectionName).where({ [field]: value }).skip(skip).limit(pageSize).get();
      const items = res.data || [];
      documents.push(...items);
      if (items.length < pageSize) break;
    }
    return documents;
  };

  const attachAudioUrls = async (items, field = "fileID") => {
    const safeItems = Array.isArray(items) ? items : [];
    const fileIDs = Array.from(new Set(safeItems.map((item) => item && item[field]).filter(Boolean)));
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
        console.error("get KET mock audio urls failed", err);
      }
    }
    return safeItems.map((item) => Object.assign({}, item, {
      audioUrl: urlByFileID.get(String(item && item[field] || "")) || "",
    }));
  };

  const getAssignedLesson = async (lessonId, options = {}) => {
    if (!lessonId) throw createError("INVALID_LESSON", "课程信息不完整，请返回后重试");
    const lessonRes = await db.collection("lessons").doc(lessonId).get();
    const lesson = lessonRes.data;
    if (!lesson || lesson.deleting === true) throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
    if (lesson.recordingTaskEnabled !== true || lesson.recordingTaskType !== "ket_mock") {
      throw createError("KET_MOCK_NOT_ASSIGNED", "老师尚未为这节课布置完整 KET 口语模拟");
    }
    const set = ketMock.findSet(lesson.ketMockSetId);
    if (!set) throw createError("KET_MOCK_SET_NOT_FOUND", "这套模拟题已经更新，请联系老师重新选择");
    const identity = options.identity || await getIdentity();
    await ensureStudentAccess(lesson.studentId);
    const studentRes = await db.collection("students").doc(lesson.studentId).get();
    if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    ensureEnglishCourseAccess(identity, studentRes.data);
    return { identity, lesson, set, student: studentRes.data };
  };

  const loadSetAssets = async (setId, withUrls = false) => {
    await createOneCollection("ketMockAssets");
    const assets = await loadAllByField("ketMockAssets", "setId", setId);
    return withUrls ? attachAudioUrls(assets) : assets;
  };

  const listLibrary = async () => {
    await ensureTeacher();
    await createOneCollection("ketMockAssets");
    const allAssets = [];
    for (let skip = 0; ; skip += 100) {
      const result = await db.collection("ketMockAssets").skip(skip).limit(100).get();
      const items = result.data || [];
      allAssets.push(...items);
      if (items.length < 100) break;
    }
    const assetsWithUrls = await attachAudioUrls(allAssets);
    let readyCount = 0;
    let totalCount = 0;
    const sets = ketMock.KET_MOCK_SETS.map((set) => {
      const completeness = ketMock.buildAssetCompleteness(set, assetsWithUrls);
      readyCount += completeness.readyCount;
      totalCount += completeness.totalCount;
      return Object.assign({}, set, {
        audioReadyCount: completeness.readyCount,
        audioTotalCount: completeness.totalCount,
        audioComplete: completeness.complete,
        cues: completeness.cues.map((cue) => Object.assign({}, cue, {
          audioFileID: cue.audioAsset && cue.audioAsset.fileID || "",
          audioUrl: cue.audioAsset && cue.audioAsset.audioUrl || "",
          audioFileName: cue.audioAsset && cue.audioAsset.fileName || "",
          audioUpdatedAtMs: Number(cue.audioAsset && cue.audioAsset.updatedAtMs || 0),
          audioAsset: undefined,
        })),
      });
    });
    return {
      success: true,
      sets,
      summary: { setCount: sets.length, readyCount, totalCount, completeSetCount: sets.filter((set) => set.audioComplete).length },
    };
  };

  const saveCueAudio = async (event) => {
    await ensureTeacher();
    await createOneCollection("ketMockAssets");
    const data = event.data || {};
    const set = ketMock.findSet(data.setId);
    const cue = ketMock.findCue(set, data.cueId);
    const fileID = String(data.fileID || "").trim();
    const cloudPath = String(data.cloudPath || "").trim().slice(0, 500);
    if (!set || !cue || !fileID) throw createError("INVALID_KET_AUDIO", "录音所属套题或文件信息不完整");
    if (cloudPath && !cloudPath.startsWith("ket-mock-assets/")) {
      throw createError("INVALID_KET_AUDIO", "考官录音的云端目录不正确，请重新上传");
    }
    const assetId = ketMock.getAssetDocumentId(set.id, cue.id);
    const nowMs = Date.now();
    const previous = await db.runTransaction(async (transaction) => {
      const ref = transaction.collection("ketMockAssets").doc(assetId);
      const current = await getOptionalTransactionDocument(ref);
      await ref.set({
        data: {
          setId: set.id,
          cueId: cue.id,
          fileID,
          cloudPath,
          fileName: String(data.fileName || "examiner-audio.mp3").trim().slice(0, 180),
          fileSize: Math.max(0, Number(data.fileSize) || 0),
          updatedAt: db.serverDate(),
          updatedAtMs: nowMs,
        },
      });
      return current;
    });
    if (previous && previous.fileID && previous.fileID !== fileID) await deleteUnsafeFiles([previous.fileID]);
    return { success: true, assetId, setId: set.id, cueId: cue.id };
  };

  const deleteCueAudio = async (event) => {
    await ensureTeacher();
    await createOneCollection("ketMockAssets");
    const data = event.data || {};
    const set = ketMock.findSet(data.setId);
    const cue = ketMock.findCue(set, data.cueId);
    if (!set || !cue) throw createError("INVALID_KET_AUDIO", "录音所属套题已经变化，请刷新后重试");
    const assetId = ketMock.getAssetDocumentId(set.id, cue.id);
    const current = await getOptionalTransactionDocument(db.collection("ketMockAssets").doc(assetId));
    if (!current) return { success: true, alreadyDeleted: true };
    await db.collection("ketMockAssets").doc(assetId).remove();
    await deleteUnsafeFiles([current.fileID]);
    return { success: true, assetId };
  };

  const getExam = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "student") throw createError("PERMISSION_DENIED", "请从学生端进入 KET 口语模拟");
    const lessonId = String(event.data && event.data.lessonId || "").trim();
    const context = await getAssignedLesson(lessonId, { identity });
    const assets = await loadSetAssets(context.set.id, true);
    const completeness = ketMock.buildAssetCompleteness(context.set, assets);
    if (!completeness.complete) {
      throw createError("KET_AUDIO_INCOMPLETE", `老师还需准备 ${completeness.missingCueIds.length} 段考官录音，完成后才能开始`);
    }
    await createOneCollection("ketMockSessions");
    const sessions = (await loadAllByField("ketMockSessions", "lessonId", lessonId))
      .filter((session) => session.studentId === context.lesson.studentId)
      .sort((left, right) => Number(right.startedAtMs || 0) - Number(left.startedAtMs || 0));
    const taskVersion = Math.max(1, Number(context.lesson.homeworkTaskVersion) || 1);
    const latestSession = sessions.find((session) => Number(session.homeworkTaskVersion || 1) === taskVersion) || null;
    return {
      success: true,
      lesson: {
        _id: context.lesson._id,
        title: context.lesson.title || "英语课",
        lessonNo: context.lesson.lessonNo || "",
        lessonDate: context.lesson.lessonDate || "",
        homeworkTaskVersion: taskVersion,
      },
      student: { _id: context.student._id, name: context.student.name || "学生" },
      set: ketMock.sanitizeSetForStudent(context.set, assets),
      latestSession: latestSession ? {
        _id: latestSession._id,
        status: latestSession.status,
        startedAtMs: Number(latestSession.startedAtMs || 0),
        submittedAtMs: Number(latestSession.submittedAtMs || 0),
        assessment: latestSession.assessment || null,
      } : null,
    };
  };

  const startSession = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "student") throw createError("PERMISSION_DENIED", "请从学生端开始模拟考试");
    const lessonId = String(event.data && event.data.lessonId || "").trim();
    const context = await getAssignedLesson(lessonId, { identity });
    const assets = await loadSetAssets(context.set.id, false);
    const completeness = ketMock.buildAssetCompleteness(context.set, assets);
    if (!completeness.complete) throw createError("KET_AUDIO_INCOMPLETE", "考官录音尚未准备完整，请稍后再试");
    await createOneCollection("ketMockSessions");
    const taskVersion = Math.max(1, Number(context.lesson.homeworkTaskVersion) || 1);
    const existing = (await loadAllByField("ketMockSessions", "lessonId", lessonId))
      .filter((session) => session.studentId === context.lesson.studentId && Number(session.homeworkTaskVersion || 1) === taskVersion)
      .sort((left, right) => Number(right.startedAtMs || 0) - Number(left.startedAtMs || 0));
    const completed = existing.find((session) => ["submitted", "reviewed"].includes(session.status));
    if (completed) {
      return { success: true, alreadySubmitted: true, sessionId: completed._id, status: completed.status };
    }
    await Promise.all(existing.filter((session) => session.status === "started").map((session) => (
      db.collection("ketMockSessions").doc(session._id).update({
        data: { status: "interrupted", interruptionReason: "restarted", interruptedAt: db.serverDate(), interruptedAtMs: Date.now() },
      })
    )));
    const startedAtMs = Date.now();
    const sessionId = `ket_session_${startedAtMs}_${Math.random().toString(36).slice(2, 12)}`;
    const responseCues = context.set.cues.filter((cue) => cue.responseExpected);
    await db.collection("ketMockSessions").doc(sessionId).set({
      data: {
        studentId: context.lesson.studentId,
        lessonId,
        setId: context.set.id,
        homeworkTaskVersion: taskVersion,
        status: "started",
        expectedResponseCueIds: responseCues.map((cue) => cue.id),
        responses: [],
        studentNameSnapshot: context.student.name || "学生",
        lessonTitleSnapshot: context.lesson.title || "英语课",
        lessonDateSnapshot: context.lesson.lessonDate || "",
        startedAt: db.serverDate(),
        startedAtMs,
      },
    });
    return { success: true, sessionId, status: "started", expectedResponseCount: responseCues.length };
  };

  const abortSession = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "student" || !identity.student) throw createError("PERMISSION_DENIED", "只有学生可以中断自己的模拟考试");
    const data = event.data || {};
    const sessionId = String(data.sessionId || "").trim();
    if (!sessionId) return { success: true, skipped: true };
    await createOneCollection("ketMockSessions");
    const session = await getOptionalTransactionDocument(db.collection("ketMockSessions").doc(sessionId));
    if (!session || session.studentId !== identity.student._id || session.status !== "started") {
      return { success: true, skipped: true };
    }
    await db.collection("ketMockSessions").doc(sessionId).update({
      data: {
        status: "interrupted",
        interruptionReason: String(data.reason || "student_left").slice(0, 80),
        interruptedAt: db.serverDate(),
        interruptedAtMs: Date.now(),
      },
    });
    return { success: true, sessionId, status: "interrupted" };
  };

  const normalizeResponses = (set, responses) => {
    const expectedCues = set.cues.filter((cue) => cue.responseExpected);
    const expectedIds = expectedCues.map((cue) => cue.id);
    const items = Array.isArray(responses) ? responses : [];
    const seen = new Set();
    const normalized = items.map((item) => {
      const cue = ketMock.findCue(set, item && item.cueId);
      const cueId = cue && cue.id || "";
      if (!cue || !cue.responseExpected || seen.has(cueId)) {
        throw createError("INVALID_KET_RESPONSES", "模拟考试录音顺序不完整，请重新开始");
      }
      seen.add(cueId);
      const fileID = String(item.fileID || "").trim();
      const cloudPath = String(item.cloudPath || "").trim().slice(0, 500);
      if (!fileID || !cloudPath.startsWith("ket-mock-submissions/")) {
        throw createError("INVALID_KET_RESPONSES", "有一段回答没有成功上传，请重新开始");
      }
      return {
        cueId,
        part: cue.part,
        order: cue.order,
        fileID,
        cloudPath,
        fileName: String(item.fileName || `${cueId}.mp3`).slice(0, 180),
        duration: Math.max(0, Math.min(180000, Number(item.duration) || 0)),
        fileSize: Math.max(0, Number(item.fileSize) || 0),
      };
    });
    if (normalized.length !== expectedIds.length || expectedIds.some((cueId) => !seen.has(cueId))) {
      throw createError("INVALID_KET_RESPONSES", "模拟考试回答不完整，请重新开始");
    }
    return normalized.sort((left, right) => expectedIds.indexOf(left.cueId) - expectedIds.indexOf(right.cueId));
  };

  const completeSession = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "student" || !identity.student) throw createError("PERMISSION_DENIED", "只有学生可以提交自己的模拟考试");
    const data = event.data || {};
    const sessionId = String(data.sessionId || "").trim();
    if (!sessionId) throw createError("INVALID_KET_SESSION", "模拟考试记录不存在，请重新开始");
    await createOneCollection("ketMockSessions");
    const session = await getOptionalTransactionDocument(db.collection("ketMockSessions").doc(sessionId));
    if (!session || session.studentId !== identity.student._id) throw createError("INVALID_KET_SESSION", "这场模拟考试不属于当前学生");
    if (["submitted", "reviewed"].includes(session.status)) {
      return {
        success: true,
        sessionId,
        status: session.status,
        alreadySubmitted: true,
        submittedLate: session.submittedLate === true,
      };
    }
    if (session.status !== "started") throw createError("INVALID_KET_SESSION", "这场模拟考试已经中断，请重新开始");
    const set = ketMock.findSet(session.setId);
    if (!set) throw createError("KET_MOCK_SET_NOT_FOUND", "套题已经更新，请联系老师重新布置");
    const responses = normalizeResponses(set, data.responses);
    const submittedAtMs = Date.now();
    const result = await db.runTransaction(async (transaction) => {
      const sessionRef = transaction.collection("ketMockSessions").doc(sessionId);
      const lessonRef = transaction.collection("lessons").doc(session.lessonId);
      const [currentSession, lesson] = await Promise.all([
        getOptionalTransactionDocument(sessionRef),
        getOptionalTransactionDocument(lessonRef),
      ]);
      if (!currentSession || currentSession.status !== "started") throw createError("INVALID_KET_SESSION", "考试状态已经变化，请返回课程页查看");
      if (
        !lesson
        || lesson.studentId !== identity.student._id
        || lesson.recordingTaskType !== "ket_mock"
        || lesson.ketMockSetId !== set.id
        || Number(lesson.homeworkTaskVersion || 1) !== Number(session.homeworkTaskVersion || 1)
      ) throw createError("KET_MOCK_NOT_ASSIGNED", "老师已经调整了这项任务，请返回课程页查看");
      const submittedLate = courseWorkflow.isLateHomeworkSubmission(lesson, submittedAtMs);
      await sessionRef.update({
        data: {
          status: "submitted",
          responses,
          part1ResponseCount: responses.filter((item) => item.part === 1).length,
          part2ResponseCount: responses.filter((item) => item.part === 2).length,
          submittedLate,
          submittedAt: db.serverDate(),
          submittedAtMs,
        },
      });
      const firstSubmittedAtMs = Number(lesson.homeworkFirstSubmittedAtMs || 0) || submittedAtMs;
      await lessonRef.update({
        data: {
          homeworkFirstSubmittedAtMs: firstSubmittedAtMs,
          homeworkLastSubmittedAtMs: submittedAtMs,
          homeworkSubmittedLate: courseWorkflow.isLateHomeworkSubmission(lesson, firstSubmittedAtMs),
        },
      });
      return { submittedLate };
    });
    return { success: true, sessionId, status: "submitted", submittedLate: result.submittedLate };
  };

  const summarizeSession = (session) => ({
    _id: session._id,
    lessonId: session.lessonId,
    setId: session.setId,
    status: session.status,
    homeworkTaskVersion: Number(session.homeworkTaskVersion || 1),
    startedAtMs: Number(session.startedAtMs || 0),
    submittedAtMs: Number(session.submittedAtMs || 0),
    reviewedAtMs: Number(session.reviewedAtMs || 0),
    submittedLate: session.submittedLate === true,
    responseCount: Array.isArray(session.responses) ? session.responses.length : 0,
    assessment: session.assessment || null,
  });

  const listSessions = async (event) => {
    const lessonId = String(event.data && event.data.lessonId || "").trim();
    const identity = await getIdentity();
    const context = await getAssignedLesson(lessonId, { identity });
    await createOneCollection("ketMockSessions");
    const taskVersion = Math.max(1, Number(context.lesson.homeworkTaskVersion) || 1);
    const sessions = (await loadAllByField("ketMockSessions", "lessonId", lessonId))
      .filter((session) => session.studentId === context.lesson.studentId && Number(session.homeworkTaskVersion || 1) === taskVersion)
      .sort((left, right) => Number(right.startedAtMs || 0) - Number(left.startedAtMs || 0))
      .map(summarizeSession);
    return { success: true, role: identity.role, sessions, set: { id: context.set.id, title: context.set.title } };
  };

  const getSessionDetail = async (event) => {
    const sessionId = String(event.data && event.data.sessionId || "").trim();
    if (!sessionId) throw createError("INVALID_KET_SESSION", "模拟考试记录不完整，请返回后重试");
    const identity = await getIdentity();
    if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
    await createOneCollection("ketMockSessions");
    const session = await getOptionalTransactionDocument(db.collection("ketMockSessions").doc(sessionId));
    if (!session) throw createError("INVALID_KET_SESSION", "模拟考试记录不存在或已删除");
    if (identity.role !== "teacher" && (!identity.student || identity.student._id !== session.studentId)) {
      throw createError("PERMISSION_DENIED", "你只能查看自己的模拟考试");
    }
    const set = ketMock.findSet(session.setId);
    if (!set) throw createError("KET_MOCK_SET_NOT_FOUND", "套题已经更新，暂时无法打开");
    const [assets, responses] = await Promise.all([
      loadSetAssets(set.id, true),
      attachAudioUrls(session.responses || []),
    ]);
    const setWithAudio = identity.role === "teacher"
      ? Object.assign({}, set, {
        cues: ketMock.buildAssetCompleteness(set, assets).cues.map((cue) => Object.assign({}, cue, {
          audioUrl: cue.audioAsset && cue.audioAsset.audioUrl || "",
          audioAsset: undefined,
        })),
      })
      : ketMock.sanitizeSetForStudent(set, assets);
    return {
      success: true,
      role: identity.role,
      canReview: identity.role === "teacher",
      session: Object.assign({}, summarizeSession(session), {
        studentNameSnapshot: session.studentNameSnapshot || "学生",
        lessonTitleSnapshot: session.lessonTitleSnapshot || "英语课",
        lessonDateSnapshot: session.lessonDateSnapshot || "",
        responses,
      }),
      set: setWithAudio,
      scoreFields: ketMock.SCORE_FIELDS,
      scoreNotice: "教师练习评分，用于后续学习调整，不是 Cambridge 官方考试成绩。",
    };
  };

  const reviewSession = async (event) => {
    const teacherIdentity = await ensureTeacher();
    const data = event.data || {};
    const sessionId = String(data.sessionId || "").trim();
    if (!sessionId) throw createError("INVALID_KET_SESSION", "模拟考试记录不完整，请刷新后重试");
    let assessment;
    try {
      assessment = ketMock.normalizeAssessment(data.assessment || {});
    } catch (err) {
      throw createError("INVALID_KET_ASSESSMENT", err.message);
    }
    await assertContentSafe({ texts: [assessment.strengths, assessment.nextFocus, assessment.comment] });
    const reviewedAtMs = Date.now();
    await db.runTransaction(async (transaction) => {
      const sessionRef = transaction.collection("ketMockSessions").doc(sessionId);
      const session = await getOptionalTransactionDocument(sessionRef);
      if (!session || !["submitted", "reviewed"].includes(session.status)) {
        throw createError("INVALID_KET_SESSION", "学生尚未完成这场模拟考试");
      }
      const lessonRef = transaction.collection("lessons").doc(session.lessonId);
      const lesson = await getOptionalTransactionDocument(lessonRef);
      if (!lesson || lesson.studentId !== session.studentId) throw createError("LESSON_NOT_FOUND", "对应课程不存在或已删除");
      await sessionRef.update({
        data: {
          status: "reviewed",
          assessment,
          reviewedAt: db.serverDate(),
          reviewedAtMs,
          reviewedBy: teacherIdentity.openid || "",
        },
      });
      if (Number(lesson.homeworkTaskVersion || 1) === Number(session.homeworkTaskVersion || 1)) {
        await lessonRef.update({
          data: {
            homeworkCompleted: true,
            homeworkCompletedAt: db.serverDate(),
            homeworkCompletedAtMs: reviewedAtMs,
            homeworkCompletedFrom: "teacher",
            homeworkTeacherReviewStatus: "completed",
            homeworkTeacherReviewedAt: db.serverDate(),
            homeworkTeacherReviewedAtMs: reviewedAtMs,
          },
        });
      }
    });
    return { success: true, sessionId, status: "reviewed", assessment };
  };

  const deleteLessonSessions = async (lessonId, studentId) => {
    await createOneCollection("ketMockSessions");
    const sessions = (await loadAllByField("ketMockSessions", "lessonId", lessonId))
      .filter((session) => !studentId || session.studentId === studentId);
    const fileIDs = sessions.flatMap((session) => (session.responses || []).map((response) => response.fileID)).filter(Boolean);
    for (let index = 0; index < sessions.length; index += 20) {
      await Promise.all(sessions.slice(index, index + 20).map((session) => (
        db.collection("ketMockSessions").doc(session._id).remove()
      )));
    }
    await deleteUnsafeFiles(fileIDs);
    return { deletedSessionCount: sessions.length, deletedFileCount: fileIDs.length };
  };

  const loadSessionsForStudents = async (students) => {
    await createOneCollection("ketMockSessions");
    const results = await Promise.all((students || []).map((student) => loadAllByField("ketMockSessions", "studentId", student._id)));
    return results.flatMap((items) => items || []);
  };

  return {
    abortSession,
    completeSession,
    deleteCueAudio,
    deleteLessonSessions,
    getExam,
    getSessionDetail,
    listLibrary,
    listSessions,
    loadSessionsForStudents,
    reviewSession,
    saveCueAudio,
    startSession,
  };
};

module.exports = { createKetMockService };
