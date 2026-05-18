const API_BASE_URL = "https://api.real-debrid.com/rest/1.0";
const VALID_SELECTION_MODES = new Set(["all", "video", "manual"]);
const VIDEO_EXTENSIONS = new Set([
  "3g2",
  "3gp",
  "asf",
  "avi",
  "divx",
  "flv",
  "m2ts",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "mts",
  "ogm",
  "ogv",
  "rm",
  "rmvb",
  "ts",
  "vob",
  "webm",
  "wmv"
]);

export class RealDebridError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message);
    this.name = "RealDebridError";
    this.status = status;
    this.payload = payload;
  }
}

export async function getSettings() {
  const settings = await chrome.storage.local.get({
    apiToken: "",
    selectionMode: "all"
  });

  return {
    apiToken: settings.apiToken.trim(),
    selectionMode: normalizeSelectionMode(settings.selectionMode)
  };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({
    apiToken: settings.apiToken.trim(),
    selectionMode: normalizeSelectionMode(settings.selectionMode)
  });
}

export async function rdRequest(path, options = {}) {
  const { apiToken } = await getSettings();

  if (!apiToken) {
    throw new RealDebridError("Add your Real-Debrid API token in the extension options first.");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${apiToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  const payload = await readPayload(response);

  if (!response.ok) {
    const message = payload?.error || payload?.message || `Real-Debrid request failed with HTTP ${response.status}.`;
    throw new RealDebridError(message, {
      status: response.status,
      payload
    });
  }

  return payload;
}

export async function addMagnet(magnet) {
  const body = new URLSearchParams();
  body.set("magnet", magnet);

  return rdRequest("/torrents/addMagnet", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
}

export async function addTorrentFile(blob, filename = "download.torrent") {
  try {
    return await rdRequest("/torrents/addTorrent", {
      method: "PUT",
      headers: {
        "Content-Type": "application/x-bittorrent"
      },
      body: blob
    });
  } catch (rawUploadError) {
    const body = new FormData();
    body.set("file", blob, filename);

    try {
      return await rdRequest("/torrents/addTorrent", {
        method: "PUT",
        body
      });
    } catch (formUploadError) {
      throw new RealDebridError(`${rawUploadError.message} Form upload retry also failed: ${formUploadError.message}`, {
        status: formUploadError.status || rawUploadError.status,
        payload: formUploadError.payload || rawUploadError.payload
      });
    }
  }
}

export async function getTorrentInfo(torrentId) {
  return rdRequest(`/torrents/info/${encodeURIComponent(torrentId)}`);
}

export async function selectTorrentFiles(torrentId, files) {
  const body = new URLSearchParams();
  body.set("files", Array.isArray(files) ? files.join(",") : files);

  await rdRequest(`/torrents/selectFiles/${encodeURIComponent(torrentId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
}

export async function getUser() {
  return rdRequest("/user");
}

export function normalizeTorrentFiles(files) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files.flatMap((file, variantIndex) => {
    if (file && typeof file === "object" && "id" in file) {
      return {
        id: String(file.id),
        path: file.path || file.filename || `File ${file.id}`,
        bytes: file.bytes || file.filesize || 0,
        selected: file.selected,
        variantIndex
      };
    }

    if (!file || typeof file !== "object") {
      return [];
    }

    return Object.entries(file).map(([id, details]) => ({
      id: String(id),
      path: details?.filename || `File ${id}`,
      bytes: details?.filesize || details?.bytes || 0,
      selected: 1,
      variantIndex
    }));
  });
}

export function getVideoFileIds(files) {
  return normalizeTorrentFiles(files)
    .filter((file) => isVideoPath(file.path))
    .map((file) => file.id);
}

export function isVideoPath(path) {
  const cleanPath = String(path || "").split(/[?#]/)[0];
  const filename = cleanPath.slice(cleanPath.lastIndexOf("/") + 1);
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";

  return VIDEO_EXTENSIONS.has(extension);
}

export function normalizeSelectionMode(mode) {
  return VALID_SELECTION_MODES.has(mode) ? mode : "all";
}

async function readPayload(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
