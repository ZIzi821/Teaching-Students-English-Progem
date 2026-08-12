const asText = (value) => String(value || "").trim();

const normalizeAnswer = (value) => asText(value)
  .toLowerCase()
  .replace(/[’‘]/g, "'")
  .replace(/\s+/g, " ");

const shuffle = (items, random = Math.random) => {
  const result = (items || []).slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = current;
  }
  return result;
};

const uniqueWords = (items) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = asText(item && (item.key || item.word)).toLowerCase();
    if (!key || !asText(item && item.word) || !asText(item && item.meaning) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const isWeakWord = (word) => {
  const source = word || {};
  if (source.isEasy === true) return false;
  const lastResult = asText(source.lastResult);
  const wrongCount = Math.max(0, Number(source.wrongCount || 0));
  const correctCount = Math.max(0, Number(source.correctCount || 0));
  return lastResult === "forgot"
    || lastResult === "hard"
    || (wrongCount >= 2 && wrongCount >= correctCount);
};

const selectChallengeWords = ({
  todayWords,
  allWords,
  scope = "smart",
  limit = 6,
  random = Math.random,
}) => {
  const combined = uniqueWords((todayWords || []).concat(allWords || []));
  const all = scope === "retry"
    ? combined
    : combined.filter((item) => (
      item.isEasy !== true
      && item.isBasicHidden !== true
      && item.isDue !== false
    ));
  const todayKeys = new Set(uniqueWords(todayWords).map((item) => asText(item.key || item.word).toLowerCase()));
  const today = all.filter((item) => todayKeys.has(asText(item.key || item.word).toLowerCase()));
  const weak = all.filter(isWeakWord);
  const due = all.filter((item) => item.isEasy !== true && item.isDue !== false);
  const groups = scope === "weak"
    ? [weak]
    : scope === "retry"
      ? [today]
      : [
        today.filter(isWeakWord),
        today.filter((item) => item.isEasy !== true && item.isDue !== false),
        weak,
        due,
        all,
      ];
  const selected = [];
  const selectedKeys = new Set();
  groups.forEach((group) => {
    shuffle(group, random).forEach((item) => {
      if (selected.length >= limit) return;
      const key = asText(item.key || item.word).toLowerCase();
      if (!key || selectedKeys.has(key)) return;
      selectedKeys.add(key);
      selected.push(item);
    });
  });
  return selected.slice(0, Math.max(1, Number(limit) || 6));
};

const buildChoiceOptions = (answer, candidates, random) => {
  const normalizedAnswer = normalizeAnswer(answer);
  const seen = new Set([normalizedAnswer]);
  const distractors = shuffle(candidates, random).filter((value) => {
    const normalized = normalizeAnswer(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 3);
  return shuffle([answer].concat(distractors), random).map((label, index) => ({
    id: `${index}-${normalizeAnswer(label)}`,
    label: asText(label),
    isAnswer: normalizeAnswer(label) === normalizedAnswer,
    state: "",
  }));
};

const buildChallengeQuestions = (selectedWords, allWords, random = Math.random) => {
  const selected = uniqueWords(selectedWords);
  const pool = uniqueWords((allWords || []).concat(selected));
  const spellingCount = selected.length >= 5 ? 2 : selected.length >= 3 ? 1 : 0;
  const choiceCount = selected.length - spellingCount;
  return selected.map((word, index) => {
    const useSpelling = index >= choiceCount;
    const preferredMeaningToWord = useSpelling || index % 2 === 1;
    const preferredAnswer = preferredMeaningToWord ? asText(word.word) : asText(word.meaning);
    const candidateValues = pool
      .filter((item) => asText(item.key || item.word) !== asText(word.key || word.word))
      .map((item) => preferredMeaningToWord ? asText(item.word) : asText(item.meaning));
    const options = useSpelling ? [] : buildChoiceOptions(preferredAnswer, candidateValues, random);
    const type = !useSpelling && options.length >= 2 ? "choice" : "spelling";
    const meaningToWord = type === "spelling" ? true : preferredMeaningToWord;
    const answer = meaningToWord ? asText(word.word) : asText(word.meaning);
    return {
      id: `${asText(word.key || word.word)}-${index}`,
      wordKey: asText(word.key || word.word),
      word: asText(word.word),
      meaning: asText(word.meaning),
      partOfSpeech: asText(word.partOfSpeech),
      sourceLabel: asText(word.sourceLabel),
      type,
      direction: meaningToWord ? "meaningToWord" : "wordToMeaning",
      typeLabel: type === "spelling" ? "拼写回忆" : meaningToWord ? "看义选词" : "看词选义",
      prompt: meaningToWord ? asText(word.meaning) : asText(word.word),
      promptHint: type === "spelling" ? "输入对应英文" : meaningToWord ? "选择对应英文" : "选择最合适的中文释义",
      answer,
      options: type === "choice" ? options : [],
    };
  });
};

module.exports = {
  buildChallengeQuestions,
  isWeakWord,
  normalizeAnswer,
  selectChallengeWords,
  shuffle,
  uniqueWords,
};
