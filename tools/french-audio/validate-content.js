/* Static validator for generated French A1/A2 curriculum data and audio references. */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..', '..');
const strictAudio = process.argv.includes('--strict-audio');
const strictCloud = process.argv.includes('--strict-cloud');
const dataDir = path.join(root, 'cloudfunctions', 'quickstartFunctions', 'data');
const read = (file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
const a1 = read('french-a1-words.json');
const a2 = read('french-a2-words.json');
const oldSentences = read('french-a1-sentences.json');
const grammar = read('french-a1-a2-grammar.json');
const expressions = read('french-a1-a2-expressions.json');
const readings = read('french-a1-a2-readings.json');
const builders = read('french-a1-a2-sentence-builders.json');
const shadowing = read('french-a1-a2-shadowing.json');
const manifest = read('french-audio-manifest.json');
const errors = [];
const warnings = [];
const ensure = (condition, message) => { if (!condition) errors.push(message); };
const unique = (items, field, label) => {
  const values = items.map((item) => item[field]);
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  ensure(!duplicates.length, `${label} has duplicate ${field}: ${[...new Set(duplicates)].join(', ')}`);
};
const canonical = (value) => String(value).normalize('NFC').toLocaleLowerCase('fr-FR')
  .replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const spokenTextHash = (value) => crypto.createHash('sha256')
  .update(String(value).normalize('NFC').trim(), 'utf8')
  .digest('hex');
const forbiddenExampleText = [/^voici\b/i, /简单用法/, /请结合句型理解/];
const irregularExampleForms = {
  'identity-etre': ['suis', 'est', 'sommes'], 'identity-avoir': ["j'ai", 'a '],
  'identity-appeler': ["m'appelle", "t'appelles"], 'identity-habiter': ['habit'],
  'needs-avoir': ["j'ai", 'a '], 'needs-vouloir': ['veux'], 'needs-pouvoir': ['peux', 'pouvez'],
  'needs-besoin': ['besoin'], 'likes-preferer': ['préfère'], 'a1-body-yeux': ['yeux'],
  'likes-faire': ['fais'], 'likes-manger': ['mangent'], 'likes-boire': ['boit'],
  'a1-daily-aller': ['vais'], 'a1-places-aller': ['vais'], 'a1-places-venir': ['viens'],
  'a1-places-prendre': ['prends'], 'a1-daily-acheter': ["achète"], 'a1-daily-etudier': ["étudie"],
  'a1-daily-ecouter': ["écoute"], 'a1-daily-comprendre': ['comprends'], 'a2-opinion-falloir': ['faut'],
  'a2-communication-se-souvenir': ['souviens'], 'a2-health-aller-mieux': ['aller mieux'],
  'a2-work-envoyer': ['envoie'], 'a2-life-nettoyer': ['nettoie'], 'a2-opinion-esperer': ['espère'],
  'a2-health-douloureux': ['douloureuse'], 'a1-daily-dormir': ['dors'], 'a1-daily-se-lever': ['lève'], 'a1-study-lire': ['lis'],
  'a2-work-decider': ['décid']
};
const exampleShowsLemma = (item) => {
  const sentence = canonical(item.exampleSentence);
  const lemma = canonical(item.lemma);
  const bare = lemma.replace(/^(se |s')/, '');
  if (sentence.includes(lemma) || (bare.length >= 3 && sentence.includes(bare))) return true;
  const stem = bare.replace(/(er|ir|re|oir)$/, '');
  if (stem.length >= 3 && sentence.includes(stem)) return true;
  return (irregularExampleForms[item.id] || []).some((form) => sentence.includes(canonical(form)));
};
const isStableId = (id) => /^[a-z0-9-]+$/.test(id);
const validLevels = new Set(['A1', 'A2']);
const allowedArticles = new Set(['le', 'la', 'les', 'l’', 'un', 'une', 'des', null]);
const allDocuments = [a1, a2, grammar, expressions, readings, builders, shadowing];
const allItems = allDocuments.flatMap((document) => document.items);
const words = [...a1.items, ...a2.items];

for (const document of allDocuments) {
  ensure(document.schemaVersion === 2, `Schema version must be 2: ${document.level}`);
  ensure(document.language === 'fr-FR', `Unexpected language: ${document.level}`);
  ensure(Array.isArray(document.topics) && document.topics.length, `Topics missing: ${document.level}`);
  ensure(Array.isArray(document.items) && document.items.length, `Items missing: ${document.level}`);
}
unique(allItems, 'id', 'All generated content');
for (const item of allItems) {
  ensure(isStableId(item.id), `ID is not stable ASCII: ${item.id}`);
  ensure(validLevels.has(item.cefrLevel), `Invalid CEFR level: ${item.id}`);
  ensure(typeof item.topic === 'string' && item.topic.length, `Topic missing: ${item.id}`);
  ensure(item.source && item.source.kind === 'editorial' && item.source.title, `Source metadata missing: ${item.id}`);
  ensure(typeof item.provenance === 'string' && /not an official CEFR/i.test(item.provenance), `Provenance disclosure missing: ${item.id}`);
  for (const [key, value] of Object.entries(item)) {
    if (typeof value === 'string') {
      ensure(value === value.normalize('NFC'), `Non-NFC Unicode text in ${item.id}.${key}`);
      ensure(!value.includes('\uFFFD'), `Replacement character in ${item.id}.${key}`);
    }
  }
}

unique(words, 'id', 'Words');
unique(words, 'audioKey', 'Words');
const seenCanonical = new Map();
for (const item of words) {
  const required = ['id','lemma','displayForm','meaningCN','meaningEN','partOfSpeech','cefrLevel','topic','ipa','exampleSentence','exampleMeaningCN','audioKey','audioRef'];
  required.forEach((key) => ensure(typeof item[key] === 'string' && item[key].trim(), `Word ${key} missing: ${item.id}`));
  ensure(item.id === item.audioKey, `Word audioKey must equal id: ${item.id}`);
  ensure(/^\/.+\/$/.test(item.ipa), `Word IPA missing or malformed: ${item.id}`);
  ensure(Number.isInteger(item.difficulty) && item.difficulty >= 1 && item.difficulty <= 5, `Difficulty invalid: ${item.id}`);
  ensure(Array.isArray(item.tags) && item.tags.length, `Tags missing: ${item.id}`);
  ensure(!forbiddenExampleText.some((pattern) => pattern.test(item.exampleSentence) || pattern.test(item.exampleMeaningCN)), `Placeholder example text: ${item.id}`);
  ensure(exampleShowsLemma(item), `Example does not demonstrate lemma or approved inflection: ${item.id} (${item.lemma})`);
  ensure(typeof item.audioRef === 'string' && /^french-audio\/v[12]\/words\/[a-z0-9-]+\.mp3$/.test(item.audioRef), `Audio reference invalid: ${item.id}`);
  ensure(allowedArticles.has(item.article), `Article invalid: ${item.id}`);
  if (item.partOfSpeech === 'noun') {
    ensure(item.gender === 'm' || item.gender === 'f', `Noun gender missing: ${item.id}`);
    ensure(typeof item.article === 'string' && item.article, `Noun article missing: ${item.id}`);
    ensure(typeof item.plural === 'string' && item.plural, `Noun plural missing: ${item.id}`);
  } else {
    ensure(item.gender === null && item.article === null && item.plural === null, `Non-noun gender/article/plural must be null: ${item.id}`);
  }
  const key = canonical(item.text);
  ensure(!seenCanonical.has(key), `Duplicate canonical word form: ${item.text} (${item.id}, ${seenCanonical.get(key)})`);
  seenCanonical.set(key, item.id);
}
const a1Canonicals = new Set(a1.items.map((item) => canonical(item.text)));
for (const item of a2.items) ensure(!a1Canonicals.has(canonical(item.text)), `A1/A2 canonical collision: ${item.text}`);

for (const item of oldSentences.items) {
  ensure(isStableId(item.id) && item.id === item.audioKey, `Legacy sentence ID/audio key mismatch: ${item.id}`);
  ensure(item.text && item.translation && item.note, `Legacy sentence text/translation/note missing: ${item.id}`);
}
for (const item of grammar.items) {
  ensure(item.title && item.titleCN && item.outcome && item.pattern && item.shortExplanationCN && Array.isArray(item.commonMistakes) && item.commonMistakes.length && Array.isArray(item.examples) && item.examples.length, `Grammar metadata missing: ${item.id}`);
  ensure(item.examples.every((example) => example.text && example.meaningCN), `Grammar example translation missing: ${item.id}`);
  ensure(item.examples.every((example) => !/请结合句型理解/.test(example.meaningCN)), `Grammar placeholder translation: ${item.id}`);
}
for (const item of expressions.items) {
  ensure(item.text && item.meaningCN && item.meaningEN && item.usageNote && item.situation && item.example && item.example.text && item.example.meaningCN, `Expression metadata missing: ${item.id}`);
  ensure(item.audioKey === item.id && item.audioRef.endsWith(`${item.id}.mp3`), `Expression audio reference invalid: ${item.id}`);
}
for (const item of readings.items) {
  ensure(item.title && item.titleCN && item.text && item.translationCN, `Reading metadata missing: ${item.id}`);
  ensure(Array.isArray(item.comprehension) && item.comprehension.length >= 2 && item.comprehension.length <= 5, `Reading questions missing: ${item.id}`);
  ensure(item.comprehension.every((question) => question.question && question.answer && question.answerCN && question.explanationCN), `Reading answer metadata missing: ${item.id}`);
}
for (const item of builders.items) {
  ensure(item.pattern && item.instructionCN && item.example && item.promptCN && item.answer && item.meaningCN && Array.isArray(item.scrambledTokens) && item.scrambledTokens.length && Array.isArray(item.slots), `Sentence-builder metadata missing: ${item.id}`);
}
for (const item of shadowing.items) {
  ensure(item.text && item.meaningCN && item.translationCN && item.cue && item.cueCN, `Shadowing metadata missing: ${item.id}`);
  ensure(item.meaningEN === null || (typeof item.meaningEN === 'string' && item.meaningEN.trim()), `Shadowing English meaning must be a string or null: ${item.id}`);
  if (item.id.includes('-shadow-word-')) ensure(item.meaningEN === null, `Vocabulary-derived shadowing must not use a word gloss as sentence meaning: ${item.id}`);
  ensure(item.audioKey === item.id && item.audioRef.endsWith(`${item.id}.mp3`), `Shadowing audio reference invalid: ${item.id}`);
}

const expectedAudio = [
  ...words.map((item) => ({ audioKey: item.audioKey, contentType: 'word', cloudPath: item.audioRef, sourceTextSha256: spokenTextHash(item.partOfSpeech === 'noun' ? item.displayForm : item.text) })),
  ...oldSentences.items.map((item) => ({ audioKey: item.audioKey, contentType: 'sentence', cloudPath: `french-audio/v1/sentences/${item.audioKey}.mp3`, sourceTextSha256: spokenTextHash(item.text) })),
  ...expressions.items.map((item) => ({ audioKey: item.audioKey, contentType: 'expression', cloudPath: item.audioRef, sourceTextSha256: spokenTextHash(item.text) })),
  ...readings.items.map((item) => ({ audioKey: item.audioKey, contentType: 'reading', cloudPath: item.audioRef, sourceTextSha256: spokenTextHash(item.text) })),
  ...shadowing.items.map((item) => ({ audioKey: item.audioKey, contentType: 'shadowing', cloudPath: item.audioRef, sourceTextSha256: spokenTextHash(item.text) }))
];
unique(expectedAudio, 'audioKey', 'Expected audio');
ensure(manifest.items.length === expectedAudio.length, `Manifest total mismatch: ${manifest.items.length} vs ${expectedAudio.length}`);
unique(manifest.items, 'audioKey', 'Manifest');
const expectedByKey = new Map(expectedAudio.map((item) => [item.audioKey, item]));
const legacyAudioKeys = new Set([
  ...a1.items.filter((item) => !item.id.startsWith('a1-')).map((item) => item.audioKey),
  ...oldSentences.items.map((item) => item.audioKey)
]);
let localPresent = 0;
for (const item of manifest.items) {
  const expected = expectedByKey.get(item.audioKey);
  ensure(expected, `Manifest audioKey not in content: ${item.audioKey}`);
  if (!expected) continue;
  ensure(item.contentType === expected.contentType, `Manifest content type mismatch: ${item.audioKey}`);
  ensure(item.cloudPath === expected.cloudPath, `Manifest cloud path changed: ${item.audioKey}`);
  ensure(item.sourceTextSha256 === expected.sourceTextSha256, `Manifest spoken-text hash mismatch: ${item.audioKey}`);
  ensure(typeof item.localPath === 'string' && item.localPath === `output/${item.cloudPath}`, `Manifest local path invalid: ${item.audioKey}`);
  ensure(/^french-audio\/v[12]\/(words|sentences|expressions|readings|shadowing)\/[a-z0-9-]+\.mp3$/.test(item.cloudPath), `Manifest cloud path format invalid: ${item.audioKey}`);
  if (legacyAudioKeys.has(item.audioKey)) {
    ensure(typeof item.fileId === 'string' && item.fileId.startsWith('cloud://'), `Legacy File ID missing: ${item.audioKey}`);
  } else {
    ensure(item.fileId === null || (typeof item.fileId === 'string' && item.fileId.startsWith('cloud://')), `New content File ID is invalid: ${item.audioKey}`);
  }
  if (typeof item.fileId === 'string') ensure(item.fileId.endsWith(item.cloudPath), `Cloud File ID/path mismatch: ${item.audioKey}`);
  if (strictCloud) ensure(typeof item.fileId === 'string' && item.fileId.startsWith('cloud://'), `Cloud File ID missing: ${item.audioKey}`);
  const localFile = path.join(root, item.localPath);
  if (!fs.existsSync(localFile)) {
    warnings.push(item.localPath);
    continue;
  }
  localPresent += 1;
  const buffer = fs.readFileSync(localFile);
  ensure(buffer.length > 1000, `Local audio too small: ${item.localPath}`);
  const header = buffer.subarray(0, 3);
  const hasId3 = header.toString('ascii') === 'ID3';
  const hasFrameSync = header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
  ensure(hasId3 || hasFrameSync, `Local audio is not MP3: ${item.localPath}`);
  if (strictAudio) {
    ensure(item.bytes === buffer.length, `Manifest bytes mismatch: ${item.localPath}`);
    ensure(item.sha256 === crypto.createHash('sha256').update(buffer).digest('hex'), `Manifest SHA-256 mismatch: ${item.localPath}`);
  }
}
const populatedFileIds = manifest.items.filter((item) => item.fileId).length;
ensure(populatedFileIds >= 90 && populatedFileIds <= manifest.items.length, `Expected 90-${manifest.items.length} valid Cloud File IDs, found ${populatedFileIds}`);
if (strictAudio && warnings.length) errors.push(`Missing local audio files in strict mode: ${warnings.length}`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
if (warnings.length) console.log(`WARN: ${warnings.length} audio files are not present locally (generation/upload intentionally not run).`);
console.log(`French content valid: A1 ${a1.items.length} words; A2 ${a2.items.length} words; grammar ${grammar.items.length}; expressions ${expressions.items.length}; readings ${readings.items.length}; builders ${builders.items.length}; shadowing ${shadowing.items.length}.`);
console.log(`Audio manifest valid: ${manifest.items.length} entries; preserved File IDs ${populatedFileIds}; pending audio ${manifest.items.length - populatedFileIds}; local MP3s ${localPresent}/${manifest.items.length}.`);
const sampleIds = ['greetings-bonjour', 'likes-film', 'a1-body-yeux', 'a2-health-toux', 'a2-money-couter'];
const sampleWords = sampleIds.map((id) => words.find((item) => item.id === id)).filter(Boolean)
  .map((item) => `${item.id}: ${item.exampleSentence} = ${item.exampleMeaningCN}`);
console.log(`Content QA sample:\n${sampleWords.join('\n')}`);
