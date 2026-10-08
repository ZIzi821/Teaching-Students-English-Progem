const crypto = require("crypto");
const mistakeExport = require("./mistakeExport");
const { buildMistakeExportDocx } = require("./mistakeExportDocx");
const { buildMistakeExportMarkdown } = require("./mistakeExportMarkdown");
const { runTransactionWithRetry } = require("./transactionRetry");
const { withoutDocumentId } = require("./databasePayload");

const EXCLUDE_POLICY_LABELS = Object.freeze({
  none: "不排除历史记录",
  exported_mistakes: "排除以前已导出的错题",
  exported_lessons: "排除以前已导出的整节课程",
});
const EXPORT_FORMAT_LABELS = Object.freeze({
  docx: "Word",
  markdown: "Markdown",
});
const normalizeExportFormat = (value) => (value === "markdown" ? "markdown" : "docx");

const createMistakeExportService = ({
  db,
  cloud,
  createError,
  createOneCollection,
  ensureTeacher,
  getOptionalTransactionDocument,
}) => {
  let collectionsReady = false;

  const ensureCollections = async () => {
    if (collectionsReady) return;
    await createOneCollection("mistakeExports");
    collectionsReady = true;
  };

  const loadAll = async (collectionName, where = {}) => {
    const rows = [];
    const pageSize = 100;
    for (let skip = 0; ; skip += pageSize) {
      const result = await db.collection(collectionName)
        .where(where)
        .skip(skip)
        .limit(pageSize)
        .get();
      const page = result.data || [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  };

  const loadStudent = async (studentId) => {
    if (!studentId) throw createError("INVALID_STUDENT", "请选择需要导出错题的学生");
    const result = await db.collection("students").doc(studentId).get();
    if (!result.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    return result.data;
  };

  const formatHongKongDateTime = (timestamp) => {
    const date = new Date((Number(timestamp) || Date.now()) + 8 * 60 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  };

  const buildSelectionLabel = (selectionMode, selectedLessons) => {
    if (!selectedLessons.length) return "暂无课程";
    if (selectionMode === "all") return `全部课程（${selectedLessons.length} 节）`;
    const first = selectedLessons[0];
    const last = selectedLessons[selectedLessons.length - 1];
    return first._id === last._id
      ? first.exportLabel
      : `${first.exportLabel} 至 ${last.exportLabel}`;
  };

  const sanitizeHistory = (row = {}) => {
    const staleGenerating = row.status === "generating"
      && Date.now() - Number(row.updatedAtMs || row.createdAtMs || 0) >= 3 * 60 * 1000;
    const status = staleGenerating ? "failed" : row.status || "failed";
    const exportFormat = normalizeExportFormat(row.exportFormat);
    return {
      _id: row._id || "",
      status,
      statusLabel: status === "ready" ? "已生成" : status === "generating" ? "生成中" : "生成失败",
      exportFormat,
      exportFormatLabel: EXPORT_FORMAT_LABELS[exportFormat],
      createdAtMs: Number(row.createdAtMs) || 0,
      createdLabel: formatHongKongDateTime(row.createdAtMs),
      selectionMode: row.selectionMode || "all",
      selectionLabel: row.selectionLabel || "课程范围",
      excludePolicy: row.excludePolicy || "none",
      excludePolicyLabel: EXCLUDE_POLICY_LABELS[row.excludePolicy] || EXCLUDE_POLICY_LABELS.none,
      mistakeCount: Math.max(0, Number(row.mistakeCount) || 0),
      lessonCount: Array.isArray(row.includedLessonIds) ? row.includedLessonIds.length : 0,
      excludedLessonCount: Math.max(0, Number(row.excludedLessonCount) || 0),
      excludedMistakeCount: Math.max(0, Number(row.excludedMistakeCount) || 0),
      fileID: status === "ready" ? String(row.fileID || "") : "",
      fileName: status === "ready" ? String(row.fileName || "") : "",
      failureMessage: status === "failed"
        ? String(row.failureMessage || (staleGenerating ? "上次生成意外中断，请重新导出" : "生成失败，请重新导出"))
        : "",
    };
  };

  const loadWorkspaceData = async (studentId, exportFormat = "docx") => {
    const [student, lessons, mistakes, history] = await Promise.all([
      loadStudent(studentId),
      loadAll("lessons", { studentId }),
      loadAll("mistakes", { studentId }),
      loadAll("mistakeExports", { studentId }),
    ]);
    const sortedLessons = mistakeExport.sortLessons(lessons);
    const normalizedFormat = normalizeExportFormat(exportFormat);
    const readyHistory = history.filter((item) => (
      item.status === "ready" && normalizeExportFormat(item.exportFormat) === normalizedFormat
    ));
    const exportedSets = mistakeExport.getExportedIdSets(readyHistory);
    const mistakeCountByLesson = new Map();
    const exportedMistakeCountByLesson = new Map();
    mistakes.forEach((item) => {
      const lessonId = String(item.lessonId || "");
      mistakeCountByLesson.set(lessonId, (mistakeCountByLesson.get(lessonId) || 0) + 1);
      if (exportedSets.mistakeIds.has(String(item._id))) {
        exportedMistakeCountByLesson.set(lessonId, (exportedMistakeCountByLesson.get(lessonId) || 0) + 1);
      }
    });
    const lessonOptions = sortedLessons.map((lesson) => {
      const lessonId = String(lesson._id);
      const mistakeCount = mistakeCountByLesson.get(lessonId) || 0;
      const exportedMistakeCount = exportedMistakeCountByLesson.get(lessonId) || 0;
      return {
        _id: lessonId,
        title: String(lesson.title || "英语课"),
        lessonDate: String(lesson.lessonDate || ""),
        lessonNo: String(lesson.lessonNo || ""),
        durationMinutes: Math.max(0, Number(lesson.durationMinutes) || 0),
        institutionCourse: lesson.institutionCourse === true,
        label: mistakeExport.formatLessonLabel(lesson),
        mistakeCount,
        exportedMistakeCount,
        wasLessonExported: exportedSets.lessonIds.has(lessonId),
        allCurrentMistakesExported: Boolean(mistakeCount && exportedMistakeCount >= mistakeCount),
      };
    });
    return { student, lessons: sortedLessons, mistakes, history, readyHistory, lessonOptions, exportFormat: normalizedFormat };
  };

  const getMistakeExportWorkspace = async (event) => {
    await ensureTeacher();
    await ensureCollections();
    const studentId = String(event.data && event.data.studentId || "").trim();
    const exportFormat = normalizeExportFormat(event.data && event.data.exportFormat);
    const workspace = await loadWorkspaceData(studentId, exportFormat);
    const history = workspace.history
      .slice()
      .sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0))
      .slice(0, 30)
      .map(sanitizeHistory);
    const exportedMistakeIds = mistakeExport.getExportedIdSets(workspace.readyHistory).mistakeIds;
    return {
      success: true,
      student: {
        _id: workspace.student._id,
        name: workspace.student.name || "",
        grade: workspace.student.grade || "",
      },
      lessonOptions: workspace.lessonOptions,
      totalMistakeCount: workspace.mistakes.length,
      exportedMistakeCount: workspace.mistakes.filter((item) => exportedMistakeIds.has(String(item._id))).length,
      historyCount: workspace.history.length,
      history,
      exportFormat,
      exportFormatLabel: EXPORT_FORMAT_LABELS[exportFormat],
    };
  };

  const downloadMistakeImages = async (mistakes) => {
    const result = new Map();
    const fileCache = new Map();
    const withImages = mistakes.filter((item) => String(item.questionImageFileId || "").trim());
    for (let offset = 0; offset < withImages.length; offset += 6) {
      const batch = withImages.slice(offset, offset + 6);
      await Promise.all(batch.map(async (item) => {
        const fileID = String(item.questionImageFileId || "").trim();
        let fileContent = fileCache.get(fileID);
        if (!fileContent) {
          try {
            const download = await cloud.downloadFile({ fileID });
            fileContent = download && download.fileContent;
          } catch (err) {
            console.error("mistake export image download failed", item._id, err);
            throw createError("EXPORT_IMAGE_DOWNLOAD_FAILED", `错题 ${item.questionNo || "图片"} 的原图读取失败，请检查图片后重试`);
          }
          if (!fileContent) {
            throw createError("EXPORT_IMAGE_DOWNLOAD_FAILED", `错题 ${item.questionNo || "图片"} 的原图为空，请检查图片后重试`);
          }
          if (!Buffer.isBuffer(fileContent)) fileContent = Buffer.from(fileContent);
          fileCache.set(fileID, fileContent);
        }
        result.set(String(item._id), fileContent);
      }));
    }
    return result;
  };

  const buildFingerprint = (studentId, plan, exportFormat) => crypto.createHash("sha1").update(JSON.stringify({
    studentId,
    exportFormat,
    selectionMode: plan.selectionMode,
    startLessonId: plan.startLessonId,
    endLessonId: plan.endLessonId,
    excludePolicy: plan.excludePolicy,
    lessonIds: plan.includedLessonIds,
    mistakeIds: plan.mistakeIds,
  })).digest("hex");

  const updateFailedExport = async (exportId, fingerprint, err) => {
    try {
      await runTransactionWithRetry(() => db.runTransaction(async (transaction) => {
        const ref = transaction.collection("mistakeExports").doc(exportId);
        const current = await getOptionalTransactionDocument(ref);
        if (!current || current.requestFingerprint !== fingerprint || current.status === "ready") return;
        await ref.update({
          data: {
            status: "failed",
            failureMessage: String(err && err.message || "生成失败，请重新导出").slice(0, 300),
            failedAt: db.serverDate(),
            failedAtMs: Date.now(),
            updatedAt: db.serverDate(),
            updatedAtMs: Date.now(),
          },
        });
      }));
    } catch (updateErr) {
      console.error("failed to persist mistake export error", updateErr);
    }
  };

  const createMistakeExport = async (event) => {
    let uploadedFileID = "";
    await ensureTeacher();
    await ensureCollections();
    const data = event.data || {};
    const studentId = String(data.studentId || "").trim();
    const exportFormat = normalizeExportFormat(data.exportFormat);
    const requestId = String(data.requestId || "").trim().slice(0, 100);
    if (!requestId) throw createError("INVALID_REQUEST", "导出请求已失效，请重新点击导出");
    const workspace = await loadWorkspaceData(studentId, exportFormat);
    let plan;
    try {
      plan = mistakeExport.buildExportPlan({
        lessons: workspace.lessons,
        mistakes: workspace.mistakes,
        history: workspace.readyHistory,
        selection: {
          mode: data.selectionMode,
          startLessonId: data.startLessonId,
          endLessonId: data.endLessonId,
        },
        excludePolicy: data.excludePolicy,
      });
    } catch (err) {
      throw createError(err.code || "INVALID_EXPORT_RANGE", err.message || "课程范围无效，请刷新后重试");
    }
    if (!plan.mistakes.length) {
      const detail = plan.excludePolicy === "none"
        ? "所选课程范围内没有错题"
        : "所选范围内没有新的可导出错题；可以调整排除方式后重试";
      throw createError("EMPTY_MISTAKE_EXPORT", detail);
    }
    const allLessonMap = new Map(workspace.lessons.map((item) => [String(item._id), item]));
    const selectedLessons = plan.selectedLessonIds.map((id) => allLessonMap.get(id)).filter(Boolean);
    const exportLessons = plan.lessons.map((lesson) => ({
      ...lesson,
      exportLabel: mistakeExport.formatLessonLabel(lesson),
    }));
    const selectionLabel = buildSelectionLabel(plan.selectionMode, selectedLessons.map((lesson) => ({
      ...lesson,
      exportLabel: mistakeExport.formatLessonLabel(lesson),
    })));
    const fingerprint = buildFingerprint(studentId, plan, exportFormat);
    const exportId = `mistake_export_${crypto.createHash("sha1").update(`${studentId}\n${requestId}`).digest("hex")}`;
    const nowMs = Date.now();
    const baseRecord = {
      recordType: "mistakeExport",
      studentId,
      studentNameSnapshot: workspace.student.name || "",
      status: "generating",
      exportFormat,
      selectionMode: plan.selectionMode,
      startLessonId: plan.startLessonId,
      endLessonId: plan.endLessonId,
      selectionLabel,
      excludePolicy: plan.excludePolicy,
      selectedLessonIds: plan.selectedLessonIds,
      includedLessonIds: plan.includedLessonIds,
      mistakeIds: plan.mistakeIds,
      mistakeCount: plan.mistakeIds.length,
      excludedLessonCount: plan.excludedLessonCount,
      excludedMistakeCount: plan.excludedMistakeCount,
      lessonSnapshots: exportLessons.map((item) => ({
        lessonId: item._id,
        lessonDate: item.lessonDate || "",
        lessonNo: item.lessonNo || "",
        title: item.title || "英语课",
        label: item.exportLabel,
      })),
      requestId,
      requestFingerprint: fingerprint,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    const claim = await runTransactionWithRetry(() => db.runTransaction(async (transaction) => {
      const ref = transaction.collection("mistakeExports").doc(exportId);
      const existing = await getOptionalTransactionDocument(ref);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          throw createError("EXPORT_REQUEST_CONFLICT", "导出条件已经变化，请重新点击导出");
        }
        if (existing.status === "ready") return { ready: true, record: existing };
        if (existing.status === "generating" && nowMs - Number(existing.updatedAtMs || existing.createdAtMs || 0) < 2 * 60 * 1000) {
          return { inProgress: true, record: existing };
        }
      }
      await ref.set({
        data: {
          ...baseRecord,
          version: Math.max(0, Number(existing && existing.version) || 0) + 1,
          createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
          createdAtMs: existing && Number(existing.createdAtMs) ? Number(existing.createdAtMs) : nowMs,
          updatedAt: db.serverDate(),
        },
      });
      return { claimed: true };
    }));
    if (claim.ready) return { success: true, reused: true, export: sanitizeHistory({ _id: exportId, ...claim.record }) };
    if (claim.inProgress) throw createError("EXPORT_IN_PROGRESS", "这份错题汇总正在生成，请稍后刷新导出记录");

    try {
      const createdLabel = formatHongKongDateTime(nowMs);
      const fileContent = exportFormat === "markdown"
        ? Buffer.from(buildMistakeExportMarkdown({
          student: workspace.student,
          lessons: exportLessons,
          mistakes: plan.mistakes,
          exportLabel: selectionLabel,
          createdLabel,
        }), "utf8")
        : await buildMistakeExportDocx({
          student: workspace.student,
          lessons: exportLessons,
          mistakes: plan.mistakes,
          imageBuffers: await downloadMistakeImages(plan.mistakes),
          exportLabel: selectionLabel,
          createdLabel,
        });
      const dateToken = createdLabel.slice(0, 10).replace(/-/g, "");
      const safeStudentId = studentId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "student";
      const extension = exportFormat === "markdown" ? "md" : "docx";
      const fileName = `${String(workspace.student.name || "学生").replace(/[\\/:*?"<>|]/g, "-")}-英语错题汇总-${dateToken}.${extension}`;
      const upload = await cloud.uploadFile({
        cloudPath: `mistake-exports/${safeStudentId}/${exportId}/mistakes.${extension}`,
        fileContent,
      });
      if (!upload || !upload.fileID) throw createError("EXPORT_UPLOAD_FAILED", "错题文件生成后上传失败，请重试");
      uploadedFileID = upload.fileID;
      const readyRecord = await runTransactionWithRetry(() => db.runTransaction(async (transaction) => {
        const ref = transaction.collection("mistakeExports").doc(exportId);
        const current = await getOptionalTransactionDocument(ref);
        if (!current || current.requestFingerprint !== fingerprint) {
          throw createError("EXPORT_REQUEST_CONFLICT", "导出记录已变化，请刷新后查看");
        }
        const ready = {
          ...withoutDocumentId(current),
          status: "ready",
          fileID: upload.fileID,
          fileName,
          fileSize: Buffer.byteLength(fileContent),
          failureMessage: "",
          readyAt: db.serverDate(),
          readyAtMs: Date.now(),
          updatedAt: db.serverDate(),
          updatedAtMs: Date.now(),
        };
        await ref.set({ data: ready });
        return ready;
      }));
      return { success: true, reused: false, export: sanitizeHistory({ _id: exportId, ...readyRecord }) };
    } catch (err) {
      if (uploadedFileID) {
        try {
          await cloud.deleteFile({ fileList: [uploadedFileID] });
        } catch (cleanupErr) {
          console.error("failed to clean orphaned mistake export file", cleanupErr);
        }
      }
      await updateFailedExport(exportId, fingerprint, err);
      throw err;
    }
  };

  return {
    createMistakeExport,
    getMistakeExportWorkspace,
  };
};

module.exports = {
  EXCLUDE_POLICY_LABELS,
  EXPORT_FORMAT_LABELS,
  createMistakeExportService,
  normalizeExportFormat,
};
