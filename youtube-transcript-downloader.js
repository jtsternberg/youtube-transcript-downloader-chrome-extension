(function() {
	'use strict';

	// Create namespace
	window.jtyt = window.jtyt || {};

	// Utility function to slugify text for filenames
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
			.substring(0, 100); // Limit length
	}

	// Generic polling utility - waits for element finder function to return a truthy value
	function waitForElementByFinder(finderFn, options = {}) {
		const {
			timeout = 30000,
			pollInterval = 100,
			description = 'element'
		} = options;

		return new Promise((resolve, reject) => {
			// Check immediately first
			const immediateResult = finderFn();
			if (immediateResult) {
				resolve(immediateResult);
				return;
			}

			const startTime = Date.now();
			const checkInterval = setInterval(() => {
				const result = finderFn();
				if (result) {
					clearInterval(checkInterval);
					resolve(result);
					return;
				}

				if (Date.now() - startTime > timeout) {
					clearInterval(checkInterval);
					reject(new Error(`Timeout waiting for ${description}`));
				}
			}, pollInterval);

			// Also use MutationObserver for faster detection
			const observer = new MutationObserver(() => {
				const result = finderFn();
				if (result) {
					clearInterval(checkInterval);
					observer.disconnect();
					resolve(result);
				}
			});

			observer.observe(document.body, {
				childList: true,
				subtree: true
			});

			// Cleanup on timeout
			setTimeout(() => {
				clearInterval(checkInterval);
				observer.disconnect();
			}, timeout);
		});
	}

	// Utility function to wait for element by selector (backward compatibility)
	function waitForElement(selector, timeout = 10000) {
		return waitForElementByFinder(
			() => document.querySelector(selector),
			{ timeout, description: selector }
		);
	}

	// Filter videos by oldest
	async function filterByOldest() {
		console.log('Filtering videos by oldest...');

		// Method 1: Look for chip cloud with "Oldest" option
		const chipCloud = document.querySelector('yt-chip-cloud-chip-renderer');
		if (chipCloud) {
			const chips = Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer'));
			const oldestChip = chips.find(chip => {
				const text = (chip.textContent || '').toLowerCase();
				return text.includes('oldest') || text.includes('date');
			});
			if (oldestChip) {
				oldestChip.click();
				// Wait for page to update
				await waitForElementByFinder(() => {
					const links = getVideoLinks();
					return links.length > 0 ? true : null;
				}, { description: 'video links after filter', timeout: 5000 });
				console.log('Filtered to oldest videos (chip method)');
				return true;
			}
		}

		// Method 2: Look for filter/sort button
		const filterButtons = Array.from(document.querySelectorAll('button, ytd-button-renderer'));
		const filterButton = filterButtons.find(btn => {
			const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
			const text = (btn.textContent || '').toLowerCase();
			return ariaLabel.includes('sort') || ariaLabel.includes('filter') ||
				   text.includes('sort') || text.includes('filter');
		});

		if (filterButton) {
			filterButton.click();

			// Wait for dropdown menu to appear
			try {
				await waitForElementByFinder(() => {
					const menuItems = Array.from(document.querySelectorAll('ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, yt-formatted-string'));
					return menuItems.find(item => {
						const text = (item.textContent || '').toLowerCase();
						return text.includes('oldest') || text.includes('date');
					}) || null;
				}, { description: 'filter menu', timeout: 3000 });

				// Find and click "Oldest" option
				const oldestOption = await waitForElementByFinder(() => {
					const menuItems = Array.from(document.querySelectorAll('ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, yt-formatted-string'));
					const item = menuItems.find(i => {
						const text = (i.textContent || '').toLowerCase();
						return text.includes('oldest') || text.includes('date');
					});
					if (item) {
						return item.closest('button') || item.closest('ytd-menu-service-item-renderer') || item;
					}
					return null;
				}, { description: 'oldest option', timeout: 3000 });

				oldestOption.click();
				// Wait for page to update
				await waitForElementByFinder(() => {
					const links = getVideoLinks();
					return links.length > 0 ? true : null;
				}, { description: 'video links after filter', timeout: 5000 });
				console.log('Filtered to oldest videos (dropdown method)');
				return true;
			} catch (e) {
				console.log('Could not find filter menu items');
			}
		}

		// Method 3: Try URL parameter (if on videos page)
		if (window.location.href.includes('/videos')) {
			const url = new URL(window.location.href);
			if (!url.searchParams.has('view') || url.searchParams.get('view') !== '0') {
				url.searchParams.set('view', '0'); // 0 = oldest
				window.location.href = url.toString();
				// Wait for page to load
				await waitForElementByFinder(() => {
					const links = getVideoLinks();
					return links.length > 0 ? true : null;
				}, { description: 'video links after URL filter', timeout: 10000 });
				console.log('Filtered to oldest videos (URL method)');
				return true;
			}
		}

		console.warn('Could not find filter button, videos may not be sorted by oldest');
		return false;
	}

	// Get all video links from the current page
	function getVideoLinks() {
		const links = [];
		const videoElements = document.querySelectorAll('a#video-title-link, a.ytd-video-renderer, ytd-video-renderer a#video-title');

		videoElements.forEach(link => {
			const href = link.getAttribute('href');
			const title = link.textContent.trim() || link.getAttribute('title') || 'untitled';
			if (href && href.startsWith('/watch')) {
				links.push({
					url: `https://www.youtube.com${href}`,
					title: title
				});
			}
		});

		console.log(`Found ${links.length} videos`);
		return links;
	}

	// Load all videos by scrolling to trigger infinite scroll
	async function loadAllVideos() {
		console.log('Loading all videos from page (scrolling to load more)...');

		let lastCount = 0;
		let noChangeCount = 0;
		const maxNoChangeIterations = 3; // Stop after 3 scrolls with no new videos
		const scrollDelay = 2000; // Wait between scrolls for content to load

		while (noChangeCount < maxNoChangeIterations) {
			// Scroll to bottom to trigger loading more videos
			const scrollHeight = document.documentElement.scrollHeight;
			window.scrollTo(0, scrollHeight);

			// Wait for potential new content to load
			await new Promise(resolve => setTimeout(resolve, scrollDelay));

			// Get current video count
			const currentLinks = getVideoLinks();
			const currentCount = currentLinks.length;

			// Check if we got new videos
			if (currentCount > lastCount) {
				noChangeCount = 0; // Reset counter
				console.log(`Loaded ${currentCount} videos so far...`);
				lastCount = currentCount;

				// Scroll a bit up and down to trigger any lazy loading
				window.scrollBy(0, -200);
				await new Promise(resolve => setTimeout(resolve, 500));
				window.scrollBy(0, 400);
				await new Promise(resolve => setTimeout(resolve, 500));
			} else {
				noChangeCount++;
				if (noChangeCount < maxNoChangeIterations) {
					console.log(`No new videos loaded (attempt ${noChangeCount}/${maxNoChangeIterations}), scrolling again...`);
					// Try scrolling to very bottom again
					window.scrollTo(0, document.documentElement.scrollHeight);
					await new Promise(resolve => setTimeout(resolve, scrollDelay));
				}
			}
		}

		// Get final list of all videos
		const allLinks = getVideoLinks();

		// Remove duplicates by URL
		const uniqueLinks = [];
		const urlSet = new Set();
		allLinks.forEach(link => {
			if (!urlSet.has(link.url)) {
				urlSet.add(link.url);
				uniqueLinks.push(link);
			}
		});

		console.log(`✓ Loaded all videos: ${uniqueLinks.length} total (${allLinks.length - uniqueLinks.length} duplicates removed)`);
		return uniqueLinks;
	}

	// Download text as file
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

	// Get video title from current page
	function getCurrentVideoTitle() {
		const titleSelectors = [
			'h1.ytd-watch-metadata yt-formatted-string',
			'h1.ytd-video-primary-info-renderer',
			'h1.ytd-watch-metadata',
			'#title h1',
			'h1[class*="title"]'
		];

		for (const selector of titleSelectors) {
			const element = document.querySelector(selector);
			if (element) {
				const title = (element.textContent || element.innerText || '').trim();
				if (title) return title;
			}
		}

		// Fallback: try to get from page title
		const pageTitle = document.title.replace(' - YouTube', '').trim();
		return pageTitle || 'untitled-video';
	}

	// Get video upload date from current page
	function getVideoUploadDate() {
		// Try to find the date in various locations
		const dateSelectors = [
			'#info-strings yt-formatted-string',
			'#info yt-formatted-string',
			'ytd-video-primary-info-renderer #info-strings',
			'ytd-video-primary-info-renderer yt-formatted-string',
			'#date yt-formatted-string',
			'ytd-video-primary-info-renderer span'
		];

		const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

		for (const selector of dateSelectors) {
			const elements = document.querySelectorAll(selector);
			for (const element of elements) {
				const text = (element.textContent || element.innerText || '').trim();

				// Try various date patterns
				// Pattern 1: "Dec 27, 2022" or "December 27, 2022"
				let dateMatch = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s+(\d{4})/i);
				if (dateMatch) {
					const monthName = dateMatch[1].toLowerCase().substring(0, 3);
					const month = monthNames.indexOf(monthName) + 1;
					const day = dateMatch[2];
					const year = dateMatch[3];
					return `${month.toString().padStart(2, '0')}-${day.padStart(2, '0')}-${year}`;
				}

				// Pattern 2: "12/27/2022" or "12-27-2022"
				dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
				if (dateMatch) {
					const [, month, day, year] = dateMatch;
					return `${month.padStart(2, '0')}-${day.padStart(2, '0')}-${year}`;
				}

				// Pattern 3: "2022-12-27" (ISO format)
				dateMatch = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
				if (dateMatch) {
					const [, year, month, day] = dateMatch;
					return `${month.padStart(2, '0')}-${day.padStart(2, '0')}-${year}`;
				}
			}
		}

		// Fallback: use current date
		const now = new Date();
		const month = (now.getMonth() + 1).toString().padStart(2, '0');
		const day = now.getDate().toString().padStart(2, '0');
		const year = now.getFullYear();
		return `${month}-${day}-${year}`;
	}

	// Download transcript for the current video page
	window.jtyt.downloadTranscript = async function() {
		// Check if we're on a video page
		if (!window.location.href.includes('/watch')) {
			console.error('Please navigate to a YouTube video page first');
			return false;
		}

		try {
			// Wait for page to be ready (video title should be present)
			console.log('Waiting for page to load...');
			await waitForElementByFinder(() => {
				const title = getCurrentVideoTitle();
				return title && title !== 'untitled-video' ? title : null;
			}, { description: 'video title', timeout: 15000 });

			const videoTitle = getCurrentVideoTitle();
			console.log(`Downloading transcript for: ${videoTitle}`);

			// Wait for and click "Show more" in description (optional - may not exist)
			console.log('Looking for "Show more" button...');
			try {
				const showMoreButton = await waitForElementByFinder(() => {
					const allButtons = Array.from(document.querySelectorAll('button, ytd-button-renderer, yt-button-shape'));
					return allButtons.find(btn => {
						const text = (btn.textContent || btn.innerText || '').toLowerCase();
						return text.includes('show more') || (text.includes('more') && !text.includes('actions'));
					}) || null;
				}, { description: 'Show more button', timeout: 3000 });

				showMoreButton.click();
				console.log('Clicked "Show more"');
			} catch (e) {
				console.log('No "Show more" button found, continuing...');
			}

			// Wait for and click "Show transcript" button
			console.log('Looking for "Show transcript" button...');

			// First, try to find and click the "..." more actions menu button if it exists
			try {
				const moreActionsButton = await waitForElementByFinder(() => {
					const buttons = Array.from(document.querySelectorAll('button, ytd-menu-renderer, yt-icon-button'));
					return buttons.find(btn => {
						const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
						return ariaLabel.includes('more actions') ||
							   (ariaLabel.includes('more') && !ariaLabel.includes('show more'));
					}) || null;
				}, { description: 'more actions button', timeout: 2000 });

				moreActionsButton.click();
				console.log('Opened more actions menu');
			} catch (e) {
				// More actions menu might not be needed
			}

			// Wait for transcript button to appear
			const transcriptButton = await waitForElementByFinder(() => {
				// Method 1: Look for button with "transcript" in aria-label or text
				const buttons = Array.from(document.querySelectorAll('button, ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer'));
				let btn = buttons.find(b => {
					const text = (b.textContent || b.innerText || '').toLowerCase();
					const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
					return text.includes('transcript') || ariaLabel.includes('transcript');
				});

				// Method 2: Look in yt-formatted-string elements
				if (!btn) {
					const formattedStrings = Array.from(document.querySelectorAll('yt-formatted-string'));
					const transcriptString = formattedStrings.find(el => {
						const text = (el.textContent || '').toLowerCase();
						return text.includes('transcript');
					});
					if (transcriptString) {
						btn = transcriptString.closest('button') || transcriptString.closest('ytd-menu-service-item-renderer');
					}
				}

				// Method 3: Look in description area specifically
				if (!btn) {
					const descriptionArea = document.querySelector('#description, ytd-video-secondary-info-renderer');
					if (descriptionArea) {
						const descButtons = Array.from(descriptionArea.querySelectorAll('button'));
						btn = descButtons.find(b => {
							const text = (b.textContent || '').toLowerCase();
							return text.includes('transcript');
						});
					}
				}

				return btn || null;
			}, { description: 'transcript button', timeout: 10000 });

			transcriptButton.click();
			console.log('Clicked "Show transcript"');

			// Wait for transcript content to appear
			console.log('Waiting for transcript content...');
			const transcriptElement = await waitForElement('ytd-transcript-renderer, ytd-transcript-body-renderer', 15000);

			// Extract all transcript segments
			const segments = transcriptElement.querySelectorAll('ytd-transcript-segment-renderer');
			let transcriptText = '';

			if (segments.length > 0) {
				segments.forEach(segment => {
					// Get timestamp
					const timeElement = segment.querySelector('.segment-timestamp, [data-timestamp], ytd-transcript-segment-renderer > div:first-child');
					const time = timeElement ? (timeElement.textContent || timeElement.innerText || '').trim() : '';

					// Get text
					const textElements = segment.querySelectorAll('yt-formatted-string');
					let text = '';
					if (textElements.length > 0) {
						text = Array.from(textElements)
							.map(el => el.textContent || el.innerText)
							.join(' ')
							.trim();
					} else {
						text = (segment.textContent || segment.innerText || '').trim();
						// Remove timestamp from text if it's included
						if (time && text.startsWith(time)) {
							text = text.substring(time.length).trim();
						}
					}

					if (text) {
						transcriptText += `${time ? time + ' ' : ''}${text}\n`;
					}
				});
			} else {
				// Fallback: get all text content
				transcriptText = transcriptElement.textContent || transcriptElement.innerText || '';
			}

			if (!transcriptText.trim()) {
				throw new Error('Transcript is empty');
			}

			// Get video ID and upload date for filename
			const videoId = extractVideoId(window.location.href);
			const uploadDate = getVideoUploadDate();

			// Download transcript
			const baseFilename = slugify(videoTitle);
			const filename = `${baseFilename}-${videoId || 'unknown'}-${uploadDate}.txt`;
			downloadText(transcriptText, filename);
			console.log(`✓ Downloaded: ${filename}`);

			return true;
		} catch (error) {
			console.error(`Error downloading transcript:`, error);
			return false;
		}
	};

	// SessionStorage keys
	const STORAGE_KEY = 'jtyt_batch_download';
	const STORAGE_STATE_KEY = 'jtyt_batch_state';
	const STORAGE_CONFIRM_MODE_KEY = 'jtyt_confirm_mode';

	// LocalStorage keys (persists across sessions)
	const STORAGE_DOWNLOADED_VIDEOS_KEY = 'jtyt_downloaded_videos';

	// Confirm mode state
	let confirmModeEnabled = false;

	// Get confirm mode from sessionStorage
	function getConfirmMode() {
		const stored = sessionStorage.getItem(STORAGE_CONFIRM_MODE_KEY);
		return stored === 'true';
	}

	// Set confirm mode
	function setConfirmMode(enabled) {
		confirmModeEnabled = enabled;
		sessionStorage.setItem(STORAGE_CONFIRM_MODE_KEY, enabled ? 'true' : 'false');
	}

	// Toggle confirm mode
	window.jtyt.toggleConfirmMode = function() {
		const newState = !confirmModeEnabled;
		setConfirmMode(newState);
		console.log(`Confirm mode ${newState ? 'ENABLED' : 'DISABLED'}`);
		return newState;
	};

	// Initialize confirm mode from storage
	confirmModeEnabled = getConfirmMode();

	// Extract video ID from YouTube URL
	function extractVideoId(url) {
		try {
			const urlObj = new URL(url);
			return urlObj.searchParams.get('v') || null;
		} catch (e) {
			// Try regex fallback for malformed URLs
			const match = url.match(/[?&]v=([^&]+)/);
			return match ? match[1] : null;
		}
	}

	// Downloaded videos tracking (localStorage - persists across sessions)
	// Stores and returns video IDs only (not full URLs)
	function getDownloadedVideos() {
		const stored = localStorage.getItem(STORAGE_DOWNLOADED_VIDEOS_KEY);
		if (!stored) return [];
		try {
			const data = JSON.parse(stored);
			// If it's an array of URLs (old format), extract IDs
			if (Array.isArray(data) && data.length > 0) {
				// Check if first item is a URL or already an ID
				if (data[0].includes('youtube.com') || data[0].includes('watch?v=')) {
					// Old format: array of URLs, extract IDs
					const ids = data.map(url => extractVideoId(url)).filter(id => id !== null);
					// Update storage to new format
					localStorage.setItem(STORAGE_DOWNLOADED_VIDEOS_KEY, JSON.stringify(ids));
					return ids;
				} else {
					// New format: already IDs
					return data;
				}
			}
			return [];
		} catch (e) {
			return [];
		}
	}

	function addDownloadedVideo(url) {
		const videoId = extractVideoId(url);
		if (!videoId) {
			console.warn(`Could not extract video ID from URL: ${url}`);
			return;
		}
		const downloaded = getDownloadedVideos();
		if (!downloaded.includes(videoId)) {
			downloaded.push(videoId);
			localStorage.setItem(STORAGE_DOWNLOADED_VIDEOS_KEY, JSON.stringify(downloaded));
		}
	}

	function isVideoDownloaded(url) {
		const videoId = extractVideoId(url);
		if (!videoId) {
			return false;
		}
		const downloaded = getDownloadedVideos();
		return downloaded.includes(videoId);
	}

	function clearDownloadedVideos() {
		localStorage.removeItem(STORAGE_DOWNLOADED_VIDEOS_KEY);
	}

	// Reset downloaded videos list
	window.jtyt.resetDownloadedVideos = function() {
		clearDownloadedVideos();
		console.log('Downloaded videos list cleared');
	};

	// Get count of downloaded videos
	window.jtyt.getDownloadedCount = function() {
		return getDownloadedVideos().length;
	};

	// Save batch download state to sessionStorage
	function saveBatchState(videoLinks, currentIndex, options) {
		const state = {
			videoLinks,
			currentIndex,
			options,
			timestamp: Date.now()
		};
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	}

	// Get batch download state from sessionStorage
	function getBatchState() {
		const stored = sessionStorage.getItem(STORAGE_KEY);
		if (!stored) return null;
		try {
			return JSON.parse(stored);
		} catch (e) {
			return null;
		}
	}

	// Clear batch download state
	function clearBatchState() {
		sessionStorage.removeItem(STORAGE_KEY);
		sessionStorage.removeItem(STORAGE_STATE_KEY);
	}

	// Continue to next video (used when confirm is cancelled)
	window.jtyt.continueToNextVideo = async function() {
		return await continueBatchDownload();
	};

	// Continue batch download from sessionStorage
	async function continueBatchDownload() {
		const state = getBatchState();
		if (!state) return false;

		const { videoLinks, currentIndex, options } = state;
		const { delayBetweenVideos = 3000 } = options;

		console.log(`Continuing batch download from video ${currentIndex + 1}/${videoLinks.length}`);

		// Check if we're on a video page (just downloaded transcript)
		if (window.location.href.includes('/watch')) {
			// We just finished downloading, now navigate to next video
			// Skip already downloaded videos
			let nextIndex = currentIndex + 1;
			while (nextIndex < videoLinks.length && isVideoDownloaded(videoLinks[nextIndex].url)) {
				console.log(`⏭ Skipping already downloaded: ${videoLinks[nextIndex].title}`);
				nextIndex++;
			}

			if (nextIndex < videoLinks.length) {
				// Update state for next video
				saveBatchState(videoLinks, nextIndex, options);

				// Wait before next video
				console.log(`Waiting ${delayBetweenVideos}ms before next video...`);
				await new Promise(resolve => setTimeout(resolve, delayBetweenVideos));

				// Check confirm mode before navigating
				if (confirmModeEnabled) {
					const nextVideo = videoLinks[nextIndex];
					const confirmed = confirm(`Ready to move to next video?\n\nCurrent: ${videoLinks[currentIndex].title}\nNext: ${nextVideo.title}\n\n[${nextIndex + 1}/${videoLinks.length}]`);

					if (!confirmed) {
						console.log('\n⚠ Navigation cancelled. To continue to next video, run:');
						console.log('window.jtyt.continueToNextVideo()');
						return false;
					}
				}

				// Navigate to next video
				const nextVideo = videoLinks[nextIndex];
				console.log(`\n[${nextIndex + 1}/${videoLinks.length}] Processing: ${nextVideo.title}`);
				window.location.href = nextVideo.url;
				return true;
			} else {
				// All done!
				console.log('\n✓ All transcripts downloaded!');
				console.log(`Total downloaded: ${getDownloadedVideos().length}`);
				clearBatchState();
				return false;
			}
		}

		// We're on videos page, need to navigate to current video
		// Skip already downloaded videos
		let targetIndex = currentIndex;
		while (targetIndex < videoLinks.length && isVideoDownloaded(videoLinks[targetIndex].url)) {
			console.log(`⏭ Skipping already downloaded: ${videoLinks[targetIndex].title}`);
			targetIndex++;
		}

		if (targetIndex < videoLinks.length) {
			const video = videoLinks[targetIndex];

			// Update state to reflect skipped videos
			if (targetIndex !== currentIndex) {
				saveBatchState(videoLinks, targetIndex, options);
			}

			// Check confirm mode before navigating
			if (confirmModeEnabled) {
				const confirmed = confirm(`Ready to start processing video?\n\nVideo: ${video.title}\n[${targetIndex + 1}/${videoLinks.length}]`);

				if (!confirmed) {
					console.log('\n⚠ Navigation cancelled. To continue, run:');
					console.log('window.jtyt.continueToNextVideo()');
					return false;
				}
			}

			console.log(`\n[${targetIndex + 1}/${videoLinks.length}] Processing: ${video.title}`);
			window.location.href = video.url;
			return true;
		}

		// All done
		console.log('\n✓ All transcripts downloaded!');
		console.log(`Total downloaded: ${getDownloadedVideos().length}`);
		clearBatchState();
		return false;
	}

	// Process a single video: open transcript and download
	async function processVideo(videoUrl, videoTitle) {
		console.log(`Processing: ${videoTitle}`);

		// Navigate to video
		window.location.href = videoUrl;

		// Wait for page to load (check for video title)
		await waitForElementByFinder(() => {
			const title = getCurrentVideoTitle();
			return title && title !== 'untitled-video' ? true : null;
		}, { description: 'video page to load', timeout: 15000 });

		// Use the standalone download function
		return await window.jtyt.downloadTranscript();
	}

	// Main function to loop through videos and download transcripts
	window.jtyt.loopAndDownloadTranscripts = async function(options = {}) {
		const {
			startIndex = 0,
			maxVideos = null,
			delayBetweenVideos = 3000
		} = options;

		// Check if we should continue an existing batch download
		if (window.location.href.includes('/watch')) {
			// We're on a video page - check if we should continue batch
			const shouldContinue = await continueBatchDownload();
			if (shouldContinue) {
				// Will navigate to next video, script will reload
				return;
			}
			// Otherwise, start fresh
		}

		console.log('Starting transcript download process...');

		// Check if we're on a videos page
		if (!window.location.href.includes('/videos')) {
			console.error('Please navigate to a YouTube channel videos page first');
			return;
		}

		// Check if we should continue from sessionStorage
		const existingState = getBatchState();
		if (existingState) {
			console.log('Found existing batch download state, continuing...');
			const shouldContinue = await continueBatchDownload();
			if (shouldContinue) {
				return; // Will navigate, script will reload
			}
		}

		// Filter by oldest if not already done
		await filterByOldest();

		// Wait for initial videos to load
		await waitForElementByFinder(() => {
			const links = getVideoLinks();
			return links.length > 0 ? true : null;
		}, { description: 'initial video links', timeout: 10000 });

		// Load ALL videos by scrolling (handles infinite scroll)
		let videoLinks = await loadAllVideos();

		if (videoLinks.length === 0) {
			console.error('No videos found on this page');
			return;
		}

		// Filter out already downloaded videos
		const downloadedVideos = getDownloadedVideos();
		const originalCount = videoLinks.length;
		videoLinks = videoLinks.filter(video => !isVideoDownloaded(video.url));
		const skippedCount = originalCount - videoLinks.length;

		if (skippedCount > 0) {
			console.log(`Skipping ${skippedCount} already downloaded video(s)`);
		}

		if (videoLinks.length === 0) {
			console.log('All videos have already been downloaded!');
			console.log(`Total downloaded: ${downloadedVideos.size}`);
			console.log('To reset and re-download, run: window.jtyt.resetDownloadedVideos()');
			return;
		}

		// Apply limits
		if (maxVideos) {
			videoLinks = videoLinks.slice(0, maxVideos);
		}

		videoLinks = videoLinks.slice(startIndex);

		if (videoLinks.length === 0) {
			console.error('No videos to process');
			return;
		}

		console.log(`Processing ${videoLinks.length} video(s) (${downloadedVideos.size} already downloaded)`);

		// Save state and start with first video
		saveBatchState(videoLinks, 0, options);
		const firstVideo = videoLinks[0];
		console.log(`\n[1/${videoLinks.length}] Processing: ${firstVideo.title}`);
		window.location.href = firstVideo.url;
	};

	// Function to cancel/stop batch download
	window.jtyt.cancelBatchDownload = function() {
		clearBatchState();
		console.log('Batch download cancelled');
	};

	// Helper functions
	window.jtyt.getVideoLinks = getVideoLinks;
	window.jtyt.getCurrentVideoTitle = getCurrentVideoTitle;
	window.jtyt.filterByOldest = filterByOldest;

	console.log('YouTube Transcript Downloader loaded!');
	console.log('Single video: window.jtyt.downloadTranscript()');
	console.log('Batch download: window.jtyt.loopAndDownloadTranscripts()');
	console.log('Options: window.jtyt.loopAndDownloadTranscripts({ startIndex: 0, maxVideos: 10, delayBetweenVideos: 3000 })');
	console.log('Toggle confirm mode: window.jtyt.toggleConfirmMode()');
	console.log('Cancel batch: window.jtyt.cancelBatchDownload()');
	console.log('Reset downloaded list: window.jtyt.resetDownloadedVideos()');
	console.log(`Downloaded videos tracked: ${getDownloadedVideos().length}`);
	if (confirmModeEnabled) {
		console.log('⚠ Confirm mode is ENABLED - you will be prompted before each navigation');
	}

	// Auto-continue batch download on page load if state exists
	(async function() {
		// Wait a bit for page to settle
		await new Promise(resolve => setTimeout(resolve, 1000));

		const state = getBatchState();
		if (!state) return;

		// Check if state is recent (within last hour)
		const age = Date.now() - state.timestamp;
		if (age > 3600000) {
			console.log('Batch download state expired, clearing...');
			clearBatchState();
			return;
		}

		// If we're on a video page, download transcript then continue
		if (window.location.href.includes('/watch')) {
			console.log('Batch download in progress, downloading transcript...');
			const currentVideo = state.videoLinks[state.currentIndex];

			// Skip if already downloaded
			if (isVideoDownloaded(currentVideo.url)) {
				console.log(`⏭ Skipping already downloaded video: ${currentVideo.title}`);
				await continueBatchDownload();
				return;
			}

			try {
				const success = await window.jtyt.downloadTranscript();
				if (success) {
					console.log(`✓ Successfully downloaded transcript for: ${currentVideo.title}`);

					// Mark as downloaded
					addDownloadedVideo(currentVideo.url);
					console.log(`📝 Marked as downloaded (${getDownloadedVideos().length} total)`);

					// Wait a bit to ensure download completes before navigating
					console.log('Waiting for download to complete...');
					await new Promise(resolve => setTimeout(resolve, 2000));
				} else {
					console.log(`✗ Failed to download transcript for: ${currentVideo.title}`);
				}
			} catch (error) {
				console.error('Error downloading transcript:', error);
			}

			// Continue to next video
			await continueBatchDownload();
		} else if (window.location.href.includes('/videos')) {
			// We're on videos page, continue to current video
			await continueBatchDownload();
		}
	})();
})();
