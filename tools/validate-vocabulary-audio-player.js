const assert = require("assert");

const contexts = [];
const downloads = [];
const audioOptions = [];

const createFakeContext = () => {
  const handlers = {};
  const context = {
    currentTime: 0,
    destroyed: false,
    playCount: 0,
    seekValues: [],
    onCanplay(callback) { handlers.canplay = callback; },
    onSeeked(callback) { handlers.seeked = callback; },
    onPlay(callback) { handlers.play = callback; },
    onWaiting(callback) { handlers.waiting = callback; },
    onTimeUpdate(callback) { handlers.timeupdate = callback; },
    onEnded(callback) { handlers.ended = callback; },
    onError(callback) { handlers.error = callback; },
    play() {
      this.playCount += 1;
      if (handlers.play) handlers.play();
    },
    seek(value) {
      this.seekValues.push(value);
      this.currentTime = value;
      if (handlers.seeked) handlers.seeked();
    },
    destroy() { this.destroyed = true; },
    emit(name, value) {
      if (handlers[name]) handlers[name](value);
    },
  };
  contexts.push(context);
  return context;
};

global.wx = {
  createInnerAudioContext: createFakeContext,
  setInnerAudioOption(options) {
    audioOptions.push(options);
    if (options && typeof options.success === "function") options.success({});
  },
  cloud: {
    downloadFile({ fileID, success }) {
      downloads.push(fileID);
      success({ tempFilePath: `temp://${downloads.length}.wav` });
    },
  },
};

const {
  createVocabularyAudioPlayer,
  prefetchVocabularyAudio,
} = require("../miniprogram/utils/vocabularyAudio");

(async () => {
const states = [];
let errors = 0;
const player = createVocabularyAudioPlayer({
  timeoutMs: 3000,
  onStateChange: (state) => states.push(state),
  onError: () => { errors += 1; },
});

assert.strictEqual(player.play({
  wordKey: "letter-a",
  directUrl: "https://example.test/letter-a.wav",
  directDurationMs: 900,
}), true);
assert.strictEqual(contexts.length, 1);
assert.strictEqual(contexts[0].src, "https://example.test/letter-a.wav");
assert.strictEqual(contexts[0].volume, 1, "Vocabulary audio must use full player volume");
assert.strictEqual(contexts[0].obeyMuteSwitch, false, "Vocabulary audio must ignore the phone mute switch");
assert(audioOptions.some((item) => item.obeyMuteSwitch === false), "Global audio output must ignore the mute switch");
contexts[0].emit("canplay");
assert.strictEqual(contexts[0].playCount, 1, "Direct WAV should play after canplay");
assert.deepStrictEqual(contexts[0].seekValues, [], "Direct WAV must not seek");
assert(states.some((item) => item.state === "loading" && item.wordKey === "letter-a"));
assert(!states.some((item) => item.state === "playing" && item.wordKey === "letter-a"), "onPlay alone must not report audible progress");
contexts[0].currentTime = 0.2;
contexts[0].emit("timeupdate");
assert(states.some((item) => item.state === "playing" && item.wordKey === "letter-a"));
contexts[0].emit("waiting");
assert.strictEqual(states[states.length - 1].state, "waiting", "Buffering should return to a visible loading state");
contexts[0].currentTime = 0.3;
contexts[0].emit("timeupdate");
assert.strictEqual(states[states.length - 1].state, "playing", "Playback progress should clear the waiting state");
player.stop();

const beforeFallback = contexts.length;
player.play({
  wordKey: "letter-b",
  directUrl: "https://example.test/letter-b.wav",
  directFileId: "cloud://env/letter-b.wav",
  directDurationMs: 800,
  fallbackUrl: "https://example.test/beginner-sprite.wav",
  fallbackFileId: "cloud://env/beginner-sprite.wav",
  startMs: 4200,
  durationMs: 800,
});
await new Promise((resolve) => setImmediate(resolve));
assert.strictEqual(downloads[0], "cloud://env/letter-b.wav", "Direct File ID should retry by local download");
const directLocal = contexts[beforeFallback];
assert.strictEqual(directLocal.src, "temp://1.wav");
directLocal.emit("error", new Error("local failed"));
const directStream = contexts[beforeFallback + 1];
assert.strictEqual(directStream.src, "https://example.test/letter-b.wav");
directStream.emit("error", new Error("stream failed"));
const spriteStream = contexts[beforeFallback + 2];
assert.strictEqual(spriteStream.src, "https://example.test/beginner-sprite.wav");
spriteStream.emit("canplay");
assert.deepStrictEqual(spriteStream.seekValues, [4.2], "Sprite fallback should seek to its word segment");
assert.strictEqual(spriteStream.playCount, 1, "Sprite fallback should play after seek");
spriteStream.currentTime = 4.3;
spriteStream.emit("timeupdate");
assert(states.some((item) => item.state === "playing" && item.wordKey === "letter-b"));
player.stop();

const beforeFailure = contexts.length;
player.play({
  wordKey: "letter-c",
  directUrl: "https://example.test/missing-direct.wav",
  directDurationMs: 700,
  fallbackUrl: "https://example.test/missing-fallback.wav",
  startMs: 300,
  durationMs: 700,
});
contexts[beforeFailure].emit("error", new Error("direct unavailable"));
contexts[beforeFailure + 1].emit("error", new Error("fallback unavailable"));
assert.strictEqual(errors, 1, "All failed sources should produce one visible error");
assert(states.some((item) => item.state === "error" && item.wordKey === "letter-c"));

player.destroy();

const downloadsBeforePrefetch = downloads.length;
const summary = await prefetchVocabularyAudio([
  { pronunciationDirectFileId: "cloud://env/prefetch-a.wav" },
  { pronunciationDirectFileId: "cloud://env/prefetch-b.wav" },
  { pronunciationDirectFileId: "cloud://env/prefetch-a.wav" },
], { concurrency: 2 });
assert.deepStrictEqual(summary, {
  requested: 2,
  cached: 0,
  downloaded: 2,
  failed: 0,
});
assert.strictEqual(downloads.length, downloadsBeforePrefetch + 2, "Prefetch should download each short audio once");

const cachedPlayer = createVocabularyAudioPlayer();
const contextsBeforeCachedPlay = contexts.length;
cachedPlayer.play({
  wordKey: "prefetch-a",
  directFileId: "cloud://env/prefetch-a.wav",
  directDurationMs: 700,
});
await new Promise((resolve) => setImmediate(resolve));
assert.strictEqual(downloads.length, downloadsBeforePrefetch + 2, "Playback should reuse the prefetched temporary file");
assert(/^temp:\/\//.test(contexts[contextsBeforeCachedPlay].src), "Prefetched playback should use a local temporary path");
cachedPlayer.destroy();
console.log("Vocabulary audio player valid: direct playback, download retry, background prefetch cache, sprite seek fallback, and single final error.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
