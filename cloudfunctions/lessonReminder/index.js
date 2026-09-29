const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const REMINDER_TEMPLATE_ID = "Ih535VWa2FCNlCCvZUYFJOt8fOA3EY3l7Pxoa9rszYA";
const HOMEWORK_REMINDER_PAGE = "pages/lesson-detail/index";
const QUERY_LIMIT = 100;
const MAX_QUERY_PAGES = 10;
const MAX_DUE_PER_RUN = 10;
const SENDING_LEASE_MS = 2 * 60 * 1000;
const HOMEWORK_RETRY_DELAY_MS = 5 * 60 * 1000;
const HOMEWORK_LATE_SEND_WINDOW_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
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

const formatHongKongDay = (timestamp) => formatHongKongDateTime(timestamp).slice(0, 10);

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

const hasLessonHomework = (lesson) => Boolean(
  String((lesson && lesson.homeworkTask) || "").trim()
  || (lesson && lesson.recordingTaskEnabled)
);

const isLessonHomeworkCompleted = (lesson) => Boolean(
  lesson && (lesson.homeworkCompleted === true || Number(lesson.homeworkCompletedAtMs || 0) > 0)
);

const loadLessonsByHomeworkReminderStatus = async (status) => {
  const lessons = [];
  for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
    const result = await db
      .collection("lessons")
      .where({ homeworkReminderNotifyStatus: status })
      .skip(page * QUERY_LIMIT)
      .limit(QUERY_LIMIT)
      .get();
    const items = result.data || [];
    lessons.push(...items);
    if (items.length < QUERY_LIMIT) break;
  }
  return lessons;
};

const cancelInvalidHomeworkReminder = async (
  lessonId,
  expectedStatus,
  expectedTargetAtMs,
  expectedTaskVersion,
  status,
  message
) => {
  return db.runTransaction(async (transaction) => {
    const result = await transaction.collection("lessons").doc(lessonId).get();
    const lesson = result.data;
    if (
      !lesson
      || lesson.homeworkReminderNotifyStatus !== expectedStatus
      || Number(lesson.homeworkReminderTargetAtMs || 0) !== Number(expectedTargetAtMs || 0)
      || Number(lesson.homeworkReminderTaskVersion || 0) !== Number(expectedTaskVersion || 0)
    ) return false;
    await transaction.collection("lessons").doc(lessonId).update({
      data: {
        homeworkReminderSubscribed: false,
        homeworkReminderNotifyStatus: status,
        homeworkReminderNotifyClaimId: "",
        homeworkReminderNotifyNextAttemptAtMs: 0,
        homeworkReminderNotifyError: message,
        updatedAt: db.serverDate(),
      },
    });
    return true;
  });
};

const rescheduleExpiredHomeworkReminder = async (lesson, now) => {
  const expectedTargetAtMs = Number(lesson.homeworkReminderTargetAtMs || 0);
  const expectedTaskVersion = Number(lesson.homeworkReminderTaskVersion || 0);
  let nextTargetAtMs = expectedTargetAtMs;
  while (nextTargetAtMs <= now) nextTargetAtMs += DAY_MS;
  return db.runTransaction(async (transaction) => {
    const lessonRef = transaction.collection("lessons").doc(lesson._id);
    const result = await lessonRef.get();
    const current = result.data;
    if (
      !current
      || current.homeworkReminderNotifyStatus !== "pending"
      || Number(current.homeworkReminderTargetAtMs || 0) !== expectedTargetAtMs
      || Number(current.homeworkReminderTaskVersion || 0) !== expectedTaskVersion
      || isLessonHomeworkCompleted(current)
      || !hasLessonHomework(current)
    ) return false;
    await lessonRef.update({
      data: {
        homeworkReminderTargetAtMs: nextTargetAtMs,
        homeworkReminderTargetDate: formatHongKongDay(nextTargetAtMs),
        homeworkReminderNotifyNextAttemptAtMs: 0,
        homeworkReminderNotifyError: "",
        updatedAt: db.serverDate(),
      },
    });
    return true;
  });
};

const recoverStaleHomeworkNotifications = async (now) => {
  const lessons = await loadLessonsByHomeworkReminderStatus("sending");
  const staleBefore = now - SENDING_LEASE_MS;
  let recoveredCount = 0;
  for (let i = 0; i < lessons.length; i += 1) {
    const item = lessons[i];
    const attemptedAtMs = Number(item.homeworkReminderNotifyAttemptedAtMs)
      || toTimestamp(item.homeworkReminderNotifyAttemptedAt);
    if (attemptedAtMs > staleBefore) continue;
    const recovered = await db.runTransaction(async (transaction) => {
      const result = await transaction.collection("lessons").doc(item._id).get();
      const lesson = result.data;
      if (!lesson || lesson.homeworkReminderNotifyStatus !== "sending") return false;
      const currentAttemptedAtMs = Number(lesson.homeworkReminderNotifyAttemptedAtMs)
        || toTimestamp(lesson.homeworkReminderNotifyAttemptedAt);
      if (currentAttemptedAtMs > staleBefore) return false;
      const attemptCount = Number(lesson.homeworkReminderNotifyAttemptCount || 0);
      const deliveryUnknown = Number(lesson.homeworkReminderNotifyDispatchStartedAtMs || 0) > 0;
      const exhausted = attemptCount >= MAX_SEND_ATTEMPTS;
      await transaction.collection("lessons").doc(item._id).update({
        data: {
          homeworkReminderSubscribed: deliveryUnknown || exhausted ? false : true,
          homeworkReminderNotifyStatus: deliveryUnknown
            ? "delivery_unknown"
            : exhausted ? "failed" : "pending",
          homeworkReminderNotifyClaimId: "",
          homeworkReminderNotifyNextAttemptAtMs: deliveryUnknown || exhausted
            ? 0
            : now + HOMEWORK_RETRY_DELAY_MS,
          homeworkReminderNotifyError: deliveryUnknown
            ? "微信接口已调用，但最终投递状态无法确认"
            : exhausted ? "课后任务提醒重试次数已用完" : lesson.homeworkReminderNotifyError || "",
          homeworkReminderNotifyRecoveredAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
      return true;
    });
    if (recovered) recoveredCount += 1;
  }
  return recoveredCount;
};

const claimHomeworkReminder = async (lessonId, expectedTargetAtMs, expectedTaskVersion) => {
  return db.runTransaction(async (transaction) => {
    const result = await transaction.collection("lessons").doc(lessonId).get();
    const lesson = result.data;
    if (!lesson || lesson.homeworkReminderNotifyStatus !== "pending") return null;
    if (isLessonHomeworkCompleted(lesson)) {
      await transaction.collection("lessons").doc(lessonId).update({
        data: {
          homeworkReminderSubscribed: false,
          homeworkReminderNotifyStatus: "cancelled_completed",
          homeworkReminderNotifyClaimId: "",
          homeworkReminderNotifyNextAttemptAtMs: 0,
          homeworkReminderNotifyError: "",
          updatedAt: db.serverDate(),
        },
      });
      return null;
    }
    const currentTaskVersion = Number(lesson.homeworkTaskVersion || 1);
    const taskMatches = currentTaskVersion === Number(expectedTaskVersion || 1)
      && currentTaskVersion === Number(lesson.homeworkReminderTaskVersion || 0);
    if (!hasLessonHomework(lesson) || !taskMatches) {
      await transaction.collection("lessons").doc(lessonId).update({
        data: {
          homeworkReminderSubscribed: false,
          homeworkReminderNotifyStatus: "cancelled_changed",
          homeworkReminderNotifyClaimId: "",
          homeworkReminderNotifyNextAttemptAtMs: 0,
          homeworkReminderNotifyError: "课后任务已变更，请重新开启提醒",
          updatedAt: db.serverDate(),
        },
      });
      return null;
    }
    const targetAtMs = Number(lesson.homeworkReminderTargetAtMs || 0);
    if (targetAtMs !== Number(expectedTargetAtMs) || targetAtMs > Date.now()) return null;
    const claimId = createClaimId();
    const attemptCount = Number(lesson.homeworkReminderNotifyAttemptCount || 0) + 1;
    await transaction.collection("lessons").doc(lessonId).update({
      data: {
        homeworkReminderNotifyStatus: "sending",
        homeworkReminderNotifyClaimId: claimId,
        homeworkReminderNotifyAttemptedAt: db.serverDate(),
        homeworkReminderNotifyAttemptedAtMs: Date.now(),
        homeworkReminderNotifyAttemptCount: attemptCount,
        updatedAt: db.serverDate(),
      },
    });
    return Object.assign({}, lesson, {
      _id: lessonId,
      homeworkReminderNotifyClaimId: claimId,
      homeworkReminderNotifyAttemptCount: attemptCount,
    });
  });
};

const updateClaimedHomeworkReminder = async (lesson, data) => {
  return db.runTransaction(async (transaction) => {
    const result = await transaction.collection("lessons").doc(lesson._id).get();
    const current = result.data;
    if (
      !current
      || current.homeworkReminderNotifyStatus !== "sending"
      || current.homeworkReminderNotifyClaimId !== lesson.homeworkReminderNotifyClaimId
      || Number(current.homeworkReminderTargetAtMs || 0) !== Number(lesson.homeworkReminderTargetAtMs || 0)
      || Number(current.homeworkTaskVersion || 1) !== Number(lesson.homeworkTaskVersion || 1)
    ) return false;
    await transaction.collection("lessons").doc(lesson._id).update({ data });
    return true;
  });
};

const markHomeworkDispatchStarted = async (lesson) => updateClaimedHomeworkReminder(lesson, {
  homeworkReminderNotifyDispatchStartedAtMs: Date.now(),
  updatedAt: db.serverDate(),
});

const markHomeworkSent = async (lesson) => updateClaimedHomeworkReminder(lesson, {
  homeworkReminderSubscribed: false,
  homeworkReminderNotifyStatus: "sent",
  homeworkReminderNotifyClaimId: "",
  homeworkReminderNotifyDispatchStartedAtMs: 0,
  homeworkReminderNotifyNextAttemptAtMs: 0,
  homeworkReminderNotifySentAt: db.serverDate(),
  homeworkReminderNotifyError: "",
  updatedAt: db.serverDate(),
});

const markHomeworkFailed = async (lesson, error) => {
  const permanent = PERMANENT_SEND_ERROR_CODES.has(getErrorCode(error));
  const canRetry = !permanent && Number(lesson.homeworkReminderNotifyAttemptCount || 0) < MAX_SEND_ATTEMPTS;
  return updateClaimedHomeworkReminder(lesson, {
    homeworkReminderSubscribed: canRetry,
    homeworkReminderNotifyStatus: canRetry ? "pending" : "failed",
    homeworkReminderNotifyClaimId: "",
    homeworkReminderNotifyDispatchStartedAtMs: 0,
    homeworkReminderNotifyNextAttemptAtMs: canRetry ? Date.now() + HOMEWORK_RETRY_DELAY_MS : 0,
    homeworkReminderNotifyFailedAt: canRetry ? null : db.serverDate(),
    homeworkReminderNotifyError: toErrorMessage(error),
    updatedAt: db.serverDate(),
  });
};

const buildHomeworkMessageData = (lesson, fieldKeys) => {
  const targetAtMs = Number(lesson.homeworkReminderTargetAtMs || Date.now());
  const values = {
    日程标题: "课后任务待完成",
    课程名称: String(lesson.title || "英语课后任务").slice(0, 20),
    开始时间: formatHongKongDateTime(targetAtMs),
    提醒内容: "还有课后任务未完成，请进入查看",
    教师: String(lesson.teacherName || "朱老师").slice(0, 10),
  };
  return REQUIRED_FIELDS.reduce((result, label) => {
    result[fieldKeys[label]] = { value: values[label] };
    return result;
  }, {});
};

const sendHomeworkReminder = async (lesson, fieldKeys) => {
  return cloud.openapi.subscribeMessage.send({
    touser: String(lesson.homeworkReminderNotifyOpenId || ""),
    templateId: REMINDER_TEMPLATE_ID,
    page: `${HOMEWORK_REMINDER_PAGE}?id=${encodeURIComponent(lesson._id)}`,
    lang: "zh_CN",
    data: buildHomeworkMessageData(lesson, fieldKeys),
  });
};

const processHomeworkReminders = async (now) => {
  const shouldProcess = Math.floor(now / 60000) % 5 === 0;
  if (!shouldProcess) return { skipped: true, checkedCount: 0, sentCount: 0, failedCount: 0 };

  const recoveredCount = await recoverStaleHomeworkNotifications(now);
  const pendingLessons = await loadLessonsByHomeworkReminderStatus("pending");
  const dueLessons = [];
  let cancelledCount = 0;
  for (let i = 0; i < pendingLessons.length; i += 1) {
    const lesson = pendingLessons[i];
    if (isLessonHomeworkCompleted(lesson)) {
      if (await cancelInvalidHomeworkReminder(
        lesson._id,
        "pending",
        lesson.homeworkReminderTargetAtMs,
        lesson.homeworkReminderTaskVersion,
        "cancelled_completed",
        ""
      )) {
        cancelledCount += 1;
      }
      continue;
    }
    const currentTaskVersion = Number(lesson.homeworkTaskVersion || 1);
    if (!hasLessonHomework(lesson) || currentTaskVersion !== Number(lesson.homeworkReminderTaskVersion || 0)) {
      if (await cancelInvalidHomeworkReminder(
        lesson._id,
        "pending",
        lesson.homeworkReminderTargetAtMs,
        lesson.homeworkReminderTaskVersion,
        "cancelled_changed",
        "课后任务已变更，请重新开启提醒"
      )) cancelledCount += 1;
      continue;
    }
    const targetAtMs = Number(lesson.homeworkReminderTargetAtMs || 0);
    const nextAttemptAtMs = Number(lesson.homeworkReminderNotifyNextAttemptAtMs || 0);
    if (!targetAtMs || targetAtMs > now || nextAttemptAtMs > now) continue;
    if (targetAtMs < now - HOMEWORK_LATE_SEND_WINDOW_MS) {
      await rescheduleExpiredHomeworkReminder(lesson, now);
      continue;
    }
    dueLessons.push(lesson);
  }

  if (!dueLessons.length) {
    return {
      skipped: false,
      checkedCount: pendingLessons.length,
      sentCount: 0,
      failedCount: 0,
      cancelledCount,
      recoveredCount,
    };
  }

  let fieldKeys;
  try {
    fieldKeys = await loadReminderFieldKeys();
  } catch (error) {
    console.error("load homework reminder template failed", error);
    return {
      skipped: false,
      checkedCount: pendingLessons.length,
      sentCount: 0,
      failedCount: dueLessons.length,
      cancelledCount,
      recoveredCount,
      message: toErrorMessage(error),
    };
  }

  let sentCount = 0;
  let failedCount = 0;
  const dueBatch = dueLessons
    .sort((a, b) => Number(a.homeworkReminderTargetAtMs) - Number(b.homeworkReminderTargetAtMs))
    .slice(0, MAX_DUE_PER_RUN);
  for (let i = 0; i < dueBatch.length; i += 1) {
    const lesson = dueBatch[i];
    const claimed = await claimHomeworkReminder(
      lesson._id,
      Number(lesson.homeworkReminderTargetAtMs),
      Number(lesson.homeworkTaskVersion || 1)
    );
    if (!claimed) continue;
    if (!claimed.homeworkReminderNotifyOpenId) {
      await markHomeworkFailed(claimed, new Error("缺少订阅消息接收人的 openid"));
      failedCount += 1;
      continue;
    }
    try {
      const dispatchReady = await markHomeworkDispatchStarted(claimed);
      if (!dispatchReady) continue;
      await sendHomeworkReminder(claimed, fieldKeys);
    } catch (error) {
      console.error("send homework reminder failed", claimed._id, error);
      await markHomeworkFailed(claimed, error);
      failedCount += 1;
      continue;
    }
    try {
      await markHomeworkSent(claimed);
    } catch (error) {
      console.error("homework reminder sent but status update failed", claimed._id, error);
    }
    sentCount += 1;
  }

  return {
    skipped: false,
    checkedCount: pendingLessons.length,
    sentCount,
    failedCount,
    cancelledCount,
    recoveredCount,
  };
};

exports.main = async () => {
  const now = Date.now();
  let homeworkReminderResult;
  try {
    homeworkReminderResult = await processHomeworkReminders(now);
  } catch (error) {
    console.error("process homework reminders failed", error);
    homeworkReminderResult = {
      success: false,
      sentCount: 0,
      failedCount: 1,
      message: toErrorMessage(error),
    };
  }

  return {
    success: homeworkReminderResult.success !== false,
    homeworkReminderResult,
  };
};
