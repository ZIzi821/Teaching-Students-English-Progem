const downloadedAudioCache = new Map();
const downloadInFlight = new Map();

const asText = (value) => String(value || "").trim();

const configureAudioOutput = () => {
  if (typeof wx.setInnerAudioOption !== "function") return;
  wx.setInnerAudioOption({
    obeyMuteSwitch: false,
    mixWithOther: false,
    fail(error) {
      console.warn("configure reliable audio output failed", error);
    },
  });
};

const downloadAudioUrl = (url, force = false) => {
  const normalizedUrl = asText(url);
  if (!normalizedUrl) return Promise.reject(new Error("AUDIO_URL_MISSING"));
  if (!force && downloadedAudioCache.has(normalizedUrl)) {
    return Promise.resolve(downloadedAudioCache.get(normalizedUrl));
  }
  if (!force && downloadInFlight.has(normalizedUrl)) return downloadInFlight.get(normalizedUrl);
  const promise = new Promise((resolve, reject) => {
    wx.downloadFile({
      url: normalizedUrl,
      success(result) {
        if (Number(result && result.statusCode) !== 200 || !result.tempFilePath) {
          reject(new Error("AUDIO_DOWNLOAD_FAILED"));
          return;
        }
        downloadedAudioCache.set(normalizedUrl, result.tempFilePath);
        resolve(result.tempFilePath);
      },
      fail(error) {
        reject(error || new Error("AUDIO_DOWNLOAD_FAILED"));
      },
    });
  }).finally(() => downloadInFlight.delete(normalizedUrl));
  downloadInFlight.set(normalizedUrl, promise);
  return promise;
};

const preloadAudioSources = (sources, options = {}) => {
  const safeSources = (Array.isArray(sources) ? sources : [])
    .map((source, index) => ({
      id: asText(source && source.id) || `audio-${index + 1}`,
      audioUrl: asText(source && source.audioUrl),
    }));
  if (safeSources.some((source) => !source.audioUrl)) {
    return Promise.reject(new Error("AUDIO_SOURCE_INCOMPLETE"));
  }
  const concurrency = Math.max(1, Math.min(4, Math.trunc(Number(options.concurrency) || 3)));
  const localById = {};
  let completed = 0;
  let nextIndex = 0;
  const notify = () => {
    if (typeof options.onProgress === "function") options.onProgress(completed, safeSources.length);
  };
  notify();
  const worker = () => {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= safeSources.length) return Promise.resolve();
    const source = safeSources[index];
    return downloadAudioUrl(source.audioUrl)
      .catch(() => downloadAudioUrl(source.audioUrl, true))
      .then((localPath) => {
        localById[source.id] = localPath;
        completed += 1;
        notify();
      })
      .then(worker);
  };
  const workerCount = Math.min(concurrency, safeSources.length);
  return Promise.all(Array.from({ length: workerCount }, () => worker())).then(() => ({
    localById,
    total: safeSources.length,
  }));
};

const playReliableAudio = (source, callbacks = {}) => {
  configureAudioOutput();
  const attempts = Array.from(new Set([
    asText(source && source.localPath),
    asText(source && source.audioUrl),
  ].filter(Boolean)));
  let activeAudio = null;
  let destroyed = false;
  let generation = 0;
  let attemptIndex = -1;
  let playTimer = null;
  let progressTimer = null;

  const clearTimers = () => {
    if (playTimer) clearTimeout(playTimer);
    if (progressTimer) clearTimeout(progressTimer);
    playTimer = null;
    progressTimer = null;
  };

  const destroyAudio = () => {
    clearTimers();
    if (!activeAudio) return;
    try { activeAudio.destroy(); } catch (_) {}
    activeAudio = null;
  };

  const finishError = (error) => {
    destroyAudio();
    if (!destroyed && typeof callbacks.onError === "function") {
      callbacks.onError(error || new Error("AUDIO_PLAYBACK_FAILED"));
    }
  };

  const startNextAttempt = (previousError) => {
    if (destroyed) return;
    destroyAudio();
    attemptIndex += 1;
    if (attemptIndex >= attempts.length) {
      finishError(previousError || new Error("AUDIO_PLAYBACK_FAILED"));
      return;
    }
    generation += 1;
    const currentGeneration = generation;
    const audio = wx.createInnerAudioContext();
    activeAudio = audio;
    audio.obeyMuteSwitch = false;
    audio.autoplay = false;
    audio.volume = 1;
    let playRequested = false;
    let playbackConfirmed = false;

    const isCurrent = () => !destroyed && activeAudio === audio && generation === currentGeneration;
    const fail = (error) => {
      if (isCurrent()) startNextAttempt(error);
    };
    const requestPlay = () => {
      if (!isCurrent() || playRequested) return;
      playRequested = true;
      try { audio.play(); } catch (error) { fail(error); }
    };
    const confirmPlayback = () => {
      if (!isCurrent() || playbackConfirmed) return;
      playbackConfirmed = true;
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = null;
      if (typeof callbacks.onStarted === "function") callbacks.onStarted();
    };

    if (typeof audio.onCanplay === "function") audio.onCanplay(requestPlay);
    if (typeof audio.onPlay === "function") {
      audio.onPlay(() => {
        if (!isCurrent()) return;
        if (typeof audio.onTimeUpdate !== "function") {
          confirmPlayback();
          return;
        }
        if (progressTimer) clearTimeout(progressTimer);
        progressTimer = setTimeout(() => fail(new Error("AUDIO_NO_PROGRESS")), 3500);
      });
    }
    if (typeof audio.onTimeUpdate === "function") {
      audio.onTimeUpdate(() => {
        if (isCurrent() && Number(audio.currentTime || 0) >= 0.02) confirmPlayback();
      });
    }
    if (typeof audio.onWaiting === "function") {
      audio.onWaiting(() => {
        if (!isCurrent()) return;
        if (progressTimer) clearTimeout(progressTimer);
        progressTimer = setTimeout(() => fail(new Error("AUDIO_WAITING_TIMEOUT")), 8000);
      });
    }
    if (typeof audio.onEnded === "function") {
      audio.onEnded(() => {
        if (!isCurrent()) return;
        if (!playbackConfirmed && typeof audio.onTimeUpdate === "function") {
          fail(new Error("AUDIO_ENDED_WITHOUT_PROGRESS"));
          return;
        }
        destroyAudio();
        if (!destroyed && typeof callbacks.onEnded === "function") callbacks.onEnded();
      });
    }
    if (typeof audio.onError === "function") audio.onError((error) => fail(error));
    audio.src = attempts[attemptIndex];
    playTimer = setTimeout(requestPlay, 300);
  };

  if (!attempts.length) {
    setTimeout(() => finishError(new Error("AUDIO_SOURCE_MISSING")), 0);
  } else {
    startNextAttempt();
  }

  return {
    destroy() {
      destroyed = true;
      generation += 1;
      destroyAudio();
    },
    stop() {
      destroyed = true;
      generation += 1;
      if (activeAudio) {
        try { activeAudio.stop(); } catch (_) {}
      }
      destroyAudio();
    },
  };
};

module.exports = {
  downloadAudioUrl,
  playReliableAudio,
  preloadAudioSources,
};
