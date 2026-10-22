const parseOptions = (options) => {
  const source = options || {};
  const mode = source.mode === "teacherPreview" ? "teacherPreview" : "";
  const previewStudentId = mode ? String(source.previewStudentId || "").trim() : "";
  return {
    mode,
    previewStudentId,
    isTeacherPreview: Boolean(mode && previewStudentId),
  };
};

const getState = (context) => (context && context.data ? context.data : context || {});

const withData = (context, data) => {
  const state = getState(context);
  const result = Object.assign({}, data || {});
  if (state.isTeacherPreview && state.previewStudentId) {
    result.mode = "teacherPreview";
    result.previewStudentId = state.previewStudentId;
  }
  return result;
};

const appendToUrl = (context, rawUrl) => {
  const state = getState(context);
  const url = String(rawUrl || "");
  if (!url || !state.isTeacherPreview || !state.previewStudentId) return url;
  const separator = url.indexOf("?") >= 0 ? "&" : "?";
  return `${url}${separator}mode=teacherPreview&previewStudentId=${encodeURIComponent(state.previewStudentId)}`;
};

const blockWrite = (context) => {
  const state = getState(context);
  if (!state.isTeacherPreview) return false;
  wx.showToast({ title: "老师预览 · 学生记录保持原状态", icon: "none" });
  return true;
};

module.exports = {
  appendToUrl,
  blockWrite,
  parseOptions,
  withData,
};
