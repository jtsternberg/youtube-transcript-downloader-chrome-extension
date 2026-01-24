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
		await sleep(1000);

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
				await sleep(2000);
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
			await sleep(1500);

			// Look for "Oldest" option in dropdown
			const menuItems = Array.from(document.querySelectorAll('ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, yt-formatted-string'));
			const oldestOption = menuItems.find(item => {
				const text = (item.textContent || '').toLowerCase();
				return text.includes('oldest') || text.includes('date');
			});

			if (oldestOption) {
				const clickable = oldestOption.closest('button') || oldestOption.closest('ytd-menu-service-item-renderer') || oldestOption;
				clickable.click();
				await sleep(2000);
				console.log('Filtered to oldest videos (dropdown method)');
				return true;
			}
		}

		// Method 3: Try URL parameter (if on videos page)
		if (window.location.href.includes('/videos')) {
			const url = new URL(window.location.href);
			if (!url.searchParams.has('view') || url.searchParams.get('view') !== '0') {
				url.searchParams.set('view', '0'); // 0 = oldest
				window.location.href = url.toString();
				await sleep(3000);
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

	// Download transcript for the current video page
	window.jtyt.downloadTranscript = async function() {
		// Check if we're on a video page
		if (!window.location.href.includes('/watch')) {
			console.error('Please navigate to a YouTube video page first');
			return false;
		}

		const videoTitle = getCurrentVideoTitle();
		console.log(`Downloading transcript for: ${videoTitle}`);

		try {
			// Wait for page to be ready
			await sleep(2000);

			// Wait for and click "Show more" in description
			console.log('Looking for "Show more" button...');
			await sleep(1000);

			// Try to find "Show more" button by text content
			const allButtons = Array.from(document.querySelectorAll('button, ytd-button-renderer, yt-button-shape'));
			const showMoreButton = allButtons.find(btn => {
				const text = (btn.textContent || btn.innerText || '').toLowerCase();
				return text.includes('show more') || text.includes('more');
			});

			if (showMoreButton) {
				showMoreButton.click();
				await sleep(1500);
				console.log('Clicked "Show more"');
			}

			// Wait for and click "Show transcript" button
			console.log('Looking for "Show transcript" button...');
			await sleep(1500);

			// First, try to find the "..." more actions menu button
			const moreActionsButton = Array.from(document.querySelectorAll('button, ytd-menu-renderer, yt-icon-button'))
				.find(btn => {
					const ariaLabel = btn.getAttribute('aria-label') || '';
					return ariaLabel.toLowerCase().includes('more actions') ||
						   ariaLabel.toLowerCase().includes('more') ||
						   btn.querySelector('yt-icon[class*="more"]');
				});

			if (moreActionsButton) {
				moreActionsButton.click();
				await sleep(1000);
				console.log('Opened more actions menu');
			}

			// Try multiple methods to find transcript button
			let transcriptButton = null;

			// Method 1: Look for button with "transcript" in aria-label or text
			const buttons = Array.from(document.querySelectorAll('button, ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer'));
			transcriptButton = buttons.find(btn => {
				const text = (btn.textContent || btn.innerText || '').toLowerCase();
				const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
				return text.includes('transcript') || ariaLabel.includes('transcript');
			});

			// Method 2: Look in yt-formatted-string elements
			if (!transcriptButton) {
				const formattedStrings = Array.from(document.querySelectorAll('yt-formatted-string'));
				const transcriptString = formattedStrings.find(el => {
					const text = (el.textContent || '').toLowerCase();
					return text.includes('transcript');
				});
				if (transcriptString) {
					transcriptButton = transcriptString.closest('button') || transcriptString.closest('ytd-menu-service-item-renderer');
				}
			}

			// Method 3: Look in description area specifically
			if (!transcriptButton) {
				const descriptionArea = document.querySelector('#description, ytd-video-secondary-info-renderer');
				if (descriptionArea) {
					const descButtons = Array.from(descriptionArea.querySelectorAll('button'));
					transcriptButton = descButtons.find(btn => {
						const text = (btn.textContent || '').toLowerCase();
						return text.includes('transcript');
					});
				}
			}

			if (transcriptButton) {
				transcriptButton.click();
				await sleep(2500);
				console.log('Clicked "Show transcript"');
			} else {
				throw new Error('Could not find transcript button');
			}

			// Wait for transcript content to appear
			console.log('Waiting for transcript content...');
			await sleep(2500);

			// Extract transcript text - YouTube uses ytd-transcript-segment-renderer
			let transcriptElement = document.querySelector('ytd-transcript-renderer, ytd-transcript-body-renderer');

			if (!transcriptElement) {
				// Try waiting a bit more
				await sleep(2000);
				transcriptElement = document.querySelector('ytd-transcript-renderer, ytd-transcript-body-renderer');
			}

			if (!transcriptElement) {
				throw new Error('Could not find transcript content');
			}

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

			// Download transcript
			const filename = `${slugify(videoTitle)}.txt`;
			downloadText(transcriptText, filename);
			console.log(`✓ Downloaded: ${filename}`);

			return true;
		} catch (error) {
			console.error(`Error downloading transcript:`, error);
			return false;
		}
	};

	// Process a single video: open transcript and download
	async function processVideo(videoUrl, videoTitle) {
		console.log(`Processing: ${videoTitle}`);

		// Navigate to video
		window.location.href = videoUrl;
		await sleep(4000); // Wait for page to load

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

		console.log('Starting transcript download process...');

		// Check if we're on a videos page
		if (!window.location.href.includes('/videos')) {
			console.error('Please navigate to a YouTube channel videos page first');
			return;
		}

		// Filter by oldest if not already done
		await filterByOldest();
		await sleep(2000);

		// Get all video links
		let videoLinks = getVideoLinks();

		if (videoLinks.length === 0) {
			console.error('No videos found on this page');
			return;
		}

		// Apply limits
		if (maxVideos) {
			videoLinks = videoLinks.slice(0, maxVideos);
		}

		videoLinks = videoLinks.slice(startIndex);

		console.log(`Processing ${videoLinks.length} videos...`);

		// Process each video
		for (let i = 0; i < videoLinks.length; i++) {
			const video = videoLinks[i];
			console.log(`\n[${i + 1}/${videoLinks.length}] Processing: ${video.title}`);

			const success = await processVideo(video.url, video.title);

			if (success) {
				console.log(`✓ Successfully downloaded transcript for: ${video.title}`);
			} else {
				console.log(`✗ Failed to download transcript for: ${video.title}`);
			}

			// Wait before next video (except for the last one)
			if (i < videoLinks.length - 1) {
				console.log(`Waiting ${delayBetweenVideos}ms before next video...`);
				await sleep(delayBetweenVideos);

				// Navigate back to videos page
				window.location.href = window.location.href.split('/watch')[0] + '/videos';
				await sleep(3000);

				// Re-filter and re-get links (in case page structure changed)
				await filterByOldest();
				await sleep(2000);
				videoLinks = getVideoLinks();
			}
		}

		console.log('\n✓ All transcripts downloaded!');
	};

	// Helper function to get video links without processing
	window.jtyt.getVideoLinks = function() {
		return getVideoLinks();
	};

	// Helper function to filter by oldest
	window.jtyt.filterByOldest = function() {
		return filterByOldest();
	};

	console.log('YouTube Transcript Downloader loaded!');
	console.log('Single video: window.jtyt.downloadTranscript()');
	console.log('Batch download: window.jtyt.loopAndDownloadTranscripts()');
	console.log('Options: window.jtyt.loopAndDownloadTranscripts({ startIndex: 0, maxVideos: 10, delayBetweenVideos: 3000 })');
})();
