const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "cloudfunctions", "quickstartFunctions", "data");
const sourceFiles = [
  "primary-beginner-words.json",
  "primary-1-3-words.json",
  "yilin-junior-2024-7a-words.json",
  "mistake-word-lexicon.json",
];
const outputPath = path.join(dataDir, "molly-ket-a2-words.json");
const OFFICIAL_SOURCE = "Cambridge English A2 Key and A2 Key for Schools Vocabulary List (updated 2023)";
const OFFICIAL_SOURCE_URL = "https://www.cambridgeenglish.org/vn/Images/506886-a2-key-2020-vocabulary-list.pdf";

const normalize = (value) => String(value || "")
  .normalize("NFKC")
  .replace(/[’‘]/g, "'")
  .replace(/[‐‑‒–—]/g, "-")
  .toLowerCase()
  .replace(/[^a-z'\-\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const SUPPLEMENTAL_MEANINGS = {
  name: "姓名；名字",
  "get dressed": "穿好衣服",
  toothbrush: "牙刷",
  breakfast: "早餐",
  midnight: "午夜",
  yesterday: "昨天",
  Monday: "星期一",
  Tuesday: "星期二",
  Wednesday: "星期三",
  Thursday: "星期四",
  Friday: "星期五",
  Saturday: "星期六",
  Sunday: "星期日",
  January: "一月",
  February: "二月",
  March: "三月",
  April: "四月",
  June: "六月",
  July: "七月",
  August: "八月",
  September: "九月",
  October: "十月",
  November: "十一月",
  December: "十二月",
  spring: "春天",
  summer: "夏天",
  autumn: "秋天",
  hour: "小时",
  minute: "分钟",
  clock: "时钟",
  timetable: "时间表；课程表",
  appointment: "预约；约会",
  early: "早的；提前",
  late: "晚的；迟到的",
  sometimes: "有时",
  apartment: "公寓",
  kitchen: "厨房",
  "sitting room": "起居室",
  entrance: "入口",
  floor: "地板；楼层",
  stairs: "楼梯",
  downstairs: "在楼下",
  garage: "车库",
  bed: "床",
  pillow: "枕头",
  table: "桌子",
  armchair: "扶手椅",
  cupboard: "橱柜",
  drawer: "抽屉",
  bookcase: "书柜",
  bookshelf: "书架",
  light: "灯；光",
  oven: "烤箱",
  cooker: "炊具；炉灶",
  sink: "水槽",
  toilet: "厕所",
  carpet: "地毯",
  curtain: "窗帘",
  box: "盒子",
  upstairs: "在楼上",
  computer: "电脑",
  laptop: "笔记本电脑",
  PC: "个人电脑",
  printer: "打印机",
  software: "软件",
  "web page": "网页",
  web: "万维网；网络",
  net: "网络",
  wifi: "无线网络",
  password: "密码",
  file: "文件",
  download: "下载",
  digital: "数字的",
  "digital camera": "数码相机",
  "MP3 player": "MP3 播放器",
  "cell phone": "手机",
  call: "打电话；呼叫",
  text: "短信；发短信；文本",
  email: "电子邮件；发邮件",
  speak: "说；讲",
  television: "电视",
  TV: "电视",
  dot: "点；小圆点",
  at: "在；符号 @",
  "by post": "通过邮寄",
  envelope: "信封",
  photograph: "照片；拍照",
  film: "电影；拍摄",
  music: "音乐",
  game: "游戏；比赛",
  city: "城市",
  street: "街道",
  playground: "操场；游乐场",
  "apartment building": "公寓楼",
  bookstore: "书店",
  cafe: "咖啡馆",
  cafeteria: "自助餐厅；学校食堂",
  cinema: "电影院",
  "department store": "百货商店",
  "grocery store": "食品杂货店",
  "guest house": "家庭旅馆",
  hospital: "医院",
  library: "图书馆",
  pharmacy: "药店",
  "sports centre": "体育中心",
  stadium: "体育场",
  supermarket: "超市",
  elevator: "电梯",
  "city centre": "市中心",
  "tourist information": "游客咨询处",
  map: "地图",
  left: "左边；向左",
  "straight on": "一直向前",
  place: "地方",
  holiday: "假期",
  visit: "参观；拜访",
  "tour guide": "导游",
  aeroplane: "飞机",
  helicopter: "直升机",
  "bus station": "汽车站",
  taxi: "出租车",
  "railway station": "火车站",
  platform: "站台",
  tram: "有轨电车",
  bicycle: "自行车",
  boat: "小船",
  delay: "延误；使延误",
  delayed: "延误的",
  luggage: "行李",
  suitcase: "手提箱",
  backpack: "背包",
  engine: "发动机",
  tyre: "轮胎",
  petrol: "汽油",
  "petrol station": "加油站",
  "traffic light": "交通信号灯",
  motorway: "高速公路",
  roundabout: "环岛",
  mechanic: "机械师；修理工",
  pack: "收拾行李；包装",
  moon: "月亮",
  star: "星星",
  season: "季节",
  rainforest: "热带雨林",
  plant: "植物；种植",
  flower: "花",
  grass: "草",
  lake: "湖",
  desert: "沙漠",
  campsite: "露营地",
  animal: "动物",
  whale: "鲸",
  tiger: "老虎",
  media: "媒体",
  painter: "画家；油漆工",
  photographer: "摄影师",
  adventure: "冒险；奇遇",
  comic: "漫画",
  story: "故事",
  picture: "图片；画",
  exhibition: "展览",
  disco: "迪斯科舞会",
  "classical music": "古典音乐",
  "hip hop": "嘻哈音乐",
  song: "歌曲",
  brilliant: "极好的；聪明的",
  scary: "吓人的",
  staff: "员工；全体职员",
  receptionist: "接待员",
  journalist: "记者",
  chef: "厨师",
  cleaner: "清洁工",
  "shop assistant": "店员",
  waitress: "女服务员",
  dentist: "牙医",
  "police officer": "警察",
  footballer: "足球运动员",
  earn: "挣钱；获得",
  help: "帮助",
  disagree: "不同意",
  love: "爱；喜爱",
  idea: "想法；主意",
  opinion: "意见；看法",
};

const unit = (id, label, candidates) => ({
  id,
  label,
  candidates: candidates.split("|").map((item) => item.trim()).filter(Boolean),
});

// Candidate pools are selected from the official Cambridge topic lists and alphabetical list.
// The builder keeps only entries that already have a checked Chinese meaning in the project.
const UNITS = [
  unit("w01", "第1周 · 认识自己与日常问答", "name|age|address|birthday|country|city|language|question|answer|ask|tell|spell|surname|favourite|hobby|student|friend|live|come|hello|morning|afternoon|evening|fine|happy|ready|young|old|year|today|tomorrow|yesterday|weekday|weekend|daily|date|time|home|school|class|teacher|pupil|learn|study|speak|talk|listen|read|write|remember|know|understand|mean|please|thank|welcome|sorry"),
  unit("w02", "第2周 · 家庭、朋友与宠物", "family|parent|mother|father|mum|dad|brother|sister|grandmother|grandfather|grandparent|grandma|grandpa|aunt|uncle|cousin|daughter|son|child|children|baby|husband|wife|married|friend|friendly|neighbour|guest|girl|boy|teenager|group|love|kind|together|visit|stay|cat|dog|rabbit|parrot|pet|animal|horse|cow|sheep|mouse|bird|fish|turtle|puppy|kitten|wildlife|zoo|care|look after|play with|help|share|invite"),
  unit("w03", "第3周 · 食物、饮料与点餐", "apple|banana|orange|pear|grape|strawberry|melon|lemon|carrot|potato|tomato|onion|mushroom|vegetable|fruit|bread|rice|pasta|pizza|sandwich|burger|salad|soup|meat|chicken|fish|egg|cheese|milk|juice|tea|water|breakfast|lunch|dinner|meal|snack|hungry|thirsty|delicious|sweet|salt|sugar|pepper|cake|biscuit|chocolate|ice cream|menu|waiter|waitress|restaurant|cafe|plate|bowl|cup|glass|fork|knife|cook|bake|boil|eat|drink|order|choose|piece of cake|main course|dessert|picnic"),
  unit("w04", "第4周 · 学校生活与学习用品", "school|classroom|classmate|lesson|course|subject|English|maths|science|history|geography|art|music|language|homework|project|test|exam|mark|question|answer|book|textbook|notebook|dictionary|page|paragraph|article|letter|note|message|desk|chair|blackboard|board|ruler|rubber|eraser|pen|pencil|paper|scissors|library|bookshelf|bookcase|instructions|practice|practise|teach|learn|study|read|write|draw|clever|difficult|easy|important|university|college|beginner|level|term"),
  unit("w05", "第5周 · 日常作息与时间", "wake up|get up|get dressed|wash|brush|toothbrush|breakfast|leave|arrive|start|finish|morning|afternoon|evening|night|noon|midnight|today|tomorrow|yesterday|weekday|weekend|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|spring|summer|autumn|winter|hour|minute|second|clock|calendar|timetable|appointment|early|late|daily|weekly|always|usually|often|sometimes|never|before|after|during|past|quarter|half|o'clock|moment"),
  unit("w06", "第6周 · 兴趣、运动与周末活动", "hobby|music|guitar|piano|instrument|sing|song|dance|draw|drawing|paint|painting|photograph|photography|camera|book|magazine|comic|chess|board game|video game|computer|club|member|join|collect|collection|camp|camping|campsite|tent|picnic|party|festival|museum|go out|go shopping|football|basketball|badminton|tennis|table tennis|volleyball|swimming|cycling|riding|running|skating|skiing|sailing|fishing|surfing|sport|team|player|coach|competition|prize|winner|win|lose|practice|fun|interesting|boring|prefer|enjoy|free time"),
  unit("w07", "第7周 · 家、房间与位置", "home|house|apartment|flat|room|bedroom|bathroom|kitchen|living room|dining room|sitting room|hall|entrance|floor|stairs|downstairs|garden|garage|roof|door|window|wall|ceiling|bed|pillow|blanket|towel|chair|table|desk|sofa|armchair|cupboard|drawer|shelf|bookcase|bookshelf|lamp|light|clock|fridge|refrigerator|oven|cooker|sink|shower|toilet|carpet|curtain|furniture|key|box|bin|rubbish|clean|tidy|inside|outside|upstairs|next to|between|opposite|behind|under|above|near|far"),
  unit("w08", "第8周 · 天气、衣服与购物", "weather|sun|sunny|cloud|cloudy|rain|snow|wind|windy|storm|fog|foggy|hot|warm|cold|wet|dry|coat|jacket|shirt|T-shirt|sweater|jumper|dress|skirt|trousers|jeans|shorts|sock|shoe|boot|trainers|hat|cap|scarf|glove|umbrella|uniform|pocket|bag|handbag|wallet|watch|glasses|sunglasses|wear|get dressed|try on|shop|store|department store|supermarket|customer|shop assistant|buy|pay|cost|price|cheap|expensive|cash|credit card|change|receipt|sale|size|fashion"),
  unit("w09", "第9周 · 阅读、通知与文本", "ad|advertisement|article|book|card|comic|diary|email|form|letter|licence|magazine|menu|message|newspaper|note|notebook|passport|postcard|project|text|textbook|ticket|title|page|paragraph|sentence|word|story|information|instructions|notice|sign|question|answer|read|write|spell|copy|complete|choose|match|check|find|look at|understand|mean|right|wrong|true|different|same|example|about|because|first|next|then|finally|important|detail|picture|photo|report|list|number|online"),
  unit("w10", "第10周 · 科技与沟通", "computer|laptop|PC|keyboard|mouse|screen|printer|software|internet|online|website|web page|web|net|wifi|password|file|download|click|digital|camera|digital camera|video|DVD|CD|MP3 player|mobile phone|cell phone|telephone|phone|call|text|email|chat|conversation|talk|speak|listen|radio|television|TV|information|address|dot|at|by post|envelope|photograph|photography|message|send|receive|open|close|save|search|news|programme|channel|film|cartoon|show|music|game"),
  unit("w11", "第11周 · 身体、健康与看医生", "body|head|face|hair|eye|ear|nose|mouth|tooth|teeth|neck|shoulder|arm|hand|finger|leg|foot|feet|back|stomach|heart|brain|health|healthy|ill|sick|well|tired|fit|pain|cold|temperature|toothache|stomach ache|hurt|fall|break|cut|accident|danger|dangerous|doctor|dentist|nurse|chemist|hospital|ambulance|medicine|appointment|check|rest|lie down|exercise|walk|run|swim|clean|soap|comb|toothbrush|feel|better|problem|careful|strong|weak|hear|see"),
  unit("w12", "第12周 · 城市、建筑与公共服务", "city|town|village|street|road|corner|square|bridge|market|park|playground|building|apartment building|bank|bookshop|bookstore|cafe|cafeteria|castle|cinema|department store|factory|garage|grocery store|guest house|hospital|hotel|library|museum|office|pharmacy|police station|post office|restaurant|school|shop|sports centre|stadium|station|supermarket|swimming pool|theatre|university|entrance|exit|lift|elevator|block|city centre|bus stop|tourist information|map|left|right|straight on|near|far|across|through|along|turn|way|place|area|centre"),
  unit("w13", "第13周 · 出行、交通与计划", "travel|trip|journey|tour|holiday|visit|visitor|tourist|tour guide|airport|flight|aeroplane|plane|helicopter|pilot|bus|bus station|bus stop|coach|car|taxi|train|railway|railway station|platform|tram|underground|motorbike|bicycle|bike|boat|ship|passenger|driver|drive|ride|fly|sail|leave|arrive|return|miss|delay|delayed|ticket|passport|luggage|suitcase|backpack|case|seat|window|engine|wheel|tyre|petrol|petrol station|traffic|traffic light|motorway|roundabout|road|map|country|far|stop|move|repair|mechanic|plan|book|pack"),
  unit("w14", "第14周 · 自然、地点与户外运动", "world|nature|air|water|fire|earth|moon|star|space|sky|sun|cloud|weather|season|spring|summer|autumn|winter|north|south|east|west|country|countryside|forest|rainforest|wood|tree|plant|flower|grass|field|farm|hill|mountain|river|lake|sea|beach|island|desert|path|campsite|animal|wild|wildlife|bee|rabbit|whale|dolphin|tiger|grow|hot|cold|ice|wind|climb|walk|ride|swim|sail|explorer|outside|beautiful|quiet|safe|dangerous"),
  unit("w15", "第15周 · 娱乐、图片与故事表达", "entertainment|media|actor|artist|dancer|musician|painter|photographer|singer|writer|act|dance|draw|paint|sing|write|read|watch|listen|play|film|movie|cinema|theatre|opera|concert|show|programme|television|radio|news|newspaper|magazine|article|adventure|cartoon|comic|story|picture|photograph|video|screen|exhibition|museum|festival|disco|classical music|pop music|rock music|hip hop|drum|guitar|keyboard|piano|instrument|song|group|laugh|fun|funny|exciting|amazing|brilliant|terrible|scary|strange|suddenly|begin|middle|end"),
  unit("w16", "第16周 · 职业、观点与综合表达", "job|work|worker|business|company|office|staff|manager|boss|secretary|receptionist|journalist|engineer|mechanic|farmer|cook|chef|cleaner|shop assistant|waiter|waitress|doctor|dentist|nurse|teacher|coach|police officer|driver|pilot|artist|actor|singer|writer|photographer|footballer|tour guide|earn|help|make|build|teach|serve|sell|plan|agree|disagree|think|believe|feel|like|love|prefer|choose|suggest|idea|reason|opinion|because|useful|important|possible|sure|clear|real|special|successful|friendly|careful|hard-working|future|dream|wish"),
];

const meaningByKey = new Map();
sourceFiles.forEach((fileName) => {
  const source = JSON.parse(fs.readFileSync(path.join(dataDir, fileName), "utf8"));
  (source.words || []).forEach((word) => {
    const key = normalize(word.key || word.word);
    if (!key || !String(word.meaning || "").trim()) return;
    const current = meaningByKey.get(key);
    if (!current || (!current.partOfSpeech && word.partOfSpeech)) {
      meaningByKey.set(key, {
        word: String(word.word || word.key || key).trim(),
        meaning: String(word.meaning || "").trim(),
        partOfSpeech: String(word.partOfSpeech || "").trim(),
      });
    }
  });
});
Object.entries(SUPPLEMENTAL_MEANINGS).forEach(([word, meaning]) => {
  const key = normalize(word);
  const existing = meaningByKey.get(key);
  meaningByKey.set(key, {
    word: existing ? existing.word : word,
    meaning,
    partOfSpeech: existing ? existing.partOfSpeech : "",
  });
});

const usedKeys = new Set();
const words = [];
const missingByUnit = [];
UNITS.forEach((sourceUnit, unitIndex) => {
  const selected = [];
  const missing = [];
  sourceUnit.candidates.forEach((candidate) => {
    if (selected.length >= 40) return;
    const key = normalize(candidate);
    const existing = meaningByKey.get(key);
    if (!existing) {
      missing.push(candidate);
      return;
    }
    if (usedKeys.has(key)) return;
    usedKeys.add(key);
    selected.push({ key, candidate, existing });
  });
  if (selected.length !== 40) {
    missingByUnit.push({ id: sourceUnit.id, label: sourceUnit.label, selected: selected.length, missing });
    return;
  }
  selected.forEach((item, index) => {
    words.push({
      key: item.key,
      word: item.existing.word,
      meaning: item.existing.meaning,
      partOfSpeech: item.existing.partOfSpeech,
      levelId: "molly-ket-a2-16w",
      unitId: sourceUnit.id,
      unitLabel: sourceUnit.label,
      sourceRef: OFFICIAL_SOURCE,
      sourceUrl: OFFICIAL_SOURCE_URL,
      week: unitIndex + 1,
      day: Math.floor(index / 8) + 1,
      order: unitIndex * 40 + index + 1,
    });
  });
});

if (missingByUnit.length) {
  console.error(JSON.stringify(missingByUnit, null, 2));
  process.exit(1);
}

if (words.length !== 640 || new Set(words.map((item) => item.key)).size !== 640) {
  throw new Error(`Expected 640 unique words, received ${words.length}`);
}

const output = {
  libraryId: "molly-ket-a2-16w",
  title: "Molly KET 16周主题词库",
  version: 1,
  sourceFile: OFFICIAL_SOURCE,
  sourceUrl: OFFICIAL_SOURCE_URL,
  dailyGoal: 8,
  studyWeeks: 16,
  studyDaysPerWeek: 5,
  levels: [{
    id: "molly-ket-a2-16w",
    label: "Molly · KET 16周词库",
    order: 50,
    grade: 2,
    semester: "KET基础",
    collectionId: "molly-ket-a2-16w",
    collectionLabel: "Molly KET 专属词库",
    edition: "Cambridge A2 Key 2023 · 16周精选",
    bookTitle: "Molly KET 16周主题词库",
    isTextbook: false,
    sourceRef: OFFICIAL_SOURCE,
  }],
  words,
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Molly KET vocabulary generated: ${words.length} words -> ${outputPath}`);
