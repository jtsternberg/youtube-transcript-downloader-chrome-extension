# YouTube Transcript Downloader

A simple Chrome extension to download transcripts from YouTube videos.

## Installation

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select this folder

## Usage

1. Navigate to any YouTube video
2. Click the extension icon
3. Click "Download Transcript"

## File Naming

Downloaded transcripts are named:
```
{video-title}-{video-id}-{upload-date}.txt
```

## Notes

- Only works on videos that have captions/transcripts available
- The original bookmarklet script is preserved in `youtube-transcript-downloader.js`
