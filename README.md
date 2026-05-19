# Real-Debrid Magnet Sender

A small unpacked Chrome extension that sends magnet links and torrent files to Real-Debrid.

## What it does

- Left-click a magnet link or obvious `.torrent` link on a web page to send it to Real-Debrid.
- Sends the torrent file to Real-Debrid.
- Right-click a link and choose **Send magnet/torrent to Real-Debrid**.
- Choose one of three modes:
  - **Download all files automatically**: selects every file in the torrent.
  - **Download video files only**: selects common video formats and skips extras.
  - **Ask which files to download**: opens a tab with checkboxes for the torrent files.

## Setup

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the folder where you downloaded or cloned this project.
5. Open the extension settings.
6. Paste your Real-Debrid API token.
7. Choose the file selection mode and save.

You can get your token from the Real-Debrid API page while signed in.

