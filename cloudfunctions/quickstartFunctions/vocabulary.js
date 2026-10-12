const crypto = require("crypto");
const vocabularyAudioManifest = require("./data/vocabulary-audio-sprites.json");

const VOCABULARY_CANDIDATES_VERSION = 3;
const VOCABULARY_PROFILE_VERSION = 5;
const DEFAULT_DAILY_GOAL = 8;
const MIN_DAILY_GOAL = 5;
const MAX_DAILY_GOAL = 30;
const MAX_CANDIDATES_PER_MISTAKE = 40;
const MAX_EXPLICIT_VOCABULARY_WORDS = 200;
const LEARNING_DAY_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SRS_INTERVALS_MS = [
  10 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
];

const COMMON_STRUCTURE_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "from", "by", "with",
  "as", "if", "then", "than", "this", "that", "these", "those", "there", "here", "it", "its",
  "is", "are", "am", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has",
  "had", "not", "no", "yes", "choose", "circle", "complete", "listen", "number", "pdf", "question",
  "answer", "iii", "iv", "vi", "vii", "viii", "ix", "v-ing",
]);

const IGNORED_CANDIDATE_WORDS = new Set([
  "studentanswer", "timmy", "jim", "mike", "benjamin", "jerry", "sally", "sth", "ing",
  "lead-led", "i'd", "i'm", "state's", "one's",
]);

const BASIC_WORD_KEYS = new Set([
  "about", "after", "again", "all", "always", "another", "answer", "ask", "back", "beautiful",
  "before", "best", "better", "big", "bird", "birds", "boat", "but", "buy", "can", "can't", "child", "children",
  "class", "clothes", "come", "country", "day", "do", "doing", "don't", "down", "each", "english",
  "easy", "even", "every", "exercise", "fast", "feel", "find", "food", "friend", "friends", "give", "go",
  "goes", "good", "grade", "great", "happy", "help", "home", "hot", "house", "how", "keep", "kind",
  "know", "language", "last", "late", "learn", "left", "life", "like", "living", "long", "look", "looks",
  "lose", "lost", "made", "make", "makes", "man", "many",
  "model", "more", "most", "much", "must", "mustn't", "name", "names", "need", "new", "next", "no",
  "nice", "now", "office", "often", "old", "only", "other", "others", "out", "over", "parent", "parents",
  "pass", "photo", "photos", "please", "question", "questions", "read", "remember", "room", "same",
  "saw", "school", "second", "shop", "should", "some", "song", "songs", "sorry", "start", "stop",
  "student", "sun", "take", "test", "thank", "they", "thing", "things", "think", "time", "today",
  "travel", "tree", "trip", "use", "useful", "very", "village", "wait", "want", "wants", "way",
  "week", "will", "winter", "woman", "would", "young",
]);

const INSTRUCTION_PATTERNS = [
  /\blisten\s+and\s+choose\b/gi,
  /\blisten\s+and\s+circle\b/gi,
  /\blisten\s+and\s+number\b/gi,
  /\bread\s+and\s+choose\b/gi,
  /\bread\s+and\s+complete\b/gi,
  /\bread\s+and\s+match\b/gi,
];

let cachedLibrary = null;

const asText = (value) => String(value === undefined || value === null ? "" : value).trim();

const normalizeEnglishText = (value) => {
  return asText(value)
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .toLowerCase()
    .replace(/[^a-z'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-'\s]+|[-'\s]+$/g, "");
};

const normalizeWordKey = (value) => normalizeEnglishText(value).slice(0, 80);
const VOCABULARY_AUDIO_SPRITE_BY_ID = new Map(
  (vocabularyAudioManifest.sprites || []).map((item) => [
    String(item.id || ""),
    {
      fileId: String(item.fileId || ""),
      cloudPath: String(item.cloudPath || ""),
    },
  ])
);
const VOCABULARY_AUDIO_BY_KEY = new Map(
  (vocabularyAudioManifest.items || []).map((item) => {
    const sprite = VOCABULARY_AUDIO_SPRITE_BY_ID.get(String(item.spriteId || "")) || {};
    return [
      normalizeWordKey(item.key),
      {
        fileId: sprite.fileId || "",
        cloudPath: sprite.cloudPath || "",
        startMs: Math.max(0, Number(item.startMs) || 0),
        durationMs: Math.max(0, Number(item.durationMs) || 0),
        directFileId: String(item.directFileId || ""),
        directCloudPath: String(item.directCloudPath || ""),
        directDurationMs: Math.max(0, Number(item.directDurationMs) || 0),
      },
    ];
  })
);

const getVocabularyAudioInfo = (value) => (
  VOCABULARY_AUDIO_BY_KEY.get(normalizeWordKey(value))
  || {
    fileId: "",
    cloudPath: "",
    startMs: 0,
    durationMs: 0,
    directFileId: "",
    directCloudPath: "",
    directDurationMs: 0,
  }
);

const getVocabularyPronunciationFields = (value) => {
  const audio = getVocabularyAudioInfo(value);
  return {
    pronunciationFileId: audio.fileId,
    pronunciationStartMs: audio.startMs,
    pronunciationDurationMs: audio.durationMs,
    pronunciationDirectFileId: audio.directFileId,
    pronunciationDirectDurationMs: audio.directDurationMs,
  };
};

const isBasicWordKey = (key) => {
  if (!key) return false;
  if (BASIC_WORD_KEYS.has(key) || COMMON_STRUCTURE_WORDS.has(key)) return true;
  const roots = [];
  if (key.endsWith("ies") && key.length > 4) roots.push(`${key.slice(0, -3)}y`);
  if (key.endsWith("ing") && key.length > 5) {
    roots.push(key.slice(0, -3), `${key.slice(0, -3)}e`);
    if (/([a-z])\1ing$/.test(key)) roots.push(key.slice(0, -4));
  }
  if (key.endsWith("ied") && key.length > 4) roots.push(`${key.slice(0, -3)}y`);
  if (key.endsWith("ed") && key.length > 4) roots.push(key.slice(0, -2), key.slice(0, -1));
  if (key.endsWith("est") && key.length > 5) roots.push(key.slice(0, -3));
  if (key.endsWith("er") && key.length > 4) roots.push(key.slice(0, -2));
  if (key.endsWith("es") && key.length > 4) roots.push(key.slice(0, -2), key.slice(0, -1));
  if (key.endsWith("s") && key.length > 3) roots.push(key.slice(0, -1));
  return roots.some((root) => BASIC_WORD_KEYS.has(root) || COMMON_STRUCTURE_WORDS.has(root));
};

const normalizeVocabularyWords = (value) => {
  const items = Array.isArray(value) ? value : [];
  const result = [];
  const itemByKey = new Map();
  items.slice(0, MAX_EXPLICIT_VOCABULARY_WORDS).forEach((item) => {
    const source = item && typeof item === "object" ? item : { word: item };
    const key = normalizeWordKey(source.key || source.word);
    if (!key) return;
    const meaningText = asText(source.meaning).slice(0, 200);
    const normalized = {
      key,
      word: asText(source.word || source.key || key).slice(0, 80),
      meaning: meaningText.indexOf("待确认") >= 0 ? "" : meaningText,
      partOfSpeech: asText(source.partOfSpeech).slice(0, 50),
    };
    const existing = itemByKey.get(key);
    if (existing) {
      if (!existing.meaning && normalized.meaning) existing.meaning = normalized.meaning;
      if (!existing.partOfSpeech && normalized.partOfSpeech) existing.partOfSpeech = normalized.partOfSpeech;
      return;
    }
    itemByKey.set(key, normalized);
    result.push(normalized);
  });
  return result;
};

const normalizeLevel = (level, index) => {
  const source = level || {};
  const id = asText(source.id || source.key || source.levelId || `level-${index + 1}`);
  return {
    id,
    label: asText(source.label || source.name || source.title || id),
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index + 1,
    collectionId: asText(source.collectionId),
    collectionLabel: asText(source.collectionLabel),
    edition: asText(source.edition),
    grade: Number.isFinite(Number(source.grade)) ? Number(source.grade) : 0,
    semester: asText(source.semester),
    bookTitle: asText(source.bookTitle),
    isbn: asText(source.isbn),
    isTextbook: source.isTextbook === true,
    isReferenceOnly: source.isReferenceOnly === true,
    sourceRef: asText(source.sourceRef),
  };
};

const normalizeLibraryWord = (word, index) => {
  const source = word || {};
  const key = normalizeWordKey(source.key || source.word);
  return {
    key,
    word: asText(source.word || source.key || key),
    meaning: asText(source.meaning),
    partOfSpeech: asText(source.partOfSpeech),
    levelId: asText(source.levelId),
    unitId: asText(source.unitId),
    unitLabel: asText(source.unitLabel),
    isBasic: source.isBasic === true || isBasicWordKey(key),
    sourceRef: asText(source.sourceRef),
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index + 1,
  };
};

const normalizeLibrary = (rawLibrary) => {
  const source = rawLibrary || {};
  const levels = (Array.isArray(source.levels) ? source.levels : [])
    .map(normalizeLevel)
    .filter((level) => level.id)
    .sort((a, b) => a.order - b.order);
  const levelIds = new Set(levels.map((level) => level.id));
  const levelOrderById = new Map(levels.map((level) => [level.id, level.order]));
  const words = (Array.isArray(source.words) ? source.words : [])
    .map(normalizeLibraryWord)
    .filter((word) => word.key && levelIds.has(word.levelId))
    .sort((a, b) => {
      const levelDiff = (levelOrderById.get(a.levelId) || 0) - (levelOrderById.get(b.levelId) || 0);
      return levelDiff || a.order - b.order;
    });
  return { levels, words };
};

const loadVocabularyLibrary = () => {
  if (cachedLibrary) return cachedLibrary;
  const rawLibrary = { levels: [], words: [] };
  [
    "./data/primary-beginner-words.json",
    "./data/primary-1-3-words.json",
    "./data/molly-ket-a2-words.json",
    "./data/yilin-junior-2024-7a-words.json",
    "./data/mistake-word-lexicon.json",
  ].forEach((dataPath) => {
    try {
      const source = require(dataPath);
      rawLibrary.levels.push(...(Array.isArray(source.levels) ? source.levels : []));
      rawLibrary.words.push(...(Array.isArray(source.words) ? source.words : []));
    } catch (err) {
      if (!err || err.code !== "MODULE_NOT_FOUND") throw err;
    }
  });
  cachedLibrary = normalizeLibrary(rawLibrary);
  return cachedLibrary;
};

const isMolly = (student) => {
  const source = student || {};
  return asText(source.name).toLowerCase() === "molly";
};

const isXuHaocheng = (student) => {
  const source = student || {};
  return asText(source.name) === "徐浩成";
};

const getRecommendedVocabularySettings = (student, library = loadVocabularyLibrary()) => {
  if (isMolly(student)) {
    return {
      profileVersion: VOCABULARY_PROFILE_VERSION,
      levelIds: ["molly-ket-a2-16w"],
      dailyGoal: 8,
      includeMistakeWords: false,
      hideBasicWords: false,
      learningOrder: "book",
      disabledUnitIds: [],
    };
  }
  if (isXuHaocheng(student)) {
    return {
      profileVersion: VOCABULARY_PROFILE_VERSION,
      levelIds: ["yilin-2024-7A"],
      dailyGoal: 10,
      includeMistakeWords: true,
      hideBasicWords: false,
      learningOrder: "book",
      disabledUnitIds: [],
    };
  }
  const levelIds = library.levels
    .filter((level) => !level.isReferenceOnly)
    .filter((level) => /^([123][AB])$/.test(level.id))
    .map((level) => level.id);
  return {
    profileVersion: VOCABULARY_PROFILE_VERSION,
    levelIds,
    dailyGoal: DEFAULT_DAILY_GOAL,
    includeMistakeWords: true,
    hideBasicWords: false,
    learningOrder: "smart",
    disabledUnitIds: [],
  };
};

const getDefaultVocabularySettings = (library = loadVocabularyLibrary(), student) => {
  return getRecommendedVocabularySettings(student, library);
};

const normalizeVocabularySettings = (settings, library = loadVocabularyLibrary(), student) => {
  const defaults = getRecommendedVocabularySettings(student, library);
  const source = settings && typeof settings === "object" ? settings : {};
  const validLevelIds = new Set(library.levels.filter((level) => !level.isReferenceOnly).map((level) => level.id));
  const sourceLevelIds = Array.isArray(source.levelIds) ? source.levelIds.map(asText) : [];
  let levelIds = Array.isArray(source.levelIds)
    ? Array.from(new Set(source.levelIds.map(asText).filter((id) => validLevelIds.has(id))))
    : defaults.levelIds;
  const needsRemovedYilinMigration = sourceLevelIds.some((id) => id.indexOf("yilin-old-") === 0)
    && !levelIds.length;
  if (needsRemovedYilinMigration) levelIds = defaults.levelIds;
  const needsMollyMigration = isMolly(student)
    && Number(source.profileVersion || 0) < VOCABULARY_PROFILE_VERSION
    && levelIds.indexOf("molly-ket-a2-16w") < 0;
  if (needsMollyMigration) levelIds = defaults.levelIds;
  const needsXuHaochengMigration = isXuHaocheng(student)
    && Number(source.profileVersion || 0) < VOCABULARY_PROFILE_VERSION
    && levelIds.indexOf("yilin-2024-7A") < 0;
  if (needsXuHaochengMigration) levelIds = defaults.levelIds;
  const selectedLevels = new Set(levelIds);
  const validUnitIds = new Set(
    library.words
      .filter((word) => selectedLevels.has(word.levelId) && word.unitId)
      .map((word) => word.unitId)
  );
  const disabledUnitIds = Array.isArray(source.disabledUnitIds)
    && !needsXuHaochengMigration
    && !needsRemovedYilinMigration
    ? Array.from(new Set(source.disabledUnitIds.map(asText).filter((id) => validUnitIds.has(id))))
    : defaults.disabledUnitIds;
  const goal = needsXuHaochengMigration ? defaults.dailyGoal : Number(source.dailyGoal);
  const learningOrder = !needsXuHaochengMigration
    && ["smart", "book", "mistakeFirst"].indexOf(source.learningOrder) >= 0
    ? source.learningOrder
    : defaults.learningOrder;
  return {
    profileVersion: VOCABULARY_PROFILE_VERSION,
    levelIds,
    dailyGoal: Number.isInteger(goal) && goal >= MIN_DAILY_GOAL && goal <= MAX_DAILY_GOAL
      ? goal
      : defaults.dailyGoal,
    includeMistakeWords: needsXuHaochengMigration
      ? defaults.includeMistakeWords
      : source.includeMistakeWords !== false,
    hideBasicWords: !needsXuHaochengMigration && typeof source.hideBasicWords === "boolean"
      ? source.hideBasicWords
      : defaults.hideBasicWords,
    learningOrder,
    disabledUnitIds,
  };
};

const buildVocabularyCatalog = ({ library = loadVocabularyLibrary(), settings = {} } = {}) => {
  const selectedLevelIds = new Set(
    Array.isArray(settings.levelIds) ? settings.levelIds.map(asText).filter(Boolean) : []
  );
  const groups = new Map();
  const disabledUnitIds = new Set(
    Array.isArray(settings.disabledUnitIds) ? settings.disabledUnitIds.map(asText).filter(Boolean) : []
  );
  (library.levels || [])
    .filter((level) => !level.isReferenceOnly && selectedLevelIds.has(level.id))
    .forEach((level) => {
      const id = level.collectionId || level.id;
      if (!groups.has(id)) {
        groups.set(id, {
          id,
          label: level.collectionLabel || level.label || id,
          edition: level.edition || "",
          isTextbook: level.isTextbook === true,
          order: Number(level.order || 0),
          levelIds: [],
          levelLabels: [],
          bookTitles: [],
          wordKeys: new Set(),
          enabledWordKeys: new Set(),
          unitIds: new Set(),
          enabledUnitIds: new Set(),
        });
      }
      const group = groups.get(id);
      group.order = Math.min(group.order, Number(level.order || group.order || 0));
      group.isTextbook = group.isTextbook || level.isTextbook === true;
      group.levelIds.push(level.id);
      group.levelLabels.push(level.label || level.id);
      if (level.bookTitle && group.bookTitles.indexOf(level.bookTitle) < 0) {
        group.bookTitles.push(level.bookTitle);
      }
    });
  const groupByLevelId = new Map();
  groups.forEach((group) => {
    group.levelIds.forEach((levelId) => groupByLevelId.set(levelId, group));
  });
  (library.words || []).forEach((word) => {
    const group = groupByLevelId.get(word.levelId);
    if (!group || !word.key) return;
    group.wordKeys.add(word.key);
    if (word.unitId) group.unitIds.add(word.unitId);
    if (!word.unitId || !disabledUnitIds.has(word.unitId)) {
      group.enabledWordKeys.add(word.key);
      if (word.unitId) group.enabledUnitIds.add(word.unitId);
    }
  });
  return Array.from(groups.values())
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    .map((group) => ({
      id: group.id,
      label: group.label,
      edition: group.edition,
      isTextbook: group.isTextbook,
      levelIds: group.levelIds,
      levelLabels: group.levelLabels,
      bookTitles: group.bookTitles,
      wordCount: group.wordKeys.size,
      enabledWordCount: group.enabledWordKeys.size,
      unitCount: group.unitIds.size,
      enabledUnitCount: group.enabledUnitIds.size,
    }));
};

const getLearningDay = (nowMs = Date.now()) => (
  Math.floor((Number(nowMs) + LEARNING_DAY_OFFSET_MS) / DAY_MS)
);

const normalizeVocabularyDailyPlan = (plan, defaultGoal, nowMs = Date.now()) => {
  const learningDay = getLearningDay(nowMs);
  const fallbackGoal = Number.isInteger(Number(defaultGoal))
    && Number(defaultGoal) >= MIN_DAILY_GOAL
    && Number(defaultGoal) <= MAX_DAILY_GOAL
    ? Number(defaultGoal)
    : DEFAULT_DAILY_GOAL;
  const source = plan && typeof plan === "object" ? plan : {};
  const requestedGoal = Number(source.dailyGoal);
  const hasStudentChoice = Number(source.learningDay) === learningDay
    && Number.isInteger(requestedGoal)
    && requestedGoal >= MIN_DAILY_GOAL
    && requestedGoal <= MAX_DAILY_GOAL;
  return {
    learningDay,
    dailyGoal: hasStudentChoice ? requestedGoal : fallbackGoal,
    defaultGoal: fallbackGoal,
    hasStudentChoice,
    selectedAtMs: hasStudentChoice ? Number(source.selectedAtMs || 0) : 0,
  };
};

const getProgressDocumentId = (studentId, wordKey) => {
  return crypto
    .createHash("sha1")
    .update(`${asText(studentId)}\n${normalizeWordKey(wordKey)}`)
    .digest("hex");
};

const getKnownWordKeys = (library) => {
  return new Set((library.words || []).map((word) => word.key));
};

const extractVocabularyCandidates = (mistake, library = loadVocabularyLibrary()) => {
  const source = mistake || {};
  const knownWordKeys = getKnownWordKeys(library);
  const questionType = asText(source.questionType);
  const skipGroupedQuestionText = /整篇|整组|阅读|完形|写作|短文|文章/.test(questionType);
  const rawTags = Array.isArray(source.skillTags)
    ? source.skillTags
    : Array.isArray(source.tags)
      ? source.tags
      : [];
  const tagText = rawTags.join(" ");
  const phraseKeys = Array.from(knownWordKeys)
    .filter((key) => key.indexOf(" ") >= 0)
    .sort((a, b) => b.length - a.length);
  const candidates = [];
  const seen = new Set();
  let automaticCandidateCount = 0;
  const addCandidate = (value, isExplicit) => {
    const key = normalizeWordKey(value);
    if (!key || seen.has(key) || IGNORED_CANDIDATE_WORDS.has(key)) return;
    if (!isExplicit && automaticCandidateCount >= MAX_CANDIDATES_PER_MISTAKE) return;
    seen.add(key);
    candidates.push(key);
    if (!isExplicit) automaticCandidateCount += 1;
  };

  normalizeVocabularyWords(source.vocabularyWords).forEach((item) => addCandidate(item.key, true));

  [
    { value: source.correctAnswer, isQuestionText: false },
    { value: source.studentAnswer, isQuestionText: false },
    { value: source.explanation, isQuestionText: false },
    { value: tagText, isQuestionText: false },
    { value: skipGroupedQuestionText ? "" : source.questionText, isQuestionText: true },
  ].forEach((field) => {
    let original = asText(field.value);
    if (!original || original.indexOf("待确认") >= 0 || automaticCandidateCount >= MAX_CANDIDATES_PER_MISTAKE) return;
    if (field.isQuestionText) {
      original = original.replace(/^\s*[IVXLCDM]+(?:[-（(][^）)]*[）)])?\s*[.。]\s*/i, "");
    }
    INSTRUCTION_PATTERNS.forEach((pattern) => {
      original = original.replace(pattern, " ");
    });
    let normalizedText = normalizeEnglishText(original);
    if (!normalizedText) return;

    phraseKeys.forEach((phraseKey) => {
      const paddedText = ` ${normalizedText} `;
      const paddedPhrase = ` ${phraseKey} `;
      if (paddedText.indexOf(paddedPhrase) < 0) return;
      addCandidate(phraseKey, false);
      normalizedText = normalizedText.split(phraseKey).join(" ").replace(/\s+/g, " ").trim();
    });

    const tokens = normalizedText.match(/[a-z]+(?:['-][a-z]+)*/g) || [];
    tokens.forEach((token) => {
      const key = normalizeWordKey(token);
      if (!key) return;
      if (knownWordKeys.has(key)) {
        addCandidate(key, false);
        return;
      }
      if (key.length < 3 || /^[a-d]$/.test(key) || COMMON_STRUCTURE_WORDS.has(key)) return;
      addCandidate(key, false);
    });
  });

  return candidates;
};

const getStoredVocabularyCandidates = (mistake, library = loadVocabularyLibrary()) => {
  const source = mistake || {};
  if (
    Number(source.vocabularyCandidatesVersion) === VOCABULARY_CANDIDATES_VERSION
    && Array.isArray(source.vocabularyCandidates)
  ) {
    return Array.from(new Set(source.vocabularyCandidates.map(normalizeWordKey).filter((key) => key)));
  }
  return extractVocabularyCandidates(source, library);
};

const clampStage = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(5, Math.trunc(number)));
};

const getProgressLabel = (stage) => {
  if (stage >= 5) return "已掌握";
  if (stage > 0) return "学习中";
  return "未学习";
};

const isVocabularyWeakWord = (word) => {
  const source = word || {};
  if (source.isEasy === true) return false;
  const lastResult = asText(source.lastResult);
  const wrongCount = Math.max(0, Number(source.wrongCount || 0));
  const correctCount = Math.max(0, Number(source.correctCount || 0));
  return lastResult === "forgot"
    || lastResult === "hard"
    || lastResult === "quizWrong"
    || (wrongCount >= 2 && wrongCount >= correctCount);
};

const getSourceLabel = (sources) => {
  const hasMistake = sources.indexOf("mistake") >= 0;
  const hasLibrary = sources.indexOf("library") >= 0;
  const hasTextbook = sources.indexOf("textbook") >= 0;
  if (hasMistake && hasTextbook) return "错题单词 · 课本词库";
  if (hasMistake && hasLibrary) return "错题单词 · 基础词库";
  if (hasMistake) return "错题单词";
  return hasTextbook ? "课本词库" : "基础词库";
};

const getMistakeSourceText = (mistake) => {
  return asText(mistake.questionText || mistake.explanation || mistake.correctAnswer || mistake.studentAnswer).slice(0, 240);
};

const buildVocabularyView = ({
  library = loadVocabularyLibrary(),
  settings,
  mistakes,
  progressItems,
  isTeacher,
  nowMs = Date.now(),
  student,
}) => {
  const normalizedSettings = normalizeVocabularySettings(settings, library, student);
  const currentLearningDay = getLearningDay(nowMs);
  const selectedLevels = new Set(normalizedSettings.levelIds);
  const disabledUnitIds = new Set(normalizedSettings.disabledUnitIds || []);
  const beginnerOnly = selectedLevels.size === 1 && selectedLevels.has("0A");
  const levelById = new Map(library.levels.map((level) => [level.id, level]));
  const libraryWordByKey = new Map();
  library.words.forEach((word) => {
    if (!libraryWordByKey.has(word.key)) libraryWordByKey.set(word.key, word);
  });
  const itemByKey = new Map();

  library.words.forEach((libraryWord) => {
    if (!selectedLevels.has(libraryWord.levelId)) return;
    if (libraryWord.unitId && disabledUnitIds.has(libraryWord.unitId)) return;
    const existing = itemByKey.get(libraryWord.key);
    if (existing) {
      if (existing.levelIds.indexOf(libraryWord.levelId) < 0) existing.levelIds.push(libraryWord.levelId);
      if (libraryWord.unitId && existing.unitIds.indexOf(libraryWord.unitId) < 0) {
        existing.unitIds.push(libraryWord.unitId);
      }
      if (libraryWord.unitLabel && existing.unitLabels.indexOf(libraryWord.unitLabel) < 0) {
        existing.unitLabels.push(libraryWord.unitLabel);
      }
      if (!existing.meaning && libraryWord.meaning) existing.meaning = libraryWord.meaning;
      if (!existing.partOfSpeech && libraryWord.partOfSpeech) existing.partOfSpeech = libraryWord.partOfSpeech;
      existing.isBasic = existing.isBasic && libraryWord.isBasic;
      return;
    }
    const level = levelById.get(libraryWord.levelId) || {};
    const sourceKind = level.isTextbook ? "textbook" : "library";
    itemByKey.set(libraryWord.key, {
      key: libraryWord.key,
      word: libraryWord.word || libraryWord.key,
      meaning: libraryWord.meaning || "",
      partOfSpeech: libraryWord.partOfSpeech || "",
      levelId: libraryWord.levelId,
      levelIds: [libraryWord.levelId],
      levelLabel: level.label || "",
      bookLabel: level.bookTitle || level.label || "",
      collectionLabel: level.collectionLabel || "",
      edition: level.edition || "",
      unitId: libraryWord.unitId || "",
      unitIds: libraryWord.unitId ? [libraryWord.unitId] : [],
      unitLabel: libraryWord.unitLabel || "",
      unitLabels: libraryWord.unitLabel ? [libraryWord.unitLabel] : [],
      isTextbook: level.isTextbook === true,
      isBasic: libraryWord.isBasic === true,
      sources: [sourceKind],
      sourceMistakeId: "",
      sourceQuestionNo: "",
      sourceText: "",
      occurrenceCount: 0,
      sortOrder: (Number(level.order) || 0) * 1000 + libraryWord.order,
      ...getVocabularyPronunciationFields(libraryWord.key),
    });
  });

  if (normalizedSettings.includeMistakeWords) {
    (mistakes || []).forEach((mistake, mistakeIndex) => {
      const explicitWordByKey = new Map(
        normalizeVocabularyWords(mistake.vocabularyWords).map((item) => [item.key, item])
      );
      getStoredVocabularyCandidates(mistake, library).forEach((key) => {
        let item = itemByKey.get(key);
        const explicitWord = explicitWordByKey.get(key);
        const libraryMatch = libraryWordByKey.get(key);
        const matchedLevel = libraryMatch ? levelById.get(libraryMatch.levelId) || {} : {};
        if (!item) {
          item = {
            key,
            word: explicitWord ? explicitWord.word : libraryMatch ? libraryMatch.word : key,
            meaning: explicitWord && explicitWord.meaning
              ? explicitWord.meaning
              : libraryMatch ? libraryMatch.meaning : "",
            partOfSpeech: explicitWord && explicitWord.partOfSpeech
              ? explicitWord.partOfSpeech
              : libraryMatch ? libraryMatch.partOfSpeech : "",
            levelId: libraryMatch && !matchedLevel.isReferenceOnly ? libraryMatch.levelId : "",
            levelIds: libraryMatch && !matchedLevel.isReferenceOnly ? [libraryMatch.levelId] : [],
            levelLabel: libraryMatch && !matchedLevel.isReferenceOnly ? matchedLevel.label || "" : "",
            bookLabel: libraryMatch && !matchedLevel.isReferenceOnly
              ? matchedLevel.bookTitle || matchedLevel.label || ""
              : "",
            collectionLabel: libraryMatch && !matchedLevel.isReferenceOnly ? matchedLevel.collectionLabel || "" : "",
            edition: libraryMatch && !matchedLevel.isReferenceOnly ? matchedLevel.edition || "" : "",
            unitId: libraryMatch ? libraryMatch.unitId || "" : "",
            unitIds: libraryMatch && libraryMatch.unitId ? [libraryMatch.unitId] : [],
            unitLabel: libraryMatch ? libraryMatch.unitLabel || "" : "",
            unitLabels: libraryMatch && libraryMatch.unitLabel ? [libraryMatch.unitLabel] : [],
            isTextbook: libraryMatch ? matchedLevel.isTextbook === true : false,
            isBasic: libraryMatch ? libraryMatch.isBasic === true : isBasicWordKey(key),
            sources: [],
            sourceMistakeId: "",
            sourceQuestionNo: "",
            sourceText: "",
            occurrenceCount: 0,
            sortOrder: 100000 + mistakeIndex,
            ...getVocabularyPronunciationFields(key),
          };
          itemByKey.set(key, item);
        } else if (explicitWord) {
          if (explicitWord.word) item.word = explicitWord.word;
          if (explicitWord.meaning) item.meaning = explicitWord.meaning;
          if (explicitWord.partOfSpeech) item.partOfSpeech = explicitWord.partOfSpeech;
        }
        if (libraryMatch && !matchedLevel.isReferenceOnly) {
          const sourceKind = matchedLevel.isTextbook ? "textbook" : "library";
          if (item.sources.indexOf(sourceKind) < 0) item.sources.push(sourceKind);
        }
        if (item.sources.indexOf("mistake") < 0) item.sources.push("mistake");
        item.occurrenceCount += 1;
        if (!item.sourceMistakeId) {
          item.sourceMistakeId = asText(mistake._id);
          item.sourceQuestionNo = asText(mistake.questionNo);
          item.sourceText = getMistakeSourceText(mistake);
        }
      });
    });
  }

  const progressByKey = new Map();
  (progressItems || []).forEach((progress) => {
    const key = normalizeWordKey(progress.wordKey);
    if (key) progressByKey.set(key, progress);
  });

  const confirmedWords = [];
  const pendingWords = [];
  itemByKey.forEach((baseItem, key) => {
    const progress = progressByKey.get(key) || {};
    if (progress.excluded === true) return;
    const stage = clampStage(progress.stage);
    const nextReviewAtMs = Number(progress.nextReviewAtMs) || 0;
    const lastReviewedAtMs = Number(progress.lastReviewedAtMs) || 0;
    const customMeaning = Object.prototype.hasOwnProperty.call(progress, "customMeaning")
      ? asText(progress.customMeaning)
      : "";
    const customPartOfSpeech = Object.prototype.hasOwnProperty.call(progress, "customPartOfSpeech")
      ? asText(progress.customPartOfSpeech)
      : "";
    const meaning = customMeaning || baseItem.meaning || "";
    const item = Object.assign({}, baseItem, {
      meaning,
      partOfSpeech: customPartOfSpeech || baseItem.partOfSpeech || "",
      sourceLabel: getSourceLabel(baseItem.sources),
      masteryLevel: stage,
      progressLabel: getProgressLabel(stage),
      nextReviewAtMs,
      lastReviewedAtMs,
      lastResult: asText(progress.lastResult),
      reviewCount: Number(progress.reviewCount || 0),
      correctCount: Number(progress.correctCount || 0),
      wrongCount: Number(progress.wrongCount || 0),
      isEasy: progress.isEasy === true,
      isBasicHidden: normalizedSettings.hideBasicWords === true
        && baseItem.isBasic === true
        && baseItem.levelIds.indexOf("0A") < 0,
      isDue: !nextReviewAtMs || nextReviewAtMs <= nowMs,
      reviewedToday: lastReviewedAtMs > 0
        && Math.floor((lastReviewedAtMs + LEARNING_DAY_OFFSET_MS) / DAY_MS) === currentLearningDay,
    });
    if (!meaning) {
      if (isTeacher) pendingWords.push(item);
      return;
    }
    confirmedWords.push(item);
  });

  const wordSort = (a, b) => {
    if (!beginnerOnly) {
      const sourceDiff = Number(b.sources.indexOf("mistake") >= 0) - Number(a.sources.indexOf("mistake") >= 0);
      if (sourceDiff) return sourceDiff;
    }
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.word.localeCompare(b.word, "en");
  };
  confirmedWords.sort(wordSort);
  pendingWords.sort(wordSort);

  const studyWords = confirmedWords.filter((item) => !item.isEasy && !item.isBasicHidden);
  const dueWords = studyWords.filter((item) => item.isDue).sort((a, b) => {
    const aNext = a.nextReviewAtMs || Number.MAX_SAFE_INTEGER;
    const bNext = b.nextReviewAtMs || Number.MAX_SAFE_INTEGER;
    if (aNext !== bNext) return aNext - bNext;
    return wordSort(a, b);
  });
  const reviewedTodayWords = confirmedWords
    .filter((item) => item.reviewedToday)
    .sort((a, b) => a.lastReviewedAtMs - b.lastReviewedAtMs || wordSort(a, b));
  const reviewedTodayKeys = new Set(reviewedTodayWords.map((item) => item.key));
  const retainedReviewedWords = reviewedTodayWords;
  const remainingSlots = Math.max(0, normalizedSettings.dailyGoal - retainedReviewedWords.length);
  const newDueWords = dueWords.filter((item) => !reviewedTodayKeys.has(item.key));
  const todayWords = retainedReviewedWords.concat(newDueWords.slice(0, remainingSlots));
  const todayReviewedCount = retainedReviewedWords.length;
  const summary = {
    totalCount: confirmedWords.length,
    totalWords: confirmedWords.length,
    libraryWordCount: confirmedWords.filter((item) => item.sources.indexOf("library") >= 0).length,
    textbookWordCount: confirmedWords.filter((item) => item.sources.indexOf("textbook") >= 0).length,
    mistakeWordCount: confirmedWords.filter((item) => item.sources.indexOf("mistake") >= 0).length,
    weakCount: confirmedWords.filter((item) => isVocabularyWeakWord(item)).length,
    masteredCount: confirmedWords.filter((item) => item.masteryLevel >= 5).length,
    strictMasteredCount: confirmedWords.filter((item) => item.masteryLevel >= 5 && !item.isEasy).length,
    learningCount: confirmedWords.filter((item) => item.masteryLevel > 0 && item.masteryLevel < 5).length,
    activeLearningCount: confirmedWords.filter((item) => (
      item.reviewCount > 0 && !item.isDue && item.masteryLevel < 5 && !item.isEasy
    )).length,
    unlearnedCount: confirmedWords.filter((item) => item.masteryLevel <= 0 && !item.isEasy && item.reviewCount <= 0).length,
    reviewDueCount: confirmedWords.filter((item) => (
      item.reviewCount > 0 && item.isDue && item.masteryLevel < 5 && !item.isEasy
    )).length,
    dueCount: dueWords.length,
    pendingCount: isTeacher ? pendingWords.length : 0,
    easyCount: confirmedWords.filter((item) => item.isEasy).length,
    basicHiddenCount: confirmedWords.filter((item) => item.isBasicHidden && !item.isEasy).length,
    dailyGoal: normalizedSettings.dailyGoal,
    todayCount: todayWords.length,
    todayReviewedCount,
    todayRemainingCount: todayWords.filter((item) => item.isDue).length,
  };

  return {
    settings: normalizedSettings,
    summary,
    todayWords,
    todayReviewedWords: reviewedTodayWords,
    words: confirmedWords,
    pendingWords: isTeacher ? pendingWords : [],
  };
};

const buildReviewProgress = (existing, result, nowMs = Date.now()) => {
  const current = existing || {};
  const currentStage = clampStage(current.stage);
  let nextStage = currentStage;
  if (result === "known") nextStage = Math.min(5, currentStage + 1);
  if (result === "forgot") nextStage = Math.max(0, currentStage - 2);
  if (result === "hard") nextStage = current.isEasy === true ? 2 : Math.max(0, currentStage);
  if (result === "easy") nextStage = 5;
  const nextIntervalMs = result === "forgot"
    ? SRS_INTERVALS_MS[0]
    : result === "hard"
      ? Math.max(30 * 60 * 1000, Math.floor(SRS_INTERVALS_MS[Math.max(0, nextStage)] / 2))
      : result === "easy"
        ? 90 * DAY_MS
        : SRS_INTERVALS_MS[nextStage];
  const isCorrect = result === "known" || result === "easy";
  return {
    stage: nextStage,
    status: getProgressLabel(nextStage),
    reviewCount: Number(current.reviewCount || 0) + 1,
    correctCount: Number(current.correctCount || 0) + (isCorrect ? 1 : 0),
    wrongCount: Number(current.wrongCount || 0) + (result === "forgot" ? 1 : 0),
    streak: isCorrect
      ? Number(current.streak || 0) + 1
      : result === "hard" && current.isEasy !== true ? Number(current.streak || 0) : 0,
    lastResult: result,
    isEasy: result === "easy",
    lastReviewedAtMs: nowMs,
    nextReviewAtMs: nowMs + nextIntervalMs,
  };
};

const normalizeQuizAnswerMode = (questionType, answerMode) => {
  const normalized = asText(answerMode);
  if (normalized === "choice" || normalized === "input") return normalized;
  return questionType === "wordToMeaning" || questionType === "meaningToWord"
    ? "choice"
    : "input";
};

// 客观小测与孩子自评使用不同的更新规则，避免选择题或重复刷题让等级虚高。
const buildQuizProgress = (existing, options = {}, nowMs = Date.now()) => {
  const current = existing || {};
  const correct = options.correct === true;
  const questionType = asText(options.questionType);
  const answerMode = normalizeQuizAnswerMode(questionType, options.answerMode);
  const learningDay = Number(options.learningDay || getLearningDay(nowMs));
  const strongRecall = answerMode === "input"
    && (questionType === "spelling" || questionType === "letterGap");
  const alreadyAdvancedToday = Number(current.lastQuizStageAdvancedLearningDay || 0) === learningDay;
  const currentStage = clampStage(current.stage);
  const nextStage = correct && strongRecall && !alreadyAdvancedToday
    ? Math.min(5, currentStage + 1)
    : correct
      ? currentStage
      : Math.max(0, currentStage - 1);
  const nextIntervalMs = correct
    ? SRS_INTERVALS_MS[nextStage]
    : SRS_INTERVALS_MS[0];
  return {
    stage: nextStage,
    status: getProgressLabel(nextStage),
    reviewCount: Number(current.reviewCount || 0) + 1,
    correctCount: Number(current.correctCount || 0) + (correct ? 1 : 0),
    wrongCount: Number(current.wrongCount || 0) + (correct ? 0 : 1),
    streak: correct ? Number(current.streak || 0) + 1 : 0,
    lastResult: correct ? "quizCorrect" : "quizWrong",
    isEasy: false,
    lastReviewedAtMs: nowMs,
    nextReviewAtMs: nowMs + nextIntervalMs,
    quizCorrectCount: Number(current.quizCorrectCount || 0) + (correct ? 1 : 0),
    quizWrongCount: Number(current.quizWrongCount || 0) + (correct ? 0 : 1),
    lastQuizAtMs: nowMs,
    lastQuizResult: correct ? "correct" : "wrong",
    lastQuizType: questionType,
    lastQuizAnswerMode: answerMode,
    lastQuizStageAdvancedLearningDay: correct && strongRecall && !alreadyAdvancedToday
      ? learningDay
      : Number(current.lastQuizStageAdvancedLearningDay || 0),
  };
};

module.exports = {
  VOCABULARY_CANDIDATES_VERSION,
  DEFAULT_DAILY_GOAL,
  MIN_DAILY_GOAL,
  MAX_DAILY_GOAL,
  VOCABULARY_PROFILE_VERSION,
  normalizeWordKey,
  getVocabularyAudioInfo,
  normalizeVocabularyWords,
  normalizeLibrary,
  loadVocabularyLibrary,
  getDefaultVocabularySettings,
  getRecommendedVocabularySettings,
  normalizeVocabularySettings,
  buildVocabularyCatalog,
  getLearningDay,
  normalizeVocabularyDailyPlan,
  normalizeQuizAnswerMode,
  getProgressDocumentId,
  extractVocabularyCandidates,
  getStoredVocabularyCandidates,
  buildVocabularyView,
  buildReviewProgress,
  buildQuizProgress,
  getProgressLabel,
  isVocabularyWeakWord,
};
