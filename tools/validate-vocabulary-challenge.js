const assert = require("assert");
const fs = require("fs");
const path = require("path");
const challenge = require("../miniprogram/utils/vocabularyChallenge");

const pageScript = fs.readFileSync(
  path.join(__dirname, "../miniprogram/pages/vocabulary-challenge/index.js"),
  "utf8"
);
const pageMarkup = fs.readFileSync(
  path.join(__dirname, "../miniprogram/pages/vocabulary-challenge/index.wxml"),
  "utf8"
);
assert(pageMarkup.includes("currentQuestion.answerMode === 'choice'"));
assert(pageMarkup.includes("currentQuestion.feedbackAnswer"));
assert(pageMarkup.includes("letter-word") && pageMarkup.includes("填满后自动判断"));
assert(pageScript.includes("answerMode: question.answerMode"));
assert(pageScript.includes("question.answerMode, isCorrect"));
assert(pageScript.includes("normalizeLetterCompletionInput") && pageScript.includes("shouldAutoJudge"));

const words = Array.from({ length: 8 }, (_, index) => ({
  key: `word-${index}`,
  word: `word${index}`,
  meaning: `释义${index}`,
  isDue: true,
  lastResult: index < 2 ? "forgot" : "",
  wrongCount: index < 2 ? 2 : 0,
  correctCount: 0,
}));
const fixedRandom = () => 0.25;

const selected = challenge.selectChallengeWords({
  todayWords: words.slice(2, 5),
  allWords: words,
  limit: 8,
  random: fixedRandom,
});
assert.strictEqual(selected.length, 8);
assert.strictEqual(new Set(selected.map((item) => item.key)).size, 8);

const weak = challenge.selectChallengeWords({
  todayWords: [],
  allWords: words,
  scope: "weak",
  limit: 6,
  random: fixedRandom,
});
assert.strictEqual(weak.length, 2);
assert(weak.every((item) => challenge.isWeakWord(item)));

const questions = challenge.buildChallengeQuestions(selected, words, fixedRandom);
assert.strictEqual(questions.length, 8);
assert(questions.some((item) => item.type === "spelling"));
assert(questions.some((item) => item.type === "letterGap"));
assert(questions.some((item) => item.taskType === "letterCompletion" && item.answerMode === "choice"));
assert(questions.some((item) => item.taskType === "letterCompletion" && item.answerMode === "input"));
assert(questions.some((item) => item.taskType === "completeWord" && item.answerMode === "choice"));
assert(questions.some((item) => item.taskType === "completeWord" && item.answerMode === "input"));
questions.filter((item) => item.answerMode === "choice").forEach((item) => {
  assert(item.options.length >= 2);
  assert.strictEqual(item.options.filter((option) => option.isAnswer).length, 1);
});
questions.filter((item) => item.answerMode === "input").forEach((item) => {
  assert.strictEqual(item.options.length, 0);
});
const letterInput = questions.find((item) => (
  item.taskType === "letterCompletion" && item.answerMode === "input"
));
assert(letterInput.promptHint.includes("只填写"));
assert(letterInput.promptHint.includes("不要输入完整单词"));
assert.strictEqual(letterInput.inputPlaceholder, "只填缺少的字母");
assert.strictEqual(letterInput.autoJudge, true);
assert.strictEqual(letterInput.letterAnswerLength, letterInput.answer.length);
assert.strictEqual(letterInput.letterSlots.filter((item) => item.hidden).length, letterInput.answer.length);
assert.notStrictEqual(challenge.normalizeAnswer(letterInput.answer), challenge.normalizeAnswer(letterInput.word));
const letterChoice = questions.find((item) => (
  item.taskType === "letterCompletion" && item.answerMode === "choice"
));
assert.strictEqual(letterChoice.typeLabel, "补全字母 · 选择题");
assert(letterChoice.promptHint.includes("选择"));
assert(letterChoice.feedbackAnswer.includes(`缺少的字母：${letterChoice.answer}`));
const fullWordChoice = questions.find((item) => (
  item.taskType === "completeWord" && item.answerMode === "choice"
));
assert.strictEqual(fullWordChoice.answer, fullWordChoice.word);
assert.strictEqual(fullWordChoice.typeLabel, "完整单词 · 选择题");
const fullWordInput = questions.find((item) => (
  item.taskType === "completeWord" && item.answerMode === "input"
));
assert.strictEqual(fullWordInput.answer, fullWordInput.word);
assert.strictEqual(fullWordInput.typeLabel, "完整单词 · 填空题");
assert.strictEqual(challenge.normalizeAnswer("  I'M  Ready "), "i'm ready");
const twoCompletion = challenge.buildLetterCompletion("two");
assert.strictEqual(twoCompletion.prompt, "t _ o");
assert.strictEqual(twoCompletion.answer, "w");
assert.strictEqual(twoCompletion.slots.length, 3);
assert.strictEqual(twoCompletion.slots[1].hidden, true);
assert.strictEqual(twoCompletion.slots[1].answerIndex, 0);
assert.strictEqual(challenge.normalizeLetterCompletionInput(" W!x ", 1), "W");
const filledTwo = challenge.fillLetterCompletionSlots(twoCompletion.slots, "w");
assert.strictEqual(filledTwo[1].displayValue, "w");
assert.strictEqual(filledTwo[1].state, "filled");
const wrongTwo = challenge.fillLetterCompletionSlots(twoCompletion.slots, "q", { answered: true, correct: false });
assert.strictEqual(wrongTwo[1].displayValue, "q");
assert.strictEqual(wrongTwo[1].state, "wrong");

const coolingWeak = challenge.selectChallengeWords({
  todayWords: [],
  allWords: [{
    key: "cooling",
    word: "cooling",
    meaning: "冷却中",
    lastResult: "forgot",
    isDue: false,
  }].concat(words.slice(2)),
  scope: "weak",
  limit: 6,
  random: fixedRandom,
});
assert.strictEqual(coolingWeak.length, 0);

const coolingHard = challenge.selectChallengeWords({
  todayWords: [],
  allWords: [{
    key: "difficult",
    word: "difficult",
    meaning: "困难的",
    lastResult: "hard",
    isDue: false,
  }],
  scope: "weak",
  limit: 6,
  random: fixedRandom,
});
assert.strictEqual(coolingHard.length, 0);

const ineligibleSmartWords = challenge.selectChallengeWords({
  todayWords: [],
  allWords: [{
    key: "easy",
    word: "easy",
    meaning: "简单的",
    isEasy: true,
    isDue: true,
  }, {
    key: "waiting",
    word: "waiting",
    meaning: "等待中的",
    isEasy: false,
    isDue: false,
  }],
  scope: "smart",
  limit: 6,
  random: fixedRandom,
});
assert.strictEqual(ineligibleSmartWords.length, 0);

const legacyBasicWord = challenge.selectChallengeWords({
  todayWords: [],
  allWords: [{
    key: "basic",
    word: "basic",
    meaning: "基础的",
    isBasicHidden: true,
    isDue: true,
  }],
  scope: "smart",
  limit: 6,
  random: fixedRandom,
});
assert.strictEqual(legacyBasicWord.length, 1, "Legacy basic-word flags must no longer filter quiz words");

const retryWaitingWord = challenge.selectChallengeWords({
  todayWords: [{
    key: "waiting",
    word: "waiting",
    meaning: "等待中的",
    isDue: false,
  }],
  allWords: [],
  scope: "retry",
  limit: 6,
  random: fixedRandom,
});
assert.strictEqual(retryWaitingWord.length, 1);

const singleWordQuestion = challenge.buildChallengeQuestions([{
  key: "apple",
  word: "apple",
  meaning: "苹果",
}], [], fixedRandom)[0];
assert.strictEqual(singleWordQuestion.type, "spelling");
assert.strictEqual(singleWordQuestion.taskType, "completeWord");
assert.strictEqual(singleWordQuestion.answerMode, "input");
assert.strictEqual(singleWordQuestion.direction, "meaningToWord");
assert.strictEqual(singleWordQuestion.prompt, "苹果");
assert.strictEqual(singleWordQuestion.answer, "apple");
assert(challenge.buildLetterGap("school").includes("_"));

console.log("vocabulary challenge validation passed");
