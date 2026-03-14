const express = require('express');
const os = require('os');
const router = express.Router();
const db = require('../db');
const streamManager = require('../streamManager');
const { requireLogin, requireSetup, requireNoSetup } = require('../middleware/auth');

const BUILD_TIME = new Date().toISOString();

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const layout = (title, body) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} – Birdcam Admin</title>
  <link rel="stylesheet" href="/admin/style.css">
</head>
<body class="admin">
  <div class="admin-wrap">
    <header class="admin-header">
      <a href="/admin">Birdcam Admin</a>
      ${title !== 'Login' && title !== 'Setup' ? '<a href="/admin/logout" class="btn btn-ghost">Logout</a>' : ''}
    </header>
    <main class="admin-main">${body}</main>
  </div>
</body>
</html>`;

router.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/admin');
  const hasUser = db.getDb().prepare('SELECT 1 FROM users LIMIT 1').get();
  if (!hasUser) return res.redirect('/admin/setup');
  res.send(layout('Login', `
    <h1>Log in</h1>
    <form method="post" action="/admin/login" class="admin-form">
      <label>Username <input type="text" name="username" required autofocus></label>
      <label>Password <input type="password" name="password" required></label>
      <button type="submit" class="btn btn-primary">Log in</button>
    </form>
    ${req.query.msg ? `<p class="admin-msg">${escapeHtml(req.query.msg)}</p>` : ''}
  `));
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.findUserByUsername(username);
  if (!user || !db.verifyPassword(password, user.password_hash)) {
    return res.redirect('/admin/login?msg=Invalid+username+or+password');
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/admin');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/setup', requireSetup, (req, res) => {
  res.send(layout('Setup', `
    <h1>Create admin account</h1>
    <p>No admin user yet. Create the first one.</p>
    <form method="post" action="/admin/setup" class="admin-form">
      <label>Username <input type="text" name="username" required autofocus></label>
      <label>Password <input type="password" name="password" required minlength="6"></label>
      <button type="submit" class="btn btn-primary">Create admin</button>
    </form>
  `));
});

router.post('/setup', requireSetup, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.redirect('/admin/setup');
  }
  db.ensureAdmin(username, password);
  const user = db.findUserByUsername(username);
  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/admin');
});

router.get('/', requireLogin, requireNoSetup, (req, res) => {
  const cameras = db.listCameras();
  const rows = cameras.map((c) => {
    const running = streamManager.isRunning(c.id);
    return `
      <tr>
        <td>${escapeHtml(c.display_name)}</td>
        <td><span class="status ${running ? 'on' : 'off'}">${running ? 'Live' : 'Off'}</span></td>
        <td>
          <a href="/admin/cameras/${c.id}/edit" class="btn btn-small">Edit</a>
          <form method="post" action="/admin/cameras/${c.id}/delete" style="display:inline" onsubmit="return confirm('Delete this camera?');">
            <button type="submit" class="btn btn-small btn-danger">Delete</button>
          </form>
        </td>
      </tr>`;
  }).join('');
  res.send(layout('Dashboard', `
    <h1>Cameras</h1>
    <p><a href="/admin/cameras/new" class="btn btn-primary">Add camera</a></p>
    <table class="admin-table">
      <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3">No cameras yet. Add one!</td></tr>'}</tbody>
    </table>
    <p style="margin-top:1rem;">
      <a href="/">View public birdcam page</a>
    </p>
    <div style="margin-top:1.5rem;">
      <button type="button" class="btn btn-small" id="debug-toggle">Debug</button>
      <div id="debug-panel" class="debug-panel" style="display:none;"></div>
    </div>
    <script>
    (function() {
      const btn = document.getElementById('debug-toggle');
      const panel = document.getElementById('debug-panel');
      let open = false;
      let polling = null;

      function escH(s) {
        const el = document.createElement('span');
        el.textContent = s;
        return el.innerHTML;
      }

      function fetchDebug() {
        fetch('/admin/api/debug-info').then(r => r.json()).then(info => {
          let html = '<h3>System</h3><table class="admin-table debug-table">';
          html += '<tr><td>Build time</td><td>' + escH(info.buildTime) + '</td></tr>';
          html += '<tr><td>Server uptime</td><td>' + escH(info.uptime) + '</td></tr>';
          html += '<tr><td>Node.js</td><td>' + escH(info.nodeVersion) + '</td></tr>';
          html += '<tr><td>Platform</td><td>' + escH(info.platform + ' ' + info.arch) + '</td></tr>';
          html += '<tr><td>Hostname</td><td>' + escH(info.hostname) + '</td></tr>';
          html += '<tr><td>Memory (RSS)</td><td>' + escH(info.memoryMB + ' MB') + '</td></tr>';
          html += '<tr><td>Free system mem</td><td>' + escH(info.freeMemMB + ' MB') + '</td></tr>';
          html += '</table>';

          html += '<h3>Environment</h3><table class="admin-table debug-table">';
          for (const [k,v] of Object.entries(info.env)) {
            html += '<tr><td>' + escH(k) + '</td><td>' + escH(v) + '</td></tr>';
          }
          html += '</table>';

          html += '<h3>Cameras</h3><table class="admin-table debug-table">';
          html += '<tr><th>ID</th><th>Name</th><th>Status</th><th>Log lines</th></tr>';
          for (const cam of info.cameras) {
            html += '<tr><td>' + cam.id + '</td><td>' + escH(cam.name) + '</td>';
            html += '<td><span class="status ' + (cam.running ? 'on' : 'off') + '">' + (cam.running ? 'Live' : 'Off') + '</span></td>';
            html += '<td>' + cam.logLines + '</td></tr>';
            if (cam.streamInfo && cam.streamInfo.length) {
              html += '<tr><td colspan="4"><pre style="margin:0.25rem 0 0.5rem;font-size:0.75rem;background:#1a202c;color:#68d391;padding:0.5rem;border-radius:6px;white-space:pre-wrap;word-break:break-all">' + cam.streamInfo.map(l => escH(l)).join('\n') + '</pre></td></tr>';
            }
          }
          html += '</table>';

          html += '<p style="margin-top:0.75rem;"><a href="/admin/debug" class="btn btn-small">View FFmpeg Logs</a></p>';

          panel.innerHTML = html;
        }).catch(() => { panel.innerHTML = '<p>Failed to load debug info.</p>'; });
      }

      btn.addEventListener('click', () => {
        open = !open;
        panel.style.display = open ? 'block' : 'none';
        btn.textContent = open ? 'Hide Debug' : 'Debug';
        if (open) {
          fetchDebug();
          polling = setInterval(fetchDebug, 5000);
        } else if (polling) {
          clearInterval(polling);
          polling = null;
        }
      });
    })();
    </script>
  `));
});

router.get('/cameras/new', requireLogin, (req, res) => {
  res.send(layout('Add camera', `
    <h1>Add camera</h1>
    <form method="post" action="/admin/cameras" class="admin-form">
      <label>Display name <input type="text" name="display_name" required placeholder="e.g. Garden bird feeder"></label>
      <label>Host / IP <input type="text" name="rtsp_host" required placeholder="192.168.1.100"></label>
      <label>Port <input type="text" name="rtsp_port" value="554" placeholder="554"></label>
      <label>Username <input type="text" name="rtsp_username" placeholder="admin" autocomplete="off"></label>
      <label>Password <input type="password" name="rtsp_password" placeholder="password" autocomplete="off"></label>
      <label>Path <input type="text" name="rtsp_path" placeholder="/stream1"></label>
      <button type="submit" class="btn btn-primary">Add camera</button>
      <a href="/admin" class="btn btn-ghost">Cancel</a>
    </form>
  `));
});

router.post('/cameras', requireLogin, (req, res) => {
  const { display_name, rtsp_host, rtsp_port, rtsp_path, rtsp_username, rtsp_password } = req.body || {};
  if (!display_name || !rtsp_host) return res.redirect('/admin/cameras/new');
  const port = parseInt(rtsp_port) || 554;
  const id = db.createCamera(display_name.trim(), rtsp_host.trim(), port, (rtsp_path || '').trim(), (rtsp_username || '').trim(), (rtsp_password || '').trim());
  const cam = db.getCamera(id);
  streamManager.startStream(id, cam.rtsp_url);
  res.redirect('/admin');
});

router.get('/cameras/:id/edit', requireLogin, (req, res) => {
  const c = db.getCamera(Number(req.params.id));
  if (!c) return res.redirect('/admin');
  res.send(layout('Edit camera', `
    <h1>Edit camera</h1>
    <form method="post" action="/admin/cameras/${c.id}" class="admin-form">
      <label>Display name <input type="text" name="display_name" value="${escapeHtml(c.display_name)}" required></label>
      <label>Host / IP <input type="text" name="rtsp_host" value="${escapeHtml(c.rtsp_host)}" required></label>
      <label>Port <input type="text" name="rtsp_port" value="${escapeHtml(String(c.rtsp_port || 554))}"></label>
      <label>Username <input type="text" name="rtsp_username" value="${escapeHtml(c.rtsp_username)}" autocomplete="off"></label>
      <label>Password <input type="password" name="rtsp_password" value="${escapeHtml(c.rtsp_password)}" autocomplete="off"></label>
      <label>Path <input type="text" name="rtsp_path" value="${escapeHtml(c.rtsp_path)}"></label>
      <button type="submit" class="btn btn-primary">Save</button>
      <a href="/admin" class="btn btn-ghost">Cancel</a>
    </form>
  `));
});

router.post('/cameras/:id', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  const c = db.getCamera(id);
  if (!c) return res.redirect('/admin');
  const { display_name, rtsp_host, rtsp_port, rtsp_path, rtsp_username, rtsp_password } = req.body || {};
  if (!display_name || !rtsp_host) return res.redirect(`/admin/cameras/${id}/edit`);
  const port = parseInt(rtsp_port) || 554;
  db.updateCamera(id, display_name.trim(), rtsp_host.trim(), port, (rtsp_path || '').trim(), (rtsp_username || '').trim(), (rtsp_password || '').trim());
  streamManager.stopStream(id);
  const updated = db.getCamera(id);
  streamManager.startStream(id, updated.rtsp_url);
  res.redirect('/admin');
});

router.post('/cameras/:id/delete', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  if (db.getCamera(id)) {
    streamManager.stopStream(id);
    db.deleteCamera(id);
  }
  res.redirect('/admin');
});

// --- Debug info API ---
router.get('/api/debug-info', requireLogin, (req, res) => {
  const cameras = db.listCameras();
  const safeEnv = {};
  const showKeys = ['NODE_ENV', 'PORT', 'ADMIN_USER'];
  for (const k of showKeys) {
    if (process.env[k]) safeEnv[k] = process.env[k];
  }
  safeEnv['SESSION_SECRET'] = process.env.SESSION_SECRET ? '(set)' : '(default)';
  const uptimeSec = process.uptime();
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = Math.floor(uptimeSec % 60);
  res.json({
    buildTime: BUILD_TIME,
    uptime: `${h}h ${m}m ${s}s`,
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    memoryMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(1),
    freeMemMB: (os.freemem() / 1024 / 1024).toFixed(0),
    env: safeEnv,
    cameras: cameras.map(c => ({
      id: c.id,
      name: c.display_name,
      running: streamManager.isRunning(c.id),
      logLines: streamManager.getLogs(c.id).length,
      streamInfo: streamManager.getStreamInfo(c.id),
    })),
  });
});

// --- Debug log API ---
router.get('/api/logs', requireLogin, (req, res) => {
  res.json(streamManager.getAllLogs());
});

router.get('/api/logs/:id', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  res.json({ id, lines: streamManager.getLogs(id) });
});

// --- Debug page ---
router.get('/debug', requireLogin, (req, res) => {
  const cameras = db.listCameras();
  const options = cameras.map(c =>
    `<option value="${c.id}">${escapeHtml(c.display_name)} (cam-${c.id})</option>`
  ).join('');
  res.send(layout('Debug', `
    <h1>Debug Logs</h1>
    <div class="debug-controls">
      <select id="cam-select" class="debug-select">
        <option value="all">All cameras</option>
        ${options}
      </select>
      <label class="debug-toggle"><input type="checkbox" id="auto-scroll" checked> Auto-scroll</label>
      <label class="debug-toggle"><input type="checkbox" id="sticky-log"> Sticky log</label>
      <button type="button" class="btn btn-small" id="clear-log">Clear</button>
    </div>
    <pre id="log-output" class="debug-log"></pre>
    <p><a href="/admin" class="btn btn-ghost">Back to dashboard</a></p>
    <script>
    (function() {
      const logEl = document.getElementById('log-output');
      const camSelect = document.getElementById('cam-select');
      const autoScroll = document.getElementById('auto-scroll');
      const stickyCheck = document.getElementById('sticky-log');
      const clearBtn = document.getElementById('clear-log');
      let polling = null;

      function escLog(s) {
        const el = document.createElement('span');
        el.textContent = s;
        return el.innerHTML;
      }

      function fetchLogs() {
        const cam = camSelect.value;
        const url = cam === 'all' ? '/admin/api/logs' : '/admin/api/logs/' + cam;
        fetch(url).then(r => r.json()).then(data => {
          let text = '';
          if (cam === 'all') {
            for (const [id, lines] of Object.entries(data)) {
              if (lines.length) {
                text += '=== Camera ' + id + ' ===\\n';
                text += lines.map(l => escLog(l)).join('\\n') + '\\n\\n';
              }
            }
          } else {
            text = (data.lines || []).map(l => escLog(l)).join('\\n');
          }
          logEl.innerHTML = text || 'No log output yet.';
          if (autoScroll.checked) logEl.scrollTop = logEl.scrollHeight;
        }).catch(() => {});
      }

      function startPolling() {
        stopPolling();
        fetchLogs();
        polling = setInterval(fetchLogs, 3000);
      }

      function stopPolling() {
        if (polling) { clearInterval(polling); polling = null; }
      }

      camSelect.addEventListener('change', fetchLogs);
      clearBtn.addEventListener('click', () => { logEl.innerHTML = ''; });
      stickyCheck.addEventListener('change', () => {
        logEl.classList.toggle('debug-log-sticky', stickyCheck.checked);
      });

      startPolling();
    })();
    </script>
  `));
});

module.exports = router;
