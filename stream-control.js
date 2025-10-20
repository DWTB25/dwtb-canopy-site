// ========================================
// Reolink On-Demand Stream Integration
// ========================================
// Configuration
const CONFIG = {
    streamApiUrl: 'https://stream-api.dwtb-solar-canopy.org',
    apiKey: 'bb6104ec02362103cf42e69567d1f724f577b46f3789ec162893cdb906c587c2',
    cloudflareStreamUrl: 'https://customer-i32my3qs0ldoeuy3.cloudflarestream.com/c0c327782cd0701b6d78dd33526706e3/manifest/video.m3u8', 
    streamDuration: 300000,
    startupDelay: 3000,
    statusCheckInterval: 10000
};

// State management
let streamState = {
    isStreaming: false,
    streamStartTime: null,
    statusCheckTimer: null,
    autoStopTimer: null
};

// ========================================
// API Functions
// ========================================

async function startStream() {
    try {
        const response = await fetch(`${CONFIG.streamApiUrl}/stream/start?api_key=${CONFIG.apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        console.log('Stream start response:', data);
        
        if (data.status === 'started' || data.status === 'already_running') {
            return true;
        } else {
            console.error('Failed to start stream:', data);
            return false;
        }
    } catch (error) {
        console.error('Error starting stream:', error);
        return false;
    }
}

async function checkStreamStatus() {
    try {
        const response = await fetch(`${CONFIG.streamApiUrl}/stream/status?api_key=${CONFIG.apiKey}`);
        const data = await response.json();
        return data.stream_active;
    } catch (error) {
        console.error('Error checking stream status:', error);
        return false;
    }
}

async function stopStream() {
    try {
        const response = await fetch(`${CONFIG.streamApiUrl}/stream/stop?api_key=${CONFIG.apiKey}`, {
            method: 'POST'
        });
        const data = await response.json();
        console.log('Stream stop response:', data);
        return true;
    } catch (error) {
        console.error('Error stopping stream:', error);
        return false;
    }
}

// ========================================
// UI Functions
// ========================================

function updatePlayButton(state) {
    const playButton = document.getElementById('play-button');
    const statusText = document.getElementById('stream-status');
    
    switch(state) {
        case 'ready':
            playButton.disabled = false;
            playButton.textContent = '▶️ Play Live Stream';
            playButton.classList.remove('loading', 'streaming');
            if (statusText) statusText.textContent = 'Ready to stream';
            break;
            
        case 'loading':
            playButton.disabled = true;
            playButton.textContent = '⏳ Starting stream...';
            playButton.classList.add('loading');
            if (statusText) statusText.textContent = 'Initializing stream...';
            break;
            
        case 'streaming':
            playButton.disabled = true;
            playButton.textContent = '🔴 Live';
            playButton.classList.add('streaming');
            playButton.classList.remove('loading');
            if (statusText) {
                const timeRemaining = Math.floor((CONFIG.streamDuration - (Date.now() - streamState.streamStartTime)) / 1000);
                statusText.textContent = `Streaming (${Math.floor(timeRemaining / 60)}:${(timeRemaining % 60).toString().padStart(2, '0')} remaining)`;
            }
            break;
            
        case 'ended':
            playButton.disabled = false;
            playButton.textContent = '▶️ Restart Stream';
            playButton.classList.remove('loading', 'streaming');
            if (statusText) statusText.textContent = 'Stream ended. Click to restart.';
            break;
            
        case 'error':
            playButton.disabled = false;
            playButton.textContent = '⚠️ Try Again';
            playButton.classList.remove('loading', 'streaming');
            if (statusText) statusText.textContent = 'Error starting stream. Try again.';
            break;
    }
}

function updateRemainingTime() {
    if (!streamState.isStreaming || !streamState.streamStartTime) return;
    
    const elapsed = Date.now() - streamState.streamStartTime;
    const remaining = CONFIG.streamDuration - elapsed;
    
    if (remaining <= 0) {
        handleStreamEnded();
        return;
    }
    
    const statusText = document.getElementById('stream-status');
    if (statusText) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        statusText.textContent = `🔴 Live (${minutes}:${seconds.toString().padStart(2, '0')} remaining)`;
    }
}

// ========================================
// Stream Management
// ========================================

function startStatusChecking() {
    // Check stream status periodically
    streamState.statusCheckTimer = setInterval(async () => {
        const isActive = await checkStreamStatus();
        if (!isActive && streamState.isStreaming) {
            // Stream stopped unexpectedly
            console.log('Stream stopped unexpectedly');
            handleStreamEnded();
        }
    }, CONFIG.statusCheckInterval);
    
    // Update remaining time display every second
    const timeUpdateTimer = setInterval(() => {
        if (streamState.isStreaming) {
            updateRemainingTime();
        } else {
            clearInterval(timeUpdateTimer);
        }
    }, 1000);
}

function stopStatusChecking() {
    if (streamState.statusCheckTimer) {
        clearInterval(streamState.statusCheckTimer);
        streamState.statusCheckTimer = null;
    }
    if (streamState.autoStopTimer) {
        clearTimeout(streamState.autoStopTimer);
        streamState.autoStopTimer = null;
    }
}

function handleStreamEnded() {
    console.log('Stream ended');
    
    // Stop the HLS player
    stopHLSPlayer();
    
    // Update state
    streamState.isStreaming = false;
    streamState.streamStartTime = null;
    stopStatusChecking();
    
    // Update UI
    updatePlayButton('ended');
}

async function handlePlayButtonClick() {
    console.log('Play button clicked');
    
    // Update UI to loading state
    updatePlayButton('loading');
    
    try {
        // Start the stream on RPi5
        const streamStarted = await startStream();
        
        if (!streamStarted) {
            updatePlayButton('error');
            alert('Failed to start stream. Please try again.');
            return;
        }
        
        // Wait for stream to initialize
        console.log(`Waiting ${CONFIG.startupDelay}ms for stream to start...`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.startupDelay));
        
        // Update state
        streamState.isStreaming = true;
        streamState.streamStartTime = Date.now();
        
        // Initialize HLS player with the stream URL
        console.log('Initializing HLS player with URL:', CONFIG.cloudflareStreamUrl);
        const playerStarted = initializeHLSPlayer(CONFIG.cloudflareStreamUrl);
        
        if (!playerStarted) {
            console.error('Failed to initialize video player');
            updatePlayButton('error');
            alert('Failed to initialize video player. Please try again.');
            streamState.isStreaming = false;
            streamState.streamStartTime = null;
            return;
        }
        
        // Update UI
        updatePlayButton('streaming');
        
        // Start monitoring stream status
        startStatusChecking();
        
        // Set timer to handle automatic stop after 5 minutes
        streamState.autoStopTimer = setTimeout(() => {
            handleStreamEnded();
        }, CONFIG.streamDuration);
        
    } catch (error) {
        console.error('Error in handlePlayButtonClick:', error);
        updatePlayButton('error');
        alert('An error occurred. Please try again.');
    }
}

// ========================================
// HLS Player Setup
// ========================================

let hlsInstance = null;

function initializeHLSPlayer(url) {
    const videoPlayer = document.getElementById('video-player');
    if (!videoPlayer) {
        console.error('Video player element not found');
        return false;
    }

    // Destroy existing HLS instance if any
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    // Check if browser supports native HLS (Safari/iOS)
    if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        console.log('Using native HLS support');
        videoPlayer.src = url;
        videoPlayer.play().catch(err => {
            console.error('Error playing video:', err);
            updatePlayButton('error');
            alert('Failed to play video. Please try again.');
        });
        return true;
    }
    // Use HLS.js for other browsers
    else if (window.Hls && Hls.isSupported()) {
        console.log('Using HLS.js');
        hlsInstance = new Hls({
            lowLatencyMode: false,
            liveSyncDurationCount: 3,
            enableWorker: true
        });

        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(videoPlayer);

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('HLS manifest parsed, starting playback');
            videoPlayer.play().catch(err => {
                console.error('Error playing video:', err);
                updatePlayButton('error');
                alert('Failed to play video. Please try again.');
            });
        });

        hlsInstance.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', data);
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('Network error, attempting recovery...');
                        hlsInstance.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('Media error, attempting recovery...');
                        hlsInstance.recoverMediaError();
                        break;
                    default:
                        console.error('Fatal error, cannot recover');
                        if (streamState.isStreaming) {
                            updatePlayButton('error');
                            alert('Stream playback error. Please try restarting the stream.');
                        }
                        break;
                }
            }
        });

        return true;
    } else {
        console.error('HLS not supported in this browser');
        alert('Your browser does not support HLS video playback.');
        return false;
    }
}

function stopHLSPlayer() {
    const videoPlayer = document.getElementById('video-player');
    
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    
    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.src = '';
        videoPlayer.load();
    }
}

// ========================================
// Video Player Event Handlers
// ========================================

function setupVideoPlayerEvents() {
    const videoPlayer = document.getElementById('video-player');
    if (!videoPlayer) return;
    
    videoPlayer.addEventListener('error', (e) => {
        console.error('Video player error:', e);
        if (streamState.isStreaming) {
            // If we're supposed to be streaming, show error
            updatePlayButton('error');
            alert('Video playback error. The stream may have ended or encountered an issue.');
            handleStreamEnded();
        }
    });
    
    videoPlayer.addEventListener('ended', () => {
        console.log('Video ended event');
        if (streamState.isStreaming) {
            handleStreamEnded();
        }
    });
}

// ========================================
// Initialization
// ========================================

function initializeStreamControls() {
    console.log('Initializing stream controls');
    
    // Setup play button
    const playButton = document.getElementById('play-button');
    if (playButton) {
        playButton.addEventListener('click', handlePlayButtonClick);
        updatePlayButton('ready');
    } else {
        console.error('Play button not found! Make sure element with id="play-button" exists.');
    }
    
    // Setup video player events
    setupVideoPlayerEvents();
    
    // Check initial stream status
    checkStreamStatus().then(isActive => {
        if (isActive) {
            console.log('Stream is already active');
            // Optionally auto-connect to existing stream
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeStreamControls);
} else {
    initializeStreamControls();
}

// ========================================
// Optional: Manual Controls (for testing)
// ========================================

// Expose functions globally for manual testing in browser console
window.streamControls = {
    start: handlePlayButtonClick,
    stop: handleStreamEnded,
    checkStatus: checkStreamStatus,
    getState: () => streamState
};
