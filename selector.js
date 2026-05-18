import { normalizeTorrentFiles } from "./realdebrid.js";

const POLL_ATTEMPTS = 30;
const POLL_DELAY_MS = 2500;

const torrentName = document.querySelector("#torrentName");
const torrentStatus = document.querySelector("#torrentStatus");
const fileList = document.querySelector("#fileList");
const selectionSummary = document.querySelector("#selectionSummary");
const selectAllButton = document.querySelector("#selectAll");
const selectNoneButton = document.querySelector("#selectNone");
const startDownloadButton = document.querySelector("#startDownload");
const statusMessage = document.querySelector("#statusMessage");

const params = new URLSearchParams(location.search);
const torrentId = params.get("torrentId");

let files = [];

selectAllButton.addEventListener("click", () => {
  setAllChecked(true);
});

selectNoneButton.addEventListener("click", () => {
  setAllChecked(false);
});

startDownloadButton.addEventListener("click", async () => {
  const selectedIds = getSelectedIds();
  if (selectedIds.length === 0) {
    setStatus("Select at least one file.", true);
    return;
  }

  startDownloadButton.disabled = true;
  setStatus("Sending file selection to Real-Debrid...");

  const response = await sendMessage({
    type: "SELECT_TORRENT_FILES",
    torrentId,
    files: selectedIds
  });

  if (response.ok) {
    setStatus("Done. Real-Debrid will download the selected files in the background.");
    torrentStatus.textContent = "File selection sent.";
  } else {
    startDownloadButton.disabled = false;
    setStatus(response.error.message, true);
  }
});

loadTorrent();

async function loadTorrent() {
  if (!torrentId) {
    setStatus("Missing torrent ID.", true);
    return;
  }

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const response = await sendMessage({
      type: "GET_TORRENT_INFO",
      torrentId
    });

    if (!response.ok) {
      setStatus(response.error.message, true);
      return;
    }

    const info = response.payload;
    torrentName.textContent = info.filename || "Real-Debrid torrent";
    torrentStatus.textContent = humanStatus(info.status);
    const normalizedFiles = normalizeTorrentFiles(info.files);

    if (["magnet_error", "error", "virus", "dead"].includes(info.status)) {
      setStatus(`Real-Debrid reported torrent status: ${humanStatus(info.status)}.`, true);
      return;
    }

    if (normalizedFiles.length > 0) {
      files = normalizedFiles;
      renderFiles(files);
      return;
    }

    await delay(POLL_DELAY_MS);
  }

  setStatus("Real-Debrid did not finish reading the torrent metadata in time.", true);
}

function renderFiles(fileItems) {
  fileList.textContent = "";

  for (const file of fileItems) {
    const row = document.createElement("label");
    row.className = "file-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = file.id;
    checkbox.checked = true;
    checkbox.addEventListener("change", updateSelectionSummary);

    const details = document.createElement("span");
    details.className = "file-details";

    const name = document.createElement("strong");
    name.textContent = cleanPath(file.path);

    const size = document.createElement("small");
    size.textContent = formatBytes(file.bytes);

    details.append(name, size);
    row.append(checkbox, details);
    fileList.append(row);
  }

  startDownloadButton.disabled = false;
  updateSelectionSummary();
}

function getSelectedIds() {
  return Array.from(fileList.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value);
}

function setAllChecked(checked) {
  for (const input of fileList.querySelectorAll("input[type='checkbox']")) {
    input.checked = checked;
  }

  updateSelectionSummary();
}

function updateSelectionSummary() {
  const selectedCount = getSelectedIds().length;
  selectionSummary.textContent = `${selectedCount} of ${files.length} files selected`;
  startDownloadButton.disabled = selectedCount === 0 || files.length === 0;
}

function cleanPath(path) {
  return String(path || "Unnamed file").replace(/^\/+/, "");
}

function humanStatus(status) {
  if (!status) {
    return "Reading torrent metadata.";
  }

  return status.replaceAll("_", " ");
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}
