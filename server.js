require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { WebSocketServer } = require('ws');
const http = require('http');
const db = require('./db');
const streamManager = require('./streamManager');
const adminRoutes = require('./routes/admin');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'birdcam-dev-secret-change-in-production';

db.getDb();
db.migrate();
if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
  db.ensureAdmin(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD);
}
streamManager.startAll();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/hls', express.static(streamManager.hlsDir, { maxAge: 0 }));

app.get('/api/cameras', (req, res) => {
  const cameras = db.listCameras().map((c) => ({
    id: c.id,
    display_name: c.display_name,
  }));
  res.json(cameras);
});

app.use('/admin', adminRoutes);

const server = http.createServer(app);

const chatMessages = [];
const MAX_CHAT_MESSAGES = 100;

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'history', messages: chatMessages.slice(-50) }));
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.nickname && data.text) {
        const msg = {
          nickname: String(data.nickname).slice(0, 30),
          text: String(data.text).slice(0, 500),
          time: new Date().toISOString(),
        };
        chatMessages.push(msg);
        if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
        wss.clients.forEach((client) => {
          if (client.readyState === 1) client.send(JSON.stringify({ type: 'message', ...msg }));
        });
      }
    } catch (_) {}
  });
});

server.listen(PORT, () => {
  console.log(`Birdcam server at http://localhost:${PORT}`);
  console.log(`Admin at http://localhost:${PORT}/admin`);
});
