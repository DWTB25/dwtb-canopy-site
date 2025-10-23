// ========================================
// Dual Camera On-Demand Stream Integration
// ========================================

//GABY2
// Configuration
const CONFIG = {
  streamApiUrl: 'https://stream-api.dwtb-solar-canopy.org',
  apiKey: 'bb6104ec02362103cf42e69567d1f724f577b46f3789ec162893cdb906c587c2',
  cameras: {
    cam1: {
      id: 'cam1',
      name: 'Camera 1',
      playbackUrl: 'https://customer-i32my3qs0ldoeuy3.cloudflarestream.com/c0c327782cd0701b6d78dd33526706e3/manifest/video.m3u8'
    },
    cam2: {
      id: 'cam2',
      name: 'Camera 2',
      playbackUrl: 'https://customer-i32my3qs0ldoeuy3.cloudflarestream.com/4aabdd6cb03fb70149fb583b3ffa66bd/manifest/video.m3u8'
    }
  },
  streamDuration: 300000,      // 5 minutes
  startupDelay: 15000,         // wait for CF stream to spin up
  statusCheckInterval: 10000,  // 10 s
  sensorUpdateInterval: 10000  // 10 s
};

// State per camera
const cameraStates = {
  cam1: { isStreaming: false, streamStartTime: null, statusCheckTimer: null, autoStopTimer: null, hlsInstance: null },
  cam2: { isStreaming: false, streamStartTime: null, statusCheckTimer: null, autoStopTimer: null, hlsInstance: null }
};

// ========================================
// API helpers (camera)
// ========================================
async function startStream(cameraId) {
  try {
    const resp = await fetch(`${CONFIG.streamApiUrl}/stream/start/${cameraId}?api_key=${CONFIG.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await resp.json();
    console.log(`${cameraId} stream start response:`, data);
    return ['started', 'starting', 'already_running'].includes(data.status);
  } catch (e) {
    console.error(`Error starting ${cameraId}:`, e);
    return false;
  }
}

async function checkStreamStatus(cameraId) {
  try {
    const resp = await fetch(`${CONFIG.streamApiUrl}/stream/status/${cameraId}?api_key=${CONFIG.apiKey}`);
    const data = await resp.json();
    return !!data.stream_active;
  } catch (e) {
    console.error(`Error checking ${cameraId} status:`, e);
    return false;
  }
}

// ========================================
// UI helpers (camera)
// ========================================
function updatePlayButton(cameraId, state) {
  const playButton = document.getElementById(`play-button-${cameraId}`);
  const statusText = document.getElementById(`stream-status-${cameraId}`);
  const name = CONFIG.cameras[cameraId].name;

  if (!playButton) return;

  switch (state) {
    case 'ready':
      playButton.disabled = false;
      playButton.textContent = `▶️ Play ${name}`;
      playButton.classList.remove('loading', 'streaming');
      if (statusText) statusText.textContent = 'Ready to stream';
      break;
    case 'loading':
      playButton.disabled = true;
      playButton.textContent = `⏳ Starting ${name}…`;
      playButton.classList.add('loading');
      if (statusText) statusText.textContent = 'Starting…';
      break;
    case 'streaming':
      playButton.disabled = false;
      playButton.textContent = `⏹ Stop ${name}`;
      playButton.classList.remove('loading');
      playButton.classList.add('streaming');
      if (statusText) statusText.textContent = 'Streaming';
      break;
    case 'error':
      playButton.disabled = false;
      playButton.textContent = `▶️ Retry ${name}`;
      playButton.classList.remove('loading', 'streaming');
      if (statusText) statusText.textContent = 'Error';
      break;
  }
}

// HLS player control
async function startHLSPlayer(cameraId) {
  const state = cameraStates[cameraId];
  const video = document.getElementById(`video-player-${cameraId}`);
  const playbackUrl = CONFIG.cameras[cameraId].playbackUrl;

  if (!video) return false;

  if (Hls.isSupported()) {
    // Cleanup if any
    if (state.hlsInstance) {
      state.hlsInstance.destroy();
      state.hlsInstance = null;
    }

    const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
    state.hlsInstance = hls;

    hls.loadSource(playbackUrl);
    hls.attachMedia(video);

    return new Promise(resolve => {
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().then(() => resolve(true)).catch(err => {
          console.error('Autoplay failed:', err);
          resolve(false);
        });
      });

      hls.on(Hls.Events.ERROR, (evt, data) => {
        console.error(`${cameraId} HLS error`, data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              console.error(`${cameraId} fatal error, cannot recover`);
              if (state.isStreaming) {
                updatePlayButton(cameraId, 'error');
                alert(`${CONFIG.cameras[cameraId].name} playback error. Please try restarting.`);
              }
              break;
          }
        }
      });
    });
  } else {
    alert('Your browser does not support HLS video playback.');
    return false;
  }
}

function stopHLSPlayer(cameraId) {
  const video = document.getElementById(`video-player-${cameraId}`);
  const state = cameraStates[cameraId];

  if (state.hlsInstance) {
    state.hlsInstance.destroy();
    state.hlsInstance = null;
  }
  if (video) {
    video.pause();
    video.src = '';
    video.load();
  }
}

async function handlePlayButtonClick(cameraId) {
  const state = cameraStates[cameraId];

  // If already streaming => stop
  if (state.isStreaming) {
    handleStreamEnded(cameraId);
    return;
  }

  updatePlayButton(cameraId, 'loading');

  // Ask backend to start pushing the stream
  const ok = await startStream(cameraId);
  if (!ok) {
    updatePlayButton(cameraId, 'error');
    alert(`Failed to start ${CONFIG.cameras[cameraId].name}.`);
    return;
  }

  // Wait a bit for ingest/startup then attach HLS
  setTimeout(async () => {
    const attached = await startHLSPlayer(cameraId);
    if (!attached) {
      updatePlayButton(cameraId, 'error');
      return;
    }

    state.isStreaming = true;
    state.streamStartTime = Date.now();
    updatePlayButton(cameraId, 'streaming');

    // Auto stop after streamDuration
    state.autoStopTimer = setTimeout(() => handleStreamEnded(cameraId), CONFIG.streamDuration);

    // Periodic status check (optional)
    state.statusCheckTimer = setInterval(async () => {
      const active = await checkStreamStatus(cameraId);
      if (!active) handleStreamEnded(cameraId);
    }, CONFIG.statusCheckInterval);
  }, CONFIG.startupDelay);
}

function handleStreamEnded(cameraId) {
  const state = cameraStates[cameraId];

  stopHLSPlayer(cameraId);

  if (state.autoStopTimer) clearTimeout(state.autoStopTimer);
  if (state.statusCheckTimer) clearInterval(state.statusCheckTimer);

  state.isStreaming = false;
  state.streamStartTime = null;
  state.autoStopTimer = null;
  state.statusCheckTimer = null;

  updatePlayButton(cameraId, 'ready');
}

// Video element listeners
function setupVideoPlayerEvents(cameraId) {
  const video = document.getElementById(`video-player-${cameraId}`);
  if (!video) return;
  const state = cameraStates[cameraId];

  video.addEventListener('error', (e) => {
    console.error(`${cameraId} video error`, e);
    if (state.isStreaming) {
      const elapsed = Date.now() - state.streamStartTime;
      if (elapsed >= CONFIG.streamDuration - 5000) {
        handleStreamEnded(cameraId);
      } else {
        updatePlayButton(cameraId, 'error');
        alert(`${CONFIG.cameras[cameraId].name} playback error. The stream may have ended unexpectedly.`);
        handleStreamEnded(cameraId);
      }
    }
  });

  video.addEventListener('ended', () => {
    if (state.isStreaming) handleStreamEnded(cameraId);
  });
}

// ========================================
// Sensor Data (cards + chart)
// ========================================
let sensorUpdateTimer = null;
let chart = null;
let currentTimeRange = 60; // default: last 60 samples

async function fetchSensorData() {
  try {
    const response = await fetch(`${CONFIG.streamApiUrl}/sensor/data`);
    const result = await response.json();
    if (result.status === 'ok' && result.data) {
      updateSensorDisplay(result.data);
      return true;
    } else {
      console.error('Sensor data error:', result);
      showSensorError('No data available');
      return false;
    }
  } catch (e) {
    console.error('Error fetching sensor data:', e);
    showSensorError('Connection error');
    return false;
  }
}

async function fetchSensorHistory(limit = null) {
  try {
    let url = `${CONFIG.streamApiUrl}/sensor/history`;
    if (limit) url += `?limit=${limit}`;
    const response = await fetch(url);
    const result = await response.json();
    if (result.status === 'ok' && result.data) return result.data;
    console.error('Sensor history error:', result);
    return [];
  } catch (e) {
    console.error('Error fetching sensor history:', e);
    return [];
  }
}

function updateSensorDisplay(data) {
  const tEl = document.getElementById('temperature-value');
  const hEl = document.getElementById('humidity-value');
  const sEl = document.getElementById('sensor-status');

  if (data.temperature != null && data.humidity != null) {
    if (tEl) {
      tEl.textContent = Number(data.temperature).toFixed(1);
      tEl.classList.add('updated'); setTimeout(() => tEl.classList.remove('updated'), 500);
    }
    if (hEl) {
      hEl.textContent = Number(data.humidity).toFixed(1);
      hEl.classList.add('updated'); setTimeout(() => hEl.classList.remove('updated'), 500);
    }
    if (sEl) {
      const ts = new Date(data.last_update);
      sEl.textContent = `Last updated: ${ts.toLocaleTimeString()} (${data.sample_count} samples)`;
      sEl.className = 'sensor-status success';
    }
  } else {
    if (sEl) {
      sEl.textContent = 'Waiting for sensor data.';
      sEl.className = 'sensor-status';
    }
  }
}

function showSensorError(msg) {
  const sEl = document.getElementById('sensor-status');
  if (sEl) {
    sEl.textContent = `Error: ${msg}`;
    sEl.className = 'sensor-status error';
  }
}

function startSensorUpdates() {
  console.log('Starting sensor data updates');
  fetchSensorData();
  updateChart();
  sensorUpdateTimer = setInterval(() => {
    fetchSensorData();
    updateChart();
  }, CONFIG.sensorUpdateInterval);
}

function stopSensorUpdates() {
  if (sensorUpdateTimer) {
    clearInterval(sensorUpdateTimer);
    sensorUpdateTimer = null;
  }
}

// Chart setup
function initializeChart() {
  const canvas = document.getElementById('sensor-chart');
  if (!canvas) { console.error('Chart canvas not found'); return; }
  const ctx = canvas.getContext('2d');

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Temperature (°C)',
          data: [],
          yAxisID: 'y-temp',
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2
        },
        {
          label: 'Humidity (%)',
          data: [],
          yAxisID: 'y-hum',
          borderWidth: 2,
          pointRadius: 2,
          borderDash: [4, 3],
          tension: 0.2
        }
      ]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: { enabled: true }
      },
      scales: {
        x: { ticks: { autoSkip: true, maxTicksLimit: 8 } },
        'y-temp': {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Temperature (°C)' },
          grid: { drawOnChartArea: true },
          suggestedMin: 10,   // adjust for your environment
          suggestedMax: 40
        },
        'y-hum': {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'Humidity (%)' },
          grid: { drawOnChartArea: false },
          min: 0,
          max: 100
        }
      }
    }
  });

  console.log('Chart initialized');
}

// Robust history → chart mapping
async function updateChart() {
  if (!chart) { console.error('Chart not initialized'); return; }

  const limit = currentTimeRange === 'all' ? null : currentTimeRange;
  let history = await fetchSensorHistory(limit);

  if (!Array.isArray(history) || history.length === 0) {
    console.log('No history data yet');
    return;
  }

  // Normalize keys and coerce to numbers
  history = history.map(d => {
    const t = Number.parseFloat(d.temperature ?? d.temp ?? d.t);
    const h = Number.parseFloat(d.humidity   ?? d.hum  ?? d.h);
    const ts = d.timestamp ?? d.time ?? Date.now();
    return {
      timestamp: ts,
      temperature: Number.isFinite(t) ? t : NaN,
      humidity: Number.isFinite(h) ? h : NaN
    };
  });

  // Filter obviously wrong points / NaN
  history = history.filter(d =>
    Number.isFinite(d.temperature) && Number.isFinite(d.humidity) &&
    d.temperature > -40 && d.temperature < 80 &&
    d.humidity >= 0 && d.humidity <= 100
  );

  if (history.length === 0) return;

  const labels = history.map(d => {
    const date = new Date(d.timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  const temperatures = history.map(d => d.temperature);
  const humidities   = history.map(d => d.humidity);

  chart.data.labels = labels;
  chart.data.datasets[0].data = temperatures; // temperature (°C)
  chart.data.datasets[1].data = humidities;   // humidity (%)
  chart.update('none'); // fast update without animation

  console.log(`Chart updated with ${history.length} points`);
}

function setupChartControls() {
  const buttons = document.querySelectorAll('.time-range-btn');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      button.classList.add('active');
      const range = button.getAttribute('data-range');
      currentTimeRange = range === 'all' ? 'all' : parseInt(range, 10);
      updateChart();
    });
  });
}

// ========================================
// Initialization (single source of truth)
// ========================================
function initializeCamera(cameraId) {
  const playButton = document.getElementById(`play-button-${cameraId}`);
  if (playButton) {
    playButton.addEventListener('click', () => handlePlayButtonClick(cameraId));
    updatePlayButton(cameraId, 'ready');
  } else {
    console.error(`Play button not found for ${cameraId}`);
  }

  setupVideoPlayerEvents(cameraId);

  // Optional: check initial status
  checkStreamStatus(cameraId).then(isActive => {
    if (isActive) console.log(`${cameraId} stream is already active`);
  });
}

function initializeStreamControls() {
  console.log('Initializing dual camera stream controls and sensors');

  // Cameras
  initializeCamera('cam1');
  initializeCamera('cam2');

  // Chart + controls
  initializeChart();
  setupChartControls();

  // Sensor polling
  startSensorUpdates();
}

// Init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeStreamControls);
} else {
  initializeStreamControls();
}

// Optional debug hooks
window.streamControls = {
  startCam1: () => handlePlayButtonClick('cam1'),
  startCam2: () => handlePlayButtonClick('cam2'),
  stopCam1: () => handleStreamEnded('cam1'),
  stopCam2: () => handleStreamEnded('cam2'),
  checkStatus: (id) => checkStreamStatus(id),
  getState: (id) => cameraStates[id]
};
window.sensorControls = {
  fetch: fetchSensorData,
  fetchHistory: fetchSensorHistory,
  start: startSensorUpdates,
  stop: stopSensorUpdates,
  updateChart: updateChart
};
