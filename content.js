document.addEventListener(
  "click",
  (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const link = event.target?.closest?.("a[href]");
    if (!link) {
      return;
    }

    const href = link.getAttribute("href") || link.href;
    const magnet = normalizeMagnet(href);
    const torrentUrl = normalizeTorrentUrl(href, link);
    if (!magnet && !torrentUrl) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (magnet) {
      chrome.runtime.sendMessage({
        type: "MAGNET_LINK_CLICKED",
        magnet
      });
      return;
    }

    chrome.runtime.sendMessage({
      type: "TORRENT_LINK_CLICKED",
      url: torrentUrl,
      referrer: location.href
    });
  },
  true
);

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

function normalizeTorrentUrl(value, link) {
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

  const type = String(link?.type || "").toLowerCase();
  const downloadName = String(link?.getAttribute?.("download") || "").toLowerCase();
  const linkText = [
    link?.textContent,
    link?.title,
    link?.getAttribute?.("aria-label"),
    link?.className
  ].join(" ").toLowerCase();
  const likelyByAttribute = type.includes("bittorrent") || downloadName.endsWith(".torrent");

  for (const candidate of candidates) {
    if (!/^https?:\/\//i.test(candidate)) {
      continue;
    }

    const lowerCandidate = candidate.toLowerCase();
    const likelyTorrentAction =
      linkText.includes("torrent") &&
      (lowerCandidate.includes("torrent") || lowerCandidate.includes("download") || lowerCandidate.includes("/dl"));

    if (likelyByAttribute || lowerCandidate.includes(".torrent") || likelyTorrentAction) {
      return candidate;
    }
  }

  return "";
}
