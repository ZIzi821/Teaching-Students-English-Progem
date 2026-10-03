const courseWorkflow = require("./courseWorkflow");
const vocabulary = require("./vocabulary");

const INACTIVITY_THRESHOLD_DAYS = 3;

const asText = (value) => String(value || "").trim();

const getDateLikeTime = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.getTime === "function") return value.getTime();
  if (typeof value === "object" && value.$date) return getDateLikeTime(value.$date);
  if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000;
  }
  return 0;
};

const getDocumentTime = (item, fields = []) => {
  const source = item || {};
  for (let index = 0; index < fields.length; index += 1) {
    const value = getDateLikeTime(source[fields[index]]);
    if (value) return value;
  }
  return Number(source.createdAtMs || 0)
    || getDateLikeTime(source.createdAt)
    || getDateLikeTime(source._createTime);
};

const getTaskVersion = (item) => Math.max(1, Number(item && item.homeworkTaskVersion) || 1);

const isTeacherCompleted = (lesson) => Boolean(
  lesson
  && (
    lesson.homeworkTeacherReviewStatus === "completed"
    || (
      lesson.homeworkCompletedFrom === "teacher"
      && (lesson.homeworkCompleted === true || Number(lesson.homeworkCompletedAtMs) > 0)
    )
  )
);

const hasLessonHomework = (lesson) => Boolean(
  lesson && (asText(lesson.homeworkTask) || lesson.recordingTaskEnabled === true)
);

const isCurrentAudioSubmission = (submission, lesson) => Boolean(
  submission
  && lesson
  && submission.kind === "audio"
  && submission.lessonId === lesson._id
  && submission.studentId === lesson.studentId
  && getTaskVersion(submission) === getTaskVersion(lesson)
);

const buildTeacherTodos = ({
  students,
  lessons,
  submissions,
  vocabularyAlerts,
  dailyStats,
  quizSessions,
  ketMockSessions,
  nowMs = Date.now(),
  inactivityThresholdDays = INACTIVITY_THRESHOLD_DAYS,
} = {}) => {
  const studentById = new Map((students || [])
    .filter((student) => student && student._id)
    .map((student) => [String(student._id), student]));
  const lessonById = new Map((lessons || [])
    .filter((lesson) => (
      lesson
      && lesson._id
      && lesson.deleting !== true
      && studentById.has(String(lesson.studentId || ""))
    ))
    .map((lesson) => [String(lesson._id), lesson]));
  const submissionsByLesson = new Map();
  (submissions || []).forEach((submission) => {
    const lesson = lessonById.get(String(submission && submission.lessonId || ""));
    if (!isCurrentAudioSubmission(submission, lesson)) return;
    if (!submissionsByLesson.has(lesson._id)) submissionsByLesson.set(lesson._id, []);
    submissionsByLesson.get(lesson._id).push(submission);
  });
  const ketSessionsByLesson = new Map();
  (ketMockSessions || []).forEach((session) => {
    const lesson = lessonById.get(String(session && session.lessonId || ""));
    if (
      !lesson
      || session.studentId !== lesson.studentId
      || Number(session.homeworkTaskVersion || 1) !== getTaskVersion(lesson)
      || !["submitted", "reviewed"].includes(session.status)
    ) return;
    if (!ketSessionsByLesson.has(lesson._id)) ketSessionsByLesson.set(lesson._id, []);
    ketSessionsByLesson.get(lesson._id).push(session);
  });

  const items = [];
  lessonById.forEach((lesson) => {
    if (!hasLessonHomework(lesson)) return;
    const student = studentById.get(String(lesson.studentId || "")) || {};
    const lessonSubmissions = submissionsByLesson.get(lesson._id) || [];
    const lessonKetSessions = ketSessionsByLesson.get(lesson._id) || [];
    const pendingSubmissions = lessonSubmissions.filter((item) => item.status === "待检查");
    const pendingKetSessions = lessonKetSessions.filter((item) => item.status === "submitted");
    const usableSubmissions = lessonSubmissions.filter((item) => item.status !== "需要重录");
    const pendingLatestAtMs = pendingSubmissions.concat(pendingKetSessions).reduce((latest, item) => (
      Math.max(latest, Number(item.submittedAtMs || 0), getDocumentTime(item, ["createdAtMs", "createdAt"]))
    ), 0);
    const usableKetSessions = lessonKetSessions.filter((item) => ["submitted", "reviewed"].includes(item.status));
    const allUsableWork = usableSubmissions.concat(usableKetSessions);
    const firstUsableAtMs = allUsableWork.reduce((earliest, item) => {
      const value = Number(item.submittedAtMs || 0) || getDocumentTime(item, ["createdAtMs", "createdAt"]);
      if (!value) return earliest;
      return earliest ? Math.min(earliest, value) : value;
    }, 0);
    const latestUsableAtMs = allUsableWork.reduce((latest, item) => (
      Math.max(latest, Number(item.submittedAtMs || 0) || getDocumentTime(item, ["createdAtMs", "createdAt"]))
    ), 0);
    const deadline = courseWorkflow.buildHomeworkDeadlineState(lesson, nowMs, firstUsableAtMs);
    const studentName = asText(student.name) || "学生";
    const lessonTitle = asText(lesson.title) || "英语课";
    const completed = isTeacherCompleted(lesson);

    if (pendingSubmissions.length) {
      const lateCount = pendingSubmissions.filter((item) => item.submittedLate === true).length;
      items.push({
        _id: `recording:${lesson._id}`,
        category: "recording",
        kind: "recording_review",
        priority: "attention",
        priorityRank: 400,
        studentId: lesson.studentId,
        studentName,
        lessonId: lesson._id,
        title: `${lessonTitle} · 待检查录音`,
        detail: `${pendingSubmissions.length} 份录音等待检查${lateCount ? `，其中 ${lateCount} 份为逾期提交` : ""}`,
        meta: asText(lesson.lessonDate),
        actionType: "lesson",
        actionLabel: "检查录音",
        activityAtMs: pendingLatestAtMs,
        sortAtMs: pendingLatestAtMs,
        pendingCount: pendingSubmissions.length,
      });
    }

    if (pendingKetSessions.length) {
      const latestKetSession = pendingKetSessions.slice().sort((left, right) => (
        Number(right.submittedAtMs || 0) - Number(left.submittedAtMs || 0)
      ))[0];
      items.push({
        _id: `ket-mock:${latestKetSession._id}`,
        category: "recording",
        kind: "ket_mock_review",
        priority: "attention",
        priorityRank: 420,
        studentId: lesson.studentId,
        studentName,
        lessonId: lesson._id,
        sessionId: latestKetSession._id,
        title: `${lessonTitle} · KET 模拟待评分`,
        detail: "Part 1 与 Part 2 已提交，等待回听和四维练习评分",
        meta: latestKetSession.submittedLate === true ? "逾期提交" : asText(lesson.lessonDate),
        actionType: "ket_mock",
        actionLabel: "回听评分",
        activityAtMs: Number(latestKetSession.submittedAtMs || 0),
        sortAtMs: Number(latestKetSession.submittedAtMs || 0),
        pendingCount: 1,
      });
    }

    const teacherReviewedAtMs = Number(lesson.homeworkTeacherReviewedAtMs || 0)
      || getDateLikeTime(lesson.homeworkTeacherReviewedAt);
    const needsHomeworkReview = !completed
      && allUsableWork.length > 0
      && pendingSubmissions.length === 0
      && pendingKetSessions.length === 0
      && (
        lesson.homeworkTeacherReviewStatus === "unreviewed"
        || !teacherReviewedAtMs
        || latestUsableAtMs > teacherReviewedAtMs
      );
    if (needsHomeworkReview) {
      items.push({
        _id: `homework-review:${lesson._id}`,
        category: "homework",
        kind: "homework_review",
        priority: "attention",
        priorityRank: 350,
        studentId: lesson.studentId,
        studentName,
        lessonId: lesson._id,
        title: `${lessonTitle} · 课后任务待批改`,
        detail: "录音已经检查，整项课后任务还没有确认完成情况",
        meta: deadline.homeworkSubmittedLate ? "逾期提交" : asText(lesson.lessonDate),
        actionType: "lesson",
        actionLabel: "批改任务",
        activityAtMs: latestUsableAtMs,
        sortAtMs: latestUsableAtMs,
      });
    }

    if (!completed && !allUsableWork.length && deadline.homeworkDueStatus === "overdue") {
      items.push({
        _id: `homework-overdue:${lesson._id}`,
        category: "homework",
        kind: "homework_overdue",
        priority: "urgent",
        priorityRank: 500,
        studentId: lesson.studentId,
        studentName,
        lessonId: lesson._id,
        title: `${lessonTitle} · 录音尚未提交`,
        detail: `${deadline.homeworkDueLabel}，目前没有有效录音`,
        meta: `截止 ${deadline.homeworkDueDate}`,
        actionType: "lesson",
        actionLabel: "查看任务",
        activityAtMs: deadline.homeworkDueAtMs,
        sortAtMs: Math.max(0, nowMs - deadline.homeworkDueAtMs),
      });
    }
  });

  (vocabularyAlerts || []).forEach((alert) => {
    if (!studentById.has(String(alert && alert.studentId || ""))) return;
    const detailParts = [asText(alert.activityText), asText(alert.detail)].filter(Boolean);
    const important = alert.severity === "important";
    items.push({
      _id: `vocabulary:${asText(alert._id) || `${alert.studentId}:${alert.activityAtMs}`}`,
      category: "vocabulary",
      kind: asText(alert.activityType) || "vocabulary_alert",
      priority: important ? "attention" : "normal",
      priorityRank: important ? 300 : 250,
      studentId: alert.studentId,
      studentName: asText(alert.studentName) || "学生",
      lessonId: "",
      title: asText(alert.title) || "单词学习需要关注",
      detail: detailParts.join(" · "),
      meta: "依据最近小测记录",
      actionType: "vocabulary",
      actionLabel: "查看单词明细",
      activityAtMs: Number(alert.activityAtMs || 0),
      sortAtMs: Number(alert.activityAtMs || 0),
    });
  });

  const currentLearningDay = vocabulary.getLearningDay(nowMs);
  const lastActivityByStudent = new Map();
  const keepActivity = (studentId, learningDay, activityAtMs) => {
    const id = String(studentId || "");
    const day = Number(learningDay);
    if (!studentById.has(id) || !Number.isFinite(day)) return;
    const current = lastActivityByStudent.get(id);
    if (!current || day > current.learningDay || (day === current.learningDay && activityAtMs > current.activityAtMs)) {
      lastActivityByStudent.set(id, { learningDay: day, activityAtMs: Number(activityAtMs || 0) });
    }
  };
  (dailyStats || []).forEach((item) => {
    const reviewedCount = Math.max(
      0,
      Number(item && item.reviewedWordCount)
        || (Array.isArray(item && item.reviewedWordKeys) ? item.reviewedWordKeys.length : 0)
    );
    if (!reviewedCount) return;
    const day = Number(item.learningDay);
    keepActivity(item.studentId, day, getDocumentTime(item, ["updatedAt", "createdAt"]));
  });
  (quizSessions || []).forEach((item) => {
    if (Number(item && item.totalQuestions || 0) <= 0) return;
    const activityAtMs = Number(item.completedAtMs || 0) || getDocumentTime(item, ["completedAt", "createdAt"]);
    const day = Number(item.learningDay || vocabulary.getLearningDay(activityAtMs));
    keepActivity(item.studentId, day, activityAtMs);
  });
  (submissions || []).forEach((item) => {
    if (!item || item.kind !== "audio") return;
    const activityAtMs = getDocumentTime(item, ["createdAtMs", "createdAt"]);
    if (!activityAtMs) return;
    keepActivity(item.studentId, vocabulary.getLearningDay(activityAtMs), activityAtMs);
  });
  (ketMockSessions || []).forEach((item) => {
    if (!item || !["submitted", "reviewed"].includes(item.status)) return;
    const activityAtMs = Number(item.submittedAtMs || item.reviewedAtMs || 0);
    if (!activityAtMs) return;
    keepActivity(item.studentId, vocabulary.getLearningDay(activityAtMs), activityAtMs);
  });

  studentById.forEach((student, studentId) => {
    if (student.vocabularyEnabled !== true && student.englishCourseEnabled !== true) return;
    const latest = lastActivityByStudent.get(studentId);
    const createdAtMs = getDocumentTime(student, ["createdAt", "_createTime"]);
    const referenceDay = latest
      ? latest.learningDay
      : createdAtMs ? vocabulary.getLearningDay(createdAtMs) : 0;
    if (!referenceDay) return;
    const inactiveDays = Math.max(0, currentLearningDay - referenceDay);
    if (inactiveDays < Math.max(1, Number(inactivityThresholdDays) || INACTIVITY_THRESHOLD_DAYS)) return;
    items.push({
      _id: `inactivity:${studentId}`,
      category: "inactivity",
      kind: "learning_inactivity",
      priority: "normal",
      priorityRank: 100,
      studentId,
      studentName: asText(student.name) || "学生",
      lessonId: "",
      title: `连续 ${inactiveDays} 天没有新的学习记录`,
      detail: "没有新的背词、小测或录音记录；这里只统计小程序内可以确认的数据",
      meta: latest ? "查看最近学习情况" : "尚未产生在线学习记录",
      actionType: student.vocabularyEnabled === true ? "vocabulary" : "student",
      actionLabel: student.vocabularyEnabled === true ? "查看学习记录" : "查看学生",
      activityAtMs: latest ? latest.activityAtMs : createdAtMs,
      sortAtMs: inactiveDays,
      inactiveDays,
    });
  });

  items.sort((left, right) => (
    Number(right.priorityRank || 0) - Number(left.priorityRank || 0)
      || Number(right.sortAtMs || 0) - Number(left.sortAtMs || 0)
      || asText(left.studentName).localeCompare(asText(right.studentName), "zh-CN")
  ));
  const counts = items.reduce((result, item) => {
    result[item.category] = Number(result[item.category] || 0) + 1;
    return result;
  }, { recording: 0, homework: 0, vocabulary: 0, inactivity: 0 });
  return {
    items,
    summary: {
      totalCount: items.length,
      recordingCount: counts.recording,
      homeworkCount: counts.homework,
      vocabularyCount: counts.vocabulary,
      inactivityCount: counts.inactivity,
      urgentCount: items.filter((item) => item.priority === "urgent").length,
      studentCount: new Set(items.map((item) => String(item.studentId || "")).filter(Boolean)).size,
    },
  };
};

module.exports = {
  INACTIVITY_THRESHOLD_DAYS,
  buildTeacherTodos,
};
