const assert = require("assert");
const vocabulary = require("../vocabulary");
const quiz = require("../vocabularyQuiz");

const nowMs = Date.UTC(2026, 9, 3, 10);
const makeWord = (index, extra = {}) => Object.assign({
  key: `word-${index}`,
  word: `word${index}`,
  meaning: `释义${index}`,
  reviewCount: 1,
  correctCount: 1,
  wrongCount: 0,
  masteryLevel: 1,
  isDue: index % 2 === 0,
  nextReviewAtMs: nowMs - index * 1000,
}, extra);

const words = Array.from({ length: 90 }, (_, index) => makeWord(index));
words[75] = makeWord(75, { lastResult: "forgot", wrongCount: 4, correctCount: 1 });
const justLearned = makeWord(91, { isDue: false, reviewedToday: true });
const unseen = makeWord(92, { reviewCount: 0 });
const todayWords = [justLearned, unseen];
const plan = quiz.buildPersonalizedQuizPlan({
  words: words.concat(todayWords),
  todayWords,
  dailyGoal: 20,
  studentId: "student-a",
  learningDay: 123,
  nowMs,
});
assert.strictEqual(plan.questionCount, 12);
assert(plan.words.some((word) => word.key === "word-75"), "weak word outside the first page was skipped");
assert(plan.words.some((word) => word.key === justLearned.key), "just-learned word was skipped");
assert(!plan.words.some((word) => word.key === unseen.key), "unseen word entered the quiz");
assert.deepStrictEqual(
  plan.words.map((word) => word.key),
  quiz.buildPersonalizedQuizPlan({
    words: words.concat(todayWords),
    todayWords,
    dailyGoal: 20,
    studentId: "student-a",
    learningDay: 123,
    nowMs,
  }).words.map((word) => word.key),
  "plan must be stable for one student and learning day"
);
assert.strictEqual(quiz.getQuestionTarget(8), 8);
assert.strictEqual(quiz.getQuestionTarget(15), 10);
assert.strictEqual(quiz.getQuestionTarget(20), 12);
assert.strictEqual(quiz.getQuestionTarget(30), 15);

const progress = vocabulary.buildQuizProgress(
  { stage: 2, reviewCount: 3 },
  { correct: true, questionType: "spelling", learningDay: 123 },
  nowMs
);
assert.strictEqual(progress.stage, 3);
const sameDay = vocabulary.buildQuizProgress(
  progress,
  { correct: true, questionType: "spelling", learningDay: 123 },
  nowMs + 1000
);
assert.strictEqual(sameDay.stage, 3, "repeating a spelling item on the same day raised its stage twice");
const choice = vocabulary.buildQuizProgress(
  { stage: 2 },
  { correct: true, questionType: "wordToMeaning", learningDay: 123 },
  nowMs
);
assert.strictEqual(choice.stage, 2, "choice questions must not raise the SRS stage");

const student = { _id: "student-a", name: "测试学生" };
const session = (offset, accuracy, totalQuestions = 8) => ({
  studentId: student._id,
  completedAtMs: nowMs - offset * 1000,
  accuracy,
  totalQuestions,
  results: [],
});
const insufficient = quiz.buildTeacherVocabularyAlerts({
  students: [student],
  sessions: [session(1, 50), session(2, 50), session(3, 50)],
  nowMs,
});
assert(!insufficient.some((item) => item.activityType === "quiz_algorithm_review"));
const enough = quiz.buildTeacherVocabularyAlerts({
  students: [student],
  sessions: [session(1, 50), session(2, 55), session(3, 60), session(4, 80), session(5, 80)],
  nowMs,
});
assert(enough.some((item) => item.activityType === "quiz_algorithm_review"));

console.log("englishVocabularyQuiz.test.js: passed");
