import {
  RealDebridError,
  addMagnet,
  addTorrentFile,
  getVideoFileIds,
  getSettings,
  getTorrentInfo,
  getUser,
  normalizeSelectionMode,
  normalizeTorrentFiles,
  selectTorrentFiles
} from "./realdebrid.js";

const CONTEXT_MENU_ID = "send-link-to-real-debrid";
const SELECTOR_POLL_ATTEMPTS = 24;
const SELECTOR_POLL_DELAY_MS = 2500;
const handledDownloadIds = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "Send magnet/torrent to Real-Debrid",
      contexts: ["link"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) {
    return;
  }

  const linkUrl = normalizeLinkUrl(info.linkUrl);
  if (!linkUrl) {
    notify("Real-Debrid", "That link is not a magnet or torrent link.");
    return;
  }

  handleLink(linkUrl).catch((error) => {
    notifyError(error);
  });
});

chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!isLikelyTorrentDownload(downloadItem)) {
    return;
  }

  handleTorrentDownload(downloadItem);
});

chrome.downloads.onDeterminingFilename.addListener((downloadItem) => {
  if (!isLikelyTorrentDownload(downloadItem)) {
    return;
  }

  handleTorrentDownload(downloadItem);
});

chrome.downloads.onChanged.addListener((delta) => {
  if (handledDownloadIds.has(delta.id)) {
    return;
  }

  if (!delta.filename?.current?.toLowerCase().endsWith(".torrent")) {
    return;
  }

  chrome.downloads.search({ id: delta.id }, (items) => {
    const downloadItem = items[0];
    if (downloadItem && isLikelyTorrentDownload(downloadItem)) {
      handleTorrentDownload(downloadItem);
    }
  });
});

function handleTorrentDownload(downloadItem) {
  if (handledDownloadIds.has(downloadItem.id)) {
    return;
  }

  handledDownloadIds.add(downloadItem.id);
  const downloadUrl = downloadItem.finalUrl || downloadItem.url;

  setLastActivity("working", `Torrent download detected from ${getHostname(downloadUrl)}. Sending it to Real-Debrid.`);
  handleTorrentUrl(downloadUrl)
    .then(() => {
      cleanupChromeDownload(downloadItem.id);
    })
    .catch((error) => {
      setLastActivity("error", `Could not send torrent download to Real-Debrid: ${error.message}`);
      notifyError(error);
    });
}

function cleanupChromeDownload(downloadId) {
  chrome.downloads.cancel(downloadId, () => {
    chrome.downloads.removeFile(downloadId, () => {
      chrome.downloads.erase({ id: downloadId });
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  routeMessage(message)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));

  return true;
});

async function routeMessage(message) {
  switch (message?.type) {
    case "MAGNET_LINK_CLICKED":
      return handleMagnet(message.magnet);
    case "TORRENT_LINK_CLICKED":
      return handleTorrentUrl(message.url, message.referrer);
    case "SEND_LINK":
      return handleLink(message.link);
    case "SEND_MAGNET":
      return handleMagnet(message.magnet);
    case "GET_SETTINGS":
      return getSettings();
    case "GET_STATUS":
      return getLastActivity();
    case "SAVE_SETTINGS":
      await chrome.storage.local.set({
        apiToken: String(message.settings?.apiToken || "").trim(),
        selectionMode: normalizeSelectionMode(message.settings?.selectionMode)
      });
      return getSettings();
    case "TEST_AUTH":
      return getUser();
    case "GET_TORRENT_INFO":
      return getTorrentInfo(message.torrentId);
    case "SELECT_TORRENT_FILES":
      await selectTorrentFiles(message.torrentId, message.files);
      notify("Real-Debrid", "Torrent file selection sent. Real-Debrid will download it in the background.");
      return { torrentId: message.torrentId };
    default:
      throw new Error("Unknown extension message.");
  }
}

async function handleMagnet(rawMagnet) {
  const magnet = normalizeMagnet(rawMagnet);
  if (!magnet) {
    throw new Error("That is not a valid magnet link.");
  }

  await setLastActivity("working", "Sending magnet to Real-Debrid...");

  const settings = await getSettings();
  if (!settings.apiToken) {
    await chrome.runtime.openOptionsPage();
    throw new Error("Add your Real-Debrid API token in the extension options first.");
  }

  const torrent = await addMagnet(magnet);
  if (!torrent?.id) {
    throw new RealDebridError("Real-Debrid did not return a torrent ID.", { payload: torrent });
  }

  return processAddedTorrent(torrent, "Magnet");
}

async function handleTorrentUrl(rawUrl, referrer = "") {
  const torrentUrl = normalizeTorrentUrl(rawUrl);
  if (!torrentUrl) {
    throw new Error("That is not a valid torrent file link.");
  }

  await setLastActivity("working", "Downloading torrent file before sending it to Real-Debrid...");

  const torrentFile = await fetchTorrentFile(torrentUrl, referrer);
  const torrent = await addTorrentFile(torrentFile.blob, torrentFile.filename);
  if (!torrent?.id) {
    throw new RealDebridError("Real-Debrid did not return a torrent ID.", { payload: torrent });
  }

  return processAddedTorrent(torrent, "Torrent file");
}

async function handleLink(rawLink) {
  const magnet = normalizeMagnet(rawLink);
  if (magnet) {
    return handleMagnet(magnet);
  }

  return handleTorrentUrl(rawLink);
}

async function processAddedTorrent(torrent, sourceLabel) {
  const settings = await getSettings();
  await setLastActivity("working", `${sourceLabel} added. Torrent ID: ${torrent.id}`);

  if (settings.selectionMode === "manual") {
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`selector.html?torrentId=${encodeURIComponent(torrent.id)}`)
    });
    await setLastActivity("manual", `${sourceLabel} added. Waiting for you to choose files.`, torrent.id);
    notify("Real-Debrid", `${sourceLabel} added. Choose which files to download in the new tab.`);
    return { torrentId: torrent.id, mode: "manual" };
  }

  if (settings.selectionMode === "video") {
    const selectedCount = await selectVideoFilesWhenReady(torrent.id);
    await setLastActivity("success", `${sourceLabel} added and ${selectedCount} video file(s) were selected.`, torrent.id);
    notify("Real-Debrid", `${selectedCount} video file(s) selected.`);
    return { torrentId: torrent.id, mode: "video", selectedCount };
  }

  await selectAllWhenReady(torrent.id);
  await setLastActivity("success", `${sourceLabel} added and all files were selected.`, torrent.id);
  notify("Real-Debrid", `${sourceLabel} added and all files were selected.`);
  return { torrentId: torrent.id, mode: "all" };
}

async function selectAllWhenReady(torrentId) {
  let lastInfo = null;
  let lastError = null;

  for (let attempt = 0; attempt < SELECTOR_POLL_ATTEMPTS; attempt += 1) {
    lastInfo = await getTorrentInfo(torrentId);
    await setLastActivity("working", `Waiting for file selection. Status: ${lastInfo.status || "unknown"}.`, torrentId);

    if (["queued", "downloading", "downloaded", "compressing", "uploading"].includes(lastInfo.status)) {
      return lastInfo;
    }

    if (["magnet_error", "error", "virus", "dead"].includes(lastInfo.status)) {
      throw new RealDebridError(`Real-Debrid reported torrent status: ${lastInfo.status}.`, {
        payload: lastInfo
      });
    }

    if (normalizeTorrentFiles(lastInfo.files).length > 0 || lastInfo.status === "waiting_files_selection") {
      try {
        await selectTorrentFiles(torrentId, "all");
        return lastInfo;
      } catch (error) {
        lastError = error;
      }
    }

    await delay(SELECTOR_POLL_DELAY_MS);
  }

  throw new RealDebridError(lastError?.message || "Real-Debrid did not finish reading the torrent metadata in time.", {
    status: lastError?.status,
    payload: lastError?.payload || lastInfo
  });
}

async function selectVideoFilesWhenReady(torrentId) {
  let lastInfo = null;

  for (let attempt = 0; attempt < SELECTOR_POLL_ATTEMPTS; attempt += 1) {
    lastInfo = await getTorrentInfo(torrentId);
    await setLastActivity("working", `Looking for video files. Status: ${lastInfo.status || "unknown"}.`, torrentId);

    if (["queued", "downloading", "downloaded", "compressing", "uploading"].includes(lastInfo.status)) {
      return 0;
    }

    if (["magnet_error", "error", "virus", "dead"].includes(lastInfo.status)) {
      throw new RealDebridError(`Real-Debrid reported torrent status: ${lastInfo.status}.`, {
        payload: lastInfo
      });
    }

    const videoFileIds = getVideoFileIds(lastInfo.files);
    if (videoFileIds.length > 0) {
      await selectTorrentFiles(torrentId, videoFileIds);
      return videoFileIds.length;
    }

    if (lastInfo.status === "waiting_files_selection" && normalizeTorrentFiles(lastInfo.files).length > 0) {
      throw new RealDebridError("No common video files were found in this torrent.", {
        payload: lastInfo
      });
    }

    await delay(SELECTOR_POLL_DELAY_MS);
  }

  throw new RealDebridError("Real-Debrid did not finish reading the torrent metadata in time.", {
    payload: lastInfo
  });
}

function normalizeMagnet(value) {
  if (!value) {
    return "";
  }

  const input = String(value).trim().replaceAll("&amp;", "&");
  const candidates = [input];

  try {
    candidates.push(decodeURIComponent(input));
  } catch {
    // Some URLs contain stray percent characters; the raw string is still useful.
  }

  for (const candidate of candidates) {
    if (candidate.toLowerCase().startsWith("magnet:?")) {
      return candidate;
    }

    const match = candidate.match(/magnet:\?[^"'\s<>]+/i);
    if (match) {
      return match[0];
    }
  }

  return "";
}

function normalizeLinkUrl(value) {
  return normalizeMagnet(value) || normalizeTorrentUrl(value);
}

function normalizeTorrentUrl(value) {
  if (!value) {
    return "";
  }

  const input = String(value).trim().replaceAll("&amp;", "&");
  const candidates = [input];

  try {
    candidates.push(decodeURIComponent(input));
  } catch {
    // Keep the raw candidate.
  }

  for (const candidate of candidates) {
    if (/^https?:\/\//i.test(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function fetchTorrentFile(url, referrer = "") {
  const response = await fetch(url, {
    credentials: "include",
    referrer: referrer || undefined
  });

  if (!response.ok) {
    throw new Error(`Torrent download failed with HTTP ${response.status}.`);
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("Torrent download returned an empty file.");
  }

  await assertTorrentBlob(blob);

  return {
    blob,
    filename: getTorrentFilename(url, response.headers)
  };
}

async function assertTorrentBlob(blob) {
  const preview = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const text = new TextDecoder("latin1").decode(preview);

  if (!text.startsWith("d") || (!text.includes("announce") && !text.includes("info"))) {
    throw new Error("The downloaded file did not look like a valid .torrent file.");
  }
}

function getTorrentFilename(url, headers) {
  const contentDisposition = headers.get("content-disposition") || "";
  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  const headerName = utfMatch?.[1] || plainMatch?.[1];

  if (headerName) {
    try {
      return decodeURIComponent(headerName);
    } catch {
      return headerName;
    }
  }

  try {
    const parsedUrl = new URL(url);
    const pathnameName = parsedUrl.pathname.split("/").filter(Boolean).pop();
    if (pathnameName) {
      return pathnameName.endsWith(".torrent") ? pathnameName : `${pathnameName}.torrent`;
    }
  } catch {
    // Fall back below.
  }

  return "download.torrent";
}

function isLikelyTorrentDownload(downloadItem) {
  const mime = String(downloadItem.mime || "").toLowerCase();
  const suggestedFilename = String(downloadItem.suggestedFilename || "").toLowerCase();
  const filename = String(downloadItem.filename || "").toLowerCase();
  const url = String(downloadItem.finalUrl || downloadItem.url || "").toLowerCase();

  return mime.includes("bittorrent") || suggestedFilename.endsWith(".torrent") || filename.endsWith(".torrent") || url.includes(".torrent");
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "torrent link";
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function serializeError(error) {
  setLastActivity("error", error?.message || "Something went wrong.");

  return {
    message: error?.message || "Something went wrong.",
    status: error?.status,
    payload: error?.payload
  };
}

function notifyError(error) {
  const message = error?.message || "Something went wrong.";
  setLastActivity("error", message);
  notify("Real-Debrid error", message);
}

async function setLastActivity(state, message, torrentId = "") {
  await chrome.storage.local.set({
    lastActivity: {
      state,
      message,
      torrentId,
      time: new Date().toISOString()
    }
  });
}

async function getLastActivity() {
  const result = await chrome.storage.local.get({
    lastActivity: {
      state: "idle",
      message: "No magnet has been sent yet.",
      torrentId: "",
      time: ""
    }
  });

  return result.lastActivity;
}

function notify(title, message) {
  try {
    const maybePromise = chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon.svg",
      title,
      message
    });

    if (maybePromise?.catch) {
      maybePromise.catch(() => {
        // Notifications may be unavailable in some Chromium builds.
      });
    }
  } catch {
    // Notifications are helpful but not required for the extension flow.
  }
}
