// YouTube Transcript Downloader - Content Script
(function() {
	'use strict';

	if (window.ytTranscriptDownloaderLoaded) return;
	window.ytTranscriptDownloaderLoaded = true;

	function slugify(text) {
		return text
			.toString()
			.toLowerCase()
			.trim()
			.replace(/\s+/g, '-')
			.replace(/[^\w\-]+/g, '')
			.replace(/\-\-+/g, '-')
			.replace(/^-+/, '')
			.replace(/-+$/, '')
			.substring(0, 100);
	}

	function waitForElement(finderFn, options = {}) {
		const { timeout = 30000, pollInterval = 100, description = 'element' } = options;

		return new Promise((resolve, reject) => {
			const result = finderFn();
			if (result) { resolve(result); return; }

			const startTime = Date.now();
			const checkInterval = setInterval(() => {
				const result = finderFn();
				if (result) { clearInterval(checkInterval); resolve(result); return; }
				if (Date.now() - startTime > timeout) {
					clearInterval(checkInterval);
					reject(new Error(`Timeout waiting for ${description}`));
				}
			}, pollInterval);

			const observer = new MutationObserver(() => {
				const result = finderFn();
				if (result) { clearInterval(checkInterval); observer.disconnect(); resolve(result); }
			});
			observer.observe(document.body, { childList: true, subtree: true });
			setTimeout(() => { clearInterval(checkInterval); observer.disconnect(); }, timeout);
		});
	}

	function getCurrentVideoTitle() {
		const selectors = [
			'h1.ytd-watch-metadata yt-formatted-string',
			'h1.ytd-video-primary-info-renderer',
			'h1.ytd-watch-metadata',
			'#title h1'
		];
		for (const selector of selectors) {
			const el = document.querySelector(selector);
			if (el) {
				const title = (el.textContent || '').trim();
				if (title) return title;
			}
		}
		return document.title.replace(' - YouTube', '').trim() || 'untitled';
	}

	function getVideoUploadDate() {
		const selectors = [
			'#info-strings yt-formatted-string',
			'#info yt-formatted-string',
			'ytd-video-primary-info-renderer #info-strings'
		];
		const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

		for (const selector of selectors) {
			for (const el of document.querySelectorAll(selector)) {
				const text = (el.textContent || '').trim();
				const match = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s+(\d{4})/i);
				if (match) {
					const month = months.indexOf(match[1].toLowerCase().substring(0, 3)) + 1;
					return `${month.toString().padStart(2, '0')}-${match[2].padStart(2, '0')}-${match[3]}`;
				}
			}
		}
		const now = new Date();
		return `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${now.getFullYear()}`;
	}

	function extractVideoId(url) {
		try { return new URL(url).searchParams.get('v'); }
		catch { return url.match(/[?&]v=([^&]+)/)?.[1] || null; }
	}

	function downloadText(text, filename) {
		const blob = new Blob([text], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	async function downloadTranscript() {
		if (!window.location.href.includes('/watch')) {
			throw new Error('Not a video page');
		}

		await waitForElement(() => {
			const title = getCurrentVideoTitle();
			return title && title !== 'untitled' ? title : null;
		}, { description: 'video title', timeout: 15000 });

		const videoTitle = getCurrentVideoTitle();

		// Try to expand description
		try {
			const showMore = await waitForElement(() => {
				return Array.from(document.querySelectorAll('button, yt-button-shape')).find(btn =>
					(btn.textContent || '').toLowerCase().includes('more') &&
					!(btn.textContent || '').toLowerCase().includes('actions')
				) || null;
			}, { timeout: 2000 });
			showMore?.click();
		} catch {}

		// Try more actions menu
		try {
			const moreActions = await waitForElement(() => {
				return Array.from(document.querySelectorAll('button, yt-icon-button')).find(btn =>
					(btn.getAttribute('aria-label') || '').toLowerCase().includes('more actions')
				) || null;
			}, { timeout: 2000 });
			moreActions?.click();
		} catch {}

		// Find transcript button
		const transcriptBtn = await waitForElement(() => {
			const btns = Array.from(document.querySelectorAll('button, ytd-menu-service-item-renderer'));
			let btn = btns.find(b =>
				(b.textContent || '').toLowerCase().includes('transcript') ||
				(b.getAttribute('aria-label') || '').toLowerCase().includes('transcript')
			);
			if (!btn) {
				const str = Array.from(document.querySelectorAll('yt-formatted-string')).find(el =>
					(el.textContent || '').toLowerCase().includes('transcript')
				);
				if (str) btn = str.closest('button') || str.closest('ytd-menu-service-item-renderer');
			}
			return btn || null;
		}, { description: 'transcript button', timeout: 10000 });

		transcriptBtn.click();

		// Wait for transcript
		const transcriptEl = await waitForElement(
			() => document.querySelector('ytd-transcript-renderer, ytd-transcript-body-renderer'),
			{ description: 'transcript content', timeout: 15000 }
		);

		// Extract text
		const segments = transcriptEl.querySelectorAll('ytd-transcript-segment-renderer');
		let text = '';

		if (segments.length > 0) {
			segments.forEach(seg => {
				const time = seg.querySelector('.segment-timestamp')?.textContent.trim() || '';
				const content = seg.querySelector('yt-formatted-string.segment-text')?.textContent.trim() ||
					seg.querySelector('yt-formatted-string')?.textContent.trim() || '';
				if (content) {
					text += `\n${time}\n${content}\n`;
				}
			});
		} else {
			text = transcriptEl.textContent || '';
		}

		text = text.trim();
		if (!text) throw new Error('Transcript is empty');

		const videoId = extractVideoId(window.location.href);
		const filename = `${slugify(videoTitle)}-${videoId || 'unknown'}-${getVideoUploadDate()}.txt`;

		downloadText(text, filename);

		chrome.runtime.sendMessage({ type: 'TRANSCRIPT_DOWNLOADED', title: videoTitle });
		return { success: true };
	}

	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.action === 'downloadTranscript') {
			downloadTranscript()
				.then(result => sendResponse(result))
				.catch(error => {
					chrome.runtime.sendMessage({ type: 'TRANSCRIPT_ERROR', error: error.message });
					sendResponse({ error: error.message });
				});
			return true;
		}
	});
})();
