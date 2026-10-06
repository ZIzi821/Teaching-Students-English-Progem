const crypto = require("crypto");

const normalizeUploadBatchId = (value) => String(value || "").trim().slice(0, 80);

const getMaterialSafetyImageFileID = (data) => {
  const originalFileID = String((data && data.fileID) || "").trim();
  const previewFileID = String((data && data.previewFileID) || "").trim();
  if (!originalFileID || !previewFileID || originalFileID === previewFileID) return originalFileID;
  const originalMatch = originalFileID.match(/^(.*)-original\.[a-z0-9]+$/i);
  if (!originalMatch) return originalFileID;
  return previewFileID === `${originalMatch[1]}-preview.jpg` ? previewFileID : originalFileID;
};

const buildLessonPaperId = (data) => {
  const safeData = data || {};
  const uploadBatchId = normalizeUploadBatchId(safeData.uploadBatchId);
  if (!uploadBatchId) return `paper_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  const batchIndex = Math.max(0, Number(safeData.batchIndex) || 0);
  const key = [safeData.studentId, safeData.lessonId, uploadBatchId, batchIndex].join("\n");
  return `paper_${crypto.createHash("sha1").update(key).digest("hex")}`;
};

const isSameLessonPaperUpload = (paper, data) => !!(
  paper
  && data
  && paper.studentId === data.studentId
  && paper.lessonId === data.lessonId
  && paper.fileID === data.fileID
);

module.exports = {
  buildLessonPaperId,
  getMaterialSafetyImageFileID,
  isSameLessonPaperUpload,
};
