document.addEventListener('DOMContentLoaded', async () => {
	const notYoutube = document.getElementById('not-youtube');
	const mainContent = document.getElementById('main-content');
	const downloadBtn = document.getElementById('download-transcript');
	const loading = document.getElementById('loading');
	const status = document.getElementById('status');

	// Listen for messages from content script
	chrome.runtime.onMessage.addListener((message) => {
		if (message.type === 'TRANSCRIPT_DOWNLOADED') {
			hideLoading();
			showStatus('Downloaded!', 'success');
		} else if (message.type === 'TRANSCRIPT_ERROR') {
			hideLoading();
			showStatus(message.error || 'Error downloading transcript', 'error');
		}
	});

	// Check current tab
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	const url = tab.url || '';

	if (!url.includes('youtube.com/watch')) {
		notYoutube.style.display = 'block';
		mainContent.style.display = 'none';
		return;
	}

	// Download transcript button
	downloadBtn.addEventListener('click', async () => {
		showLoading();
		try {
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				files: ['src/content.js']
			});
			await chrome.tabs.sendMessage(tab.id, { action: 'downloadTranscript' });
		} catch (error) {
			showStatus('Error: ' + error.message, 'error');
			hideLoading();
		}
	});

	function showLoading() {
		loading.style.display = 'flex';
		downloadBtn.disabled = true;
		status.style.display = 'none';
	}

	function hideLoading() {
		loading.style.display = 'none';
		downloadBtn.disabled = false;
	}

	function showStatus(message, type) {
		status.textContent = message;
		status.className = `status ${type}`;
		status.style.display = 'block';
	}
});
