# French A1/A2 content coverage

## Scope and status

This is an editorially selected, CEFR-aligned learning collection. It is **not** an official CEFR word list, a certification syllabus, or a claim of completeness. The material is written or synthesised for this mini-program; it does not reproduce a commercial textbook.

The formal JSON is generated with `node tools/french-content/build-content.js`. Compact tables live in `tools/french-content/sources.js`; do not hand-edit generated word or manifest objects. Validate with `node tools/french-audio/validate-content.js`.

## Current coverage matrix

| Learning area | A1 coverage | A2 coverage | Learner use |
| --- | --- | --- | --- |
| Vocabulary | 180 words: greetings, identity, time, family, needs, likes, home, food, places, study, weather, clothes, body and leisure | 220 words: travel, city services, work/study, home, health, communication, opinions, leisure and money | Recall, meaning, gender/article, plural, example and audio reference |
| Grammar | 16 focused cards: identity, present tense, questions, negation, articles, place, agreement and routine | 18 focused cards: past, future, pronouns, quantity, comparison, relative forms, sequencing and polite conditional | Pattern, short Chinese explanation, common mistakes and examples; 34 total |
| Expressions | 24 situational formulae: greeting, repair, directions, order, price, class and shopping | 32 situational formulae: booking, delay, work, opinion, problem, health, social and money | Meaning, usage situation, example and planned audio; 56 total |
| Reading | 8 short original dialogues/notes: café, introduction, station, routine, class, weather, family and shopping | 10 short original dialogues/notes: hotel, delay, work message, health, invitation, apartment, pharmacy, budget, directions and project | 2 comprehension questions with answer/support fields; 18 total |
| Sentence builder | 12 controlled A1 frames | 16 controlled A2 frames | Prompt, model answer, Chinese meaning, slots and scrambled tokens; 28 total |
| Shadowing | 15 new short A1 utterances, in addition to the existing 30 legacy A1 sentences | 53 short A2 utterances: 8 situational lines plus 45 controlled vocabulary-example turns | 68 new items plus 30 legacy sentences; Chinese translation, listening cue and stable planned audio reference |

## Word record contract

Both word collections use schema version 2. Every word has `id`, `lemma`, `displayForm`, `meaningCN`, `meaningEN`, `partOfSpeech`, `cefrLevel`, `topic`, `ipa`, `article`, `gender`, `plural`, `exampleSentence`, `exampleMeaningCN`, `difficulty`, `tags`, `audioKey`, `audioRef`, `source` and `provenance`. The compatibility fields `text`, `display` and `meaning` remain for the existing A1 consumer.

`gender`, `article` and `plural` are required for nouns and deliberately `null` for other word classes. IDs and audio keys are stable ASCII; French text is NFC Unicode. Every word example is editorially tied to its lemma (or a documented inflected form); the builder rejects the former shared-topic and placeholder examples.

Grammar example cards include an item-level Chinese translation for every French example. For shadowing, `meaningCN` and `translationCN` are required sentence translations. `meaningEN` is nullable: it is retained for curated full-sentence prompts, but deliberately `null` for vocabulary-derived prompts when a reliable sentence translation has not been authored. A word gloss must never be presented as the English meaning of a full shadowing sentence.

## Audio boundary

The previous 60 A1 word and 30 A1 sentence CloudBase File IDs remain unchanged. The 482 new vocabulary and practice MP3s have been generated locally and uploaded under stable `french-audio/v2/` paths; all 572 manifest File IDs are now populated. The validator protects all v1 IDs and accepts each v2 ID only when it is a valid `cloud://` value ending in the exact manifest path. Local validation still does not establish deployment or real-device playback.

## Content QA

`node tools/french-audio/validate-content.js` checks counts, IDs, audio references and the 90 preserved File IDs. It also rejects known placeholder text, requires each word example to show its lemma or an approved inflection, requires real Chinese grammar translations, and prevents vocabulary-derived shadowing from carrying a word-gloss `meaningEN`. The command prints five compact editorial samples for manual spot checks; French idiom and register still benefit from a qualified human reviewer before audio recording.

## Integration notes

The existing French vocabulary page can still consume the A1 file because its legacy fields are retained. A future A2 UI/backend route should use `french-a2-words.json` and the new structured files explicitly; no existing route is redirected by these data changes. Audio upload and human pronunciation review are separate release work.
