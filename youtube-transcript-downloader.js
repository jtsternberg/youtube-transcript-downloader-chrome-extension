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

		console.log('Starting transcript download process...');

		// Check if we're on a videos page
		if (!window.location.href.includes('/videos')) {
			console.error('Please navigate to a YouTube channel videos page first');
			return;
		}

		// Filter by oldest if not already done
		await filterByOldest();

		// Get all video links (wait for them to be available)
		await waitForElementByFinder(() => {
			const links = getVideoLinks();
			return links.length > 0 ? true : null;
		}, { description: 'video links', timeout: 10000 });

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
				await new Promise(resolve => setTimeout(resolve, delayBetweenVideos));

				// Navigate back to videos page
				window.location.href = window.location.href.split('/watch')[0] + '/videos';

				// Wait for videos page to load
				await waitForElementByFinder(() => {
					const links = getVideoLinks();
					return links.length > 0 ? true : null;
				}, { description: 'videos page to load', timeout: 15000 });

				// Re-filter and re-get links (in case page structure changed)
				await filterByOldest();

				// Wait for links to be available after filtering
				await waitForElementByFinder(() => {
					const links = getVideoLinks();
					return links.length > 0 ? true : null;
				}, { description: 'video links after re-filter', timeout: 10000 });

				videoLinks = getVideoLinks();
			}
		}

		console.log('\n✓ All transcripts downloaded!');
	};

	// Helper functions
	window.jtyt.getVideoLinks = getVideoLinks;
	window.jtyt.getCurrentVideoTitle = getCurrentVideoTitle;
	window.jtyt.filterByOldest = filterByOldest;

	console.log('YouTube Transcript Downloader loaded!');
	console.log('Single video: window.jtyt.downloadTranscript()');
	console.log('Batch download: window.jtyt.loopAndDownloadTranscripts()');
	console.log('Options: window.jtyt.loopAndDownloadTranscripts({ startIndex: 0, maxVideos: 10, delayBetweenVideos: 3000 })');
})();
