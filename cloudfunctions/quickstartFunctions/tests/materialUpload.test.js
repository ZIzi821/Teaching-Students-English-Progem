const assert = require("assert");
const {
  buildLessonPaperId,
  getMaterialSafetyImageFileID,
  isSameLessonPaperUpload,
} = require("../materialUpload");

const original = "cloud://env.bucket/lesson-materials/student/lesson/batch_1-01-original.jpg";
const preview = "cloud://env.bucket/lesson-materials/student/lesson/batch_1-01-preview.jpg";

assert.strictEqual(
  getMaterialSafetyImageFileID({ fileID: original, previewFileID: preview }),
  preview,
  "A matching compressed preview should be checked instead of the full original"
);
assert.strictEqual(
  getMaterialSafetyImageFileID({ fileID: original, previewFileID: "cloud://env.bucket/other-preview.jpg" }),
  original,
  "An unrelated preview must never replace the original in the safety check"
);
assert.strictEqual(
  getMaterialSafetyImageFileID({ fileID: original, previewFileID: original }),
  original,
  "The original should remain the fallback when no separate preview exists"
);

const request = {
  studentId: "student_1",
  lessonId: "lesson_1",
  uploadBatchId: "batch_100",
  batchIndex: 0,
  fileID: original,
};
assert.strictEqual(
  buildLessonPaperId(request),
  buildLessonPaperId(Object.assign({}, request)),
  "Retrying the same upload request should reuse one paper id"
);
assert.notStrictEqual(
  buildLessonPaperId(request),
  buildLessonPaperId(Object.assign({}, request, { batchIndex: 1 })),
  "Different files in one batch need different paper ids"
);
assert.strictEqual(
  isSameLessonPaperUpload(request, request),
  true,
  "An exact retry should be recognized"
);
assert.strictEqual(
  isSameLessonPaperUpload(request, Object.assign({}, request, { fileID: preview })),
  false,
  "A reused request id must not overwrite a different file"
);

console.log("material upload tests passed");
