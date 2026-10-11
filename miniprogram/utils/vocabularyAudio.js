const DEFAULT_TIMEOUT_MS = 8000;
const STOP_PADDING_MS = 220;
const downloadedFileCache = new Map();
const downloadInFlight = new Map();

const asText = (value) => String(value === undefined || value === null ? "" : value).trim();
const asDuration = (value) => Math.max(0, Number(value) || 0);

const downloadVocabularyAudioFile = (fileId) => {
  const normalizedFileId = asText(fileId);
  if (!normalizedFileId) return Promise.reject(new Error("VOCABULARY_AUDIO_FILE_ID_MISSING"));
  const cachedPath = downloadedFileCache.get(normalizedFileId);
  if (cachedPath) return Promise.resolve(cachedPath);
  if (downloadInFlight.has(normalizedFileId)) return downloadInFlight.get(normalizedFileId);
  if (!wx.cloud || typeof wx.cloud.downloadFile !== "function") {
    return Promise.reject(new Error("VOCABULARY_AUDIO_DOWNLOAD_UNAVAILABLE"));
  }

  const promise = new Promise((resolve, reject) => {
    wx.cloud.downloadFile({
      fileID: normalizedFileId,
      success(res) {
        const tempFilePath = asText(res && res.tempFilePath);
        if (!tempFilePath) {
          reject(new Error("VOCABULARY_AUDIO_DOWNLOAD_EMPTY"));
          return;
        }
        downloadedFileCache.set(normalizedFileId, tempFilePath);
        resolve(tempFilePath);
      },
      fail(error) {
        reject(error || new Error("VOCABULARY_AUDIO_DOWNLOAD_FAILED"));
      },
    });
  }).finally(() => {
    downloadInFlight.delete(normalizedFileId);
  });
  downloadInFlight.set(normalizedFileId, promise);
  return promise;
};

const prefetchVocabularyAudio = (sources, options) => {
  const settings = options || {};
  const concurrency = Math.max(1, Math.min(4, Math.trunc(Number(settings.concurrency) || 3)));
  const includeFallback = settings.includeFallback === true;
  const configuredFallbackLimit = Number(settings.maxFallbackFiles);
  const maxFallbackFiles = includeFallback
    ? Math.max(0, Math.min(4, Number.isFinite(configuredFallbackLimit)
      ? Math.trunc(configuredFallbackLimit)
      : 1))
    : 0;
  const fileIds = [];
  const selectedFileIds = new Set();
  const selectedFallbackIds = new Set();
  (Array.isArray(sources) ? sources : []).forEach((source) => {
    const directFileId = asText(source && (
      source.pronunciationDirectFileId || source.directFileId
    ));
    const fallbackFileId = asText(source && (
      source.pronunciationFileId || source.fallbackFileId
    ));
    let fileId = directFileId;
    if (!fileId && includeFallback && fallbackFileId) {
      if (!selectedFallbackIds.has(fallbackFileId) && selectedFallbackIds.size >= maxFallbackFiles) return;
      selectedFallbackIds.add(fallbackFileId);
      fileId = fallbackFileId;
    }
    if (!fileId || selectedFileIds.has(fileId)) return;
    selectedFileIds.add(fileId);
    fileIds.push(fileId);
  });
  const summary = {
    requested: fileIds.length,
    cached: fileIds.filter((fileId) => downloadedFileCache.has(fileId)).length,
    downloaded: 0,
    failed: 0,
  };
  let nextIndex = 0;
  const worker = () => {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= fileIds.length) return Promise.resolve();
    const fileId = fileIds[index];
    const wasCached = downloadedFileCache.has(fileId);
    return downloadVocabularyAudioFile(fileId)
      .then(() => {
        if (!wasCached) summary.downloaded += 1;
      })
      .catch(() => {
        summary.failed += 1;
      })
      .then(worker);
  };
  const workerCount = Math.min(concurrency, fileIds.length);
  return Promise.all(Array.from({ length: workerCount }, () => worker())).then(() => summary);
};

const createVocabularyAudioPlayer = (options) => {
  const settings = options || {};
  const timeoutMs = Math.max(2000, Number(settings.timeoutMs) || DEFAULT_TIMEOUT_MS);
  let requestId = 0;
  let attemptId = 0;
  let attempts = [];
  let attemptIndex = -1;
  let activeWordKey = "";
  let audio = null;
  let loadTimer = null;
  let stopTimer = null;

  const notify = (state, extra) => {
    if (typeof settings.onStateChange !== "function") return;
    settings.onStateChange(Object.assign({
      state,
      wordKey: activeWordKey,
    }, extra || {}));
  };

  const clearTimers = () => {
    if (loadTimer) clearTimeout(loadTimer);
    if (stopTimer) clearTimeout(stopTimer);
    loadTimer = null;
    stopTimer = null;
  };

  const destroyAudio = () => {
    if (!audio) return;
    try {
      audio.destroy();
    } catch (err) {
      console.warn("destroy vocabulary audio failed", err);
    }
    audio = null;
  };

  const clearAttempt = () => {
    clearTimers();
    destroyAudio();
  };

  const isCurrent = (expectedRequestId, expectedAttemptId) => (
    requestId === expectedRequestId && attemptId === expectedAttemptId
  );

  const buildAttempts = (source) => {
    const result = [];
    const canDownload = Boolean(wx.cloud && typeof wx.cloud.downloadFile === "function");
    const addSource = (kind, url, fileId, startMs, durationMs) => {
      const normalizedUrl = asText(url);
      const normalizedFileId = asText(fileId);
      const normalizedDuration = asDuration(durationMs);
      if (!normalizedDuration || (!normalizedUrl && !normalizedFileId)) return;
      const base = {
        kind,
        fileId: normalizedFileId,
        startMs: asDuration(startMs),
        durationMs: normalizedDuration,
      };
      // iOS 微信对短 WAV 的远程流式播放偶尔只触发 onPlay 却没有声音。
      // 短音频优先下载到本机再播放；长合辑仍先走临时 URL，避免每次下载大文件。
      const localSourceReady = normalizedFileId
        && (downloadedFileCache.has(normalizedFileId) || downloadInFlight.has(normalizedFileId));
      const shouldTryLocalFirst = normalizedFileId
        && canDownload
        && (kind === "direct" || localSourceReady);
      if (shouldTryLocalFirst) {
        result.push(Object.assign({}, base, { src: normalizedFileId, download: true }));
      }
      if (normalizedUrl) result.push(Object.assign({}, base, { src: normalizedUrl, download: false }));
      if (kind !== "direct" && normalizedFileId && canDownload && !shouldTryLocalFirst) {
        result.push(Object.assign({}, base, { src: normalizedFileId, download: true }));
      } else if (!normalizedUrl && normalizedFileId && !canDownload) {
        result.push(Object.assign({}, base, { src: normalizedFileId, download: false }));
      }
    };

    addSource(
      "direct",
      source.directUrl,
      source.directFileId,
      0,
      source.directDurationMs
    );
    addSource(
      "fallback",
      source.fallbackUrl,
      source.fallbackFileId,
      source.startMs,
      source.durationMs
    );
    return result;
  };

  const stop = (shouldNotify) => {
    requestId += 1;
    attemptId += 1;
    clearAttempt();
    const stoppedWordKey = activeWordKey;
    activeWordKey = "";
    attempts = [];
    attemptIndex = -1;
    if (shouldNotify !== false && stoppedWordKey) {
      notify("stopped", { wordKey: stoppedWordKey });
    }
  };

  const finishWithError = (error) => {
    const failedWordKey = activeWordKey;
    clearAttempt();
    activeWordKey = "";
    attempts = [];
    attemptIndex = -1;
    notify("error", { wordKey: failedWordKey, error });
    if (typeof settings.onError === "function") settings.onError(error);
  };

  const playResolvedSource = (attempt, src, expectedRequestId, expectedAttemptId, onAttemptFailed) => {
    if (!isCurrent(expectedRequestId, expectedAttemptId)) return;
    let playRequested = false;
    let seekRequested = false;
    let waitingForData = false;
    audio = wx.createInnerAudioContext();
    const currentAudio = audio;
    currentAudio.obeyMuteSwitch = false;
    currentAudio.autoplay = false;
    currentAudio.volume = 1;
    let playbackConfirmed = false;

    const requestPlay = () => {
      if (!isCurrent(expectedRequestId, expectedAttemptId) || playRequested) return;
      playRequested = true;
      currentAudio.play();
    };

    const scheduleStop = () => {
      if (stopTimer) clearTimeout(stopTimer);
      const elapsedMs = Math.max(0, Number(currentAudio.currentTime || 0) * 1000 - attempt.startMs);
      const remainingMs = Math.max(100, attempt.durationMs - elapsedMs);
      stopTimer = setTimeout(() => {
        if (isCurrent(expectedRequestId, expectedAttemptId)) stop(true);
      }, remainingMs + STOP_PADDING_MS);
    };

    if (typeof currentAudio.onCanplay === "function") {
      currentAudio.onCanplay(() => {
        if (!isCurrent(expectedRequestId, expectedAttemptId)) return;
        if (attempt.startMs > 0 && typeof currentAudio.seek === "function") {
          if (seekRequested) return;
          seekRequested = true;
          currentAudio.seek(attempt.startMs / 1000);
          if (typeof currentAudio.onSeeked !== "function") requestPlay();
          return;
        }
        requestPlay();
      });
    }
    if (typeof currentAudio.onSeeked === "function") {
      currentAudio.onSeeked(() => requestPlay());
    }
    if (typeof currentAudio.onPlay === "function") {
      currentAudio.onPlay(() => {
        if (!isCurrent(expectedRequestId, expectedAttemptId)) return;
        if (loadTimer) clearTimeout(loadTimer);
        waitingForData = false;
        if (typeof currentAudio.onTimeUpdate !== "function") {
          playbackConfirmed = true;
          loadTimer = null;
          notify("playing", { sourceKind: attempt.kind });
          scheduleStop();
          return;
        }
        // onPlay 只表示微信接受了播放请求，不代表声音或时间轴真的开始。
        // 如果几秒内没有任何进度，自动尝试下一个来源，避免界面假装“正在播放”。
        loadTimer = setTimeout(() => {
          onAttemptFailed(new Error("VOCABULARY_AUDIO_NO_PROGRESS"));
        }, Math.min(timeoutMs, 3500));
      });
    }
    if (typeof currentAudio.onWaiting === "function") {
      currentAudio.onWaiting(() => {
        if (!isCurrent(expectedRequestId, expectedAttemptId)) return;
        if (stopTimer) clearTimeout(stopTimer);
        stopTimer = null;
        waitingForData = true;
        notify("waiting", { sourceKind: attempt.kind });
        if (loadTimer) clearTimeout(loadTimer);
        loadTimer = setTimeout(() => {
          onAttemptFailed(new Error("VOCABULARY_AUDIO_WAITING_TIMEOUT"));
        }, timeoutMs);
      });
    }
    if (typeof currentAudio.onTimeUpdate === "function") {
      currentAudio.onTimeUpdate(() => {
        if (!isCurrent(expectedRequestId, expectedAttemptId)) return;
        const currentMs = Number(currentAudio.currentTime || 0) * 1000;
        if (!playbackConfirmed && currentMs >= attempt.startMs + 20) {
          playbackConfirmed = true;
          if (loadTimer) clearTimeout(loadTimer);
          loadTimer = null;
          notify("playing", { sourceKind: attempt.kind });
          scheduleStop();
        }
        if (waitingForData) {
          waitingForData = false;
          if (loadTimer) clearTimeout(loadTimer);
          loadTimer = null;
          if (playbackConfirmed) {
            notify("playing", { sourceKind: attempt.kind });
            scheduleStop();
          }
        }
        const endMs = attempt.startMs + attempt.durationMs + 80;
        if (currentMs >= endMs) stop(true);
      });
    }
    if (typeof currentAudio.onEnded === "function") {
      currentAudio.onEnded(() => {
        if (isCurrent(expectedRequestId, expectedAttemptId)) stop(true);
      });
    }
    if (typeof currentAudio.onError === "function") {
      currentAudio.onError((error) => {
        if (!isCurrent(expectedRequestId, expectedAttemptId)) return;
        if (attempt.download && attempt.fileId) downloadedFileCache.delete(attempt.fileId);
        onAttemptFailed(error || new Error("AUDIO_PLAYBACK_FAILED"));
      });
    }

    currentAudio.src = src;
    // 部分旧版微信基础库不会回调 onCanplay；短音频可直接请求播放作为兼容路径。
    if (typeof currentAudio.onCanplay !== "function") {
      currentAudio.startTime = attempt.startMs / 1000;
      requestPlay();
    }
  };

  const startNextAttempt = (expectedRequestId, previousError) => {
    if (requestId !== expectedRequestId) return;
    clearAttempt();
    attemptIndex += 1;
    if (attemptIndex >= attempts.length) {
      finishWithError(previousError || new Error("VOCABULARY_AUDIO_UNAVAILABLE"));
      return;
    }

    const attempt = attempts[attemptIndex];
    attemptId += 1;
    const expectedAttemptId = attemptId;
    const failAttempt = (error) => {
      if (!isCurrent(expectedRequestId, expectedAttemptId)) return;
      startNextAttempt(expectedRequestId, error);
    };
    notify("loading", { sourceKind: attempt.kind });
    loadTimer = setTimeout(() => {
      failAttempt(new Error("VOCABULARY_AUDIO_TIMEOUT"));
    }, timeoutMs);

    if (!attempt.download) {
      playResolvedSource(attempt, attempt.src, expectedRequestId, expectedAttemptId, failAttempt);
      return;
    }

    downloadVocabularyAudioFile(attempt.fileId)
      .then((tempFilePath) => {
        if (!isCurrent(expectedRequestId, expectedAttemptId)) return;
        playResolvedSource(attempt, tempFilePath, expectedRequestId, expectedAttemptId, failAttempt);
      })
      .catch((error) => {
        failAttempt(error || new Error("VOCABULARY_AUDIO_DOWNLOAD_FAILED"));
      });
  };

  const play = (source) => {
    stop(false);
    if (typeof wx.setInnerAudioOption === "function") {
      wx.setInnerAudioOption({
        obeyMuteSwitch: false,
        mixWithOther: true,
        fail(error) {
          console.warn("refresh vocabulary audio output failed", error);
        },
      });
    }
    activeWordKey = asText(source && source.wordKey);
    attempts = buildAttempts(source || {});
    if (!activeWordKey || !attempts.length) {
      const error = new Error("VOCABULARY_AUDIO_MISSING");
      const failedWordKey = activeWordKey;
      activeWordKey = "";
      notify("error", { wordKey: failedWordKey, error });
      if (typeof settings.onError === "function") settings.onError(error);
      return false;
    }
    const expectedRequestId = requestId;
    startNextAttempt(expectedRequestId);
    return true;
  };

  return {
    play,
    stop: () => stop(true),
    destroy: () => stop(false),
  };
};

module.exports = {
  createVocabularyAudioPlayer,
  prefetchVocabularyAudio,
};
