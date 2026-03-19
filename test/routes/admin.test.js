const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createIsolatedTestDb } = require('../helpers/isolated-db');

let testDb = null;
let tmpDir = null;
let snapshotDir = null;

function getDb() {
  return testDb;
}

function setupTestDb() {
  testDb = createIsolatedTestDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birdcam-routes-test-'));
  snapshotDir = path.join(tmpDir, 'snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });
  return testDb;
}

function teardownTestDb() {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
    tmpDir = null;
  }
}

function createMockApp() {
  return {
    locals: {
      snapshotDir,
      reloadChatMessages: () => {},
      broadcastDeleteMessages: () => {},
      broadcastClearChat: () => {},
    },
    rotateSessionSecret: () => {},
  };
}

function createMockSession(options = {}) {
  return {
    userId: options.userId,
    username: options.username,
    _csrf: options.csrf || 'test-csrf-token',
    destroy: function(cb) {
      this.destroyed = true;
      cb && cb(null);
    },
    regenerate: function(cb) {
      this.id = 'new-session-id';
      cb && cb(null);
    },
  };
}

describe('admin routes - authentication', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('login flow', () => {
    it('creates admin user on setup', () => {
      const db = getDb();
      db.ensureAdmin('admin', 'password123');
      const user = db.findUserByUsername('admin');
      assert.ok(user);
      assert.strictEqual(user.username, 'admin');
    });

    it('verifies correct password', () => {
      const db = getDb();
      db.ensureAdmin('admin', 'password123');
      const user = db.findUserByUsername('admin');
      assert.ok(db.verifyPassword('password123', user.password_hash));
    });

    it('rejects wrong password', () => {
      const db = getDb();
      db.ensureAdmin('admin', 'password123');
      const user = db.findUserByUsername('admin');
      assert.ok(!db.verifyPassword('wrongpassword', user.password_hash));
    });

    it('prevents duplicate admin creation', () => {
      const db = getDb();
      db.ensureAdmin('admin1', 'password1');
      db.ensureAdmin('admin2', 'password2');
      assert.strictEqual(db.countUsers(), 1);
    });
  });

  describe('session handling', () => {
    it('session stores user info', () => {
      const session = createMockSession({ userId: 1, username: 'admin' });
      assert.strictEqual(session.userId, 1);
      assert.strictEqual(session.username, 'admin');
    });

    it('session can be destroyed', () => {
      const session = createMockSession({ userId: 1 });
      session.destroy();
      assert.strictEqual(session.destroyed, true);
    });

    it('session can be regenerated', () => {
      const session = createMockSession({ userId: 1 });
      session.regenerate();
      assert.strictEqual(session.id, 'new-session-id');
    });
  });
});

describe('admin routes - camera CRUD', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('createCamera', () => {
    it('creates camera with valid RTSP URL', () => {
      const db = getDb();
      const id = db.createCamera('Test Camera', '192.168.1.100', 554, '/stream1', '', '');
      assert.ok(id > 0);
      const cam = db.getCamera(id);
      assert.strictEqual(cam.display_name, 'Test Camera');
    });

    it('stores RTSP URL components', () => {
      const db = getDb();
      const id = db.createCamera('Test', '192.168.1.100', 8554, '/live', 'admin', 'secret');
      const cam = db.getCamera(id);
      assert.strictEqual(cam.rtsp_host, '192.168.1.100');
      assert.strictEqual(cam.rtsp_port, 8554);
      assert.strictEqual(cam.rtsp_path, '/live');
      assert.strictEqual(cam.rtsp_username, 'admin');
      assert.strictEqual(cam.rtsp_password, 'secret');
    });

    it('rejects invalid RTSP URL', () => {
      const db = getDb();
      assert.throws(() => {
        db.createCamera('Test', '', 554, '/path', '', '');
      }, /Invalid RTSP URL/);
    });

    it('stores FFmpeg options', () => {
      const db = getDb();
      const id = db.createCamera('Test', '192.168.1.1', 554, '/live', '', '', '{"crf":23}');
      const cam = db.getCamera(id);
      const opts = JSON.parse(cam.ffmpeg_options);
      assert.strictEqual(opts.crf, 23);
    });
  });

  describe('updateCamera', () => {
    it('updates camera fields', () => {
      const db = getDb();
      const id = db.createCamera('Old', '192.168.1.1', 554, '/old', '', '');
      db.updateCamera(id, 'New', '192.168.1.2', 8554, '/new', 'user', 'pass');
      const cam = db.getCamera(id);
      assert.strictEqual(cam.display_name, 'New');
      assert.strictEqual(cam.rtsp_host, '192.168.1.2');
    });

    it('updates password to empty string when provided', () => {
      const db = getDb();
      const id = db.createCamera('Test', '192.168.1.1', 554, '/live', 'user', 'secret');
      db.updateCamera(id, 'Test', '192.168.1.1', 554, '/live', 'user', '');
      const cam = db.getCamera(id);
      assert.strictEqual(cam.rtsp_password, '');
    });
  });

  describe('deleteCamera', () => {
    it('removes camera', () => {
      const db = getDb();
      const id = db.createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      db.deleteCamera(id);
      assert.strictEqual(db.getCamera(id), undefined);
    });
  });

  describe('listCameras', () => {
    it('returns all cameras', () => {
      const db = getDb();
      db.createCamera('Cam1', '192.168.1.1', 554, '/live', '', '');
      db.createCamera('Cam2', '192.168.1.2', 554, '/live', '', '');
      const cameras = db.listCameras();
      assert.strictEqual(cameras.length, 2);
    });
  });
});

describe('admin routes - user management', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('createUser', () => {
    it('creates user with hashed password', () => {
      const db = getDb();
      const id = db.createUser('testuser', 'password123');
      assert.ok(id > 0);
      const user = db.findUserByUsername('testuser');
      assert.ok(user);
    });

    it('rejects duplicate username', () => {
      const db = getDb();
      db.createUser('testuser', 'password1');
      assert.throws(() => {
        db.createUser('testuser', 'password2');
      });
    });
  });

  describe('updateUserPassword', () => {
    it('updates password', () => {
      const db = getDb();
      const id = db.createUser('testuser', 'oldpassword');
      db.updateUserPassword(id, 'newpassword');
      const user = db.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
      assert.ok(db.verifyPassword('newpassword', user.password_hash));
    });
  });

  describe('deleteUser', () => {
    it('removes user', () => {
      const db = getDb();
      const id = db.createUser('testuser', 'password');
      db.deleteUser(id);
      assert.strictEqual(db.findUserByUsername('testuser'), undefined);
    });

    it('countUsers returns correct count', () => {
      const db = getDb();
      db.createUser('user1', 'pass1');
      db.createUser('user2', 'pass2');
      assert.strictEqual(db.countUsers(), 2);
    });
  });
});

describe('admin routes - settings', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('getSetting/setSetting', () => {
    it('stores and retrieves settings', () => {
      const db = getDb();
      db.setSetting('test_key', 'test_value');
      assert.strictEqual(db.getSetting('test_key'), 'test_value');
    });

    it('updates existing setting', () => {
      const db = getDb();
      db.setSetting('key', 'value1');
      db.setSetting('key', 'value2');
      assert.strictEqual(db.getSetting('key'), 'value2');
    });
  });

  describe('getAllSettings', () => {
    it('returns all settings', () => {
      const db = getDb();
      db.setSetting('key1', 'value1');
      db.setSetting('key2', 'value2');
      const settings = db.getAllSettings();
      assert.strictEqual(settings.key1, 'value1');
      assert.strictEqual(settings.key2, 'value2');
    });
  });
});

describe('admin routes - chat moderation', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('addChatMessage', () => {
    it('stores message', () => {
      const db = getDb();
      const id = db.addChatMessage('user', 'Hello', '2026-03-19T10:00:00Z', '127.0.0.1');
      assert.ok(id > 0);
    });
  });

  describe('getChatMessages', () => {
    it('returns messages', () => {
      const db = getDb();
      db.addChatMessage('user', 'Test', '2026-03-19T10:00:00Z');
      const messages = db.getChatMessages(10);
      assert.strictEqual(messages.length, 1);
    });
  });

  describe('deleteChatMessage', () => {
    it('removes message', () => {
      const db = getDb();
      const id = db.addChatMessage('user', 'Test', '2026-03-19T10:00:00Z');
      db.deleteChatMessage(id);
      const messages = db.getChatMessages(10);
      assert.strictEqual(messages.length, 0);
    });
  });

  describe('clearAllChatMessages', () => {
    it('removes all messages', () => {
      const db = getDb();
      db.addChatMessage('user', 'Test1', '2026-03-19T10:00:00Z');
      db.addChatMessage('user', 'Test2', '2026-03-19T10:01:00Z');
      db.clearAllChatMessages();
      const messages = db.getChatMessages(10);
      assert.strictEqual(messages.length, 0);
    });
  });

  describe('IP bans', () => {
    it('adds and checks ban', () => {
      const db = getDb();
      db.addBan('192.168.1.100', 'Spam', 'admin');
      assert.strictEqual(db.isIpBanned('192.168.1.100'), true);
    });

    it('removes ban', () => {
      const db = getDb();
      db.addBan('192.168.1.100', 'Spam', 'admin');
      db.removeBan('192.168.1.100');
      assert.strictEqual(db.isIpBanned('192.168.1.100'), false);
    });
  });
});

describe('admin routes - snapshots', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('addSnapshot', () => {
    it('stores snapshot', () => {
      const db = getDb();
      db.addSnapshot('test.png', 'User', 'Camera');
      const snapshots = db.getLatestSnapshots(10);
      assert.strictEqual(snapshots.length, 1);
    });
  });

  describe('setSnapshotStarred', () => {
    it('stars snapshot', () => {
      const db = getDb();
      const result = db.db.prepare('INSERT INTO snapshots (filename, nickname, camera_name) VALUES (?, ?, ?)').run('test.png', 'User', 'Cam');
      db.setSnapshotStarred(result.lastInsertRowid, true);
      const snap = db.getSnapshot(result.lastInsertRowid);
      assert.strictEqual(snap.starred, 1);
    });
  });

  describe('deleteSnapshot', () => {
    it('removes snapshot', () => {
      const db = getDb();
      const result = db.db.prepare('INSERT INTO snapshots (filename, nickname, camera_name) VALUES (?, ?, ?)').run('test.png', 'User', 'Cam');
      db.deleteSnapshot(result.lastInsertRowid);
      assert.strictEqual(db.getSnapshot(result.lastInsertRowid), undefined);
    });
  });
});

describe('admin routes - audit log', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('addAuditLog', () => {
    it('stores audit entry', () => {
      const db = getDb();
      db.addAuditLog(1, 'admin', 'user.create', '{}', '127.0.0.1', 'req-1');
      const logs = db.getAuditLogs(10);
      assert.strictEqual(logs.length, 1);
    });
  });

  describe('getAuditLogs', () => {
    it('returns logs in descending order', () => {
      const db = getDb();
      db.addAuditLog(1, 'admin', 'action1', '{}', '127.0.0.1', 'r1');
      db.addAuditLog(1, 'admin', 'action2', '{}', '127.0.0.1', 'r2');
      const logs = db.getAuditLogs(10);
      assert.strictEqual(logs[0].action, 'action2');
    });
  });
});
