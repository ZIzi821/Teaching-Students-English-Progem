const crypto = require("crypto");

const MODES = ["automatic", "manual"];
const GAP_SECONDS = [1, 2, 3];
const RESPONSE_SECONDS = [3, 5, 8, 10, 15, 20];
const MAX_ITEMS = 20;
const MAX_ITEM_TEXT = 300;

const asText = (value, limit = MAX_ITEM_TEXT) => String(value || "").trim().slice(0, limit);

const textHash = (text) => crypto
  .createHash("sha1")
  .update(asText(text))
  .digest("hex");

const itemIdFor = (text, duplicateIndex) => `follow_${crypto
  .createHash("sha1")
  .update(`${asText(text)}\n${Math.max(1, Number(duplicateIndex) || 1)}`)
  .digest("hex")
  .slice(0, 16)}`;

const normalizeItems = (data = {}) => {
  const lines = Array.isArray(data.followReadingItems)
    ? data.followReadingItems.map((item) => asText(item && item.text))
    : String(data.followReadingContent || "").split(/\r?\n/).map((item) => asText(item));
  const duplicateCount = new Map();
  return lines.filter(Boolean).slice(0, MAX_ITEMS).map((text, index) => {
    const duplicateIndex = (duplicateCount.get(text) || 0) + 1;
    duplicateCount.set(text, duplicateIndex);
    return {
      id: itemIdFor(text, duplicateIndex),
      order: index + 1,
      text,
      textHash: textHash(text),
    };
  });
};

const normalizeTask = (data = {}) => {
  const mode = MODES.includes(data.followReadingMode) ? data.followReadingMode : "automatic";
  const requestedGap = Math.trunc(Number(data.followReadingGapSeconds));
  const requestedResponse = Math.trunc(Number(data.followReadingResponseSeconds));
  return {
    followReadingMode: mode,
    followReadingGapSeconds: GAP_SECONDS.includes(requestedGap) ? requestedGap : 2,
    followReadingResponseSeconds: RESPONSE_SECONDS.includes(requestedResponse) ? requestedResponse : 8,
    followReadingItems: normalizeItems(data),
  };
};

const getAssetDocumentId = (lessonId, itemId) => `follow_asset_${crypto
  .createHash("sha1")
  .update(`${String(lessonId || "")}\n${String(itemId || "")}`)
  .digest("hex")}`;

const buildAssetCompleteness = (task = {}, assets = []) => {
  const assetByItemId = new Map((assets || [])
    .filter((asset) => asset && asset.itemId)
    .map((asset) => [String(asset.itemId), asset]));
  const items = (task.followReadingItems || []).map((item) => {
    const candidate = assetByItemId.get(item.id) || null;
    const asset = candidate && candidate.fileID && candidate.itemTextHash === item.textHash
      ? candidate
      : null;
    return Object.assign({}, item, {
      audioReady: Boolean(asset),
      audioAsset: asset,
    });
  });
  const readyCount = items.filter((item) => item.audioReady).length;
  return {
    items,
    readyCount,
    totalCount: items.length,
    complete: items.length > 0 && readyCount === items.length,
    missingItemIds: items.filter((item) => !item.audioReady).map((item) => item.id),
  };
};

const sanitizeTaskForStudent = (task = {}, assets = []) => {
  const completeness = buildAssetCompleteness(task, assets);
  return {
    mode: task.followReadingMode,
    gapSeconds: task.followReadingGapSeconds,
    responseSeconds: task.followReadingResponseSeconds,
    audioComplete: completeness.complete,
    readyCount: completeness.readyCount,
    totalCount: completeness.totalCount,
    items: completeness.items.map((item) => ({
      id: item.id,
      order: item.order,
      text: item.text,
      audioUrl: item.audioAsset && item.audioAsset.audioUrl || "",
    })),
  };
};

module.exports = {
  GAP_SECONDS,
  MAX_ITEMS,
  MODES,
  RESPONSE_SECONDS,
  buildAssetCompleteness,
  getAssetDocumentId,
  normalizeItems,
  normalizeTask,
  sanitizeTaskForStudent,
  textHash,
};
