(function () {
  const NICKNAME_KEY = 'birdcam_nickname';

  const video = document.getElementById('video');
  const videoOverlay = document.getElementById('video-overlay');
  const cameraTabs = document.getElementById('camera-tabs');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const nicknameInput = document.getElementById('nickname');
  const chatSend = document.getElementById('chat-send');

  let hls = null;
  let ws = null;
  let cameras = [];
  let selectedCameraId = null;

  function loadCameras() {
    fetch('/api/cameras')
      .then((r) => r.json())
      .then((list) => {
        cameras = list;
        renderTabs();
        if (cameras.length && !selectedCameraId) selectCamera(cameras[0].id);
        if (!cameras.length) {
          selectedCameraId = null;
          destroyHls();
          videoOverlay.classList.remove('hidden');
          videoOverlay.querySelector('p').textContent = 'No cameras yet. Add one in Admin.';
        }
      })
      .catch(() => {
        cameras = [];
        renderTabs();
      });
  }

  function renderTabs() {
    cameraTabs.innerHTML = '';
    cameras.forEach((cam) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.role = 'tab';
      tab.setAttribute('data-cam-id', cam.id);
      tab.setAttribute('aria-selected', selectedCameraId === cam.id ? 'true' : 'false');
      tab.textContent = cam.display_name;
      tab.addEventListener('click', () => selectCamera(cam.id));
      cameraTabs.appendChild(tab);
    });
  }

  function selectCamera(id) {
    selectedCameraId = id;
    cameraTabs.querySelectorAll('[role="tab"]').forEach((tab) => {
      tab.setAttribute('aria-selected', tab.getAttribute('data-cam-id') === String(id) ? 'true' : 'false');
    });

    const src = `/hls/cam-${id}.m3u8`;
    if (Hls.isSupported()) {
      destroyHls();
      hls = new Hls({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => videoOverlay.classList.add('hidden'));
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          videoOverlay.classList.remove('hidden');
          videoOverlay.querySelector('p').textContent = 'Stream not available. Try another camera.';
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      videoOverlay.classList.add('hidden');
    } else {
      videoOverlay.classList.remove('hidden');
      videoOverlay.querySelector('p').textContent = 'HLS not supported in this browser.';
    }
    renderTabs();
  }

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    video.src = '';
  }

  loadCameras();
  setInterval(loadCameras, 15000);

  function connectWs() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host + '/ws');
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'history' && Array.isArray(data.messages)) {
          data.messages.forEach((m) => appendMessage(m));
        } else if (data.type === 'message' && data.nickname && data.text) {
          appendMessage(data);
        }
      } catch (_) {}
    };
    ws.onclose = () => setTimeout(connectWs, 3000);
  }

  function appendMessage(m) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const time = m.time ? new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    div.innerHTML = `<span class="name">${escapeHtml(m.nickname)}</span><div class="text">${escapeHtml(m.text)}</div><div class="time">${time}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function escapeHtml(s) {
    const el = document.createElement('span');
    el.textContent = s == null ? '' : String(s);
    return el.innerHTML;
  }

  // --- Stream info panel ---
  const infoBtn = document.getElementById('info-btn');
  const infoPanel = document.getElementById('info-panel');

  infoBtn.addEventListener('click', () => {
    const isHidden = infoPanel.classList.toggle('hidden');
    if (!isHidden) updateInfoPanel();
  });

  function updateInfoPanel() {
    const lines = [];
    if (video.videoWidth && video.videoHeight) {
      lines.push('Resolution: ' + video.videoWidth + 'x' + video.videoHeight);
    }
    if (!isNaN(video.duration) && isFinite(video.duration)) {
      lines.push('Buffer: ' + video.duration.toFixed(1) + 's');
    }
    if (video.currentTime) {
      lines.push('Position: ' + video.currentTime.toFixed(1) + 's');
    }
    if (hls) {
      const level = hls.levels && hls.levels[hls.currentLevel];
      if (level) {
        if (level.codecSet) lines.push('Codecs: ' + level.codecSet);
        else if (level.attrs && level.attrs.CODECS) lines.push('Codecs: ' + level.attrs.CODECS);
        if (level.bitrate) lines.push('Bitrate: ' + (level.bitrate / 1000).toFixed(0) + ' kbps');
        if (level.width && level.height) lines.push('Level: ' + level.width + 'x' + level.height);
      }
      if (hls.latency != null) lines.push('Latency: ' + hls.latency.toFixed(1) + 's');
      lines.push('Dropped frames: ' + (video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality().droppedVideoFrames : 'N/A'));
    } else if (video.src) {
      lines.push('Native HLS (Safari)');
      if (video.getVideoPlaybackQuality) {
        const q = video.getVideoPlaybackQuality();
        lines.push('Dropped frames: ' + q.droppedVideoFrames);
      }
    }
    if (!lines.length) lines.push('No stream active');
    infoPanel.textContent = lines.join('\n');
  }

  // Refresh info panel if open
  setInterval(() => {
    if (!infoPanel.classList.contains('hidden')) updateInfoPanel();
  }, 2000);

  // --- Emoji picker ---
  const emojiBtn = document.getElementById('emoji-btn');
  const emojiPicker = document.getElementById('emoji-picker');
  const EMOJIS = ['😊','😂','🥰','😍','🤩','😎','😢','😭','😡','🤔','👍','👎','❤️','🔥','🎉','🌟','🐦','🐧','🦆','🦜','🦅','🦉','🐣','🌸','🍃','🌿','🌳','☀️','🌈','⭐','🎵','👀','🙌','💪','🤣','😅','🥳','😴','🤯','💯'];
  EMOJIS.forEach((em) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = em;
    btn.addEventListener('click', () => {
      chatInput.value += em;
      chatInput.focus();
      emojiPicker.classList.add('hidden');
    });
    emojiPicker.appendChild(btn);
  });
  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
  });
  document.addEventListener('click', () => emojiPicker.classList.add('hidden'));
  emojiPicker.addEventListener('click', (e) => e.stopPropagation());

  chatSend.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

  function sendMessage() {
    const text = (chatInput.value || '').trim();
    const nickname = (nicknameInput.value || 'Guest').trim() || 'Guest';
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ nickname, text }));
    chatInput.value = '';
    try {
      localStorage.setItem(NICKNAME_KEY, nickname);
    } catch (_) {}
  }

  try {
    const saved = localStorage.getItem(NICKNAME_KEY);
    if (saved) nicknameInput.value = saved;
  } catch (_) {}

  connectWs();
})();
