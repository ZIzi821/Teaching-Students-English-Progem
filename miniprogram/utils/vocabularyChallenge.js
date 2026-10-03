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
    || lastResult === "quizWrong"
    || source.lastQuizResult === "wrong"
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

const buildLetterCompletion = (value) => {
  const word = asText(value);
  const letterIndexes = [];
  word.split("").forEach((letter, index) => {
    if (/[a-z]/i.test(letter)) letterIndexes.push(index);
  });
  if (!letterIndexes.length) {
    return { prompt: word, answer: "" };
  }
  const hideCount = Math.max(1, Math.min(4, Math.ceil(letterIndexes.length / 3)));
  const hidden = new Set();
  for (let offset = 0; offset < hideCount; offset += 1) {
    const position = Math.floor((offset + 1) * letterIndexes.length / (hideCount + 1));
    hidden.add(letterIndexes[Math.min(letterIndexes.length - 1, position)]);
  }
  return {
    prompt: word.split("").map((letter, index) => hidden.has(index) ? "_" : letter).join(" "),
    answer: word.split("").filter((letter, index) => hidden.has(index) && /[a-z]/i.test(letter)).join(""),
  };
};

const buildLetterGap = (value) => buildLetterCompletion(value).prompt;

const buildLetterChoiceCandidates = (word, answer, pool) => {
  const normalizedAnswer = normalizeAnswer(answer).replace(/[^a-z]/g, "");
  if (!normalizedAnswer) return [];
  const candidates = [];
  (pool || []).forEach((item) => {
    const candidate = normalizeAnswer(buildLetterCompletion(item && item.word).answer)
      .replace(/[^a-z]/g, "");
    if (candidate.length === normalizedAnswer.length) candidates.push(candidate);
  });
  if (normalizedAnswer.length === 1) {
    asText(word).toLowerCase().split("").forEach((letter) => {
      if (/[a-z]/.test(letter)) candidates.push(letter);
    });
  }
  const uniqueCandidates = Array.from(new Set(candidates.filter((candidate) => (
    candidate && candidate !== normalizedAnswer
  ))));
  const replacements = "aeioubcdfghjklmnpqrstvwxyz";
  for (let position = 0; position < normalizedAnswer.length && uniqueCandidates.length < 3; position += 1) {
    for (let index = 0; index < replacements.length && uniqueCandidates.length < 3; index += 1) {
      const replacement = replacements[index];
      if (replacement === normalizedAnswer[position]) continue;
      const candidate = normalizedAnswer.split("");
      candidate[position] = replacement;
      const value = candidate.join("");
      if (!uniqueCandidates.includes(value)) uniqueCandidates.push(value);
    }
  }
  return uniqueCandidates;
};

const buildChallengeQuestions = (selectedWords, allWords, random = Math.random) => {
  const selected = uniqueWords(selectedWords);
  const pool = uniqueWords((allWords || []).concat(selected));
  return selected.map((word, index) => {
    const preferredType = ["wordToMeaning", "meaningToWord", "letterGap", "spelling"][index % 4];
    let type = preferredType;
    let answerMode = preferredType === "wordToMeaning" || preferredType === "meaningToWord"
      ? "choice"
      : "input";
    if (preferredType === "letterGap") {
      // 一轮常规小测有两道字母补全题：第一道填空，第二道选择。
      answerMode = Math.floor(index / 4) % 2 === 0 ? "input" : "choice";
    }
    const letterCompletion = buildLetterCompletion(word.word);
    let answer = type === "wordToMeaning"
      ? asText(word.meaning)
      : type === "letterGap"
        ? letterCompletion.answer
        : asText(word.word);
    let options = [];
    if (answerMode === "choice") {
      const candidateValues = type === "letterGap"
        ? buildLetterChoiceCandidates(word.word, answer, pool)
        : pool
          .filter((item) => asText(item.key || item.word) !== asText(word.key || word.word))
          .map((item) => type === "wordToMeaning" ? asText(item.meaning) : asText(item.word));
      options = buildChoiceOptions(answer, candidateValues, random);
    }
    if (!answer || (answerMode === "choice" && options.length < 2)) {
      type = "spelling";
      answerMode = "input";
      answer = asText(word.word);
      options = [];
    }
    const taskType = type === "letterGap"
      ? "letterCompletion"
      : type === "wordToMeaning"
        ? "wordMeaning"
        : "completeWord";
    const direction = type === "wordToMeaning" ? "wordToMeaning" : "meaningToWord";
    const typeLabel = type === "letterGap"
      ? `补全字母 · ${answerMode === "choice" ? "选择题" : "填空题"}`
      : type === "wordToMeaning"
        ? "单词释义 · 选择题"
        : `完整单词 · ${answerMode === "choice" ? "选择题" : "填空题"}`;
    const promptHint = type === "letterGap"
      ? answerMode === "choice"
        ? "选择按顺序缺少的字母"
        : "只填写按顺序缺少的字母，不要输入完整单词"
      : type === "wordToMeaning"
        ? "选择最合适的中文释义"
        : answerMode === "choice"
          ? "根据中文，选择完整的英文单词"
          : "根据中文，填写完整的英文单词";
    return {
      id: `${asText(word.key || word.word)}-${index}`,
      wordKey: asText(word.key || word.word),
      word: asText(word.word),
      meaning: asText(word.meaning),
      partOfSpeech: asText(word.partOfSpeech),
      sourceLabel: asText(word.sourceLabel),
      type,
      taskType,
      answerMode,
      direction,
      typeLabel,
      prompt: type === "letterGap"
        ? `${asText(word.meaning)}\n${letterCompletion.prompt}`
        : direction === "meaningToWord" ? asText(word.meaning) : asText(word.word),
      promptHint,
      inputPlaceholder: type === "letterGap" ? "只填缺少的字母" : "填写完整英文单词",
      emptyAnswerMessage: type === "letterGap" ? "请填写缺少的字母" : "请填写完整英文单词",
      feedbackAnswer: type === "letterGap"
        ? `缺少的字母：${answer} · 完整单词：${asText(word.word)} · ${asText(word.meaning)}`
        : `${asText(word.word)} · ${asText(word.meaning)}`,
      answer,
      options,
    };
  });
};

module.exports = {
  buildChallengeQuestions,
  buildLetterCompletion,
  buildLetterGap,
  isWeakWord,
  normalizeAnswer,
  selectChallengeWords,
  shuffle,
  uniqueWords,
};
