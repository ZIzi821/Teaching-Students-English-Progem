const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(
  root,
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "primary-beginner-words.json"
);

const words = [];
let order = 0;
const add = (item) => {
  order += 1;
  words.push(Object.assign({
    levelId: "0A",
    order,
    sourceRef: "教师自编英语启蒙词库 v1",
  }, item));
};

"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((letter) => {
  add({
    key: `letter-${letter.toLowerCase()}`,
    word: `${letter} ${letter.toLowerCase()}`,
    meaning: `字母 ${letter}`,
    partOfSpeech: "字母",
    unitId: "letters",
    unitLabel: "26 个英文字母",
    audioText: letter,
  });
});

[
  ["zero", "0", "零"], ["one", "1", "一"], ["two", "2", "二"],
  ["three", "3", "三"], ["four", "4", "四"], ["five", "5", "五"],
  ["six", "6", "六"], ["seven", "7", "七"], ["eight", "8", "八"],
  ["nine", "9", "九"], ["ten", "10", "十"], ["eleven", "11", "十一"],
  ["twelve", "12", "十二"], ["thirteen", "13", "十三"], ["fourteen", "14", "十四"],
  ["fifteen", "15", "十五"], ["sixteen", "16", "十六"], ["seventeen", "17", "十七"],
  ["eighteen", "18", "十八"], ["nineteen", "19", "十九"], ["twenty", "20", "二十"],
].forEach(([english, numeral, chinese], index) => {
  add({
    key: `number-${english}`,
    word: `${numeral} · ${english}`,
    meaning: `${chinese}；数字 ${numeral}`,
    partOfSpeech: "数词（num.）",
    unitId: index <= 10 ? "numbers-0-10" : "numbers-11-20",
    unitLabel: index <= 10 ? "数字 0–10" : "数字 11–20",
    audioText: english,
  });
});

[
  ["listen", "listen", "听", "动词（v.）"],
  ["look", "look", "看", "动词（v.）"],
  ["repeat", "repeat", "跟读；重复", "动词（v.）"],
  ["read", "read", "读", "动词（v.）"],
  ["say", "say", "说", "动词（v.）"],
  ["write", "write", "写", "动词（v.）"],
  ["open", "open", "打开", "动词（v.）"],
  ["close", "close", "关闭", "动词（v.）"],
  ["point", "point", "指一指", "动词（v.）"],
  ["match", "match", "连线；配对", "动词（v.）"],
  ["stand-up", "stand up", "起立", "课堂用语"],
  ["sit-down", "sit down", "坐下", "课堂用语"],
].forEach(([key, word, meaning, partOfSpeech]) => add({
  key, word, meaning, partOfSpeech, unitId: "classroom", unitLabel: "课堂动作", audioText: word,
}));

[
  ["hello", "你好"], ["hi", "嗨；你好"], ["goodbye", "再见"], ["please", "请"],
  ["thank-you", "谢谢你"], ["sorry", "对不起"], ["yes", "是；对"], ["no", "不；不是"],
].forEach(([key, meaning]) => {
  const word = key.replace(/-/g, " ");
  add({ key, word, meaning, partOfSpeech: "常用表达", unitId: "greetings", unitLabel: "问候和礼貌用语", audioText: word });
});

[
  ["red", "红色；红色的"], ["blue", "蓝色；蓝色的"], ["yellow", "黄色；黄色的"],
  ["green", "绿色；绿色的"], ["black", "黑色；黑色的"], ["white", "白色；白色的"],
  ["pink", "粉色；粉色的"], ["orange", "橙色；橙色的"],
].forEach(([word, meaning]) => add({
  key: word, word, meaning, partOfSpeech: "颜色词", unitId: "colours", unitLabel: "基础颜色", audioText: word,
}));

[
  ["book", "书"], ["pencil", "铅笔"], ["pen", "钢笔；笔"], ["ruler", "尺子"],
  ["bag", "书包；包"], ["desk", "书桌；课桌"], ["chair", "椅子"], ["apple", "苹果"],
  ["ball", "球"], ["cat", "猫"], ["dog", "狗"], ["teacher", "老师"], ["mum", "妈妈"], ["dad", "爸爸"],
].forEach(([word, meaning]) => add({
  key: word, word, meaning, partOfSpeech: "名词（n.）", unitId: "first-words", unitLabel: "第一批生活词", audioText: word,
}));

const library = {
  libraryId: "primary-beginner",
  title: "英语启蒙零基础词库",
  version: 1,
  sourceFile: "教师自编英语启蒙词库 v1",
  levels: [
    {
      id: "0A",
      label: "英语启蒙（零基础）",
      order: 0,
      grade: 0,
      semester: "启蒙",
      collectionId: "primary-beginner",
      collectionLabel: "英语启蒙词库",
      edition: "零基础 v1",
      bookTitle: "英语启蒙（零基础）",
      isTextbook: false,
      sourceRef: "教师自编英语启蒙词库 v1",
    },
  ],
  words,
};

fs.writeFileSync(outputPath, `${JSON.stringify(library, null, 2)}\n`, "utf8");
console.log(`Beginner vocabulary written: ${words.length} items -> ${path.relative(root, outputPath)}`);
