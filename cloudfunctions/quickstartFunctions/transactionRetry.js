const DEFAULT_RETRY_DELAYS_MS = [200, 500, 1000];

const getTransactionErrorText = (err) => [
  err && err.code,
  err && err.errCode,
  err && err.errcode,
  err && err.message,
  err && err.errMsg,
].filter((value) => value !== undefined && value !== null && value !== "").join(" ");

const isTransactionBusyError = (err) => {
  if (!err) return false;
  const rawErrorCode = err.errCode !== undefined
    ? err.errCode
    : err.errcode !== undefined
      ? err.errcode
      : err.code;
  const errorCode = Number(rawErrorCode);
  if (errorCode === -501001) return true;
  return /\btransaction\s+(?:is\s+)?busy\b/i.test(getTransactionErrorText(err));
};

const getRetryDelays = (value) => {
  if (!Array.isArray(value) || !value.length) return DEFAULT_RETRY_DELAYS_MS;
  return value.map((delay) => Math.max(0, Number(delay) || 0));
};

const waitForRetry = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

const runTransactionWithRetry = async (operation, options = {}) => {
  if (typeof operation !== "function") throw new TypeError("operation 必须是函数");
  const retryDelays = getRetryDelays(options.retryDelaysMs);
  let lastError;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isTransactionBusyError(err) || attempt >= retryDelays.length) throw err;
      const waitMs = retryDelays[attempt];
      if (typeof options.onRetry === "function") {
        options.onRetry({
          attempt: attempt + 1,
          maxAttempts: retryDelays.length + 1,
          waitMs,
          error: err,
        });
      }
      await waitForRetry(waitMs);
    }
  }
  throw lastError;
};

module.exports = {
  isTransactionBusyError,
  runTransactionWithRetry,
};
