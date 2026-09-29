/* Build formal French A1/A2 JSON from compact editorial source tables. */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const source = require('./sources');

const root = path.resolve(__dirname, '..', '..');
const dataDir = path.join(root, 'cloudfunctions', 'quickstartFunctions', 'data');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
const writeJson = (name, value) => fs.writeFileSync(
  path.join(dataDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8'
);
const editorialSource = {
  kind: 'editorial',
  title: 'Original CEFR-aligned French learner content',
  license: 'Original content for this mini-program',
  url: null
};
const provenance = 'CEFR-aligned editorial selection; not an official CEFR word list or certification material.';

const legacyEnglish = {
  'greetings-bonjour':'hello; good day','greetings-salut':'hi; bye (informal)','greetings-au-revoir':'goodbye','greetings-merci':'thank you','greetings-sil-vous-plait':'please','greetings-excusez-moi':'excuse me; sorry','greetings-oui':'yes','greetings-non':'no','greetings-bienvenue':'welcome','greetings-a-bientot':'see you soon',
  'identity-je':'I','identity-tu':'you (informal singular)','identity-vous':'you (formal/plural)','identity-etre':'to be','identity-appeler':'to be called','identity-habiter':'to live','identity-francais':'French language','identity-francaise':'French (feminine)','identity-ville':'city','identity-pays':'country',
  'time-un':'one','time-deux':'two','time-trois':'three','time-aujourdhui':'today','time-demain':'tomorrow','time-hier':'yesterday','time-lundi':'Monday','time-semaine':'week','time-heure':'hour; o\'clock','time-maintenant':'now',
  'family-famille':'family','family-pere':'father','family-mere':'mother','family-parent':'parent; relative','family-frere':'brother','family-soeur':'sister','family-ami':'male friend','family-amie':'female friend','family-enfant':'child','family-personne':'person',
  'needs-avoir':'to have','needs-vouloir':'to want','needs-pouvoir':'can; to be able to','needs-besoin':'to need','needs-eau':'water','needs-faim':'hunger','needs-soif':'thirst','needs-aide':'help','needs-toilettes':'toilets','needs-probleme':'problem',
  'likes-aimer':'to like; love','likes-preferer':'to prefer','likes-adorer':'to love; adore','likes-faire':'to do; make','likes-manger':'to eat','likes-boire':'to drink','likes-musique':'music','likes-livre':'book','likes-cafe':'coffee; café','likes-film':'film; movie'
};
const legacyPlurals = {
  'identity-francais':'français','identity-ville':'villes','identity-pays':'pays','time-lundi':'lundis','time-semaine':'semaines','time-heure':'heures',
  'family-famille':'familles','family-pere':'pères','family-mere':'mères','family-parent':'parents','family-frere':'frères','family-soeur':'sœurs','family-ami':'amis','family-amie':'amies','family-enfant':'enfants','family-personne':'personnes',
  'needs-eau':'eaux','needs-faim':'faims','needs-soif':'soifs','needs-aide':'aides','needs-toilettes':'toilettes','needs-probleme':'problèmes',
  'likes-musique':'musiques','likes-livre':'livres','likes-cafe':'cafés','likes-film':'films'
};
// The original 60 A1 records predate the structured example fields.  Keep
// their IDs/audio keys intact, but give each lemma its own usable context.
const legacyExamples = {
  'greetings-bonjour':['Bonjour, Madame Martin !','您好，Martin 女士！'], 'greetings-salut':['Salut, Paul !','嗨，Paul！'],
  'greetings-au-revoir':['Au revoir, à demain !','再见，明天见！'], 'greetings-merci':['Merci pour votre aide.','谢谢您的帮助。'],
  'greetings-sil-vous-plait':['Un café, s\'il vous plaît.','请给我一杯咖啡。'], 'greetings-excusez-moi':['Excusez-moi, où est la gare ?','劳驾，车站在哪里？'],
  'greetings-oui':['Oui, je comprends.','是的，我明白。'], 'greetings-non':['Non, merci.','不用了，谢谢。'],
  'greetings-bienvenue':['Bienvenue dans notre classe !','欢迎来到我们的课堂！'], 'greetings-a-bientot':['À bientôt, Léa !','回头见，Léa！'],
  'identity-je':['Je suis étudiant.','我是学生。'], 'identity-tu':['Tu habites ici ?','你住在这里吗？'],
  'identity-vous':['Vous êtes prêts ?','您准备好了吗？'], 'identity-etre':['Paris est une grande ville.','巴黎是一座大城市。'],
  'identity-appeler':['Je m\'appelle Mei.','我叫 Mei。'], 'identity-habiter':['Nous habitons près du parc.','我们住在公园附近。'],
  'identity-francais':['Le français est intéressant.','法语很有趣。'], 'identity-francaise':['Elle est française.','她是法国人。'],
  'identity-ville':['Cette ville est calme.','这座城市很安静。'], 'identity-pays':['La France est un pays européen.','法国是一个欧洲国家。'],
  'time-un':['J\'ai un frère.','我有一个兄弟。'], 'time-deux':['Nous avons deux chats.','我们有两只猫。'],
  'time-trois':['Il est trois heures.','现在三点。'], 'time-aujourdhui':['Aujourd\'hui, je travaille.','今天我工作。'],
  'time-demain':['Demain, nous allons au musée.','明天我们去博物馆。'], 'time-hier':['Hier, il a plu.','昨天下雨了。'],
  'time-lundi':['Le lundi, j\'étudie le français.','星期一我学法语。'], 'time-semaine':['La semaine commence lundi.','一周从星期一开始。'],
  'time-heure':['Il est huit heures.','现在八点。'], 'time-maintenant':['Je pars maintenant.','我现在出发。'],
  'family-famille':['Ma famille est ici.','我的家人在这里。'], 'family-pere':['Mon père travaille aujourd\'hui.','我父亲今天工作。'],
  'family-mere':['Ma mère prépare le repas.','我母亲在准备饭菜。'], 'family-parent':['Un parent attend devant l\'école.','一位家长在学校门口等候。'],
  'family-frere':['Mon frère aime le sport.','我兄弟喜欢运动。'], 'family-soeur':['Ma sœur lit un livre.','我姐妹在读书。'],
  'family-ami':['Un ami arrive ce soir.','一位男性朋友今晚来。'], 'family-amie':['Une amie parle français.','一位女性朋友说法语。'],
  'family-enfant':['L\'enfant joue dans le parc.','孩子在公园里玩。'], 'family-personne':['Cette personne est gentille.','这个人很友善。'],
  'needs-avoir':['J\'ai un nouveau livre.','我有一本新书。'], 'needs-vouloir':['Je veux boire de l\'eau.','我想喝水。'],
  'needs-pouvoir':['Vous pouvez entrer.','您可以进来。'], 'needs-besoin':["J'ai besoin d'aide.",'我需要帮助。'],
  'needs-eau':['Je bois de l\'eau.','我喝水。'], 'needs-faim':["J'ai faim après le cours.",'课后我饿了。'],
  'needs-soif':["J'ai soif après le sport.",'运动后我渴了。'], 'needs-aide':["Merci pour votre aide.",'谢谢您的帮助。'],
  'needs-toilettes':['Les toilettes sont au premier étage.','洗手间在一楼。'], 'needs-probleme':['Il y a un problème avec la porte.','门有问题。'],
  'likes-aimer':["J'aime lire le soir.",'我喜欢晚上阅读。'], 'likes-preferer':['Je préfère le thé au café.','我更喜欢茶而不是咖啡。'],
  'likes-adorer':["J'adore ce film.",'我非常喜欢这部电影。'], 'likes-faire':['Nous faisons les devoirs.','我们做作业。'],
  'likes-manger':['Ils mangent au restaurant.','他们在餐馆吃饭。'], 'likes-boire':['Elle boit du thé.','她喝茶。'],
  'likes-musique':["J'écoute de la musique.",'我听音乐。'], 'likes-livre':['Ce livre est facile.','这本书很容易。'],
  'likes-cafe':['Le café est chaud.','咖啡是热的。'], 'likes-film':['Nous regardons un film.','我们看一部电影。']
};
const canonical = (value) => String(value).normalize('NFC').toLocaleLowerCase('fr-FR').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const spokenTextHash = (value) => crypto.createHash('sha256')
  .update(String(value).normalize('NFC').trim(), 'utf8')
  .digest('hex');
const cleanNullable = (value) => value === '' ? null : value;
const cap = (value) => value ? value[0].toLocaleUpperCase('fr-FR') + value.slice(1) : value;
const shortExampleOverrides = {
  'a1-number-quatre':['J\'ai quatre livres.','我有四本书。'], 'a1-number-cinq':['Nous sommes cinq dans la classe.','我们班有五个人。'],
  'a1-number-six':['Le bus arrive à six heures.','公交车六点到。'], 'a1-number-sept':['Le magasin ouvre à sept heures.','商店七点开门。'],
  'a1-number-huit':['Il est huit heures.','现在八点。'], 'a1-number-neuf':['Le cours commence à neuf heures.','课程九点开始。'], 'a1-number-dix':['J\'ai dix minutes.','我有十分钟。'],
  'a1-body-tete':["J'ai mal à la tête.",'我头疼。'], 'a1-body-main':['Elle lève la main.','她举起手。'],
  'a1-body-yeux':['Il ferme les yeux.','他闭上眼睛。'], 'a1-body-bras':["J'ai mal au bras.",'我手臂疼。'],
  'a1-weather-vent':['Le vent est fort aujourd\'hui.','今天风很大。'], 'a1-weather-nuage':['Un nuage cache le soleil.','一朵云遮住太阳。'],
  'a1-weather-humide':['Après la pluie, l\'air est humide.','下雨后空气很潮湿。'], 'a1-weather-sec':['En été, l\'air est sec.','夏天空气干燥。'],
  'a1-daily-dormir':['Je dors tôt le soir.','我晚上早睡。'], 'a1-daily-se-lever':['Je me lève à sept heures.','我七点起床。'],
  'a1-daily-rentrer':['Je rentre à la maison après le cours.','我课后回家。'], 'a1-daily-ouvrir':['Ouvre la fenêtre, s\'il te plaît.','请打开窗户。'],
  'a1-daily-fermer':['Je ferme la porte.','我关门。'], 'a1-daily-aussi':['Moi aussi, j\'aime ce film.','我也喜欢这部电影。'],
  'a1-daily-toujours':['Il arrive toujours à l\'heure.','他总是准时到。'], 'a1-study-ecrire':['J\'écris une réponse.','我写一个回答。'],
  'a1-study-lire':['Nous lisons le texte.','我们读这篇文章。'], 'a1-study-dessiner':['Elle dessine un chat.','她画一只猫。'],
  'a1-leisure-sport':['Le sport est bon pour la santé.','运动对健康有益。'], 'a1-leisure-jeu':['Le jeu commence maintenant.','游戏现在开始。'],
  'a1-leisure-oiseau':['Un oiseau chante dans le parc.','一只鸟在公园里唱歌。'],
  'a2-health-fievre':["J'ai de la fièvre depuis hier.",'我从昨天开始发烧。'], 'a2-health-rhume':["J'ai un rhume.",'我感冒了。'],
  'a2-health-toux':['Cette toux ne passe pas.','这阵咳嗽一直不好。'], 'a2-health-ventre':["J'ai mal au ventre.",'我肚子疼。'],
  'a2-health-dos':["J'ai mal au dos.",'我背疼。'], 'a2-health-jambe':["J'ai mal à la jambe.",'我腿疼。'],
  'a2-health-sante':['La santé est importante.','健康很重要。'], 'a2-health-urgence':['C\'est une urgence, appelez le médecin.','这是紧急情况，请叫医生。'],
  'a2-health-allergie':["J'ai une allergie au pollen.",'我对花粉过敏。'], 'a2-health-guerir':['Il va guérir bientôt.','他很快会康复。'],
  'a2-health-tousser':['Je tousse beaucoup la nuit.','我晚上咳得很厉害。'], 'a2-health-respirer':['Respirez lentement.','请慢慢呼吸。'],
  'a2-health-aller-mieux':['Je vais aller mieux demain.','我明天会好些。'], 'a2-health-grave':['Le problème n\'est pas grave.','问题并不严重。'],
  'a2-health-douloureux':['Cette blessure est douloureuse.','这个伤口很疼。'], 'a2-health-plein':['Après le repas, je suis plein.','饭后我饱了。'],
  'a2-health-vide':['La salle d\'attente est vide.','候诊室是空的。'],
  'a2-money-argent':["Je n'ai pas beaucoup d'argent.",'我没有很多钱。'], 'a2-money-prix':['Le prix est affiché ici.','价格标在这里。'],
  'a2-money-facture':['La facture arrive par courriel.','账单通过邮件寄来。'], 'a2-money-monnaie':['Avez-vous de la monnaie ?','您有零钱吗？'],
  'a2-money-carte':['Je paie par carte.','我刷卡付款。'], 'a2-money-especes':['Je paie en espèces.','我付现金。'],
  'a2-money-budget':['Notre budget est limité.','我们的预算有限。'], 'a2-money-reduction':['Cette réduction est valable aujourd\'hui.','这个折扣今天有效。'],
  'a2-money-remboursement':['Le remboursement arrive bientôt.','退款很快到账。'], 'a2-money-depense':['Cette dépense est nécessaire.','这笔开销是必要的。'],
  'a2-money-payer':['Je vais payer maintenant.','我现在付款。'], 'a2-money-couter':['Ce livre coûte dix euros.','这本书十欧元。'],
  'a2-money-economiser':['Nous voulons économiser pour le voyage.','我们想为旅行省钱。'], 'a2-money-choisir':['Je dois choisir une taille.','我得选一个尺码。'],
  'a2-money-essayer':['Je peux essayer cette veste ?','我可以试这件夹克吗？'], 'a2-money-gratuit':['L\'entrée est gratuite.','入场免费。'],
  'a2-money-onereux':['Cet hôtel est onéreux.','这家酒店很贵。'], 'a2-money-raisonnable':['Le prix est raisonnable.','价格合理。'],
  'a2-money-assez':['Il fait assez chaud aujourd\'hui.','今天相当暖和。'], 'a2-money-trop':['Ce sac est trop lourd.','这个包太重了。'],
  'a2-city-traverser':['Nous traversons la rue ici.','我们在这里过马路。'], 'a2-city-monter':['Je monte au deuxième étage.','我上二楼。'],
  'a2-city-descendre':['Je descends du bus ici.','我在这里下公交车。'], 'a2-city-suivre':['Suivez cette rue jusqu\'à la gare.','沿着这条街走到车站。'],
  'a2-work-imprimer':['J\'imprime le document.','我打印文件。'], 'a2-work-telephoner':['Je téléphone au client.','我给客户打电话。'],
  'a2-work-utiliser':['Nous utilisons cet ordinateur.','我们使用这台电脑。'], 'a2-work-organiser':['Elle organise la réunion.','她组织会议。'],
  'a2-work-decider':['Nous décidons ensemble.','我们一起决定。'],
  'a2-home-demenager':['Nous déménageons le mois prochain.','我们下个月搬家。'], 'a2-home-louer':['Ils louent un appartement.','他们租一套公寓。'],
  'a2-home-installer':['Il installe le lave-linge.','他安装洗衣机。'], 'a2-home-ranger':['Je range ma chambre.','我整理卧室。'],
  'a2-home-ameliorer':['Nous améliorons la cuisine.','我们改善厨房。'],
  'a2-communication-appel':["J'attends un appel.",'我在等电话。'], 'a2-communication-discussion':['Nous avons une discussion après le cours.','我们课后讨论。'],
  'a2-communication-conversation':['La conversation commence maintenant.','谈话现在开始。'], 'a2-communication-invitation':["J'envoie une invitation à Léa.",'我给 Léa 发邀请。'],
  'a2-communication-anniversaire':['Mon anniversaire est samedi.','我的生日在星期六。'], 'a2-communication-fete':['La fête commence à vingt heures.','聚会二十点开始。'],
  'a2-communication-cadeau':["J'ai un cadeau pour toi.",'我有一份礼物给你。'], 'a2-communication-photo':['Cette photo est très belle.','这张照片非常漂亮。'],
  'a2-communication-nouvelle':["J'ai une bonne nouvelle.",'我有一个好消息。'], 'a2-communication-verite':["C'est la vérité.",'这是真相。'],
  'a2-communication-accord':['Nous sommes d’accord.','我们同意。'], 'a2-communication-chance':['Bonne chance pour l’examen !','祝你考试好运！']
};
const naturalShortExample = (row, order) => {
  if (shortExampleOverrides[row.id]) return shortExampleOverrides[row.id];
  const displayed = row.displayForm || (row.article ? `${row.article} ${row.lemma}` : row.lemma);
  const indefinite = row.gender === 'f' ? `une ${row.lemma}` : `un ${row.lemma}`;
  if (row.partOfSpeech === 'number') return [`J'ai ${row.lemma} livres.`, `我有${row.meaningCN}本书。`];
  if (row.topic === 'time' && row.partOfSpeech === 'noun') return [`Nous sommes ${row.lemma}.`, `今天是${row.meaningCN}。`];
  if (row.topic === 'family') return [`${cap(displayed)} arrive ce soir.`, `${row.meaningCN}今晚来。`];
  if (row.topic === 'clothes' && row.partOfSpeech === 'noun') return [`Je porte ${displayed}.`, `我穿着这件${row.meaningCN}。`];
  if (row.topic === 'food' && row.partOfSpeech === 'noun') {
    if (/(supermarché|marché|boulangerie|boucherie)/.test(row.lemma)) return [`${cap(displayed)} est ouvert ce matin.`, `${row.meaningCN}今天早上开门。`];
    if (/(assiette|verre|couteau|fourchette)/.test(row.lemma)) return [`${cap(displayed)} est sur la table.`, `${row.meaningCN}在桌子上。`];
    return [`Je prends ${displayed} pour le repas.`, `我为这顿饭拿${row.meaningCN}。`];
  }
  if (row.topic === 'city' && row.partOfSpeech === 'noun') return [`${cap(displayed)} est près d'ici.`, `${row.meaningCN}就在这附近。`];
  if (row.topic === 'home' && row.partOfSpeech === 'noun') {
    if (row.id === 'a2-home-loyer') return [`Le loyer est payé chaque mois.`, `房租每月支付。`];
    if (row.id === 'a2-home-proprietaire') return [`Le propriétaire répond au message.`, `房东回复消息。`];
    return [`Dans cette maison, il y a ${indefinite}.`, `这所房子里有${row.meaningCN}。`];
  }
  if (row.topic === 'leisure' && row.partOfSpeech === 'noun') return [`J'aime ${displayed}.`, `我喜欢${row.meaningCN}。`];
  if (row.topic === 'communication' && row.partOfSpeech === 'noun') return [`Nous avons ${displayed} aujourd'hui.`, `我们今天有${row.meaningCN}。`];
  if (row.topic === 'work-study' && row.partOfSpeech === 'noun') {
    if (/(collègue|client)/.test(row.lemma)) return [`${cap(displayed)} arrive à neuf heures.`, `${row.meaningCN}九点到。`];
    if (/(ordinateur|clavier|écran|fichier)/.test(row.lemma)) return [`J'utilise ${displayed} au bureau.`, `我在办公室使用${row.meaningCN}。`];
    if (row.id === 'a2-work-entreprise') return [`Cette entreprise cherche un employé.`, `这家公司正在招聘员工。`];
    if (row.id === 'a2-work-bureau') return [`Le bureau est au deuxième étage.`, `办公室在二楼。`];
    if (row.id === 'a2-work-contrat') return [`Le contrat est prêt à signer.`, `合同准备好签署了。`];
    if (row.id === 'a2-work-salaire') return [`Le salaire arrive à la fin du mois.`, `工资在月底到账。`];
    if (row.id === 'a2-work-formation') return [`La formation commence lundi.`, `培训星期一开始。`];
    if (row.id === 'a2-work-candidature') return [`Ma candidature est envoyée.`, `我的申请已发送。`];
    if (row.id === 'a2-work-cv') return [`Mon CV est à jour.`, `我的简历是最新的。`];
    if (row.id === 'a2-work-experience') return [`Cette expérience est utile.`, `这段经验很有用。`];
    return [`Nous avons ${displayed} aujourd'hui.`, `我们今天有${row.meaningCN}。`];
  }
  if (row.partOfSpeech === 'noun') return [`${cap(displayed)} est ici.`, `${row.meaningCN}在这里。`];
  if (row.partOfSpeech === 'verb') {
    const infinitive = row.lemma.startsWith('se ') ? `me ${row.lemma.slice(3)}` : row.lemma;
    return [`Je vais ${infinitive} après le cours.`, `我课后会${row.meaningCN}。`];
  }
  if (row.partOfSpeech === 'adjective') return [`C'est ${row.lemma}.`, `这很${row.meaningCN}。`];
  if (row.partOfSpeech === 'adverb') return [`Je travaille ${row.lemma}.`, `我${row.meaningCN}工作。`];
  return [`J'utilise ${row.lemma} dans cette phrase.`, `我在这个句子中使用“${row.meaningCN}”。`];
};
const wordFromRow = (row, level, order) => {
  const [exampleSentence, exampleMeaningCN] = row.needsEditorialExample
    ? naturalShortExample(row, order)
    : [row.exampleSentence, row.exampleMeaningCN];
  return {
  id: row.id,
  text: row.lemma,
  display: row.displayForm,
  lemma: row.lemma,
  displayForm: row.displayForm,
  meaning: row.meaningCN,
  meaningCN: row.meaningCN,
  meaningEN: row.meaningEN,
  partOfSpeech: row.partOfSpeech,
  cefrLevel: level,
  topic: row.topic,
  ipa: row.ipa,
  article: cleanNullable(row.article),
  gender: cleanNullable(row.gender),
  plural: cleanNullable(row.plural),
  exampleSentence,
  exampleMeaningCN,
  difficulty: Number(row.difficulty),
  tags: row.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
  order,
  audioKey: row.id,
  audioRef: `french-audio/v2/words/${row.id}.mp3`,
  source: editorialSource,
  provenance
  };
};
const enrichLegacyWord = (item) => {
  const [exampleSentence, exampleMeaningCN] = legacyExamples[item.id];
  const isNoun = item.partOfSpeech === 'noun';
  return {
    ...item,
    displayForm: item.display,
    meaningCN: item.meaning,
    meaningEN: legacyEnglish[item.id],
    cefrLevel: 'A1',
    plural: isNoun ? legacyPlurals[item.id] : null,
    exampleSentence,
    exampleMeaningCN,
    difficulty: item.topic === 'greetings' || item.topic === 'identity' ? 1 : 2,
    tags: [item.topic, 'core-a1'],
    audioRef: `french-audio/v1/words/${item.audioKey}.mp3`,
    source: editorialSource,
    provenance
  };
};
const contentDocument = (level, topics, items) => ({
  schemaVersion: 2,
  language: 'fr-FR',
  level,
  cefrAlignment: 'Editorially CEFR-aligned; not an official CEFR list or certification material.',
  topics,
  items
});

const records = (rows, mapper) => rows.map((row, index) => mapper(row, index + 1));
const buildStructured = (rows, fields) => rows.map((row) => Object.fromEntries(fields.map((key, index) => [key, row[index]])));

const oldA1 = readJson('french-a1-words.json');
const oldSentences = readJson('french-a1-sentences.json');
const oldManifest = readJson('french-audio-manifest.json');
const legacyManifestEntries = oldManifest.items.filter((item) => /^french-audio\/v1\//.test(String(item.cloudPath || '')));
const invalidLegacyFileIds = legacyManifestEntries.filter((item) => (
  typeof item.fileId !== 'string'
  || !item.fileId.startsWith('cloud://')
  || !item.fileId.endsWith(item.cloudPath)
));
if (legacyManifestEntries.length !== 90 || invalidLegacyFileIds.length) {
  throw new Error(
    `Refusing to build: expected 90 valid preserved v1 Cloud File IDs; found ${legacyManifestEntries.length} v1 entries and ${invalidLegacyFileIds.length} invalid IDs.`
  );
}

const legacyA1 = oldA1.items.filter((item) => !String(item.id).startsWith('a1-')).map(enrichLegacyWord);
if (legacyA1.length !== 60) throw new Error(`Expected 60 legacy A1 words, found ${legacyA1.length}.`);
const a1Extra = records(source.a1WordRows, (row, order) => wordFromRow(row, 'A1', order));
const a2Words = records(source.a2WordRows, (row, order) => wordFromRow(row, 'A2', order));
const a1Words = [...legacyA1, ...a1Extra];

const grammarExampleTranslations = {
  'a1-etre-identity':['我是学生。','我们在这里。'], 'a1-avoir-needs':['我有一本书。','她饿了。'],
  'a1-present-er':['我说法语。','我们看一部电影。'], 'a1-negation':['我不明白。','他不喜欢茶。'],
  'a1-questions':['你叫什么名字？','车站在哪里？'], 'a1-articles':['这张桌子。','一本书。'],
  'a1-prepositions-place':['书在桌子上。'], 'a1-adjective-agreement':['一座大城市。','一家小咖啡馆。'],
  'a2-passe-compose':['我预订了一间房。'], 'a2-passe-compose-etre':['我们很早到了。'],
  'a2-future-proche':['我打算参观博物馆。'], 'a2-object-pronouns':['我明天拿它。'],
  'a2-quantity-partitive':['我喝牛奶。'], 'a2-comparison':['地铁比公交车快。'],
  'a2-relative-qui-que':['我正在读的书很有用。'], 'a2-conditional-polite':['您可以再说一遍吗？'],
  'a1-pronouns':['我们说话。','她们到了。'], 'a1-possessives':['我母亲在这里。','我的朋友们到了。'],
  'a1-demonstratives':['这本书很有意思。','这张桌子很小。'], 'a1-plural':['这些鞋是黑色的。'],
  'a1-imperative':['请认真听。','请看这里。'], 'a1-frequency':['我经常星期六工作。'],
  'a1-weather':['今天有风。'], 'a1-linking':['我学习，因为我喜欢法语。'],
  'a2-imparfait':['以前，我在这里工作。'], 'a2-future-simple':['明天我会早些出发。'],
  'a2-reflexive':['我晚上休息。'], 'a2-indirect-object':['我明天回复他/她。'],
  'a2-negation-extended':['我什么都不明白。'], 'a2-questions-inversion':['您有一间房吗？'],
  'a2-pronoun-y':['我明天去那里。'], 'a2-agreement':['她很早到了。'],
  'a2-cause-result':['下雨了，所以我留在这里。'], 'a2-time-sequencing':['我先工作，然后回家。']
};
const grammarItems = buildStructured(source.grammar, ['id','cefrLevel','topic','title','titleCN','outcome','pattern','examples']).map((item) => {
  const texts = item.examples.split(' / ');
  const translations = grammarExampleTranslations[item.id];
  if (!translations || translations.length !== texts.length) throw new Error(`Grammar translations missing for ${item.id}.`);
  return {
  ...item,
  shortExplanationCN: `用“${item.pattern}”完成本单元的基础交际任务。`,
  commonMistakes: ['只背单词而不带入句型。', '忽略主语、动词和否定词的位置。'],
  examples: texts.map((text, index) => ({ text, meaningCN: translations[index] })),
  source: editorialSource,
  provenance
  };
});
const expressionItems = buildStructured(source.expressions, ['id','cefrLevel','topic','text','meaningCN','meaningEN','usageNote']).map((item) => ({
  ...item,
  situation: item.usageNote,
  example: { text: item.text, meaningCN: item.meaningCN },
  audioKey: item.id,
  audioRef: `french-audio/v2/expressions/${item.id}.mp3`,
  source: editorialSource,
  provenance
}));
const readingItems = buildStructured(source.readings, ['id','cefrLevel','topic','title','titleCN','text','translationCN','questionText']).map((item) => ({
  ...item,
  comprehension: item.questionText.split('|').map((question, index) => ({
    id: `${item.id}-q${index + 1}`,
    question,
    answer: item.text.split(/[.!?]/).filter(Boolean)[Math.min(index, item.text.split(/[.!?]/).filter(Boolean).length - 1)].trim(),
    answerCN: '答案可在原文对应句中找到。',
    explanationCN: '回到原文，圈出人物、时间、地点或动作信息。'
  })),
  audioKey: item.id,
  audioRef: `french-audio/v2/readings/${item.id}.mp3`,
  source: editorialSource,
  provenance,
  questionText: undefined
}));
const builderItems = buildStructured(source.sentenceBuilders, ['id','cefrLevel','topic','pattern','instructionCN','example']).map((item) => ({
  ...item,
  promptCN: item.instructionCN,
  answer: item.example,
  meaningCN: item.instructionCN,
  scrambledTokens: item.example.replace(/[?.!]/g, '').split(/\s+/).reverse(),
  slots: [...item.pattern.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]),
  source: editorialSource,
  provenance
}));
const shadowingMeaningCN = {
  'a1-shadow-greeting':'你好，我叫 Lina。很高兴认识你！', 'a1-shadow-order':'我想要一杯加牛奶的茶，谢谢。',
  'a1-shadow-place':'不好意思，车站在哪里？', 'a1-shadow-time':'今天是星期一，现在八点。',
  'a1-shadow-need':'我不明白。请再说一遍。', 'a1-shadow-routine':'早上我工作，然后回家。',
  'a1-shadow-like':'我喜欢音乐，但我更喜欢这部电影。', 'a1-shadow-weather':'有阳光，所以我们去公园。',
  'a2-shadow-booking':'我想预订一间房住两晚。', 'a2-shadow-delay':'火车晚点十五分钟，所以我晚点到。',
  'a2-shadow-meeting':'会议九点开始，但我还在地铁上。', 'a2-shadow-opinion':'我认为这个应用方便又很有用。',
  'a2-shadow-health':'医生建议休息并服用这个药。', 'a2-shadow-direction':'一直往前走，然后在药店后向左转。',
  'a2-shadow-message':'我会尽快把信息发给你。', 'a2-shadow-plan':'我们十点十五分在车站前见吗？'
};
let shadowingItems = buildStructured(source.shadowing, ['id','cefrLevel','topic','text','meaningEN','cue']).map((item) => ({
  ...item,
  meaningCN: shadowingMeaningCN[item.id],
  translationCN: shadowingMeaningCN[item.id],
  cueCN: `跟读提示：${item.cue}`,
  audioKey: item.id,
  audioRef: `french-audio/v2/shadowing/${item.id}.mp3`,
  source: editorialSource,
  provenance
}));
// Additional A2 shadowing prompts reuse the curated example sentence attached
// to each vocabulary item, giving learners short, controlled pronunciation turns.
shadowingItems = [
  ...shadowingItems,
  ...a1Words.filter((word) => word.id.startsWith('a1-')).slice(0, 7).map((word, index) => ({
    id: `a1-shadow-word-${String(index + 1).padStart(2, '0')}`,
    cefrLevel: 'A1', topic: word.topic, text: word.exampleSentence,
    meaningEN: null, meaningCN: word.exampleMeaningCN, translationCN: word.exampleMeaningCN,
    cue: 'Listen once and repeat in one short breath group.',
    cueCN: '先听一遍，再按一个短意群跟读。',
    audioKey: `a1-shadow-word-${String(index + 1).padStart(2, '0')}`,
    audioRef: `french-audio/v2/shadowing/a1-shadow-word-${String(index + 1).padStart(2, '0')}.mp3`,
    source: editorialSource, provenance
  })),
  ...a2Words.slice(0, 45).map((word, index) => ({
    id: `a2-shadow-word-${String(index + 1).padStart(2, '0')}`,
    cefrLevel: 'A2',
    topic: word.topic,
    text: word.exampleSentence,
    meaningEN: null,
    meaningCN: word.exampleMeaningCN,
    translationCN: word.exampleMeaningCN,
    cue: 'Listen once, mark one thought group, then shadow twice.',
    cueCN: '先听一遍，划分一个意群，再跟读两遍。',
    audioKey: `a2-shadow-word-${String(index + 1).padStart(2, '0')}`,
    audioRef: `french-audio/v2/shadowing/a2-shadow-word-${String(index + 1).padStart(2, '0')}.mp3`,
    source: editorialSource,
    provenance
  }))
];

writeJson('french-a1-words.json', contentDocument('A1', [...new Set(a1Words.map((item) => item.topic))], a1Words));
writeJson('french-a2-words.json', contentDocument('A2', [...new Set(a2Words.map((item) => item.topic))], a2Words));
writeJson('french-a1-a2-grammar.json', contentDocument('A1-A2', [...new Set(grammarItems.map((item) => item.topic))], grammarItems));
writeJson('french-a1-a2-expressions.json', contentDocument('A1-A2', [...new Set(expressionItems.map((item) => item.topic))], expressionItems));
writeJson('french-a1-a2-readings.json', contentDocument('A1-A2', [...new Set(readingItems.map((item) => item.topic))], readingItems));
writeJson('french-a1-a2-sentence-builders.json', contentDocument('A1-A2', [...new Set(builderItems.map((item) => item.topic))], builderItems));
writeJson('french-a1-a2-shadowing.json', contentDocument('A1-A2', [...new Set(shadowingItems.map((item) => item.topic))], shadowingItems));

const audioSources = [
  ...a1Words.map((item) => ({ audioKey: item.audioKey, contentType: 'word', cloudPath: item.audioRef, sourceTextSha256: spokenTextHash(item.partOfSpeech === 'noun' ? item.displayForm : item.text) })),
  ...a2Words.map((item) => ({ audioKey: item.audioKey, contentType: 'word', cloudPath: item.audioRef, sourceTextSha256: spokenTextHash(item.partOfSpeech === 'noun' ? item.displayForm : item.text) })),
  ...oldSentences.items.map((item) => ({ audioKey: item.audioKey, contentType: 'sentence', cloudPath: `french-audio/v1/sentences/${item.audioKey}.mp3`, sourceTextSha256: spokenTextHash(item.text) })),
  ...expressionItems.map((item) => ({ audioKey: item.audioKey, contentType: 'expression', cloudPath: item.audioRef, sourceTextSha256: spokenTextHash(item.text) })),
  ...readingItems.map((item) => ({ audioKey: item.audioKey, contentType: 'reading', cloudPath: item.audioRef, sourceTextSha256: spokenTextHash(item.text) })),
  ...shadowingItems.map((item) => ({ audioKey: item.audioKey, contentType: 'shadowing', cloudPath: item.audioRef, sourceTextSha256: spokenTextHash(item.text) }))
];
const existingByKey = new Map(oldManifest.items.map((item) => [item.audioKey, item]));
const manifestItems = audioSources.map((item) => {
  const existing = existingByKey.get(item.audioKey);
  return {
    ...item,
    localPath: `output/${item.cloudPath}`,
    fileId: existing && typeof existing.fileId === 'string' && existing.fileId.startsWith('cloud://')
      ? existing.fileId
      : null,
    bytes: existing && Number.isInteger(existing.bytes) && existing.bytes > 0 ? existing.bytes : null,
    sha256: existing && typeof existing.sha256 === 'string' && /^[a-f0-9]{64}$/.test(existing.sha256)
      ? existing.sha256
      : null
  };
});
writeJson('french-audio-manifest.json', {
  ...oldManifest,
  version: 2,
  generatedAt: '2026-09-10',
  items: manifestItems
});

const totals = {
  a1Words: a1Words.length,
  a2Words: a2Words.length,
  grammar: grammarItems.length,
  expressions: expressionItems.length,
  readings: readingItems.length,
  sentenceBuilders: builderItems.length,
  shadowing: shadowingItems.length,
  audioManifest: manifestItems.length,
  preservedFileIds: manifestItems.filter((item) => item.fileId).length,
  pendingAudio: manifestItems.filter((item) => item.fileId === null).length
};
console.log(`French content build complete: ${JSON.stringify(totals)}`);
console.log(`Canonical sample: ${canonical(a1Words[0].lemma)}`);
