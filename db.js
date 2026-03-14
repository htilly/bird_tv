const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'birdcam.db');
let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    init();
  }
  return db;
}

function init() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      rtsp_url TEXT NOT NULL,
      rtsp_host TEXT NOT NULL DEFAULT '',
      rtsp_port INTEGER NOT NULL DEFAULT 554,
      rtsp_path TEXT NOT NULL DEFAULT '',
      rtsp_username TEXT NOT NULL DEFAULT '',
      rtsp_password TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function migrate() {
  const d = getDb();
  const cols = d.prepare("PRAGMA table_info(cameras)").all().map(c => c.name);
  if (!cols.includes('rtsp_host')) {
    d.exec(`
      ALTER TABLE cameras ADD COLUMN rtsp_host TEXT NOT NULL DEFAULT '';
      ALTER TABLE cameras ADD COLUMN rtsp_port INTEGER NOT NULL DEFAULT 554;
      ALTER TABLE cameras ADD COLUMN rtsp_path TEXT NOT NULL DEFAULT '';
      ALTER TABLE cameras ADD COLUMN rtsp_username TEXT NOT NULL DEFAULT '';
      ALTER TABLE cameras ADD COLUMN rtsp_password TEXT NOT NULL DEFAULT '';
    `);
    // Migrate existing rtsp_url values into separate fields
    const cameras = d.prepare('SELECT id, rtsp_url FROM cameras').all();
    const update = d.prepare('UPDATE cameras SET rtsp_host = ?, rtsp_port = ?, rtsp_path = ?, rtsp_username = ?, rtsp_password = ? WHERE id = ?');
    for (const cam of cameras) {
      try {
        const url = new URL(cam.rtsp_url);
        update.run(url.hostname, parseInt(url.port) || 554, url.pathname + url.search, url.username, url.password, cam.id);
      } catch (_) {}
    }
  }
}

function buildRtspUrl(host, port, urlPath, username, password) {
  const auth = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
  return `rtsp://${auth}${host}:${port}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
}

function ensureAdmin(username, password) {
  const bcrypt = require('bcryptjs');
  const d = getDb();
  const existing = d.prepare('SELECT id FROM users LIMIT 1').get();
  if (existing) return;
  const hash = bcrypt.hashSync(password, 10);
  d.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
}

function findUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUser(id) {
  return getDb().prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id);
}

function listUsers() {
  return getDb().prepare('SELECT id, username, created_at FROM users ORDER BY id').all();
}

function countUsers() {
  return getDb().prepare('SELECT COUNT(*) as n FROM users').get().n;
}

function createUser(username, password) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(password, 10);
  const r = getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
  return r.lastInsertRowid;
}

function updateUserPassword(id, newPassword) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(newPassword, 10);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
}

function deleteUser(id) {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

function verifyPassword(password, hash) {
  return require('bcryptjs').compareSync(password, hash);
}

function listCameras() {
  return getDb().prepare('SELECT * FROM cameras ORDER BY id').all();
}

function getCamera(id) {
  return getDb().prepare('SELECT * FROM cameras WHERE id = ?').get(id);
}

function createCamera(display_name, host, port, urlPath, username, password) {
  const d = getDb();
  const rtsp_url = buildRtspUrl(host, port, urlPath, username, password);
  const r = d.prepare(
    "INSERT INTO cameras (display_name, rtsp_url, rtsp_host, rtsp_port, rtsp_path, rtsp_username, rtsp_password, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))"
  ).run(display_name, rtsp_url, host, port, urlPath, username, password);
  return r.lastInsertRowid;
}

function updateCamera(id, display_name, host, port, urlPath, username, password) {
  const rtsp_url = buildRtspUrl(host, port, urlPath, username, password);
  getDb().prepare(
    "UPDATE cameras SET display_name = ?, rtsp_url = ?, rtsp_host = ?, rtsp_port = ?, rtsp_path = ?, rtsp_username = ?, rtsp_password = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(display_name, rtsp_url, host, port, urlPath, username, password, id);
}

function deleteCamera(id) {
  getDb().prepare('DELETE FROM cameras WHERE id = ?').run(id);
}

module.exports = {
  getDb,
  init,
  migrate,
  buildRtspUrl,
  ensureAdmin,
  findUserByUsername,
  getUser,
  listUsers,
  countUsers,
  createUser,
  updateUserPassword,
  deleteUser,
  verifyPassword,
  listCameras,
  getCamera,
  createCamera,
  updateCamera,
  deleteCamera,
};
