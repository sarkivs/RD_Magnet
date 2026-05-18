const statusEl = document.querySelector("#status");
const modeEl = document.querySelector("#mode");
const openOptionsButton = document.querySelector("#openOptions");
const magnetInput = document.querySelector("#magnetInput");
const sendMagnetButton = document.querySelector("#sendMagnet");
const lastActivity = document.querySelector("#lastActivity");

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

sendMagnetButton.addEventListener("click", async () => {
  const link = normalizeLink(magnetInput.value);
  if (!link) {
    lastActivity.textContent = "Paste a valid magnet link or .torrent URL first.";
    return;
  }

  sendMagnetButton.disabled = true;
  lastActivity.textContent = "Sending to Real-Debrid...";

  const response = await sendMessage({
    type: "SEND_LINK",
    link
  });

  sendMagnetButton.disabled = false;

  if (response.ok) {
    magnetInput.value = "";
    await loadStatus();
  } else {
    lastActivity.textContent = response.error.message;
  }
});

loadPopup();

async function loadPopup() {
  const response = await sendMessage({ type: "GET_SETTINGS" });
  const settings = response.payload;

  statusEl.textContent = settings.apiToken ? "Ready for magnet links" : "API token needed";
  modeEl.textContent = modeLabel(settings.selectionMode);
  await loadStatus();
}

async function loadStatus() {
  const response = await sendMessage({ type: "GET_STATUS" });
  if (!response.ok) {
    return;
  }

  const activity = response.payload;
  const prefix = activity.torrentId ? `${activity.torrentId}: ` : "";
  lastActivity.textContent = `${prefix}${activity.message}`;
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function modeLabel(mode) {
  if (mode === "manual") {
    return "Ask first";
  }

  if (mode === "video") {
    return "Video only";
  }

  return "All files";
}

function normalizeLink(value) {
  return normalizeMagnet(value) || normalizeTorrentUrl(value);
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
    // Keep the raw candidate.
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
