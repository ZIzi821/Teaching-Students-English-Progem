const assert = require("assert");
const challenge = require("../miniprogram/utils/vocabularyChallenge");

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
  limit: 6,
  random: fixedRandom,
});
assert.strictEqual(selected.length, 6);
assert.strictEqual(new Set(selected.map((item) => item.key)).size, 6);

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
assert.strictEqual(questions.length, 6);
assert(questions.some((item) => item.type === "spelling"));
assert(questions.some((item) => item.type === "letterGap"));
questions.filter((item) => ["wordToMeaning", "meaningToWord"].includes(item.type)).forEach((item) => {
  assert(item.options.length >= 2);
  assert.strictEqual(item.options.filter((option) => option.isAnswer).length, 1);
});
assert.strictEqual(challenge.normalizeAnswer("  I'M  Ready "), "i'm ready");

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
  }, {
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
assert.strictEqual(ineligibleSmartWords.length, 0);

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
assert.strictEqual(singleWordQuestion.direction, "meaningToWord");
assert.strictEqual(singleWordQuestion.prompt, "苹果");
assert.strictEqual(singleWordQuestion.answer, "apple");
assert(challenge.buildLetterGap("school").includes("_"));

console.log("vocabulary challenge validation passed");
