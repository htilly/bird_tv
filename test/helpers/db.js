const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

let testDbPath = null;
let testDb = null;
let testDbId = 0;

function createTestDb() {
  if (testDb) {
    try { testDb.close(); } catch (_) {}
  }
  
  testDbId++;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `birdcam-test-${testDbId}-`));
  testDbPath = path.join(tmpDir, 'test.db');
  testDb = new Database(testDbPath);
  testDb.pragma('journal_mode = WAL');
  initSchema(testDb);
  return testDb;
}

function initSchema(db) {
  db.exec(`
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
      onvif_port INTEGER NOT NULL DEFAULT 8899,
      onvif_username TEXT NOT NULL DEFAULT '',
      onvif_password TEXT NOT NULL DEFAULT '',
      ffmpeg_options TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS motion_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      starred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_motion_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_motion_incidents_camera_started_at ON motion_incidents(camera_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_motion_incidents_ended_starred ON motion_incidents(ended_at, starred);
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      nickname TEXT NOT NULL,
      camera_name TEXT NOT NULL DEFAULT '',
      starred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      text TEXT NOT NULL,
      time TEXT NOT NULL,
      ip_address TEXT
    );
    CREATE INDEX idx_chat_messages_id ON chat_messages(id);
    CREATE TABLE IF NOT EXISTS banned_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address TEXT NOT NULL UNIQUE,
      reason TEXT,
      banned_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_banned_ips_ip ON banned_ips(ip_address);
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_key TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_visits_created_at ON visits(created_at);
    CREATE INDEX idx_visits_visitor_key ON visits(visitor_key);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      request_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
    CREATE INDEX idx_audit_user_id ON audit_log(user_id);
    CREATE INDEX idx_audit_action ON audit_log(action);
  `);
}

function getTestDb() {
  if (!testDb) {
    createTestDb();
  }
  return testDb;
}

function closeTestDb() {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
  if (testDbPath) {
    const tmpDir = path.dirname(testDbPath);
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        try { fs.unlinkSync(path.join(tmpDir, f)); } catch (_) {}
      }
      fs.rmdirSync(tmpDir);
    } catch (_) {}
    testDbPath = null;
  }
}

function clearTables() {
  const db = getTestDb();
  db.exec(`
    DELETE FROM audit_log;
    DELETE FROM visits;
    DELETE FROM banned_ips;
    DELETE FROM chat_messages;
    DELETE FROM snapshots;
    DELETE FROM motion_incidents;
    DELETE FROM cameras;
    DELETE FROM users;
    DELETE FROM settings;
  `);
}

function resetTestDb() {
  closeTestDb();
  return createTestDb();
}

module.exports = {
  createTestDb,
  getTestDb,
  closeTestDb,
  clearTables,
  resetTestDb,
};
