const crypto = require("crypto");
const schedule = require("./schedule");
const { runTransactionWithRetry } = require("./transactionRetry");
const { withoutDocumentId } = require("./databasePayload");

const SCHEDULE_LOCK_ID = "weekly_schedule_state_v1";
const SCHEDULE_SEED_REVISION = 1;

const createWeeklyScheduleService = ({
  db,
  createError,
  createOneCollection,
  getIdentity,
  getOptionalTransactionDocument,
  assertContentSafe,
}) => {
  let collectionsReady = false;

  const ensureCollections = async () => {
    if (collectionsReady) return;
    await createOneCollection("scheduleEvents");
    await createOneCollection("systemLocks");
    collectionsReady = true;
  };

  const withScheduleTransaction = (operation) => runTransactionWithRetry(
    () => db.runTransaction(operation),
    {
      onRetry({ attempt, waitMs }) {
        console.warn(`weekly schedule transaction busy, retry ${attempt} after ${waitMs}ms`);
      },
    }
  );

  const ensureDefaults = async () => {
    await ensureCollections();
    return withScheduleTransaction(async (transaction) => {
      const lockRef = transaction.collection("systemLocks").doc(SCHEDULE_LOCK_ID);
      const state = await getOptionalTransactionDocument(lockRef);
      if (Number(state && state.seedRevision) >= SCHEDULE_SEED_REVISION) return false;
      const nowMs = Date.now();
      for (let index = 0; index < schedule.DEFAULT_WEEKLY_EVENTS.length; index += 1) {
        const source = schedule.DEFAULT_WEEKLY_EVENTS[index];
        const eventRef = transaction.collection("scheduleEvents").doc(source._id);
        const existing = await getOptionalTransactionDocument(eventRef);
        if (existing) continue;
        await eventRef.set({
          data: {
            ...withoutDocumentId(source),
            recordType: "weeklyScheduleEvent",
            recurrence: "weekly",
            status: "active",
            version: 1,
            createdByRole: "system",
            createdAt: db.serverDate(),
            createdAtMs: nowMs,
            updatedAt: db.serverDate(),
            updatedAtMs: nowMs,
          },
        });
      }
      await lockRef.set({
        data: {
          recordType: "weeklyScheduleState",
          version: Math.max(0, Number(state && state.version) || 0) + 1,
          seedRevision: SCHEDULE_SEED_REVISION,
          updatedAt: db.serverDate(),
          updatedAtMs: nowMs,
        },
      });
      return true;
    });
  };

  const loadAllEvents = async (where = {}) => {
    const rows = [];
    const pageSize = 100;
    for (let skip = 0; ; skip += pageSize) {
      const result = await db.collection("scheduleEvents")
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

  const loadAllStudents = async () => {
    const rows = [];
    const pageSize = 100;
    for (let skip = 0; ; skip += pageSize) {
      const result = await db.collection("students")
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
    if (!studentId) return null;
    const result = await db.collection("students").doc(studentId).get();
    return result.data || null;
  };

  const sanitizeStudent = (student) => ({
    _id: student._id,
    name: student.name || student.nickname || "学生",
    bookingDurationMinutes: schedule.getDefaultBookingDurationMinutes(student),
    colorKey: schedule.getStudentColorKey(student),
  });

  const sanitizeTeacherEvent = (event) => {
    const decorated = schedule.decorateEvent(event);
    return {
      _id: decorated._id,
      eventType: decorated.eventType,
      weekday: decorated.weekday,
      startMinute: decorated.startMinute,
      endMinute: decorated.endMinute,
      startTime: decorated.startTime,
      endTime: decorated.endTime,
      timeLabel: decorated.timeLabel,
      durationMinutes: decorated.durationMinutes,
      title: decorated.title,
      note: decorated.note || "",
      studentId: decorated.studentId || "",
      studentName: decorated.studentNameSnapshot || "",
      colorKey: decorated.colorKey || "teacher",
      source: decorated.source || "teacher",
      version: Number(decorated.version) || 1,
      canEdit: true,
      canCancel: true,
    };
  };

  const sanitizeStudentEvent = (event, student, canWrite) => {
    const decorated = schedule.decorateEvent(event);
    const isOwn = decorated.eventType === "lesson_booking"
      && student
      && decorated.studentId === student._id;
    if (decorated.eventType === "lesson_booking" && !isOwn) {
      return {
        _id: decorated._id,
        eventType: "occupied",
        weekday: decorated.weekday,
        startMinute: decorated.startMinute,
        endMinute: decorated.endMinute,
        startTime: decorated.startTime,
        endTime: decorated.endTime,
        timeLabel: decorated.timeLabel,
        durationMinutes: decorated.durationMinutes,
        title: "已有课程",
        note: "",
        colorKey: decorated.colorKey || "occupied",
        version: Number(decorated.version) || 1,
        canEdit: false,
        canCancel: false,
      };
    }
    return {
      _id: decorated._id,
      eventType: decorated.eventType,
      weekday: decorated.weekday,
      startMinute: decorated.startMinute,
      endMinute: decorated.endMinute,
      startTime: decorated.startTime,
      endTime: decorated.endTime,
      timeLabel: decorated.timeLabel,
      durationMinutes: decorated.durationMinutes,
      title: isOwn
        ? `${student.name || "我的"}课程`
        : decorated.publicTitle || "老师有安排",
      note: isOwn ? String(decorated.note || "") : "",
      studentId: isOwn ? decorated.studentId : "",
      colorKey: decorated.colorKey || (isOwn ? schedule.getStudentColorKey(student) : "teacher"),
      version: Number(decorated.version) || 1,
      canEdit: Boolean(isOwn && canWrite),
      canCancel: Boolean(isOwn && canWrite),
    };
  };

  const getPreviewStudentId = (data = {}) => String(data.previewStudentId || data.studentId || "").trim();

  const canManageEvent = ({ identity, data, current }) => {
    return schedule.canManageScheduleEvent({
      actorRole: identity.role,
      actorStudentId: identity.student && identity.student._id,
      mode: data.mode,
      previewStudentId: getPreviewStudentId(data),
      event: current,
    });
  };

  const getWeeklySchedule = async (event) => {
    const identity = await getIdentity();
    if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
    const data = event.data || {};
    const isTeacherPreview = identity.role === "teacher" && data.mode === "teacherPreview";
    let student = identity.role === "student" ? identity.student : null;
    if (isTeacherPreview) {
      student = await loadStudent(String(data.previewStudentId || data.studentId || ""));
      if (!student) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    }
    await ensureDefaults();
    const events = schedule.sortEvents(await loadAllEvents({ status: "active" }));
    const studentColorKeys = schedule.assignStudentColorKeys(events);
    const displayEvents = events.map((item) => (
      item.eventType === "lesson_booking" && studentColorKeys.has(String(item.studentId || ""))
        ? { ...item, colorKey: studentColorKeys.get(String(item.studentId)) }
        : item
    ));
    const canWrite = (
      (identity.role === "student" || isTeacherPreview)
      && schedule.isStudentBookingEnabled(student)
    ) || (identity.role === "teacher" && !isTeacherPreview);
    const students = identity.role === "teacher" && !isTeacherPreview
      ? (await loadAllStudents())
        .filter(schedule.isStudentBookingEnabled)
        .sort((left, right) => String(left.name || left.nickname || "").localeCompare(String(right.name || right.nickname || ""), "zh-CN"))
        .map(sanitizeStudent)
      : [];
    return {
      success: true,
      role: isTeacherPreview ? "student" : identity.role,
      actorRole: identity.role,
      isTeacherPreview,
      canWrite,
      student: student ? sanitizeStudent(student) : null,
      students,
      events: identity.role === "teacher" && !isTeacherPreview
        ? displayEvents.map(sanitizeTeacherEvent)
        : displayEvents.map((item) => sanitizeStudentEvent(item, student, canWrite)),
    };
  };

  const saveScheduleEvent = async ({ eventId, fingerprint, eventData }) => {
    return withScheduleTransaction(async (transaction) => {
      const lockRef = transaction.collection("systemLocks").doc(SCHEDULE_LOCK_ID);
      const eventRef = transaction.collection("scheduleEvents").doc(eventId);
      const [state, existing, activeResult] = await Promise.all([
        getOptionalTransactionDocument(lockRef),
        getOptionalTransactionDocument(eventRef),
        transaction.collection("scheduleEvents")
          .where({ status: "active", weekday: eventData.weekday })
          .get(),
      ]);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          throw createError("SCHEDULE_REQUEST_CONFLICT", "这次提交的内容已经变化，请重新确认");
        }
        if (existing.status === "active") return { created: false, event: existing };
      }
      const conflict = (activeResult.data || []).find((item) => (
        item._id !== eventId && schedule.rangesOverlap(item, eventData)
      ));
      if (conflict) {
        const time = `${schedule.formatMinute(conflict.startMinute)}–${schedule.formatMinute(conflict.endMinute)}`;
        throw createError("SCHEDULE_CONFLICT", `这个时间已有安排（${time}），请选择其他时间`);
      }
      const nowMs = Date.now();
      const saved = {
        ...eventData,
        recordType: "weeklyScheduleEvent",
        recurrence: "weekly",
        status: "active",
        requestFingerprint: fingerprint,
        version: existing ? Math.max(1, Number(existing.version) || 1) + 1 : 1,
        createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
        createdAtMs: existing && Number(existing.createdAtMs) ? Number(existing.createdAtMs) : nowMs,
        updatedAt: db.serverDate(),
        updatedAtMs: nowMs,
      };
      await eventRef.set({ data: saved });
      await lockRef.set({
        data: {
          recordType: "weeklyScheduleState",
          version: Math.max(0, Number(state && state.version) || 0) + 1,
          seedRevision: Math.max(SCHEDULE_SEED_REVISION, Number(state && state.seedRevision) || 0),
          updatedAt: db.serverDate(),
          updatedAtMs: nowMs,
        },
      });
      return { created: true, event: saved };
    });
  };

  const createScheduleBooking = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "student" && identity.role !== "teacher") {
      throw createError("PERMISSION_DENIED", "请使用家长、学生或教师账号预约上课");
    }
    const data = event.data || {};
    const requestedStudentId = String(data.studentId || data.previewStudentId || "").trim();
    const studentId = identity.role === "teacher"
      ? requestedStudentId
      : String(identity.student && identity.student._id || "");
    if (identity.role === "teacher" && data.mode === "teacherPreview" && studentId !== getPreviewStudentId(data)) {
      throw createError("PERMISSION_DENIED", "教师预览只能为当前学生预约");
    }
    await ensureDefaults();
    const student = await loadStudent(studentId);
    if (!student) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    if (!schedule.isStudentBookingEnabled(student)) {
      throw createError("BOOKING_NOT_AVAILABLE", "该学生当前未开放预约");
    }
    const range = schedule.buildBookingRange(student, data.weekday, data.startTime);
    if (!range.valid) throw createError("INVALID_SCHEDULE_TIME", range.message);
    const requestId = String(data.requestId || "").trim().slice(0, 100);
    if (!requestId) throw createError("INVALID_REQUEST", "预约请求已失效，请重新提交");
    const note = String(data.note || "").trim().slice(0, 100);
    await assertContentSafe({ texts: [note] });
    const fingerprint = crypto.createHash("sha1").update(JSON.stringify({
      studentId: student._id,
      weekday: range.weekday,
      startMinute: range.startMinute,
      endMinute: range.endMinute,
      note,
    })).digest("hex");
    const eventId = `schedule_booking_${crypto.createHash("sha1").update(`${student._id}\n${requestId}`).digest("hex")}`;
    const saved = await saveScheduleEvent({
      eventId,
      fingerprint,
      eventData: {
        eventType: "lesson_booking",
        weekday: range.weekday,
        startMinute: range.startMinute,
        endMinute: range.endMinute,
        durationMinutes: range.durationMinutes,
        title: `${student.name || "学生"}课程`,
        publicTitle: "已有课程",
        note,
        studentId: student._id,
        studentNameSnapshot: student.name || "",
        colorKey: schedule.getStudentColorKey(student),
        source: identity.role === "teacher" ? "teacher_booking" : "parent",
        clientRequestId: requestId,
        createdByRole: identity.role,
        createdByOpenId: identity.openid || "",
      },
    });
    return {
      success: true,
      created: saved.created,
      event: identity.role === "teacher" && data.mode !== "teacherPreview"
        ? sanitizeTeacherEvent(Object.assign({ _id: eventId }, saved.event))
        : sanitizeStudentEvent(Object.assign({ _id: eventId }, saved.event), student, true),
    };
  };

  const saveTeacherScheduleBlock = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "teacher") throw createError("PERMISSION_DENIED", "仅教师端可添加日程");
    const data = event.data || {};
    if (data.mode === "teacherPreview") throw createError("PERMISSION_DENIED", "请在教师日程中添加老师安排");
    await ensureDefaults();
    const startMinute = schedule.parseTime(data.startTime);
    const endMinute = schedule.parseTime(data.endTime);
    const range = schedule.validateTimeRange({ weekday: data.weekday, startMinute, endMinute });
    if (!range.valid) throw createError("INVALID_SCHEDULE_TIME", range.message);
    const title = String(data.title || "").trim().slice(0, 50);
    const note = String(data.note || "").trim().slice(0, 100);
    if (!title) throw createError("INVALID_SCHEDULE_TITLE", "请填写这段时间的事项");
    await assertContentSafe({ texts: [title, note] });
    const requestId = String(data.requestId || "").trim().slice(0, 100);
    if (!requestId) throw createError("INVALID_REQUEST", "日程请求已失效，请重新提交");
    const fingerprint = crypto.createHash("sha1").update(JSON.stringify({
      weekday: range.weekday,
      startMinute: range.startMinute,
      endMinute: range.endMinute,
      title,
      note,
    })).digest("hex");
    const eventId = `schedule_teacher_${crypto.createHash("sha1").update(`${identity.openid || "teacher"}\n${requestId}`).digest("hex")}`;
    const saved = await saveScheduleEvent({
      eventId,
      fingerprint,
      eventData: {
        eventType: "teacher_busy",
        weekday: range.weekday,
        startMinute: range.startMinute,
        endMinute: range.endMinute,
        durationMinutes: range.durationMinutes,
        title,
        publicTitle: title,
        note,
        colorKey: "teacher",
        source: "teacher",
        clientRequestId: requestId,
        createdByRole: "teacher",
        createdByOpenId: identity.openid || "",
      },
    });
    return {
      success: true,
      created: saved.created,
      event: sanitizeTeacherEvent(Object.assign({ _id: eventId }, saved.event)),
    };
  };

  const updateScheduleEvent = async (event) => {
    const identity = await getIdentity();
    if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
    const data = event.data || {};
    const eventId = String(data.eventId || "").trim();
    const expectedVersion = Number(data.expectedVersion);
    if (!eventId || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw createError("INVALID_SCHEDULE_EVENT", "日程信息已变化，请刷新后重试");
    }
    await ensureDefaults();
    const initialResult = await db.collection("scheduleEvents").doc(eventId).get();
    const initial = initialResult.data || null;
    if (!initial || initial.status !== "active") throw createError("INVALID_SCHEDULE_EVENT", "这段日程已不存在，请刷新后重试");
    if (!canManageEvent({ identity, data, current: initial })) {
      throw createError("PERMISSION_DENIED", "你没有权限编辑这段日程");
    }

    let eventData;
    if (initial.eventType === "lesson_booking") {
      const student = await loadStudent(String(initial.studentId || ""));
      if (!student) throw createError("INVALID_STUDENT", "学生不存在或已删除");
      if (!schedule.isStudentBookingEnabled(student)) {
        throw createError("BOOKING_NOT_AVAILABLE", "该学生当前未开放预约，可取消这段日程后重新安排");
      }
      const range = schedule.buildBookingRange(student, data.weekday, data.startTime);
      if (!range.valid) throw createError("INVALID_SCHEDULE_TIME", range.message);
      const note = String(data.note || "").trim().slice(0, 100);
      await assertContentSafe({ texts: [note] });
      eventData = {
        weekday: range.weekday,
        startMinute: range.startMinute,
        endMinute: range.endMinute,
        durationMinutes: range.durationMinutes,
        title: `${student.name || "学生"}课程`,
        publicTitle: "已有课程",
        note,
        studentNameSnapshot: student.name || "",
        colorKey: schedule.getStudentColorKey(student),
      };
    } else {
      if (identity.role !== "teacher" || data.mode === "teacherPreview") {
        throw createError("PERMISSION_DENIED", "请在教师日程中编辑老师安排");
      }
      const range = schedule.validateTimeRange({
        weekday: data.weekday,
        startMinute: schedule.parseTime(data.startTime),
        endMinute: schedule.parseTime(data.endTime),
      });
      if (!range.valid) throw createError("INVALID_SCHEDULE_TIME", range.message);
      const title = String(data.title || "").trim().slice(0, 50);
      const note = String(data.note || "").trim().slice(0, 100);
      if (!title) throw createError("INVALID_SCHEDULE_TITLE", "请填写这段时间的事项");
      await assertContentSafe({ texts: [title, note] });
      eventData = {
        weekday: range.weekday,
        startMinute: range.startMinute,
        endMinute: range.endMinute,
        durationMinutes: range.durationMinutes,
        title,
        publicTitle: title,
        note,
      };
    }

    const updated = await withScheduleTransaction(async (transaction) => {
      const lockRef = transaction.collection("systemLocks").doc(SCHEDULE_LOCK_ID);
      const eventRef = transaction.collection("scheduleEvents").doc(eventId);
      const [state, current, activeResult] = await Promise.all([
        getOptionalTransactionDocument(lockRef),
        getOptionalTransactionDocument(eventRef),
        transaction.collection("scheduleEvents")
          .where({ status: "active", weekday: eventData.weekday })
          .get(),
      ]);
      if (!current || current.status !== "active") throw createError("INVALID_SCHEDULE_EVENT", "这段日程已不存在，请刷新后重试");
      if (!canManageEvent({ identity, data, current })) throw createError("PERMISSION_DENIED", "你没有权限编辑这段日程");
      if (Number(current.version) !== expectedVersion) throw createError("SCHEDULE_VERSION_CONFLICT", "这段日程刚被修改过，请刷新后再编辑");
      if (current.eventType !== initial.eventType || String(current.studentId || "") !== String(initial.studentId || "")) {
        throw createError("SCHEDULE_VERSION_CONFLICT", "这段日程内容已变化，请刷新后再编辑");
      }
      const conflict = (activeResult.data || []).find((item) => (
        item._id !== eventId && schedule.rangesOverlap(item, eventData)
      ));
      if (conflict) {
        const time = `${schedule.formatMinute(conflict.startMinute)}–${schedule.formatMinute(conflict.endMinute)}`;
        throw createError("SCHEDULE_CONFLICT", `这个时间已有安排（${time}），请选择其他时间`);
      }
      const nowMs = Date.now();
      const nextVersion = Math.max(1, Number(current.version) || 1) + 1;
      await eventRef.update({
        data: {
          ...eventData,
          version: nextVersion,
          editedByRole: identity.role,
          editedByOpenId: identity.openid || "",
          updatedAt: db.serverDate(),
          updatedAtMs: nowMs,
        },
      });
      await lockRef.set({
        data: {
          recordType: "weeklyScheduleState",
          version: Math.max(0, Number(state && state.version) || 0) + 1,
          seedRevision: Math.max(SCHEDULE_SEED_REVISION, Number(state && state.seedRevision) || 0),
          updatedAt: db.serverDate(),
          updatedAtMs: nowMs,
        },
      });
      return { ...withoutDocumentId(current), ...eventData, version: nextVersion, _id: eventId };
    });

    const previewStudent = data.mode === "teacherPreview"
      ? await loadStudent(getPreviewStudentId(data))
      : identity.role === "student" ? identity.student : null;
    return {
      success: true,
      event: identity.role === "teacher" && data.mode !== "teacherPreview"
        ? sanitizeTeacherEvent(updated)
        : sanitizeStudentEvent(updated, previewStudent, true),
    };
  };

  const cancelScheduleEvent = async (event) => {
    const identity = await getIdentity();
    if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
    const data = event.data || {};
    const eventId = String(data.eventId || "").trim();
    if (!eventId) throw createError("INVALID_SCHEDULE_EVENT", "日程信息不完整，请刷新后重试");
    await ensureDefaults();
    const cancelled = await withScheduleTransaction(async (transaction) => {
      const lockRef = transaction.collection("systemLocks").doc(SCHEDULE_LOCK_ID);
      const eventRef = transaction.collection("scheduleEvents").doc(eventId);
      const [state, current] = await Promise.all([
        getOptionalTransactionDocument(lockRef),
        getOptionalTransactionDocument(eventRef),
      ]);
      if (!current || current.status === "cancelled") return false;
      if (!canManageEvent({ identity, data, current })) throw createError("PERMISSION_DENIED", "你没有权限取消这段日程");
      if (Number(data.expectedVersion) > 0 && Number(current.version) !== Number(data.expectedVersion)) {
        throw createError("SCHEDULE_VERSION_CONFLICT", "这段日程刚被修改过，请刷新后再操作");
      }
      const nowMs = Date.now();
      await eventRef.update({
        data: {
          status: "cancelled",
          version: Math.max(1, Number(current.version) || 1) + 1,
          cancelledByRole: identity.role,
          cancelledAt: db.serverDate(),
          cancelledAtMs: nowMs,
          updatedAt: db.serverDate(),
          updatedAtMs: nowMs,
        },
      });
      await lockRef.set({
        data: {
          recordType: "weeklyScheduleState",
          version: Math.max(0, Number(state && state.version) || 0) + 1,
          seedRevision: Math.max(SCHEDULE_SEED_REVISION, Number(state && state.seedRevision) || 0),
          updatedAt: db.serverDate(),
          updatedAtMs: nowMs,
        },
      });
      return true;
    });
    return { success: true, cancelled, eventId };
  };

  return {
    getWeeklySchedule,
    createScheduleBooking,
    saveTeacherScheduleBlock,
    updateScheduleEvent,
    cancelScheduleEvent,
  };
};

module.exports = {
  SCHEDULE_LOCK_ID,
  SCHEDULE_SEED_REVISION,
  createWeeklyScheduleService,
};
