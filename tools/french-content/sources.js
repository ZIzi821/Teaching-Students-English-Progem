/*
 * Compact editorial source tables for French A1/A2 content.
 * These are CEFR-aligned teaching selections, not an official CEFR word list.
 * Field order for word rows:
 * id | lemma | displayForm | meaningCN | meaningEN | partOfSpeech | topic |
 * ipa | article | gender | plural | exampleSentence | exampleMeaningCN |
 * difficulty | comma-separated tags
 */
'use strict';

const splitRows = (text, columns) => text.trim().split('\n')
  .filter((row) => row.trim() && !row.trim().startsWith('#'))
  .map((row) => {
    const values = row.split('|').map((value) => value.trim());
    if (values.length !== columns.length) {
      throw new Error(`Expected ${columns.length} columns, found ${values.length}: ${row}`);
    }
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });

const wordColumns = [
  'id', 'lemma', 'displayForm', 'meaningCN', 'meaningEN', 'partOfSpeech', 'topic',
  'ipa', 'article', 'gender', 'plural', 'exampleSentence', 'exampleMeaningCN',
  'difficulty', 'tags'
];

const a1WordRows = splitRows(`
# daily routines and descriptions
a1-daily-maison|maison|la maison|房子；家|house; home|noun|daily-life|/mɛ.zɔ̃/|la|f|maisons|La maison est petite.|这所房子很小。|1|home,essentials
a1-daily-appartement|appartement|un appartement|公寓|apartment|noun|daily-life|/a.paʁ.tə.mɑ̃/|un|m|appartements|Mon appartement est près du métro.|我的公寓靠近地铁。|2|home,city
a1-daily-chambre|chambre|la chambre|房间；卧室|room; bedroom|noun|daily-life|/ʃɑ̃bʁ/|la|f|chambres|La chambre est calme.|这个房间很安静。|1|home
a1-daily-porte|porte|la porte|门|door|noun|daily-life|/pɔʁt/|la|f|portes|La porte est ouverte.|门开着。|1|home
a1-daily-table|table|la table|桌子|table|noun|daily-life|/ta.blə/|la|f|tables|Le livre est sur la table.|书在桌子上。|1|home,objects
a1-daily-chaise|chaise|la chaise|椅子|chair|noun|daily-life|/ʃɛz/|la|f|chaises|La chaise est près de la fenêtre.|椅子靠近窗户。|1|home,objects
a1-daily-fenetre|fenêtre|la fenêtre|窗户|window|noun|daily-life|/fə.nɛtʁ/|la|f|fenêtres|La fenêtre est fermée.|窗户关着。|2|home
a1-daily-matin|matin|le matin|早晨|morning|noun|daily-life|/ma.tɛ̃/|le|m|matins|Le matin, je bois un café.|早上我喝咖啡。|1|routine,time
a1-daily-soir|soir|le soir|晚上|evening|noun|daily-life|/swaʁ/|le|m|soirs|Le soir, nous regardons un film.|晚上我们看电影。|1|routine,time
a1-daily-travailler|travailler|travailler|工作；学习用功|to work|verb|daily-life|/tʁa.va.je/||||Je travaille le samedi.|我星期六工作。|2|routine,verb
a1-daily-etudier|étudier|étudier|学习；研究|to study|verb|daily-life|/e.ty.dje/||||J'étudie le français chaque jour.|我每天学习法语。|2|study,verb
a1-daily-regarder|regarder|regarder|看；观看|to watch; to look at|verb|daily-life|/ʁə.ɡaʁ.de/||||Nous regardons un film.|我们看一部电影。|1|routine,verb
a1-daily-ecouter|écouter|écouter|听|to listen to|verb|daily-life|/e.ku.te/||||J'écoute de la musique.|我听音乐。|1|routine,verb
a1-daily-parler|parler|parler|说；交谈|to speak|verb|daily-life|/paʁ.le/||||Tu parles français ?|你说法语吗？|1|communication,verb
a1-daily-comprendre|comprendre|comprendre|理解|to understand|verb|daily-life|/kɔ̃.pʁɑ̃dʁ/||||Je comprends la question.|我理解这个问题。|2|communication,verb
a1-daily-acheter|acheter|acheter|买|to buy|verb|daily-life|/a.ʃə.te/||||J'achète une pomme.|我买一个苹果。|2|shopping,verb
a1-daily-grand|grand|grand|大的；高的|big; tall|adjective|daily-life|/ɡʁɑ̃/||||Paris est une grande ville.|巴黎是一座大城市。|1|description
a1-daily-petit|petit|petit|小的；矮的|small; short|adjective|daily-life|/pə.ti/||||C'est un petit café.|这是一家小咖啡馆。|1|description
a1-daily-bon|bon|bon|好的；好吃的|good|adjective|daily-life|/bɔ̃/||||Le café est bon.|咖啡很好喝。|1|description,food
a1-daily-cher|cher|cher|贵的|expensive|adjective|daily-life|/ʃɛʁ/||||Ce livre est cher.|这本书很贵。|2|shopping,description
a1-daily-pas-cher|pas cher|pas cher|不贵的；便宜的|inexpensive|adjective|daily-life|/pa ʃɛʁ/||||Le ticket n'est pas cher.|这张票不贵。|2|shopping,description
a1-daily-ici|ici|ici|这里|here|adverb|daily-life|/i.si/||||Le métro est ici.|地铁在这里。|1|place
a1-daily-la-bas|là-bas|là-bas|那里|there|adverb|daily-life|/la.ba/||||La gare est là-bas.|车站在那里。|1|place
a1-daily-tres|très|très|很；非常|very|adverb|daily-life|/tʁɛ/||||C'est très bien.|这很好。|1|intensifier
# food and shopping
a1-food-pain|pain|le pain|面包|bread|noun|food|/pɛ̃/|le|m|pains|Je mange du pain.|我吃面包。|1|food,essentials
a1-food-pomme|pomme|la pomme|苹果|apple|noun|food|/pɔm/|la|f|pommes|La pomme est rouge.|苹果是红色的。|1|food
a1-food-fromage|fromage|le fromage|奶酪|cheese|noun|food|/fʁɔ.maʒ/|le|m|fromages|Le fromage est sur la table.|奶酪在桌子上。|1|food
a1-food-lait|lait|le lait|牛奶|milk|noun|food|/lɛ/|le|m|laits|Je bois du lait.|我喝牛奶。|1|food
a1-food-the|thé|le thé|茶|tea|noun|food|/te/|le|m|thés|Le thé est chaud.|茶是热的。|1|food,drink
a1-food-jus|jus|le jus|果汁|juice|noun|food|/ʒy/|le|m|jus|Je voudrais un jus, s'il vous plaît.|请给我一杯果汁。|1|food,drink
a1-food-repas|repas|le repas|一餐；饭|meal|noun|food|/ʁə.pɑ/|le|m|repas|Le repas est prêt.|饭准备好了。|2|food,routine
a1-food-menu|menu|le menu|菜单|menu|noun|food|/mə.ny/|le|m|menus|Le menu est sur la table.|菜单在桌子上。|1|restaurant
a1-food-restaurant|restaurant|le restaurant|餐馆|restaurant|noun|food|/ʁɛs.tɔ.ʁɑ̃/|le|m|restaurants|Le restaurant est ouvert.|餐馆开着。|1|restaurant,place
a1-food-addition|addition|l'addition|账单|bill; check|noun|food|/a.di.sjɔ̃/|l’|f|additions|L'addition, s'il vous plaît.|请给我账单。|2|restaurant
a1-food-plat|plat|le plat|菜肴；盘子|dish|noun|food|/pla/|le|m|plats|Ce plat est bon.|这道菜很好吃。|2|food,restaurant
a1-food-chaud|chaud|chaud|热的|hot; warm|adjective|food|/ʃo/||||Le café est chaud.|咖啡是热的。|1|food,description
a1-food-froid|froid|froid|冷的|cold|adjective|food|/fʁwa/||||L'eau est froide.|水是凉的。|1|food,description
a1-food-avec|avec|avec|和；带着|with|preposition|food|/a.vɛk/||||Un café avec du lait, s'il vous plaît.|请给我一杯加牛奶的咖啡。|1|connector
a1-food-sans|sans|sans|没有；不带|without|preposition|food|/sɑ̃/||||Un thé sans sucre, s'il vous plaît.|请给我一杯不加糖的茶。|2|connector
a1-food-combien|combien|combien|多少；多少钱|how much; how many|adverb|food|/kɔ̃.bjɛ̃/||||Combien coûte le café ?|咖啡多少钱？|2|shopping,questions
# places and movement
a1-places-rue|rue|la rue|街道|street|noun|places|/ʁy/|la|f|rues|La rue est calme.|这条街很安静。|1|city,place
a1-places-gare|gare|la gare|火车站|station|noun|places|/ɡaʁ/|la|f|gares|La gare est près d'ici.|车站就在这附近。|1|travel,place
a1-places-metro|métro|le métro|地铁|metro|noun|places|/me.tʁo/|le|m|métros|Je prends le métro.|我坐地铁。|1|travel,transport
a1-places-bus|bus|le bus|公交车|bus|noun|places|/bys/|le|m|bus|Le bus arrive à huit heures.|公交车八点到。|1|travel,transport
a1-places-ecole|école|l'école|学校|school|noun|places|/e.kɔl/|l’|f|écoles|L'école est ouverte aujourd'hui.|学校今天开门。|1|study,place
a1-places-magasin|magasin|le magasin|商店|shop|noun|places|/ma.ɡa.zɛ̃/|le|m|magasins|Le magasin ferme à dix-huit heures.|商店18点关门。|1|shopping,place
a1-places-hotel|hôtel|l'hôtel|酒店|hotel|noun|places|/o.tɛl/|l’|m|hôtels|L'hôtel est près de la gare.|酒店靠近车站。|2|travel,place
a1-places-parc|parc|le parc|公园|park|noun|places|/paʁk/|le|m|parcs|Le parc est grand.|公园很大。|1|city,place
a1-places-aller|aller|aller|去；前往|to go|verb|places|/a.le/||||Je vais à l'école.|我去学校。|1|movement,verb
a1-places-venir|venir|venir|来|to come|verb|places|/və.niʁ/||||Tu viens avec nous ?|你和我们一起来吗？|2|movement,verb
a1-places-prendre|prendre|prendre|拿；乘坐|to take|verb|places|/pʁɑ̃dʁ/||||Je prends le bus.|我坐公交车。|2|movement,verb
a1-places-chercher|chercher|chercher|寻找|to look for|verb|places|/ʃɛʁ.ʃe/||||Je cherche la gare.|我在找车站。|2|movement,verb
a1-places-pres|près|près|近的；靠近|near|adverb|places|/pʁɛ/||||Le café est près d'ici.|咖啡馆就在这附近。|1|place
a1-places-loin|loin|loin|远|far|adverb|places|/lwɛ̃/||||Le musée est loin.|博物馆很远。|1|place
# study, colours, weather and links
a1-study-professeur|professeur|le professeur|老师|teacher|noun|study|/pʁɔ.fɛ.sœʁ/|le|m|professeurs|Le professeur parle lentement.|老师说得很慢。|1|study,people
a1-study-etudiant|étudiant|un étudiant|学生（男）；大学生|student|noun|study|/e.ty.djɑ̃/|un|m|étudiants|L'étudiant écoute le professeur.|学生在听老师讲。|2|study,people
a1-study-question|question|la question|问题|question|noun|study|/kɛs.tjɔ̃/|la|f|questions|La question est facile.|这个问题很简单。|1|study,communication
a1-study-reponse|réponse|la réponse|回答|answer|noun|study|/ʁe.pɔ̃s/|la|f|réponses|La réponse est correcte.|答案是正确的。|2|study,communication
a1-study-mot|mot|le mot|词|word|noun|study|/mo/|le|m|mots|Ce mot est français.|这个词是法语。|1|study,language
a1-study-facile|facile|facile|容易的|easy|adjective|study|/fa.sil/||||L'exercice est facile.|练习很容易。|1|study,description
a1-study-difficile|difficile|difficile|困难的|difficult|adjective|study|/di.fi.sil/||||La question est difficile.|这个问题很难。|2|study,description
a1-study-rouge|rouge|rouge|红色的|red|adjective|study|/ʁuʒ/||||La pomme est rouge.|苹果是红色的。|1|colour,description
a1-study-bleu|bleu|bleu|蓝色的|blue|adjective|study|/blø/||||Le ciel est bleu.|天空是蓝色的。|1|colour,description
a1-study-vert|vert|vert|绿色的|green|adjective|study|/vɛʁ/||||Le parc est vert.|公园是绿色的。|1|colour,description
a1-study-beau|beau|beau|漂亮的；美丽的|beautiful; nice|adjective|study|/bo/||||C'est un beau parc.|这是一个漂亮的公园。|1|description
a1-study-soleil|soleil|le soleil|太阳；阳光|sun|noun|study|/sɔ.lɛj/|le|m|soleils|Il y a du soleil aujourd'hui.|今天有阳光。|2|weather
a1-study-pluie|pluie|la pluie|雨|rain|noun|study|/plɥi/|la|f|pluies|Il y a de la pluie demain.|明天有雨。|2|weather
a1-study-mais|mais|mais|但是|but|conjunction|study|/mɛ/||||J'aime le café, mais pas le thé.|我喜欢咖啡，但不喜欢茶。|1|connector
a1-study-et|et|et|和；以及|and|conjunction|study|/e/||||Anna et Paul sont ici.|安娜和保罗在这里。|1|connector
a1-study-parce-que|parce que|parce que|因为|because|conjunction|study|/paʁs kə/||||J'étudie parce que j'aime le français.|我学习因为我喜欢法语。|2|connector
`, wordColumns);

const a2WordRows = splitRows(`
# travel and services
a2-travel-voyage|voyage|le voyage|旅行|trip; journey|noun|travel|/vwa.jaʒ/|le|m|voyages|Le voyage commence demain.|旅行明天开始。|2|travel
a2-travel-billet|billet|le billet|票|ticket|noun|travel|/bi.jɛ/|le|m|billets|J'ai un billet pour Lyon.|我有一张去里昂的票。|2|travel
a2-travel-valise|valise|la valise|行李箱|suitcase|noun|travel|/va.liz/|la|f|valises|Ma valise est lourde.|我的行李箱很重。|2|travel
a2-travel-avion|avion|l'avion|飞机|plane|noun|travel|/a.vjɔ̃/|l’|m|avions|L'avion part à midi.|飞机中午起飞。|2|travel,transport
a2-travel-arriver|arriver|arriver|到达|to arrive|verb|travel|/a.ʁi.ve/||||Le train arrive bientôt.|火车很快到。|2|travel,verb
a2-travel-partir|partir|partir|离开；出发|to leave|verb|travel|/paʁ.tiʁ/||||Nous partons demain matin.|我们明天早上出发。|2|travel,verb
a2-travel-reserver|réserver|réserver|预订|to reserve|verb|travel|/ʁe.zɛʁ.ve/||||Je réserve une chambre pour deux nuits.|我预订一间房住两晚。|3|travel,services
a2-travel-visiter|visiter|visiter|参观；拜访|to visit|verb|travel|/vi.zi.te/||||Nous visitons le musée samedi.|我们星期六参观博物馆。|2|travel,verb
a2-travel-touriste|touriste|un touriste|游客|tourist|noun|travel|/tu.ʁist/|un|m|touristes|Le touriste demande son chemin.|游客问路。|2|travel,people
a2-travel-plan|plan|le plan|地图；计划|map; plan|noun|travel|/plɑ̃/|le|m|plans|Le plan montre la gare.|地图显示车站。|2|travel,navigation
a2-travel-tourner|tourner|tourner|转弯；转动|to turn|verb|travel|/tuʁ.ne/||||Tournez à gauche après la banque.|过了银行向左转。|3|travel,directions
a2-travel-droite|droite|à droite|右边；向右|right; to the right|adverb|travel|/a dʁwat/||||La pharmacie est à droite.|药店在右边。|2|travel,directions
a2-travel-gauche|gauche|à gauche|左边；向左|left; to the left|adverb|travel|/a ɡoʃ/||||Le parc est à gauche.|公园在左边。|2|travel,directions
a2-travel-retard|retard|le retard|迟到；延误|delay|noun|travel|/ʁə.taʁ/|le|m|retards|Le train a dix minutes de retard.|火车晚点十分钟。|3|travel,time
a2-travel-continuez|continuer|continuer|继续|to continue|verb|travel|/kɔ̃.ti.nɥe/||||Continuez tout droit, s'il vous plaît.|请一直往前走。|3|travel,directions
a2-travel-pharmacie|pharmacie|la pharmacie|药店|pharmacy|noun|travel|/faʁ.ma.si/|la|f|pharmacies|La pharmacie ferme à dix-neuf heures.|药店19点关门。|2|services,place
# work, study and communication
a2-work-rendez-vous|rendez-vous|le rendez-vous|预约；约会|appointment|noun|work-study|/ʁɑ̃.de.vu/|le|m|rendez-vous|J'ai rendez-vous à quatorze heures.|我14点有约。|2|work,time
a2-work-reunion|réunion|la réunion|会议|meeting|noun|work-study|/ʁe.y.njɔ̃/|la|f|réunions|La réunion commence à neuf heures.|会议九点开始。|2|work
a2-work-message|message|le message|消息|message|noun|work-study|/me.saʒ/|le|m|messages|J'envoie un message à Marie.|我给玛丽发一条消息。|2|communication
a2-work-courriel|courriel|le courriel|电子邮件|email|noun|work-study|/ku.ʁjɛl/|le|m|courriels|Le courriel est dans ma boîte.|邮件在我的邮箱里。|3|communication,work
a2-work-projet|projet|le projet|项目|project|noun|work-study|/pʁɔ.ʒɛ/|le|m|projets|Le projet est important.|这个项目很重要。|2|work
a2-work-devoir|devoir|le devoir|作业；义务|homework; duty|noun|work-study|/də.vwaʁ/|le|m|devoirs|Je finis mes devoirs ce soir.|我今晚完成作业。|2|study
a2-work-examen|examen|l'examen|考试|exam|noun|work-study|/ɛɡ.za.mɛ̃/|l’|m|examens|L'examen est vendredi.|考试在星期五。|2|study
a2-work-commencer|commencer|commencer|开始|to begin|verb|work-study|/kɔ.mɑ̃.se/||||Le cours commence à huit heures.|课程八点开始。|2|work,verb
a2-work-finir|finir|finir|完成；结束|to finish|verb|work-study|/fi.niʁ/||||Je finis le travail à dix-sept heures.|我17点完成工作。|2|work,verb
a2-work-envoyer|envoyer|envoyer|发送|to send|verb|work-study|/ɑ̃.vwa.je/||||J'envoie le document aujourd'hui.|我今天发送文件。|3|communication,verb
a2-work-repondre|répondre|répondre|回答；回复|to answer; reply|verb|work-study|/ʁe.pɔ̃dʁ/||||Elle répond au message.|她回复消息。|2|communication,verb
a2-work-expliquer|expliquer|expliquer|解释|to explain|verb|work-study|/ɛks.pli.ke/||||Le professeur explique la règle.|老师解释规则。|3|study,verb
a2-work-important|important|important|重要的|important|adjective|work-study|/ɛ̃.pɔʁ.tɑ̃/||||C'est une question importante.|这是一个重要问题。|2|description
a2-work-possible|possible|possible|可能的|possible|adjective|work-study|/pɔ.si.blə/||||C'est possible demain ?|明天可以吗？|2|communication
a2-work-occupe|occupé|occupé|忙的；被占用的|busy|adjective|work-study|/ɔ.ky.pe/||||Je suis occupé cet après-midi.|我今天下午很忙。|2|work,time
a2-work-ensemble|ensemble|ensemble|一起|together|adverb|work-study|/ɑ̃.sɑ̃bl/||||Nous travaillons ensemble.|我们一起工作。|2|work,connector
# home, health and everyday problems
a2-life-quartier|quartier|le quartier|街区；社区|neighbourhood|noun|daily-life|/kaʁ.tje/|le|m|quartiers|Mon quartier est animé.|我的街区很热闹。|2|city,home
a2-life-voisin|voisin|un voisin|邻居|neighbour|noun|daily-life|/vwa.zɛ̃/|un|m|voisins|Mon voisin est sympathique.|我的邻居很友好。|2|people,home
a2-life-menage|ménage|le ménage|家务；清洁|housework|noun|daily-life|/me.naʒ/|le|m|ménages|Je fais le ménage le dimanche.|我星期日做家务。|3|home,routine
a2-life-cuisine|cuisine|la cuisine|厨房；烹饪|kitchen; cooking|noun|daily-life|/kɥi.zin/|la|f|cuisines|La cuisine est propre.|厨房很干净。|2|home
a2-life-salle-de-bains|salle de bains|la salle de bains|浴室|bathroom|noun|daily-life|/sal də bɛ̃/|la|f|salles de bains|La salle de bains est libre.|浴室空着。|2|home
a2-life-douleur|douleur|la douleur|疼痛|pain|noun|health|/du.lœʁ/|la|f|douleurs|J'ai une douleur au bras.|我的手臂疼。|3|health
a2-life-medecin|médecin|le médecin|医生|doctor|noun|health|/med.sɛ̃/|le|m|médecins|Le médecin arrive bientôt.|医生很快到。|2|health,people
a2-life-medicament|médicament|le médicament|药|medicine|noun|health|/me.di.ka.mɑ̃/|le|m|médicaments|Je prends ce médicament le soir.|我晚上吃这个药。|3|health
a2-life-malade|malade|malade|生病的|ill; sick|adjective|health|/ma.lad/||||Je suis malade aujourd'hui.|我今天生病了。|2|health
a2-life-fatigue|fatigué|fatigué|疲惫的|tired|adjective|health|/fa.ti.ɡe/||||Après le voyage, je suis fatigué.|旅行后我很累。|2|health
a2-life-reposer|se reposer|se reposer|休息|to rest|verb|health|/sə ʁə.po.ze/||||Je me repose après le travail.|工作后我休息。|2|health,verb
a2-life-nettoyer|nettoyer|nettoyer|清洁|to clean|verb|daily-life|/nɛ.twa.je/||||Je nettoie la table.|我清洁桌子。|3|home,verb
a2-life-reparer|réparer|réparer|修理|to repair|verb|daily-life|/ʁe.pa.ʁe/||||Il faut réparer la porte.|需要修理门。|3|home,verb
a2-life-casser|casser|casser|打碎；坏掉|to break|verb|daily-life|/ka.se/||||Le verre est cassé.|杯子碎了。|3|home,problems
a2-life-propre|propre|propre|干净的|clean|adjective|daily-life|/pʁɔpʁ/||||La chambre est propre.|房间很干净。|2|home,description
a2-life-bruyant|bruyant|bruyant|吵闹的|noisy|adjective|daily-life|/bʁɥi.jɑ̃/||||La rue est bruyante le soir.|这条街晚上很吵。|3|city,description
# opinions and connected speech
a2-opinion-avis|avis|un avis|意见|opinion|noun|opinions|/a.vi/|un|m|avis|Quel est ton avis ?|你的意见是什么？|2|opinion
a2-opinion-idee|idée|une idée|想法|idea|noun|opinions|/i.de/|une|f|idées|C'est une bonne idée.|这是个好主意。|2|opinion
a2-opinion-raison|raison|la raison|理由；道理|reason|noun|opinions|/ʁɛ.zɔ̃/|la|f|raisons|Quelle est la raison ?|原因是什么？|3|opinion
a2-opinion-choix|choix|le choix|选择|choice|noun|opinions|/ʃwa/|le|m|choix|Le choix est difficile.|这个选择很难。|2|opinion
a2-opinion-chose|chose|la chose|事情；东西|thing|noun|opinions|/ʃoz/|la|f|choses|Une chose est certaine.|有一件事是肯定的。|3|opinion
a2-opinion-penser|penser|penser|认为；思考|to think|verb|opinions|/pɑ̃.se/||||Je pense que c'est utile.|我认为这很有用。|2|opinion,verb
a2-opinion-esperer|espérer|espérer|希望|to hope|verb|opinions|/ɛs.pe.ʁe/||||J'espère que tu vas bien.|我希望你一切都好。|2|opinion,verb
a2-opinion-falloir|falloir|falloir|必须；需要|must; need|verb|opinions|/fa.lwaʁ/||||Il faut partir maintenant.|现在必须走。|2|modal,verb
a2-opinion-pouvoir-conditional|pourrais|pourrais|可以（条件式）|could|verb|opinions|/pu.ʁɛ/||||Tu pourrais répéter, s'il te plaît ?|你可以再说一遍吗？|3|politeness,verb
a2-opinion-utile|utile|utile|有用的|useful|adjective|opinions|/y.til/||||Cette application est utile.|这个应用很有用。|2|opinion,description
a2-opinion-pratique|pratique|pratique|实用的；方便的|practical; convenient|adjective|opinions|/pʁa.tik/||||Le métro est pratique.|地铁很方便。|2|opinion,description
a2-opinion-donc|donc|donc|所以；那么|therefore; so|adverb|opinions|/dɔ̃k/||||Il pleut, donc je reste ici.|下雨了，所以我留在这里。|2|connector
a2-opinion-puis|puis|puis|然后；接着|then|adverb|opinions|/pɥi/||||Je travaille, puis je rentre.|我工作，然后回家。|2|connector
a2-opinion-pendant|pendant|pendant|在……期间|during|preposition|opinions|/pɑ̃.dɑ̃/||||Pendant le voyage, je lis.|旅行期间我阅读。|3|connector,time
a2-opinion-deja|déjà|déjà|已经|already|adverb|opinions|/de.ʒa/||||J'ai déjà le billet.|我已经有票了。|2|time
a2-opinion-encore|encore|encore|还；再次|again; still|adverb|opinions|/ɑ̃.kɔʁ/||||Répétez encore, s'il vous plaît.|请再重复一遍。|2|communication
`, wordColumns);

const grammar = [
  ['a1-etre-identity','A1','identity','être: identity and description','être：身份与描述','Say who someone is and give a basic description.','subject + être + noun/adjective','Je suis étudiant. / Nous sommes ici.'],
  ['a1-avoir-needs','A1','needs','avoir: possession and needs','avoir：拥有与需要','Use avoir for possession, age and common needs.','subject + avoir + noun','J\'ai un livre. / Elle a faim.'],
  ['a1-present-er','A1','daily-life','Present tense: regular -er verbs','现在时：规则 -er 动词','Recognise and build common present-tense forms.','je -e, tu -es, il/elle -e, nous -ons, vous -ez, ils/elles -ent','Je parle français. / Nous regardons un film.'],
  ['a1-negation','A1','communication','Negation with ne...pas','ne...pas 否定','Put ne before and pas after the conjugated verb.','subject + ne + verb + pas','Je ne comprends pas. / Il n\'aime pas le thé.'],
  ['a1-questions','A1','communication','Basic questions','基础提问','Ask for a name, place, time or quantity.','question word + verb / rising intonation','Comment tu t\'appelles ? / Où est la gare ?'],
  ['a1-articles','A1','daily-life','Articles and gender','冠词与性别','Learn nouns together with their article and gender.','le/la/l\' + noun; un/une + noun','la table / un livre'],
  ['a1-prepositions-place','A1','places','Place: à, dans, sur','地点：à、dans、sur','Locate people and things with a small reliable set of prepositions.','être + à/dans/sur + place','Le livre est sur la table.'],
  ['a1-adjective-agreement','A1','description','Basic adjective agreement','基础形容词配合','Notice common feminine endings when describing a noun.','noun + adjective','une grande ville / un petit café'],
  ['a2-passe-compose','A2','travel','Passé composé with avoir','复合过去时：avoir','Talk about completed events using avoir plus a past participle.','subject + avoir (present) + past participle','J\'ai réservé une chambre.'],
  ['a2-passe-compose-etre','A2','travel','Passé composé with movement verbs','复合过去时：移动动词','Use être with a small set of movement and reflexive verbs; agreement matters.','subject + être (present) + past participle','Nous sommes arrivés tôt.'],
  ['a2-future-proche','A2','plans','Near future with aller','近期将来时：aller','Express a near plan with aller plus an infinitive.','aller (present) + infinitive','Je vais visiter le musée.'],
  ['a2-object-pronouns','A2','communication','Direct-object pronouns','直接宾语代词','Replace a known direct object with le, la or les before the verb.','subject + le/la/les + verb','Je le prends demain.'],
  ['a2-quantity-partitive','A2','food','Partitive articles and quantity','部分冠词与数量','Use du, de la, de l\' and des for an unspecified amount.','verb + du/de la/de l\'/des + noun','Je bois du lait.'],
  ['a2-comparison','A2','opinions','Comparison with plus/moins/aussi','比较：plus、moins、aussi','Compare two things with a simple adjective pattern.','plus/moins/aussi + adjective + que','Le métro est plus rapide que le bus.'],
  ['a2-relative-qui-que','A2','communication','Relative qui and que','关系代词 qui 和 que','Connect two short clauses without repeating a noun.','noun + qui/que + clause','Le livre que je lis est utile.'],
  ['a2-conditional-polite','A2','services','Polite requests with conditional','条件式礼貌请求','Use voudrais or pourriez for soft requests.','je voudrais / pourriez-vous + infinitive','Pourriez-vous répéter ?']
];

const expressions = [
  ['a1-exp-ca-va','A1','greetings','Ça va ?','你好吗？','How are you?','informal check-in'],
  ['a1-exp-ca-va-bien','A1','greetings','Ça va bien, merci.','我很好，谢谢。','I am well, thank you.','reply'],
  ['a1-exp-enchante','A1','identity','Enchanté(e).','很高兴认识你。','Nice to meet you.','meeting; gender ending optional in writing'],
  ['a1-exp-je-ne-sais-pas','A1','communication','Je ne sais pas.','我不知道。','I do not know.','useful repair phrase'],
  ['a1-exp-je-ne-comprends-pas','A1','communication','Je ne comprends pas.','我不明白。','I do not understand.','useful repair phrase'],
  ['a1-exp-repetez','A1','communication','Répétez, s\'il vous plaît.','请重复一遍。','Please repeat.','polite request'],
  ['a1-exp-ou-est','A1','places','Où est ... ?','……在哪里？','Where is ...?','ask for a location'],
  ['a1-exp-je-voudrais','A1','food','Je voudrais ...','我想要……','I would like ...','polite ordering frame'],
  ['a1-exp-quelle-heure','A1','time','Quelle heure est-il ?','现在几点？','What time is it?','ask the time'],
  ['a1-exp-a-tout-a-lheure','A1','greetings','À tout à l\'heure !','一会儿见！','See you later!','informal farewell'],
  ['a1-exp-bonne-journee','A1','greetings','Bonne journée !','祝你今天愉快！','Have a good day!','farewell'],
  ['a1-exp-cest-combien','A1','shopping','C\'est combien ?','这个多少钱？','How much is it?','informal price question'],
  ['a2-exp-jai-rendez-vous','A2','work-study','J\'ai rendez-vous à ...','我……点有预约。','I have an appointment at ...','time arrangement'],
  ['a2-exp-je-voudrais-reserver','A2','travel','Je voudrais réserver ...','我想预订……','I would like to book ...','service request'],
  ['a2-exp-pourriez-vous','A2','communication','Pourriez-vous m\'aider ?','您能帮我吗？','Could you help me?','formal polite request'],
  ['a2-exp-il-y-a-du-retard','A2','travel','Il y a du retard.','有延误。','There is a delay.','transport update'],
  ['a2-exp-je-suis-en-retard','A2','work-study','Je suis en retard.','我迟到了。','I am late.','apology context'],
  ['a2-exp-quest-ce-que-vous-pensez','A2','opinions','Qu\'est-ce que vous en pensez ?','您对此怎么看？','What do you think about it?','ask an opinion'],
  ['a2-exp-je-pense-que','A2','opinions','Je pense que ...','我认为……','I think that ...','give an opinion'],
  ['a2-exp-ca-me-va','A2','plans','Ça me va.','我可以；这对我合适。','That works for me.','agree to a plan'],
  ['a2-exp-ca-ne-marche-pas','A2','problems','Ça ne marche pas.','这个不工作了。','It does not work.','report a problem'],
  ['a2-exp-je-vais-reflechir','A2','opinions','Je vais y réfléchir.','我会考虑一下。','I will think about it.','delay a decision'],
  ['a2-exp-bon-retablissement','A2','health','Bon rétablissement !','祝早日康复！','Get well soon!','health wish'],
  ['a2-exp-on-se-tient-au-courant','A2','communication','On se tient au courant.','我们保持联系。','Let us keep each other posted.','work-friendly close']
];

const readings = [
  ['a1-reading-cafe','A1','food','Au café','在咖啡馆','Bonjour. Je voudrais un café et un pain, s\'il vous plaît. — Voilà. C\'est trois euros. — Merci beaucoup.','你好。我想要一杯咖啡和一块面包，谢谢。——给您。一共三欧元。——非常感谢。','What does the customer order?|How much is it?'],
  ['a1-reading-introduction','A1','identity','Une nouvelle amie','一位新朋友','Salut ! Je m\'appelle Lina. J\'habite à Lyon et j\'étudie le français. J\'aime la musique et les films.','你好！我叫Lina。我住在里昂，学习法语。我喜欢音乐和电影。','What is her name?|Where does she live?'],
  ['a1-reading-station','A1','places','À la gare','在车站','Pardon, où est la gare ? — La gare est là-bas, près du parc. — Merci ! — De rien.','不好意思，车站在哪里？——车站在那边，靠近公园。——谢谢！——不客气。','Where is the station?|What is near the station?'],
  ['a1-reading-routine','A1','daily-life','Une journée simple','简单的一天','Le matin, Paul travaille. À midi, il mange au restaurant. Le soir, il écoute de la musique à la maison.','早上，Paul工作。中午，他在餐馆吃饭。晚上，他在家听音乐。','When does Paul work?|Where does he listen to music?'],
  ['a2-reading-hotel','A2','travel','Réserver une chambre','预订房间','Bonjour, je voudrais réserver une chambre pour deux nuits, du vendredi au dimanche. — Oui, nous avons une chambre calme près de la gare. — Parfait, merci.','你好，我想从周五到周日预订一间房，两晚。——可以，我们有一间靠近车站的安静房间。——太好了，谢谢。','How many nights?|Where is the room?'],
  ['a2-reading-delay','A2','travel','Un train en retard','火车晚点','Le train pour Marseille a quinze minutes de retard. Marie envoie un message : « J\'arrive un peu plus tard. Rendez-vous devant la gare à dix heures quinze. »','去马赛的火车晚点15分钟。Marie发消息：“我会晚一点到。10点15分在车站前见。”','Why is Marie late?|Where do they meet?'],
  ['a2-reading-work','A2','work-study','Un message de travail','一条工作消息','Bonjour Sami, la réunion commence à neuf heures, mais je suis encore dans le métro. Peux-tu préparer le document ? Je t\'envoie les informations dans cinq minutes.','你好Sami，会议九点开始，但我还在地铁上。你能准备文件吗？我五分钟后把信息发给你。','Where is the writer?|What will arrive in five minutes?'],
  ['a2-reading-health','A2','health','Après le médecin','看医生后','Le médecin conseille à Nora de se reposer et de prendre ce médicament le soir. Elle ne travaille pas demain parce qu\'elle est encore fatiguée.','医生建议Nora休息并在晚上服用这个药。她明天不工作，因为还很累。','What does the doctor advise?|Why does Nora not work tomorrow?']
];

const sentenceBuilders = [
  ['a1-builder-identity','A1','identity','Je m\'appelle + [name].','Use for your name.','Je m\'appelle Mei.'],
  ['a1-builder-home','A1','identity','J\'habite à + [city].','Use à with a city.','J\'habite à Paris.'],
  ['a1-builder-like','A1','likes','J\'aime + [noun / infinitive].','State a simple preference.','J\'aime la musique.'],
  ['a1-builder-order','A1','food','Je voudrais + [item], s\'il vous plaît.','Polite ordering.','Je voudrais un thé, s\'il vous plaît.'],
  ['a1-builder-location','A1','places','Où est + [place] ?','Ask where a place is.','Où est la gare ?'],
  ['a1-builder-time','A1','time','Il est + [number] heure(s).','Give the current time.','Il est deux heures.'],
  ['a1-builder-need','A1','needs','J\'ai besoin de + [noun].','State a need; use d\' before a vowel.','J\'ai besoin d\'eau.'],
  ['a1-builder-negative','A1','communication','Je ne + [verb] + pas.','Make a present-tense sentence negative.','Je ne comprends pas.'],
  ['a2-builder-plan','A2','plans','Je vais + [infinitive] + [time].','State a near-future plan.','Je vais visiter le musée samedi.'],
  ['a2-builder-past','A2','travel','J\'ai + [past participle] + [detail].','Report a completed action with avoir.','J\'ai réservé une chambre.'],
  ['a2-builder-opinion','A2','opinions','Je pense que + [clause].','Give a reasoned basic opinion.','Je pense que le métro est pratique.'],
  ['a2-builder-compare','A2','opinions','A est plus + [adjective] + que B.','Compare two things.','Le train est plus rapide que le bus.'],
  ['a2-builder-request','A2','services','Pourriez-vous + [infinitive] ?','Make a polite formal request.','Pourriez-vous répéter ?'],
  ['a2-builder-problem','A2','problems','Il y a + [problem].','Report a basic issue.','Il y a un problème avec la porte.'],
  ['a2-builder-arrangement','A2','plans','On se retrouve à + [place/time].','Make an arrangement.','On se retrouve à la gare à neuf heures.'],
  ['a2-builder-reason','A2','opinions','... parce que + [clause].','Add a short reason.','Je reste ici parce qu\'il pleut.']
];

const shadowing = [
  ['a1-shadow-greeting','A1','greetings','Bonjour, je m\'appelle Lina. Enchantée !','Hello, my name is Lina. Nice to meet you.','Listen once, then repeat in two thought groups.'],
  ['a1-shadow-order','A1','food','Je voudrais un thé avec du lait, s\'il vous plaît.','I would like a tea with milk, please.','Link voudrais un without pausing.'],
  ['a1-shadow-place','A1','places','Pardon, où est la gare ?','Excuse me, where is the station?','Raise intonation on the question.'],
  ['a1-shadow-time','A1','time','Aujourd\'hui, c\'est lundi et il est huit heures.','Today is Monday and it is eight o\'clock.','Pause after aujourd\'hui.'],
  ['a1-shadow-need','A1','needs','Je ne comprends pas. Répétez, s\'il vous plaît.','I do not understand. Please repeat.','Keep ne...pas as one rhythm unit.'],
  ['a1-shadow-routine','A1','daily-life','Le matin, je travaille, puis je rentre à la maison.','In the morning, I work, then I go home.','Notice the final consonant is often not released.'],
  ['a1-shadow-like','A1','likes','J\'aime la musique, mais je préfère ce film.','I like music, but I prefer this film.','Stress the contrast after mais.'],
  ['a1-shadow-weather','A1','weather','Il y a du soleil, alors nous allons au parc.','It is sunny, so we are going to the park.','Chunk after soleil.'],
  ['a2-shadow-booking','A2','travel','Je voudrais réserver une chambre pour deux nuits.','I would like to reserve a room for two nights.','Link réserver une in one smooth group.'],
  ['a2-shadow-delay','A2','travel','Le train a quinze minutes de retard, donc j\'arrive plus tard.','The train is fifteen minutes late, so I arrive later.','Use a short pause before donc.'],
  ['a2-shadow-meeting','A2','work-study','La réunion commence à neuf heures, mais je suis encore dans le métro.','The meeting starts at nine, but I am still on the metro.','Keep commence à connected.'],
  ['a2-shadow-opinion','A2','opinions','Je pense que cette application est pratique et très utile.','I think this application is practical and very useful.','Use a rising then falling information rhythm.'],
  ['a2-shadow-health','A2','health','Le médecin conseille de se reposer et de prendre ce médicament.','The doctor advises resting and taking this medicine.','Keep de se reposer together.'],
  ['a2-shadow-direction','A2','travel','Continuez tout droit, puis tournez à gauche après la pharmacie.','Go straight on, then turn left after the pharmacy.','Make a clear break after droit.'],
  ['a2-shadow-message','A2','communication','Je t\'envoie les informations dès que possible.','I will send you the information as soon as possible.','Link t\'envoie and les informations.'],
  ['a2-shadow-plan','A2','plans','On se retrouve devant la gare à dix heures quinze ?','Shall we meet in front of the station at 10:15?','Use rising intonation for confirmation.']
];

// A short form keeps larger lexical coverage readable.  The build step owns
// the controlled, lemma-aware example rules; never put generic placeholder
// examples in this source table.
const shortColumns = ['id','lemma','meaningCN','meaningEN','partOfSpeech','topic','ipa','article','gender','plural','difficulty','tags'];
const expandShortWord = (row) => ({
  ...row,
  displayForm: row.article ? `${row.article} ${row.lemma}` : row.lemma,
  exampleSentence: '',
  exampleMeaningCN: '',
  needsEditorialExample: true
});
const additionalA1Words = splitRows(`
a1-number-quatre|quatre|四|four|number|numbers|/katʁ/||||1|numbers
a1-number-cinq|cinq|五|five|number|numbers|/sɛ̃k/||||1|numbers
a1-number-six|six|六|six|number|numbers|/sis/||||1|numbers
a1-number-sept|sept|七|seven|number|numbers|/sɛt/||||1|numbers
a1-number-huit|huit|八|eight|number|numbers|/ɥit/||||1|numbers
a1-number-neuf|neuf|九|nine|number|numbers|/nœf/||||1|numbers
a1-number-dix|dix|十|ten|number|numbers|/dis/||||1|numbers
a1-time-mardi|mardi|星期二|Tuesday|noun|time|/maʁ.di/|le|m|mardis|1|time
a1-time-mercredi|mercredi|星期三|Wednesday|noun|time|/mɛʁ.kʁə.di/|le|m|mercredis|1|time
a1-time-jeudi|jeudi|星期四|Thursday|noun|time|/ʒø.di/|le|m|jeudis|1|time
a1-time-vendredi|vendredi|星期五|Friday|noun|time|/vɑ̃.dʁə.di/|le|m|vendredis|1|time
a1-time-samedi|samedi|星期六|Saturday|noun|time|/sam.di/|le|m|samedis|1|time
a1-time-dimanche|dimanche|星期日|Sunday|noun|time|/di.mɑ̃ʃ/|le|m|dimanches|1|time
a1-family-grand-mere|grand-mère|祖母；外祖母|grandmother|noun|family|/ɡʁɑ̃.mɛʁ/|la|f|grands-mères|2|family
a1-family-grand-pere|grand-père|祖父；外祖父|grandfather|noun|family|/ɡʁɑ̃.pɛʁ/|le|m|grands-pères|2|family
a1-family-cousin|cousin|堂/表兄弟|cousin (male)|noun|family|/ku.zɛ̃/|un|m|cousins|2|family
a1-family-cousine|cousine|堂/表姐妹|cousin (female)|noun|family|/ku.zin/|une|f|cousines|2|family
a1-body-tete|tête|头|head|noun|body|/tɛt/|la|f|têtes|1|body
a1-body-main|main|手|hand|noun|body|/mɛ̃/|la|f|mains|1|body
a1-body-yeux|œil|眼睛|eye|noun|body|/œj/|l’|m|yeux|2|body
a1-body-bras|bras|手臂|arm|noun|body|/bʁa/|le|m|bras|1|body
a1-clothes-robe|robe|连衣裙|dress|noun|clothes|/ʁɔb/|la|f|robes|1|clothes
a1-clothes-pantalon|pantalon|裤子|trousers|noun|clothes|/pɑ̃.ta.lɔ̃/|le|m|pantalons|1|clothes
a1-clothes-chaussure|chaussure|鞋|shoe|noun|clothes|/ʃo.syʁ/|la|f|chaussures|1|clothes
a1-clothes-manteau|manteau|外套|coat|noun|clothes|/mɑ̃.to/|le|m|manteaux|2|clothes
a1-clothes-blanc|blanc|白色的|white|adjective|clothes|/blɑ̃/||||1|colour
a1-clothes-noir|noir|黑色的|black|adjective|clothes|/nwaʁ/||||1|colour
a1-food-banane|banane|香蕉|banana|noun|food|/ba.nan/|la|f|bananes|1|food
a1-food-orange|orange|橙子|orange|noun|food|/ɔ.ʁɑ̃ʒ/|une|f|oranges|1|food
a1-food-riz|riz|米饭|rice|noun|food|/ʁi/|le|m|riz|1|food
a1-food-viande|viande|肉|meat|noun|food|/vjɑ̃d/|la|f|viandes|2|food
a1-food-legume|légume|蔬菜|vegetable|noun|food|/le.ɡym/|un|m|légumes|2|food
a1-food-sucre|sucre|糖|sugar|noun|food|/sykʁ/|le|m|sucres|1|food
a1-weather-vent|vent|风|wind|noun|weather|/vɑ̃/|le|m|vents|2|weather
a1-weather-nuage|nuage|云|cloud|noun|weather|/nɥaʒ/|le|m|nuages|2|weather
a1-weather-humide|humide|潮湿的|humid|adjective|weather|/y.mid/||||2|weather
a1-weather-sec|sec|干燥的|dry|adjective|weather|/sɛk/||||2|weather
a1-daily-dormir|dormir|睡觉|to sleep|verb|daily-life|/dɔʁ.miʁ/||||2|routine
a1-daily-se-lever|se lever|起床|to get up|verb|daily-life|/sə lə.ve/||||2|routine
a1-daily-rentrer|rentrer|回家；返回|to return|verb|daily-life|/ʁɑ̃.tʁe/||||2|movement
a1-daily-ouvrir|ouvrir|打开|to open|verb|daily-life|/u.vʁiʁ/||||2|home
a1-daily-fermer|fermer|关闭|to close|verb|daily-life|/fɛʁ.me/||||2|home
a1-daily-aussi|aussi|也|also|adverb|daily-life|/o.si/||||1|connector
a1-daily-toujours|toujours|总是；仍然|always; still|adverb|daily-life|/tu.ʒuʁ/||||2|time
a1-study-ecrire|écrire|写|to write|verb|study|/e.kʁiʁ/||||2|study
a1-study-lire|lire|读|to read|verb|study|/liʁ/||||2|study
a1-study-dessiner|dessiner|画画|to draw|verb|study|/de.si.ne/||||2|leisure
a1-leisure-sport|sport|运动|sport|noun|leisure|/spɔʁ/|le|m|sports|1|leisure
a1-leisure-jeu|jeu|游戏|game|noun|leisure|/ʒø/|le|m|jeux|1|leisure
a1-leisure-oiseau|oiseau|鸟|bird|noun|leisure|/wa.zo/|un|m|oiseaux|2|animals
`, shortColumns).map(expandShortWord);

const additionalA2Words = splitRows(`
a2-food-supermarche|supermarché|超市|supermarket|noun|food|/sy.pɛʁ.maʁ.ʃe/|le|m|supermarchés|2|shopping
a2-food-marche|marché|市场|market|noun|food|/maʁ.ʃe/|le|m|marchés|2|shopping
a2-food-boulangerie|boulangerie|面包店|bakery|noun|food|/bu.lɑ̃.ʒʁi/|la|f|boulangeries|2|shopping
a2-food-boucherie|boucherie|肉店|butcher's|noun|food|/bu.ʃʁi/|la|f|boucheries|3|shopping
a2-food-poisson|poisson|鱼|fish|noun|food|/pwa.sɔ̃/|le|m|poissons|2|food
a2-food-poulet|poulet|鸡肉；鸡|chicken|noun|food|/pu.lɛ/|le|m|poulets|2|food
a2-food-oeuf|œuf|鸡蛋|egg|noun|food|/œf/|un|m|œufs|2|food
a2-food-beurre|beurre|黄油|butter|noun|food|/bœʁ/|le|m|beurres|2|food
a2-food-confiture|confiture|果酱|jam|noun|food|/kɔ̃.fi.tyʁ/|la|f|confitures|3|food
a2-food-salade|salade|沙拉|salad|noun|food|/sa.lad/|la|f|salades|2|food
a2-food-soupe|soupe|汤|soup|noun|food|/sup/|la|f|soupes|2|food
a2-food-dessert|dessert|甜点|dessert|noun|food|/de.sɛʁ/|le|m|desserts|2|food
a2-food-assiette|assiette|盘子|plate|noun|food|/a.sjɛt/|une|f|assiettes|2|restaurant
a2-food-verre|verre|玻璃杯|glass|noun|food|/vɛʁ/|un|m|verres|2|restaurant
a2-food-couteau|couteau|刀|knife|noun|food|/ku.to/|un|m|couteaux|2|restaurant
a2-food-fourchette|fourchette|叉子|fork|noun|food|/fuʁ.ʃɛt/|une|f|fourchettes|2|restaurant
a2-food-servir|servir|服务；端上|to serve|verb|food|/sɛʁ.viʁ/||||3|restaurant
a2-food-cuisiner|cuisiner|做饭|to cook|verb|food|/kɥi.zi.ne/||||2|food
a2-food-commander|commander|点餐；订购|to order|verb|food|/kɔ.mɑ̃.de/||||2|restaurant
a2-food-gouter|goûter|品尝|to taste|verb|food|/ɡu.te/||||3|food
a2-city-mairie|mairie|市政厅|town hall|noun|city|/mɛ.ʁi/|la|f|mairies|3|services
a2-city-bibliotheque|bibliothèque|图书馆|library|noun|city|/bi.bljo.tɛk/|la|f|bibliothèques|2|city
a2-city-musee|musée|博物馆|museum|noun|city|/my.ze/|le|m|musées|2|city
a2-city-cinema|cinéma|电影院|cinema|noun|city|/si.ne.ma/|le|m|cinémas|2|leisure
a2-city-banqe|banque|银行|bank|noun|city|/bɑ̃k/|la|f|banques|2|services
a2-city-poste|poste|邮局|post office|noun|city|/pɔst/|la|f|postes|2|services
a2-city-piscine|piscine|游泳池|swimming pool|noun|city|/pi.sin/|la|f|piscines|2|leisure
a2-city-stade|stade|体育场|stadium|noun|city|/stad/|le|m|stades|2|leisure
a2-city-pont|pont|桥|bridge|noun|city|/pɔ̃/|le|m|ponts|2|city
a2-city-feu|feu|红绿灯；火|traffic light; fire|noun|city|/fø/|le|m|feux|3|city
a2-city-carrefour|carrefour|十字路口|crossroads|noun|city|/kaʁ.fuʁ/|le|m|carrefours|3|city
a2-city-trottoir|trottoir|人行道|pavement|noun|city|/tʁɔ.twaʁ/|le|m|trottoirs|3|city
a2-city-ascenseur|ascenseur|电梯|lift|noun|city|/a.sɑ̃.sœʁ/|un|m|ascenseurs|3|services
a2-city-etage|étage|楼层|floor|noun|city|/e.taʒ/|un|m|étages|2|home
a2-city-entree|entrée|入口；前菜|entrance|noun|city|/ɑ̃.tʁe/|une|f|entrées|2|city
a2-city-sortie|sortie|出口|exit|noun|city|/sɔʁ.ti/|la|f|sorties|2|city
a2-city-traverser|traverser|穿过|to cross|verb|city|/tʁa.vɛʁ.se/||||3|directions
a2-city-monter|monter|上去|to go up|verb|city|/mɔ̃.te/||||2|directions
a2-city-descendre|descendre|下去；下车|to get off|verb|city|/de.sɑ̃dʁ/||||2|directions
a2-city-suivre|suivre|跟随|to follow|verb|city|/sɥi.vʁ/||||3|directions
a2-work-entreprise|entreprise|公司|company|noun|work-study|/ɑ̃.tʁə.pʁiz/|une|f|entreprises|2|work
a2-work-bureau|bureau|办公室；书桌|office; desk|noun|work-study|/by.ʁo/|le|m|bureaux|2|work
a2-work-collegue|collègue|同事|colleague|noun|work-study|/kɔ.lɛɡ/|un|m|collègues|2|work
a2-work-client|client|客户|client|noun|work-study|/kli.jɑ̃/|un|m|clients|2|work
a2-work-contrat|contrat|合同|contract|noun|work-study|/kɔ̃.tʁa/|le|m|contrats|3|work
a2-work-salaire|salaire|工资|salary|noun|work-study|/sa.lɛʁ/|le|m|salaires|3|work
a2-work-formation|formation|培训|training|noun|work-study|/fɔʁ.ma.sjɔ̃/|la|f|formations|3|work
a2-work-candidature|candidature|申请|application|noun|work-study|/kɑ̃.di.da.tyʁ/|la|f|candidatures|3|work
a2-work-cv|CV|简历|CV|noun|work-study|/se.ve/|un|m|CV|3|work
a2-work-experience|expérience|经验|experience|noun|work-study|/ɛks.pe.ʁjɑ̃s/|une|f|expériences|3|work
a2-work-ordinateur|ordinateur|电脑|computer|noun|work-study|/ɔʁ.di.na.tœʁ/|un|m|ordinateurs|2|technology
a2-work-clavier|clavier|键盘|keyboard|noun|work-study|/kla.vje/|un|m|claviers|3|technology
a2-work-ecran|écran|屏幕|screen|noun|work-study|/e.kʁɑ̃/|un|m|écrans|2|technology
a2-work-fichier|fichier|文件|file|noun|work-study|/fi.ʃje/|un|m|fichiers|3|technology
a2-work-imprimer|imprimer|打印|to print|verb|work-study|/ɛ̃.pʁi.me/||||3|work
a2-work-telephoner|téléphoner|打电话|to phone|verb|work-study|/te.le.fɔ.ne/||||2|communication
a2-work-chercher-emploi|chercher un emploi|找工作|to look for work|verb|work-study|/ʃɛʁ.ʃe ɛ̃.n‿ɑ̃.plwa/||||3|work
a2-work-utiliser|utiliser|使用|to use|verb|work-study|/y.ti.li.ze/||||2|technology
a2-work-organiser|organiser|组织|to organise|verb|work-study|/ɔʁ.ɡa.ni.ze/||||3|work
a2-work-decider|décider|决定|to decide|verb|work-study|/de.si.de/||||3|work
a2-health-hopital|hôpital|医院|hospital|noun|health|/o.pi.tal/|l’|m|hôpitaux|2|health
a2-health-infirmier|infirmier|护士|nurse|noun|health|/ɛ̃.fiʁ.mje/|un|m|infirmiers|3|health
a2-health-ordonnance|ordonnance|处方|prescription|noun|health|/ɔʁ.dɔ.nɑ̃s/|une|f|ordonnances|3|health
a2-health-fievre|fièvre|发烧；热度|fever|noun|health|/fjɛvʁ/|la|f|fièvres|2|health
a2-health-rhume|rhume|感冒|cold|noun|health|/ʁym/|un|m|rhumes|2|health
a2-health-toux|toux|咳嗽|cough|noun|health|/tu/|la|f|toux|2|health
a2-health-ventre|ventre|肚子|stomach|noun|health|/vɑ̃tʁ/|le|m|ventres|2|body
a2-health-dos|dos|背部|back|noun|health|/do/|le|m|dos|2|body
a2-health-jambe|jambe|腿|leg|noun|health|/ʒɑ̃b/|la|f|jambes|2|body
a2-health-sante|santé|健康|health|noun|health|/sɑ̃.te/|la|f|santés|2|health
a2-health-urgence|urgence|紧急情况|emergency|noun|health|/yʁ.ʒɑ̃s/|une|f|urgences|3|health
a2-health-allergie|allergie|过敏|allergy|noun|health|/a.lɛʁ.ʒi/|une|f|allergies|3|health
a2-health-guerir|guérir|康复；治疗|to recover; heal|verb|health|/ɡe.ʁiʁ/||||3|health
a2-health-tousser|tousser|咳嗽|to cough|verb|health|/tu.se/||||2|health
a2-health-respirer|respirer|呼吸|to breathe|verb|health|/ʁɛs.pi.ʁe/||||3|health
a2-health-aller-mieux|aller mieux|好转|to feel better|verb|health|/a.le mjø/||||3|health
a2-health-grave|grave|严重的|serious|adjective|health|/ɡʁav/||||3|health
a2-health-douloureux|douloureux|疼痛的|painful|adjective|health|/du.lu.ʁø/||||3|health
a2-health-plein|plein|满的；饱的|full|adjective|health|/plɛ̃/||||2|description
a2-health-vide|vide|空的|empty|adjective|health|/vid/||||2|description
a2-home-meuble|meuble|家具|piece of furniture|noun|home|/mœbl/|un|m|meubles|2|home
a2-home-canape|canapé|沙发|sofa|noun|home|/ka.na.pe/|un|m|canapés|2|home
a2-home-lit|lit|床|bed|noun|home|/li/|un|m|lits|2|home
a2-home-frigo|frigo|冰箱|fridge|noun|home|/fʁi.ɡo/|un|m|frigos|2|home
a2-home-four|four|烤箱|oven|noun|home|/fuʁ/|un|m|fours|2|home
a2-home-lave-linge|lave-linge|洗衣机|washing machine|noun|home|/lav.lɛ̃ʒ/|un|m|lave-linge|3|home
a2-home-jardin|jardin|花园|garden|noun|home|/ʒaʁ.dɛ̃/|un|m|jardins|2|home
a2-home-balcon|balcon|阳台|balcony|noun|home|/bal.kɔ̃/|un|m|balcons|2|home
a2-home-loyer|loyer|房租|rent|noun|home|/lwa.je/|le|m|loyers|3|home
a2-home-proprietaire|propriétaire|房东；业主|owner; landlord|noun|home|/pʁɔ.pʁje.tɛʁ/|le|m|propriétaires|3|home
a2-home-demenager|déménager|搬家|to move house|verb|home|/de.me.na.ʒe/||||3|home
a2-home-louer|louer|租用|to rent|verb|home|/lu.e/||||2|home
a2-home-installer|installer|安装；安置|to install|verb|home|/ɛ̃s.ta.le/||||3|home
a2-home-ranger|ranger|收拾；整理|to tidy|verb|home|/ʁɑ̃.ʒe/||||2|home
a2-home-ameliorer|améliorer|改善|to improve|verb|home|/a.me.ljɔ.ʁe/||||3|home
a2-home-confortable|confortable|舒适的|comfortable|adjective|home|/kɔ̃.fɔʁ.ta.blə/||||2|home
a2-home-lumineux|lumineux|明亮的|bright|adjective|home|/ly.mi.nø/||||3|home
a2-home-sombre|sombre|昏暗的|dark|adjective|home|/sɔ̃bʁ/||||3|home
a2-home-spacieux|spacieux|宽敞的|spacious|adjective|home|/spa.sjø/||||3|home
a2-home-etroit|étroit|狭窄的|narrow|adjective|home|/e.tʁwa/||||3|home
a2-communication-appel|appel|电话；呼叫|call|noun|communication|/a.pɛl/|un|m|appels|2|communication
a2-communication-discussion|discussion|讨论|discussion|noun|communication|/dis.ky.sjɔ̃/|une|f|discussions|3|communication
a2-communication-conversation|conversation|谈话|conversation|noun|communication|/kɔ̃.vɛʁ.sa.sjɔ̃/|une|f|conversations|2|communication
a2-communication-invitation|invitation|邀请|invitation|noun|communication|/ɛ̃.vi.ta.sjɔ̃/|une|f|invitations|2|communication
a2-communication-anniversaire|anniversaire|生日|birthday|noun|communication|/a.ni.vɛʁ.sɛʁ/|un|m|anniversaires|2|social
a2-communication-fete|fête|聚会；节日|party; celebration|noun|communication|/fɛt/|une|f|fêtes|2|social
a2-communication-cadeau|cadeau|礼物|gift|noun|communication|/ka.do/|un|m|cadeaux|2|social
a2-communication-photo|photo|照片|photo|noun|communication|/fɔ.to/|une|f|photos|2|social
a2-communication-nouvelle|nouvelle|消息；新闻|news|noun|communication|/nu.vɛl/|une|f|nouvelles|2|communication
a2-communication-verite|vérité|真相；事实|truth|noun|communication|/ve.ʁi.te/|la|f|vérités|3|communication
a2-communication-accord|accord|同意；协议|agreement|noun|communication|/a.kɔʁ/|un|m|accords|3|communication
a2-communication-chance|chance|机会；运气|chance|noun|communication|/ʃɑ̃s/|une|f|chances|2|social
a2-communication-inviter|inviter|邀请|to invite|verb|communication|/ɛ̃.vi.te/||||2|social
a2-communication-accepter|accepter|接受|to accept|verb|communication|/ak.sɛp.te/||||2|communication
a2-communication-refuser|refuser|拒绝|to refuse|verb|communication|/ʁə.fy.ze/||||2|communication
a2-communication-proposer|proposer|建议；提议|to suggest|verb|communication|/pʁɔ.po.ze/||||2|communication
a2-communication-raconter|raconter|讲述|to tell|verb|communication|/ʁa.kɔ̃.te/||||3|communication
a2-communication-oublier|oublier|忘记|to forget|verb|communication|/u.bli.je/||||2|memory
a2-communication-se-souvenir|se souvenir|记得|to remember|verb|communication|/sə su.və.niʁ/||||3|memory
a2-communication-attendre|attendre|等待|to wait|verb|communication|/a.tɑ̃dʁ/||||2|time
a2-leisure-vacances|vacances|假期|holiday|noun|leisure|/va.kɑ̃s/|les|f|vacances|2|leisure
a2-leisure-plage|plage|海滩|beach|noun|leisure|/plaʒ/|la|f|plages|2|leisure
a2-leisure-montagne|montagne|山|mountain|noun|leisure|/mɔ̃.taɲ/|la|f|montagnes|2|nature
a2-leisure-riviere|rivière|河|river|noun|leisure|/ʁi.vjɛʁ/|la|f|rivières|3|nature
a2-leisure-foret|forêt|森林|forest|noun|leisure|/fɔ.ʁɛ/|la|f|forêts|3|nature
a2-leisure-arbre|arbre|树|tree|noun|leisure|/aʁbʁ/|un|m|arbres|2|nature
a2-leisure-fleur|fleur|花|flower|noun|leisure|/flœʁ/|une|f|fleurs|2|nature
a2-leisure-animal|animal|动物|animal|noun|leisure|/a.ni.mal/|un|m|animaux|2|nature
a2-leisure-chien|chien|狗|dog|noun|leisure|/ʃjɛ̃/|un|m|chiens|2|animals
a2-leisure-chat|chat|猫|cat|noun|leisure|/ʃa/|un|m|chats|2|animals
a2-leisure-nager|nager|游泳|to swim|verb|leisure|/na.ʒe/||||2|leisure
a2-leisure-marcher|marcher|走路|to walk|verb|leisure|/maʁ.ʃe/||||2|leisure
a2-leisure-courir|courir|跑步|to run|verb|leisure|/ku.ʁiʁ/||||3|leisure
a2-leisure-jouer|jouer|玩；演奏|to play|verb|leisure|/ʒu.e/||||2|leisure
a2-leisure-danser|danser|跳舞|to dance|verb|leisure|/dɑ̃.se/||||2|leisure
a2-leisure-chante|chanter|唱歌|to sing|verb|leisure|/ʃɑ̃.te/||||2|leisure
a2-money-argent|argent|钱|money|noun|money|/aʁ.ʒɑ̃/|l’|m|argent|2|money
a2-money-prix|prix|价格|price|noun|money|/pʁi/|le|m|prix|2|money
a2-money-facture|facture|账单；发票|bill; invoice|noun|money|/fak.tyʁ/|une|f|factures|3|money
a2-money-monnaie|monnaie|零钱；货币|change; currency|noun|money|/mɔ.nɛ/|la|f|monnaies|3|money
a2-money-carte|carte|卡；地图|card|noun|money|/kaʁt/|une|f|cartes|2|money
a2-money-especes|espèces|现金|cash|noun|money|/ɛs.pɛs/|les|f|espèces|3|money
a2-money-budget|budget|预算|budget|noun|money|/byd.ʒɛ/|le|m|budgets|3|money
a2-money-reduction|réduction|折扣|discount|noun|money|/ʁe.dyk.sjɔ̃/|une|f|réductions|3|shopping
a2-money-remboursement|remboursement|退款|refund|noun|money|/ʁɑ̃.buʁ.sə.mɑ̃/|un|m|remboursements|3|shopping
a2-money-depense|dépense|花费|expense|noun|money|/de.pɑ̃s/|une|f|dépenses|3|money
a2-money-payer|payer|付款|to pay|verb|money|/pɛ.je/||||2|money
a2-money-couter|coûter|花费；值多少钱|to cost|verb|money|/ku.te/||||2|money
a2-money-economiser|économiser|节省|to save|verb|money|/e.kɔ.nɔ.mi.ze/||||3|money
a2-money-choisir|choisir|选择|to choose|verb|money|/ʃwa.ziʁ/||||2|shopping
a2-money-essayer|essayer|试；尝试|to try|verb|money|/e.sɛ.je/||||2|shopping
a2-money-gratuit|gratuit|免费的|free|adjective|money|/ɡʁa.tɥi/||||3|money
a2-money-onereux|onéreux|昂贵的|expensive|adjective|money|/ɔ.ne.ʁø/||||3|money
a2-money-raisonnable|raisonnable|合理的|reasonable|adjective|money|/ʁɛ.zɔ.na.blə/||||3|money
a2-money-assez|assez|足够；相当|enough; quite|adverb|money|/a.se/||||2|quantity
a2-money-trop|trop|太多|too much|adverb|money|/tʁo/||||2|quantity
`, shortColumns).map(expandShortWord);

const expansionGrammar = [
  ['a1-pronouns','A1','identity','Subject pronouns','主语人称代词','Match je, tu, il/elle, nous, vous and ils/elles to the verb.','subject + verb','Nous parlons. / Elles arrivent.'],
  ['a1-possessives','A1','family','Possessives mon/ma/mes','物主词 mon/ma/mes','Choose a possessive to introduce family and belongings.','mon/ma/mes + noun','Ma mère est ici. / Mes amis arrivent.'],
  ['a1-demonstratives','A1','daily-life','Demonstratives ce/cette','指示词 ce/cette','Point to one known item with a basic demonstrative.','ce/cette + noun','Ce livre est intéressant. / Cette table est petite.'],
  ['a1-plural','A1','numbers','Plural nouns and articles','名词复数与冠词','Recognise common plural -s and the article les.','les + plural noun','Les chaussures sont noires.'],
  ['a1-imperative','A1','communication','Useful imperative','常用命令式','Understand short classroom and direction instructions.','verb + complement','Écoutez bien. / Regardez ici.'],
  ['a1-frequency','A1','daily-life','Frequency words','频率副词','Place simple frequency words in a daily-routine sentence.','subject + verb + souvent/toujours','Je travaille souvent le samedi.'],
  ['a1-weather','A1','weather','Weather with il y a','il y a 表达天气','Describe sun, rain and wind with one reliable frame.','Il y a + weather noun','Il y a du vent aujourd’hui.'],
  ['a1-linking','A1','communication','Simple links et/mais/parce que','简单连接词','Join two short ideas without making a long sentence.','clause + connector + clause','J’étudie parce que j’aime le français.'],
  ['a2-imparfait','A2','daily-life','Imparfait for background','未完成过去时背景描述','Recognise a background habit or description in the past.','stem + -ais/-ait/-ions','Avant, je travaillais ici.'],
  ['a2-future-simple','A2','plans','Simple future recognition','简单将来时识别','Recognise common future forms for plans and predictions.','infinitive + future ending','Demain, je partirai tôt.'],
  ['a2-reflexive','A2','daily-life','Reflexive verbs','自反动词','Use a reflexive pronoun for routine actions.','subject + me/te/se + verb','Je me repose le soir.'],
  ['a2-indirect-object','A2','communication','Indirect object with lui/leur','间接宾语 lui/leur','Avoid repeating a person after à.','subject + lui/leur + verb','Je lui réponds demain.'],
  ['a2-negation-extended','A2','opinions','More negation','扩展否定','Recognise jamais, rien and personne in common phrases.','ne + verb + jamais/rien','Je ne comprends rien.'],
  ['a2-questions-inversion','A2','services','Formal question forms','正式疑问句','Recognise inversion in service and written contexts.','verb-subject + question','Avez-vous une chambre ?'],
  ['a2-pronoun-y','A2','places','Pronoun y','代词 y','Replace a known place introduced by à/dans.','subject + y + verb','J’y vais demain.'],
  ['a2-agreement','A2','travel','Past-participle agreement','过去分词配合','Notice gender/number agreement after être.','être + participle agreement','Elle est arrivée tôt.'],
  ['a2-cause-result','A2','opinions','Cause and result','原因与结果','Link an explanation and a consequence.','parce que / donc','Il pleut, donc je reste ici.'],
  ['a2-time-sequencing','A2','plans','Time sequencing','时间顺序','Order actions with d’abord, puis and enfin.','d’abord + puis + enfin','D’abord je travaille, puis je rentre.']
];
const expansionExpressions = [
  ['a1-exp-bonjour-madame','A1','greetings','Bonjour madame/monsieur.','您好，女士/先生。','Hello ma’am/sir.','polite service greeting'],['a1-exp-comment-dit-on','A1','study','Comment dit-on ... en français ?','……用法语怎么说？','How do you say ... in French?','classroom repair'],['a1-exp-pouvez-vous-parler','A1','communication','Pouvez-vous parler lentement ?','您能说慢一点吗？','Can you speak slowly?','listening repair'],['a1-exp-je-suis-desole','A1','communication','Je suis désolé(e).','对不起。','I am sorry.','apology'],['a1-exp-pas-de-probleme','A1','communication','Pas de problème.','没问题。','No problem.','reassurance'],['a1-exp-de-rien','A1','greetings','De rien.','不客气。','You are welcome.','reply to thanks'],['a1-exp-bon-appetit','A1','food','Bon appétit !','祝你用餐愉快！','Enjoy your meal!','meal greeting'],['a1-exp-je-regarde','A1','daily-life','Je regarde seulement.','我只是看看。','I am just looking.','shopping'],['a1-exp-cest-ouvert','A1','places','C’est ouvert ?','开着吗？','Is it open?','shop check'],['a1-exp-a-quelle-heure','A1','time','À quelle heure ?','几点？','At what time?','time follow-up'],['a1-exp-je-suis-pret','A1','daily-life','Je suis prêt(e).','我准备好了。','I am ready.','routine'],['a1-exp-a-plus','A1','greetings','À plus !','回头见！','See you later!','informal farewell'],
  ['a2-exp-je-confirme','A2','work-study','Je vous confirme que ...','我向您确认……','I confirm that ...','work confirmation'],['a2-exp-est-ce-possible','A2','plans','Est-ce possible de ... ?','可以……吗？','Is it possible to ...?','polite request'],['a2-exp-je-vous-remercie','A2','communication','Je vous remercie pour ...','感谢您……','I thank you for ...','formal thanks'],['a2-exp-excusez-le-retard','A2','work-study','Excusez-moi pour le retard.','抱歉迟到了。','Sorry for the delay.','professional apology'],['a2-exp-je-ne-peux-pas','A2','plans','Je ne peux pas venir.','我不能来。','I cannot come.','decline'],['a2-exp-une-autre-fois','A2','plans','Une autre fois, peut-être.','也许下次吧。','Another time, perhaps.','soft decline'],['a2-exp-quel-domage','A2','social','Quel dommage !','真可惜！','What a pity!','reaction'],['a2-exp-felicitation','A2','social','Félicitations !','恭喜！','Congratulations!','reaction'],['a2-exp-bien-sur','A2','communication','Bien sûr.','当然。','Of course.','agreement'],['a2-exp-pas-encore','A2','time','Pas encore.','还没有。','Not yet.','status'],['a2-exp-tout-de-suite','A2','time','Tout de suite.','马上。','Right away.','time'],['a2-exp-ca-depend','A2','opinions','Ça dépend.','这要看情况。','It depends.','opinion'],['a2-exp-a-mon-avis','A2','opinions','À mon avis, ...','依我看……','In my opinion, ...','opinion'],['a2-exp-je-suis-daccord','A2','opinions','Je suis d’accord.','我同意。','I agree.','opinion'],['a2-exp-je-ne-suis-pas-daccord','A2','opinions','Je ne suis pas d’accord.','我不同意。','I do not agree.','opinion'],['a2-exp-quel-est-le-probleme','A2','problems','Quel est le problème ?','有什么问题？','What is the problem?','problem solving'],['a2-exp-il-faut','A2','health','Il faut consulter un médecin.','应该去看医生。','You need to see a doctor.','health advice'],['a2-exp-je-me-sens','A2','health','Je me sens mieux.','我感觉好些了。','I feel better.','health status'],['a2-exp-je-vous-appelle','A2','communication','Je vous appelle plus tard.','我晚点给您打电话。','I will call you later.','follow-up'],['a2-exp-bonne-chance','A2','social','Bonne chance !','祝你好运！','Good luck!','encouragement']
];
const expansionReadings = [
  ['a1-reading-class','A1','study','En classe','在课堂上','Le professeur dit : « Ouvrez le livre, s’il vous plaît. » Les étudiants lisent une question, puis écrivent une réponse.','老师说：“请打开书。”学生读一个问题，然后写一个答案。','What do students open?|What do they write?'],['a1-reading-weather','A1','weather','Le temps','天气','Aujourd’hui, il y a du soleil, mais le vent est froid. Paul prend son manteau avant d’aller au parc.','今天有阳光，但风很冷。Paul去公园前带上外套。','What is the weather like?|What does Paul take?'],['a1-reading-family','A1','family','Le dimanche','星期日','Le dimanche, ma grand-mère vient à la maison. Nous mangeons ensemble et nous regardons des photos.','星期日，我的祖母来家里。我们一起吃饭和看照片。','Who visits?|What do they look at?'],['a1-reading-shopping','A1','shopping','Au magasin','在商店','La robe rouge est jolie, mais elle est chère. Emma choisit une robe bleue parce qu’elle est moins chère.','红裙子漂亮，但很贵。Emma选了一条蓝裙子，因为它更便宜。','Which dress is expensive?|Why does Emma choose blue?'],
  ['a2-reading-invitation','A2','social','Une invitation','一份邀请','Salut Ana, samedi je fais une petite fête pour mon anniversaire. Est-ce que tu peux venir vers dix-neuf heures ? Apporte seulement ta bonne humeur !','你好Ana，周六我为生日办一个小聚会。你能19点左右来吗？只要带着好心情就行！','What is the event?|When should Ana come?'],['a2-reading-apartment','A2','home','Un appartement à louer','出租公寓','Appartement lumineux avec un balcon, près du métro. Le loyer est de huit cents euros par mois. La cuisine est équipée, mais la chambre est petite.','明亮公寓带阳台，靠近地铁。月租800欧元。厨房配套齐全，但卧室较小。','How much is the rent?|What is small?'],['a2-reading-pharmacy','A2','health','À la pharmacie','在药店','Bonjour, j’ai un rhume et je tousse beaucoup. — Prenez ce médicament trois fois par jour et reposez-vous. Si la fièvre continue, consultez un médecin.','你好，我感冒了而且咳得厉害。——每天吃三次这个药并休息。如果持续发烧，请去看医生。','What symptoms are mentioned?|When should the person see a doctor?'],['a2-reading-budget','A2','money','Un budget simple','简单预算','Ce mois-ci, Léa veut économiser. Elle compare les prix au supermarché et paie en espèces pour mieux contrôler ses dépenses.','这个月Léa想省钱。她在超市比较价格并用现金付款，以便更好控制开支。','What does Léa want to do?|Why does she pay cash?'],['a2-reading-directions','A2','city','Trouver la bibliothèque','寻找图书馆','Pour aller à la bibliothèque, continuez tout droit jusqu’au carrefour. Tournez à droite, traversez le pont et la bibliothèque est en face de la mairie.','去图书馆，请一直走到十字路口。右转，过桥，图书馆就在市政厅对面。','Where do you turn?|What is opposite the library?'],['a2-reading-project','A2','work-study','Un petit projet','一个小项目','Notre équipe prépare un projet pour vendredi. Sami organise les documents, Nora contacte le client et moi, j’imprime les photos. Ensuite, nous vérifions le budget ensemble.','我们团队准备周五的项目。Sami整理文件，Nora联系客户，我打印照片。然后我们一起核查预算。','Who contacts the client?|What does the team check together?']
];
const expansionBuilders = [
  ['a1-builder-possessive','A1','family','Voici mon/ma + [family member].','介绍一位家人。','Voici ma grand-mère.'],['a1-builder-weather','A1','weather','Il y a + [weather noun] + aujourd’hui.','说今天的天气。','Il y a du vent aujourd’hui.'],['a1-builder-classroom','A1','study','Ouvrez + [object], s’il vous plaît.','给出简单课堂指令。','Ouvrez le livre, s’il vous plaît.'],['a1-builder-shopping','A1','shopping','Je cherche + [item].','说明你在找什么。','Je cherche des chaussures noires.'],
  ['a2-builder-delay','A2','travel','Il y a + [duration] de retard.','说明交通延误。','Il y a quinze minutes de retard.'],['a2-builder-booking','A2','travel','Je voudrais réserver + [item] pour [duration].','预订服务。','Je voudrais réserver une chambre pour deux nuits.'],['a2-builder-message','A2','communication','Je vous envoie + [item] + [time].','说明发送安排。','Je vous envoie le document ce soir.'],['a2-builder-health','A2','health','J’ai mal à + [body part].','描述疼痛部位。','J’ai mal au ventre.'],['a2-builder-advice','A2','health','Il faut + [infinitive].','给出简单建议。','Il faut se reposer.'],['a2-builder-invite','A2','social','Est-ce que tu peux + [infinitive] ?','邀请或请求。','Est-ce que tu peux venir samedi ?'],['a2-builder-status','A2','work-study','Je suis + [adjective] + [time].','说明当前状态。','Je suis occupé cet après-midi.'],['a2-builder-money','A2','money','Ça coûte + [price].','说明价格。','Ça coûte vingt euros.']
];

module.exports = {
  a1WordRows: [...a1WordRows, ...additionalA1Words],
  a2WordRows: [...a2WordRows, ...additionalA2Words],
  grammar: [...grammar, ...expansionGrammar],
  expressions: [...expressions, ...expansionExpressions],
  readings: [...readings, ...expansionReadings],
  sentenceBuilders: [...sentenceBuilders, ...expansionBuilders],
  shadowing
};
