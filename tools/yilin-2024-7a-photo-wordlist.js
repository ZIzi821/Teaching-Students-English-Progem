const splitWords = (value) => value
  .split("|")
  .map((item) => item.trim())
  .filter(Boolean);

const SOURCE_REF = "family-photo-wordlist-2026-10-15-pages-149-154";

const UNIT_TITLES = Object.freeze([
  "This is me!",
  "Hobbies",
  "Welcome to our school!",
  "School days",
  "A healthy lifestyle",
  "My clothes, my style",
  "Be wise with money",
  "Let's celebrate!",
]);

// 2026-10-15 家长提供的教材书后 Wordlist (by unit)，页码 149-154。
// 这里只记录印刷词表；照片上的手写批注不属于教材词条。
const WORDS_BY_UNIT = Object.freeze([
  splitWords("greet | introduce | each other | go by | glad | same | hobby | grade | classmate | friendly | full | be full of | energy | be good at | slim | polite | smart | ready | be ready to do sth | other | interested | be interested in | looks | character | both | enjoy | pretty | shy | only | stay | match | luck | good luck | chess | Chinese chess | problem | weekend | at the weekend | fun | make friends with"),
  splitWords("jogging | painting | paper-cutting | all kinds of | fit | around | change | life | museum | thing | fun | apart | take ... apart | fix | scientist | dream | true | come true | paint | club | member | geography | p.m. | volleyball | each | once | join | meeting | sound | plan | role | model | role model | design | skill | artist | master | work | become | designer | would | would like | future | in the future | hope"),
  splitWords("gym | building | field | sports field | dining | hall | dining hall | lab | part | modern | as well | bright | everyone | perfect | spend | chat | exciting | take place | noticeboard | gate | news | board | like | more | trust | really | soon | teach | team | form teacher | show | grey | different | thousand | fact | in fact | borrow | newspaper | magazine | else | care | care about | event | together | quite | large | special"),
  splitWords("a.m. | get up | activity | housework | homework | weekday | on weekdays | usually | jog | a little | myself | enjoy oneself | first | term | start | writer | amazing | biology | living | nature | practise | field | trip | field trip | leave | leave for | pick | of course | seldom | tennis | roller skate | grow | tour | website | video | outside | teamwork | better | tiring | duty | area | take part in | group | turn | take turns | empty | bin | care | take care of"),
  splitWords("lifestyle | cucumber | lemon | watermelon | pepper | chocolate | beef | carrot | pork | sweet | snack | health | delicious | important | diet | without | pancake | tofu | sugar | tooth | homebody | mutton | sweet | have a sweet tooth | stay | stay up | unhealthy | need | enough | less | cheese | piece | bowl | salt | packet | kilo | bottle | maybe | than | almost | chip | smartphone | score | point | change | meal | porridge | whole | miss | rest | pie | yogurt | most"),
  splitWords("style | blouse | jacket | jeans | scarf | tie | T-shirt | calm | fashion | choose | could | advice | depend | depend on | skin | such as | purple | similar | example | for example | dark | mix | match | formal | informal | comfortable | primary | smart | date | traditional | popular | type | design | festival | wedding | just | culture | history | belt | be made of | silk | smooth | soft | cotton | agree | feature | size"),
  splitWords("wise | yuan | euro | pound | yen | rouble | dollar | key | ring | baseball | Russian | set | a set of | inside | another | colourful | surprise | mall | across | cost | manage | budget | cover | education | pay | pay for | flat | daily | need | per cent | expensive | save | bank | account | rainy | matter | keep to | pocket | pocket money | notebook | rest | strawberry | bookshop | eraser | as | present | away | shell | deal | coin | online | country | lucky | lucky money | grandparent | relative | send | online | red packet | survey | in need | habit"),
  splitWords("celebrate | Christmas | remember | poet | dragon | dragon boat | race | dumpling | rice dumpling | Scottish | dish | poem | lady | gentleman | spread | doorstep | peace | hang | onion | Greek | tradition | symbol | midnight | strike | into | ahead | carry | suitcase | block | traveller | wherever | violin | lively | spring roll | moment | at the moment | tonight | lantern | mountain | climb | natural | beauty | elder | double | forever | something | put up | Spring Festival couplets | prepare | meaning | during | last | till | heart"),
]);

const EXPECTED_UNIT_COUNTS = Object.freeze([40, 45, 47, 49, 53, 47, 62, 54]);

const METADATA_OVERRIDES = Object.freeze({
  informal: {
    meaning: "（衣服）在家穿的，日常穿的",
    partOfSpeech: "adj.",
  },
  "keep to": {
    meaning: "遵守；不偏离",
    partOfSpeech: "",
  },
  peace: {
    meaning: "和平，平静",
    partOfSpeech: "n.",
  },
});

module.exports = {
  EXPECTED_UNIT_COUNTS,
  METADATA_OVERRIDES,
  SOURCE_REF,
  UNIT_TITLES,
  WORDS_BY_UNIT,
};
