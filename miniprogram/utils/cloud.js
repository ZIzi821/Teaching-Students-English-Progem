const { getFriendlyCloudErrorMessage, isTransactionBusyError } = require("./cloudError");

const NETWORK_FAILURE_PATTERN = /callFunction:fail|request:fail|timeout|network|ERR_/i;

// 统一调用 quickstartFunctions：返回值与 wx.cloud.callFunction 相同（res.result），
// 调用失败时抛出带中文提示的 Error，同时保留原始 errCode / errMsg 供重试判断。
// 数据库事务繁忙的错误原样抛出，页面里的自动重试逻辑依赖原始信息。
const callCloud = (data) => wx.cloud.callFunction({ name: "quickstartFunctions", data })
  .catch((err) => {
    if (isTransactionBusyError(err)) throw err;
    const rawMessage = String(err && (err.errMsg || err.message) || "");
    const message = NETWORK_FAILURE_PATTERN.test(rawMessage)
      ? "网络不稳定，请稍后重试"
      : getFriendlyCloudErrorMessage(err);
    const friendly = new Error(message);
    friendly.code = err && err.code;
    friendly.errCode = err && err.errCode;
    friendly.errMsg = err && err.errMsg;
    friendly.cause = err;
    throw friendly;
  });

module.exports = {
  callCloud,
};
