const getCloudErrorText = (err) => [
  err && err.code,
  err && err.errCode,
  err && err.errcode,
  err && err.message,
  err && err.errMsg,
].filter((value) => value !== undefined && value !== null && value !== "").join(" ");

const isTransactionBusyError = (err) => {
  const text = getCloudErrorText(err);
  return /(^|\s)-501001(?:\s|$)/.test(text)
    || /\btransaction\s+(?:is\s+)?busy\b/i.test(text)
    || /\bTRANSACTION_BUSY\b/.test(text);
};

const getFriendlyCloudErrorMessage = (err, fallback) => {
  if (isTransactionBusyError(err)) {
    return "云数据库暂时繁忙，已自动重试，请再点一次";
  }
  const message = String(err && (err.message || err.errMsg) || "").trim();
  if (!message || /(?:document|collection|transaction)\.(?:get|set|update|add|remove):fail/i.test(message)) {
    return fallback || "服务暂时不可用，请稍后再试";
  }
  return message;
};

module.exports = {
  getFriendlyCloudErrorMessage,
  isTransactionBusyError,
};
