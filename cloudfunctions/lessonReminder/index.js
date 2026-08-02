const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const REMINDER_TEMPLATE_ID = "Ih535VWa2FCNlCCvZUYFJOt8fOA3EY3l7Pxoa9rszYA";
const REMINDER_PAGE = "pages/lesson-bookings/index";
const REMINDER_WINDOW_MS = 10 * 60 * 1000;
const QUERY_LIMIT = 100;
const MAX_QUERY_PAGES = 10;
const MAX_DUE_PER_RUN = 10;
const SENDING_LEASE_MS = 2 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 1000;
const MAX_SEND_ATTEMPTS = 3;
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;
const REQUIRED_FIELDS = ["日程标题", "课程名称", "开始时间", "提醒内容", "教师"];
const PERMANENT_SEND_ERROR_CODES = new Set([40003, 40037, 41030, 43101, 47003]);
let reminderFieldKeysCache = null;

const pad2 = (value) => String(value).padStart(2, "0");

const formatHongKongDateTime = (timestamp) => {
  const date = new Date(timestamp + HONG_KONG_OFFSET_MS);
  return [
    date.getUTCFullYear(),
    "-",
    pad2(date.getUTCMonth() + 1),
    "-",
    pad2(date.getUTCDate()),
    " ",
    pad2(date.getUTCHours()),
    ":",
    pad2(date.getUTCMinutes()),
  ].join("");
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getTemplateItems = (response) => {
  if (Array.isArray(response)) return response;
  if (!response) return [];
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.templateList)) return response.templateList;
  if (Array.isArray(response.template_list)) return response.template_list;
  if (Array.isArray(response.list)) return response.list;
  return [];
};

const getTemplateId = (item) => {
  return String(
    (item &&
      (item.priTmplId || item.pri_tmpl_id || item.templateId || item.template_id || item.tmplId)) ||
      ""
  );
};

const getTemplateContent = (item) => {
  return String(
    (item &&
      (item.content || item.templateContent || item.template_content || item.templateData || item.template_data)) ||
      ""
  );
};

const parseFieldKeys = (template) => {
  const content = getTemplateContent(template);
  if (!content) throw new Error("日程提醒模板没有返回模板内容");

  const fieldKeys = {};
  REQUIRED_FIELDS.forEach((label) => {
    const pattern = new RegExp(
      `${escapeRegExp(label)}\\s*[：:]?\\s*\\{\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\.DATA\\s*\\}\\}`,
      "i"
    );
    const match = content.match(pattern);
    if (!match) throw new Error(`日程提醒模板缺少字段：${label}`);
    fieldKeys[label] = match[1];
  });
  return fieldKeys;
};

const loadReminderFieldKeys = async () => {
  if (reminderFieldKeysCache) return reminderFieldKeysCache;
  const response = await cloud.openapi.subscribeMessage.getTemplateList({});
  const template = getTemplateItems(response).find((item) => getTemplateId(item) === REMINDER_TEMPLATE_ID);
  if (!template) throw new Error("未在小程序模板列表中找到日程提醒模板");
  reminderFieldKeysCache = parseFieldKeys(template);
  return reminderFieldKeysCache;
};

const toErrorMessage = (error) => {
  const code = error && (error.errCode || error.errcode || error.code);
  const message = error && (error.errMsg || error.errmsg || error.message);
  return [code, message].filter((item) => item !== undefined && item !== null && item !== "").join(": ").slice(0, 300) || "发送订阅消息失败";
};

const getErrorCode = (error) => {
  const value = error && (error.errCode || error.errcode || error.code);
  const code = Number(value);
  return Number.isFinite(code) ? code : 0;
};

const createClaimId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const toTimestamp = (value) => {
  if (Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value.getTime === "function") return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const loadBookingsByReminderStatus = async (status) => {
  const bookings = [];
  for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
    const result = await db
      .collection("lessonBookings")
      .where({ reminder10mNotifyStatus: status })
      .skip(page * QUERY_LIMIT)
      .limit(QUERY_LIMIT)
      .get();
    const items = result.data || [];
    bookings.push(...items);
    if (items.length < QUERY_LIMIT) break;
  }
  return bookings;
};

const loadBookingsByConfirmationStatus = async (status) => {
  const bookings = [];
  for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
    const result = await db
      .collection("lessonBookings")
      .where({ confirmationNotifyStatus: status })
      .skip(page * QUERY_LIMIT)
      .limit(QUERY_LIMIT)
      .get();
    const items = result.data || [];
    bookings.push(...items);
    if (items.length < QUERY_LIMIT) break;
  }
  return bookings;
};

const recoverStaleConfirmationNotifications = async (now) => {
  const bookings = await loadBookingsByConfirmationStatus("sending");
  const staleBefore = now - SENDING_LEASE_MS;
  let recoveredCount = 0;
  for (let i = 0; i < bookings.length; i += 1) {
    const item = bookings[i];
    const attemptedAtMs = Number(item.confirmationNotifyAttemptedAtMs)
      || toTimestamp(item.confirmationNotifyAttemptedAt);
    if (attemptedAtMs > staleBefore) continue;
    const recovered = await db.runTransaction(async (transaction) => {
      const result = await transaction.collection("lessonBookings").doc(item._id).get();
      const booking = result.data;
      if (!booking || booking.confirmationNotifyStatus !== "sending") return false;
      const currentAttemptedAtMs = Number(booking.confirmationNotifyAttemptedAtMs)
        || toTimestamp(booking.confirmationNotifyAttemptedAt);
      if (currentAttemptedAtMs > staleBefore) return false;
      await transaction.collection("lessonBookings").doc(item._id).update({
        data: {
          confirmationNotifyStatus: "failed",
          confirmationNotifyError: "提醒发送结果未确认，请由家长重新开启",
          updatedAt: db.serverDate(),
        },
      });
      return true;
    });
    if (recovered) recoveredCount += 1;
  }
  return recoveredCount;
};

const recoverStaleSendingBookings = async (now) => {
  const sendingBookings = await loadBookingsByReminderStatus("sending");
  const staleBefore = now - SENDING_LEASE_MS;
  let recoveredCount = 0;
  for (let i = 0; i < sendingBookings.length; i += 1) {
    const item = sendingBookings[i];
    const attemptedAtMs = Number(item.reminder10mNotifyAttemptedAtMs) || toTimestamp(item.reminder10mNotifyAttemptedAt);
    if (attemptedAtMs > staleBefore) continue;
    const recovered = await db.runTransaction(async (transaction) => {
      const result = await transaction.collection("lessonBookings").doc(item._id).get();
      const booking = result.data;
      if (!booking || booking.reminder10mNotifyStatus !== "sending") return false;
      const currentAttemptedAtMs = Number(booking.reminder10mNotifyAttemptedAtMs)
        || toTimestamp(booking.reminder10mNotifyAttemptedAt);
      if (currentAttemptedAtMs > staleBefore) return false;
      const attemptCount = Number(booking.reminder10mNotifyAttemptCount || 0);
      const exhausted = attemptCount >= MAX_SEND_ATTEMPTS;
      const deliveryUnknown = Number(booking.reminder10mNotifyDispatchStartedAtMs || 0) > 0;
      await transaction.collection("lessonBookings").doc(item._id).update({
        data: {
          reminder10mNotifyStatus: deliveryUnknown
            ? "delivery_unknown"
            : exhausted ? "failed" : "pending",
          reminder10mNotifyClaimId: "",
          reminder10mNotifyError: deliveryUnknown
            ? "微信接口已调用，但最终投递状态无法确认"
            : exhausted ? "提醒发送重试次数已用完" : booking.reminder10mNotifyError || "",
          reminder10mNotifyRecoveredAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
      return true;
    });
    if (recovered) recoveredCount += 1;
  }
  return recoveredCount;
};

const claimBooking = async (bookingId, expectedStartAtMs) => {
  return db.runTransaction(async (transaction) => {
    const bookingResult = await transaction.collection("lessonBookings").doc(bookingId).get();
    const booking = bookingResult.data;
    if (!booking || booking.status !== "已确认" || booking.reminder10mNotifyStatus !== "pending") {
      return null;
    }
    const currentStartAtMs = Number(booking.confirmedStartAtMs);
    const startMatches = expectedStartAtMs === null
      ? !Number.isFinite(currentStartAtMs)
      : currentStartAtMs === expectedStartAtMs;
    if (!startMatches) {
      return null;
    }
    if (expectedStartAtMs !== null && currentStartAtMs <= Date.now()) {
      return null;
    }
    const claimId = createClaimId();
    const attemptCount = Number(booking.reminder10mNotifyAttemptCount || 0) + 1;
    await transaction.collection("lessonBookings").doc(bookingId).update({
      data: {
        reminder10mNotifyStatus: "sending",
        reminder10mNotifyClaimId: claimId,
        reminder10mNotifyAttemptedAt: db.serverDate(),
        reminder10mNotifyAttemptedAtMs: Date.now(),
        reminder10mNotifyAttemptCount: attemptCount,
        updatedAt: db.serverDate(),
      },
    });
    return Object.assign({}, booking, {
      _id: bookingId,
      reminder10mNotifyClaimId: claimId,
      reminder10mNotifyAttemptCount: attemptCount,
    });
  });
};

const markExpired = async (bookingId, expectedStartAtMs) => {
  return db.runTransaction(async (transaction) => {
    const bookingResult = await transaction.collection("lessonBookings").doc(bookingId).get();
    const booking = bookingResult.data;
    if (!booking || booking.status !== "已确认" || booking.reminder10mNotifyStatus !== "pending") {
      return false;
    }
    if (Number(booking.confirmedStartAtMs) !== expectedStartAtMs) return false;
    await transaction.collection("lessonBookings").doc(bookingId).update({
      data: {
        reminder10mNotifyStatus: "expired",
        reminder10mNotifyExpiredAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
    return true;
  });
};

const updateClaimedBooking = async (booking, data) => {
  return db.runTransaction(async (transaction) => {
    const bookingResult = await transaction.collection("lessonBookings").doc(booking._id).get();
    const current = bookingResult.data;
    if (
      !current
      || current.status !== "已确认"
      || current.reminder10mNotifyStatus !== "sending"
      || current.reminder10mNotifyClaimId !== booking.reminder10mNotifyClaimId
      || Number(current.confirmedStartAtMs) !== Number(booking.confirmedStartAtMs)
    ) return false;
    await transaction.collection("lessonBookings").doc(booking._id).update({ data });
    return true;
  });
};

const markFailedAfterClaim = async (booking, error) => {
  const now = Date.now();
  const startAtMs = Number(booking.confirmedStartAtMs);
  const permanent = PERMANENT_SEND_ERROR_CODES.has(getErrorCode(error));
  const canRetry = !permanent
    && Number(booking.reminder10mNotifyAttemptCount || 0) < MAX_SEND_ATTEMPTS
    && startAtMs > now + 5000;
  const nextRetryAtMs = canRetry ? Math.min(now + RETRY_DELAY_MS, startAtMs - 5000) : 0;
  return updateClaimedBooking(booking, {
    reminder10mNotifyStatus: canRetry ? "pending" : "failed",
    reminder10mNotifyClaimId: "",
    reminder10mNotifyDispatchStartedAtMs: 0,
    reminder10mNotifyNextAttemptAtMs: nextRetryAtMs,
    reminder10mNotifyFailedAt: canRetry ? null : db.serverDate(),
    reminder10mNotifyError: toErrorMessage(error),
    updatedAt: db.serverDate(),
  });
};

const markSentAfterClaim = async (booking) => {
  return updateClaimedBooking(booking, {
    reminder10mNotifyStatus: "sent",
    reminder10mNotifyClaimId: "",
    reminder10mNotifyDispatchStartedAtMs: 0,
    reminder10mNotifyNextAttemptAtMs: 0,
    reminder10mNotifySentAt: db.serverDate(),
    reminder10mNotifyError: "",
    updatedAt: db.serverDate(),
  });
};

const markDispatchStarted = async (booking) => {
  return updateClaimedBooking(booking, {
    reminder10mNotifyDispatchStartedAtMs: Date.now(),
    updatedAt: db.serverDate(),
  });
};

const markSentWithRetry = async (booking) => {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await markSentAfterClaim(booking);
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }
  throw lastError;
};

const buildMessageData = (booking, fieldKeys, startAtMs) => {
  const studentName = String(booking.studentNameSnapshot || "").trim();
  const courseName = studentName ? `${studentName}英语课` : "英语课";
  const remainingMinutes = Math.max(1, Math.ceil((startAtMs - Date.now()) / 60000));
  const values = {
    日程标题: "英语课即将开始",
    课程名称: courseName.slice(0, 20),
    开始时间: formatHongKongDateTime(startAtMs),
    提醒内容: remainingMinutes <= 1
      ? "课程即将开始，请查看会议信息"
      : `约${remainingMinutes}分钟后开始，请查看会议信息`,
    教师: String(booking.teacherName || "朱老师").slice(0, 10),
  };
  return REQUIRED_FIELDS.reduce((result, label) => {
    result[fieldKeys[label]] = { value: values[label] };
    return result;
  }, {});
};

const sendReminder = async (booking, fieldKeys, startAtMs) => {
  return cloud.openapi.subscribeMessage.send({
    touser: String(booking.reminderNotifyOpenId || booking.notifyOpenId || ""),
    templateId: REMINDER_TEMPLATE_ID,
    page: `${REMINDER_PAGE}?bookingId=${encodeURIComponent(booking._id)}`,
    lang: "zh_CN",
    data: buildMessageData(booking, fieldKeys, startAtMs),
  });
};

exports.main = async () => {
  const now = Date.now();
  // Pending reminders still run every minute; stale-send recovery only needs a
  // periodic pass and otherwise doubles the idle database-query usage.
  const shouldRecoverStaleSending = Math.floor(now / 60000) % 5 === 0;
  const recoveredCount = shouldRecoverStaleSending
    ? await recoverStaleSendingBookings(now)
    : 0;
  const recoveredConfirmationCount = shouldRecoverStaleSending
    ? await recoverStaleConfirmationNotifications(now)
    : 0;
  const pendingBookings = await loadBookingsByReminderStatus("pending");
  const dueBookings = [];
  let expiredCount = 0;
  let failedCount = 0;

  for (let i = 0; i < pendingBookings.length; i += 1) {
    const booking = pendingBookings[i];
    if (booking.status !== "已确认") continue;
    const startAtMs = Number(booking.confirmedStartAtMs);
    if (!Number.isFinite(startAtMs)) {
      const claimedBooking = await claimBooking(booking._id, null);
      if (claimedBooking) {
        await markFailedAfterClaim(claimedBooking, new Error("缺少有效的 confirmedStartAtMs"));
        failedCount += 1;
      }
      continue;
    }
    if (startAtMs <= now) {
      if (await markExpired(booking._id, startAtMs)) expiredCount += 1;
      continue;
    }
    const nextAttemptAtMs = Number(booking.reminder10mNotifyNextAttemptAtMs || 0);
    if (nextAttemptAtMs > now) continue;
    if (startAtMs <= now + REMINDER_WINDOW_MS) {
      dueBookings.push({ booking, startAtMs });
    }
  }

  if (!dueBookings.length) {
    return {
      success: true,
      checkedCount: pendingBookings.length,
      sentCount: 0,
      failedCount,
      expiredCount,
      recoveredCount,
      recoveredConfirmationCount,
    };
  }

  let fieldKeys;
  let templateError;
  try {
    fieldKeys = await loadReminderFieldKeys();
  } catch (error) {
    templateError = error;
    console.error("load reminder template failed", error);
  }

  if (templateError) {
    return {
      success: false,
      checkedCount: pendingBookings.length,
      sentCount: 0,
      failedCount,
      expiredCount,
      recoveredCount,
      recoveredConfirmationCount,
      message: toErrorMessage(templateError),
    };
  }

  const dueBatch = dueBookings
    .sort((a, b) => a.startAtMs - b.startAtMs)
    .slice(0, MAX_DUE_PER_RUN);
  let sentCount = 0;
  for (let i = 0; i < dueBatch.length; i += 1) {
    const { booking, startAtMs } = dueBatch[i];
    const claimedBooking = await claimBooking(booking._id, startAtMs);
    if (!claimedBooking) continue;

    if (!(claimedBooking.reminderNotifyOpenId || claimedBooking.notifyOpenId)) {
      await markFailedAfterClaim(claimedBooking, new Error("缺少订阅消息接收人的 openid"));
      failedCount += 1;
      continue;
    }

    try {
      const dispatchReady = await markDispatchStarted(claimedBooking);
      if (!dispatchReady) continue;
    } catch (error) {
      console.error("mark lesson reminder dispatch failed", claimedBooking._id, error);
      failedCount += 1;
      continue;
    }

    try {
      await sendReminder(claimedBooking, fieldKeys, startAtMs);
    } catch (error) {
      console.error("send lesson reminder failed", claimedBooking._id, error);
      await markFailedAfterClaim(claimedBooking, error);
      failedCount += 1;
      continue;
    }
    try {
      await markSentWithRetry(claimedBooking);
    } catch (error) {
      console.error("lesson reminder sent but status update failed", claimedBooking._id, error);
    }
    sentCount += 1;
  }

  return {
    success: true,
    checkedCount: pendingBookings.length,
    sentCount,
    failedCount,
    expiredCount,
    recoveredCount,
    recoveredConfirmationCount,
  };
};
