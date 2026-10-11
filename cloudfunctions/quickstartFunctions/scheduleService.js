const crypto = require("crypto");
const schedule = require("./schedule");
const { runTransactionWithRetry } = require("./transactionRetry");
const { withoutDocumentId } = require("./databasePayload");

const SCHEDULE_LOCK_ID = "weekly_schedule_state_v1";
const SCHEDULE_AVAILABILITY_ID = "weekly_schedule_availability_v1";
const SCHEDULE_SEED_REVISION = 2;

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
    const [students, existingEvents] = await Promise.all([
      loadAllStudents(),
      loadAllEvents(),
    ]);
    const seedEvents = schedule.DEFAULT_WEEKLY_EVENTS.concat(
      schedule.buildDefaultStudentScheduleEvents(students)
    );
    return withScheduleTransaction(async (transaction) => {
      const lockRef = transaction.collection("systemLocks").doc(SCHEDULE_LOCK_ID);
      const state = await getOptionalTransactionDocument(lockRef);
      const nowMs = Date.now();
      let created = false;
      for (let index = 0; index < seedEvents.length; index += 1) {
        const source = seedEvents[index];
        if (source.eventType === "fixed_student_lesson") {
          const existingFixed = existingEvents.find((item) => (
            item.eventType === "fixed_student_lesson"
            && item.fixedTemplateId === source.fixedTemplateId
          ));
          if (existingFixed) continue;
          const matchingBooking = existingEvents.find((item) => (
            item.eventType === "lesson_booking"
            && item.status === "active"
            && String(item.studentId || "") === String(source.studentId || "")
            && Number(item.weekday) === Number(source.weekday)
            && Number(item.startMinute) === Number(source.startMinute)
            && Number(item.endMinute) === Number(source.endMinute)
          ));
          if (matchingBooking) {
            const matchingRef = transaction.collection("scheduleEvents").doc(matchingBooking._id);
            const current = await getOptionalTransactionDocument(matchingRef);
            if (current && current.status === "active" && current.eventType === "lesson_booking") {
              await matchingRef.update({
                data: {
                  eventType: source.eventType,
                  fixedTemplateId: source.fixedTemplateId,
                  scheduleKind: source.scheduleKind,
                  title: source.title,
                  publicTitle: source.publicTitle,
                  note: source.note,
                  source: source.source,
                  version: Math.max(1, Number(current.version) || 1) + 1,
                  updatedAt: db.serverDate(),
                  updatedAtMs: nowMs,
                },
              });
              created = true;
              continue;
            }
          }
        }
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
        created = true;
      }
      if (!created && Number(state && state.seedRevision) >= SCHEDULE_SEED_REVISION) return false;
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

  const loadAvailabilityState = async () => (
    getOptionalTransactionDocument(db.collection("systemLocks").doc(SCHEDULE_AVAILABILITY_ID))
  );

  const sanitizeStudent = (student) => ({
    _id: student._id,
    name: student.name || student.nickname || "学生",
    bookingDurationMinutes: schedule.getDefaultBookingDurationMinutes(student),
    colorKey: schedule.getStudentColorKey(student),
  });

  const sanitizeTeacherEvent = (event) => {
    const decorated = schedule.decorateEvent(event);
    const isFixedStudentLesson = decorated.eventType === "fixed_student_lesson";
    return {
      _id: decorated._id,
      eventType: decorated.eventType,
      weekday: decorated.weekday,
      weekdayLabel: schedule.WEEKDAY_LABELS[Number(decorated.weekday) - 1] || "每周",
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
      fixedTemplateId: decorated.fixedTemplateId || "",
      enabled: decorated.status === "active",
      version: Number(decorated.version) || 1,
      canEdit: !isFixedStudentLesson,
      canCancel: !isFixedStudentLesson,
    };
  };

  const sanitizeStudentEvent = (event, student) => {
    const decorated = schedule.decorateEvent(event);
    const isOwn = schedule.isStudentLessonEvent(decorated)
      && student
      && decorated.studentId === student._id;
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
        ? decorated.title || `${student.name || "我的"}课程`
        : decorated.publicTitle || "老师有安排",
      note: isOwn ? String(decorated.note || "") : "",
      studentId: isOwn ? decorated.studentId : "",
      colorKey: decorated.colorKey || (isOwn ? schedule.getStudentColorKey(student) : "teacher"),
      version: Number(decorated.version) || 1,
      canEdit: false,
      canCancel: false,
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
    const [allEvents, availabilityState, allStudents] = await Promise.all([
      loadAllEvents(),
      loadAvailabilityState(),
      identity.role === "teacher" && !isTeacherPreview ? loadAllStudents() : Promise.resolve([]),
    ]);
    const activeEvents = allEvents.filter((item) => item.status === "active");
    const events = schedule.sortEvents(activeEvents);
    const closedWeekdays = schedule.normalizeClosedWeekdays(availabilityState && availabilityState.closedWeekdays);
    const studentColorKeys = schedule.assignStudentColorKeys(allEvents);
    const displayEvents = events.map((item) => (
      schedule.isStudentLessonEvent(item) && studentColorKeys.has(String(item.studentId || ""))
        ? { ...item, colorKey: studentColorKeys.get(String(item.studentId)) }
        : item
    ));
    const canWrite = identity.role === "teacher" && !isTeacherPreview;
    const students = identity.role === "teacher" && !isTeacherPreview
      ? allStudents
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
      availabilityVersion: Math.max(0, Number(availabilityState && availabilityState.version) || 0),
      dayAvailability: schedule.buildWeekdayAvailability(closedWeekdays),
      student: student ? sanitizeStudent(student) : null,
      students,
      fixedStudentSchedules: identity.role === "teacher" && !isTeacherPreview
        ? schedule.sortEvents(allEvents.filter((item) => item.eventType === "fixed_student_lesson"))
          .map((item) => studentColorKeys.has(String(item.studentId || ""))
            ? { ...item, colorKey: studentColorKeys.get(String(item.studentId)) }
            : item)
          .map(sanitizeTeacherEvent)
        : [],
      events: identity.role === "teacher" && !isTeacherPreview
        ? displayEvents.map(sanitizeTeacherEvent)
        : displayEvents
          .filter((item) => schedule.isStudentLessonEvent(item)
            && student
            && String(item.studentId || "") === String(student._id || ""))
          .map((item) => sanitizeStudentEvent(item, student)),
    };
  };

  const saveScheduleEvent = async ({ eventId, fingerprint, eventData, enforceBookingOpen = false }) => {
    return withScheduleTransaction(async (transaction) => {
      const lockRef = transaction.collection("systemLocks").doc(SCHEDULE_LOCK_ID);
      const eventRef = transaction.collection("scheduleEvents").doc(eventId);
      const [state, existing, activeResult, availabilityState] = await Promise.all([
        getOptionalTransactionDocument(lockRef),
        getOptionalTransactionDocument(eventRef),
        transaction.collection("scheduleEvents")
          .where({ status: "active", weekday: eventData.weekday })
          .get(),
        enforceBookingOpen
          ? getOptionalTransactionDocument(transaction.collection("systemLocks").doc(SCHEDULE_AVAILABILITY_ID))
          : Promise.resolve(null),
      ]);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          throw createError("SCHEDULE_REQUEST_CONFLICT", "这次提交的内容已经变化，请重新确认");
        }
        if (existing.status === "active") return { created: false, event: existing };
      }
      if (enforceBookingOpen && !schedule.isWeekdayBookingOpen(
        availabilityState && availabilityState.closedWeekdays,
        eventData.weekday
      )) {
        throw createError("DAY_BOOKING_CLOSED", `${schedule.WEEKDAY_LABELS[eventData.weekday - 1]}当前暂停预约，请选择其他时间`);
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
    if (identity.role !== "teacher") {
      throw createError("PERMISSION_DENIED", "日程现由教师统一安排，家长端仅查看课程时间");
    }
    const data = event.data || {};
    if (data.mode === "teacherPreview") {
      throw createError("PERMISSION_DENIED", "学生预览与家长端保持一致，仅查看课程时间");
    }
    const requestedStudentId = String(data.studentId || data.previewStudentId || "").trim();
    const studentId = requestedStudentId;
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
        publicTitle: "其他学生已预约",
        note,
        studentId: student._id,
        studentNameSnapshot: student.name || "",
        colorKey: schedule.getStudentColorKey(student),
        source: "teacher_booking",
        clientRequestId: requestId,
        createdByRole: identity.role,
        createdByOpenId: identity.openid || "",
      },
      enforceBookingOpen: false,
    });
    return {
      success: true,
      created: saved.created,
      event: sanitizeTeacherEvent(Object.assign({ _id: eventId }, saved.event)),
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
    if (initial.eventType === "fixed_student_lesson") {
      throw createError("FIXED_SCHEDULE_CONTROL_REQUIRED", "固定课表请使用下方开关控制，不支持直接改写");
    }
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
        publicTitle: "其他学生已预约",
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
      const [state, current, activeResult, availabilityState] = await Promise.all([
        getOptionalTransactionDocument(lockRef),
        getOptionalTransactionDocument(eventRef),
        transaction.collection("scheduleEvents")
          .where({ status: "active", weekday: eventData.weekday })
          .get(),
        initial.eventType === "lesson_booking"
          ? getOptionalTransactionDocument(transaction.collection("systemLocks").doc(SCHEDULE_AVAILABILITY_ID))
          : Promise.resolve(null),
      ]);
      if (!current || current.status !== "active") throw createError("INVALID_SCHEDULE_EVENT", "这段日程已不存在，请刷新后重试");
      if (!canManageEvent({ identity, data, current })) throw createError("PERMISSION_DENIED", "你没有权限编辑这段日程");
      if (Number(current.version) !== expectedVersion) throw createError("SCHEDULE_VERSION_CONFLICT", "这段日程刚被修改过，请刷新后再编辑");
      if (current.eventType !== initial.eventType || String(current.studentId || "") !== String(initial.studentId || "")) {
        throw createError("SCHEDULE_VERSION_CONFLICT", "这段日程内容已变化，请刷新后再编辑");
      }
      if (initial.eventType === "lesson_booking" && identity.role !== "teacher" && !schedule.isWeekdayBookingOpen(
        availabilityState && availabilityState.closedWeekdays,
        eventData.weekday
      )) {
        throw createError("DAY_BOOKING_CLOSED", `${schedule.WEEKDAY_LABELS[eventData.weekday - 1]}当前暂停预约，请选择其他时间`);
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

    return {
      success: true,
      event: sanitizeTeacherEvent(updated),
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
      if (current.eventType === "fixed_student_lesson") {
        throw createError("FIXED_SCHEDULE_CONTROL_REQUIRED", "固定课表请使用开关关闭，不会删除记录");
      }
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

  const setScheduleDayAvailability = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "teacher") throw createError("PERMISSION_DENIED", "仅教师端可调整预约开放状态");
    const data = event.data || {};
    if (data.mode === "teacherPreview") throw createError("PERMISSION_DENIED", "请返回教师日程调整预约开放状态");
    const weekday = schedule.normalizeWeekday(data.weekday);
    if (!weekday || typeof data.bookingOpen !== "boolean") {
      throw createError("INVALID_AVAILABILITY", "请选择需要调整的星期");
    }
    await ensureDefaults();
    const expectedVersion = Math.max(0, Number(data.expectedVersion) || 0);
    const saved = await withScheduleTransaction(async (transaction) => {
      const ref = transaction.collection("systemLocks").doc(SCHEDULE_AVAILABILITY_ID);
      const current = await getOptionalTransactionDocument(ref);
      const currentVersion = Math.max(0, Number(current && current.version) || 0);
      if (currentVersion !== expectedVersion) {
        throw createError("SCHEDULE_VERSION_CONFLICT", "预约开放状态刚被修改，请刷新后再操作");
      }
      const closedWeekdays = new Set(schedule.normalizeClosedWeekdays(current && current.closedWeekdays));
      if (data.bookingOpen) closedWeekdays.delete(weekday);
      else closedWeekdays.add(weekday);
      const nowMs = Date.now();
      const next = {
        recordType: "weeklyScheduleAvailability",
        closedWeekdays: Array.from(closedWeekdays).sort((left, right) => left - right),
        version: currentVersion + 1,
        updatedByOpenId: identity.openid || "",
        updatedAt: db.serverDate(),
        updatedAtMs: nowMs,
      };
      await ref.set({ data: next });
      return next;
    });
    return {
      success: true,
      availabilityVersion: saved.version,
      dayAvailability: schedule.buildWeekdayAvailability(saved.closedWeekdays),
    };
  };

  const setFixedStudentScheduleEnabled = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "teacher") throw createError("PERMISSION_DENIED", "仅教师端可调整固定课表");
    const data = event.data || {};
    if (data.mode === "teacherPreview") {
      throw createError("PERMISSION_DENIED", "请返回教师日程调整固定课表");
    }
    const eventId = String(data.eventId || "").trim();
    const expectedVersion = Number(data.expectedVersion);
    if (!eventId || typeof data.enabled !== "boolean" || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw createError("INVALID_SCHEDULE_EVENT", "固定课表信息已变化，请刷新后重试");
    }
    await ensureDefaults();
    const saved = await withScheduleTransaction(async (transaction) => {
      const lockRef = transaction.collection("systemLocks").doc(SCHEDULE_LOCK_ID);
      const eventRef = transaction.collection("scheduleEvents").doc(eventId);
      const [state, current] = await Promise.all([
        getOptionalTransactionDocument(lockRef),
        getOptionalTransactionDocument(eventRef),
      ]);
      if (!current || current.eventType !== "fixed_student_lesson") {
        throw createError("INVALID_SCHEDULE_EVENT", "固定课表不存在，请刷新后重试");
      }
      if (Number(current.version) !== expectedVersion) {
        throw createError("SCHEDULE_VERSION_CONFLICT", "固定课表刚被修改，请刷新后再操作");
      }
      const nextStatus = data.enabled ? "active" : "paused";
      if (current.status === nextStatus) return { ...withoutDocumentId(current), _id: eventId };
      if (data.enabled) {
        const activeResult = await transaction.collection("scheduleEvents")
          .where({ status: "active", weekday: current.weekday })
          .get();
        const conflict = (activeResult.data || []).find((item) => (
          item._id !== eventId && schedule.rangesOverlap(item, current)
        ));
        if (conflict) {
          const time = `${schedule.formatMinute(conflict.startMinute)}–${schedule.formatMinute(conflict.endMinute)}`;
          throw createError("SCHEDULE_CONFLICT", `这个固定时间已有其他安排（${time}），请先调整冲突日程`);
        }
      }
      const nowMs = Date.now();
      const nextVersion = Math.max(1, Number(current.version) || 1) + 1;
      await eventRef.update({
        data: {
          status: nextStatus,
          version: nextVersion,
          enabledByOpenId: identity.openid || "",
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
      return { ...withoutDocumentId(current), status: nextStatus, version: nextVersion, _id: eventId };
    });
    return {
      success: true,
      fixedSchedule: sanitizeTeacherEvent(saved),
    };
  };

  return {
    getWeeklySchedule,
    createScheduleBooking,
    saveTeacherScheduleBlock,
    updateScheduleEvent,
    cancelScheduleEvent,
    setScheduleDayAvailability,
    setFixedStudentScheduleEnabled,
  };
};

module.exports = {
  SCHEDULE_LOCK_ID,
  SCHEDULE_AVAILABILITY_ID,
  SCHEDULE_SEED_REVISION,
  createWeeklyScheduleService,
};
