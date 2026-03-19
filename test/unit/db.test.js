const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { createIsolatedTestDb } = require('../helpers/isolated-db');

let testDb = null;

function getDb() {
  if (!testDb) {
    testDb = createIsolatedTestDb();
  }
  return testDb;
}

function setupTestDb() {
  testDb = createIsolatedTestDb();
  return testDb;
}

function teardownTestDb() {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

describe('db.buildRtspUrl', () => {
  it('builds URL with host and port only', () => {
    const db = getDb();
    assert.strictEqual(
      db.buildRtspUrl('192.168.1.100', 554, '', '', ''),
      'rtsp://192.168.1.100:554/'
    );
  });

  it('adds leading slash when path has none', () => {
    const db = getDb();
    assert.strictEqual(
      db.buildRtspUrl('host', 554, 'stream1', '', ''),
      'rtsp://host:554/stream1'
    );
  });

  it('does not double slash when path starts with /', () => {
    const db = getDb();
    assert.strictEqual(
      db.buildRtspUrl('host', 554, '/stream1', '', ''),
      'rtsp://host:554/stream1'
    );
  });

  it('includes username and password when given', () => {
    const db = getDb();
    const url = db.buildRtspUrl('cam.local', 554, '/live', 'admin', 'secret');
    assert.ok(url.startsWith('rtsp://'));
    assert.ok(url.includes('@'));
    assert.ok(url.includes('554/live'));
    assert.ok(url.includes('admin'));
    assert.ok(url.includes('secret'));
  });

  it('encodes special characters in credentials', () => {
    const db = getDb();
    const url = db.buildRtspUrl('host', 554, '', 'user@name', 'p@ss');
    assert.ok(url.includes('%40'));
  });

  it('encodes colon in password', () => {
    const db = getDb();
    const url = db.buildRtspUrl('host', 554, '/path', 'user', 'pass:word');
    assert.ok(url.includes('pass%3Aword'));
  });
});

describe('db.validateRtspUrl', () => {
  it('accepts valid rtsp URL', () => {
    const db = getDb();
    assert.strictEqual(db.validateRtspUrl('rtsp://192.168.1.1:554/stream1'), true);
    assert.strictEqual(db.validateRtspUrl('rtsp://host/path'), true);
    assert.strictEqual(db.validateRtspUrl('rtsp://user:pass@host:554/path'), true);
  });

  it('rejects non-rtsp protocols', () => {
    const db = getDb();
    assert.strictEqual(db.validateRtspUrl('http://host/'), false);
    assert.strictEqual(db.validateRtspUrl('https://host/'), false);
    assert.strictEqual(db.validateRtspUrl('ftp://host/'), false);
    assert.strictEqual(db.validateRtspUrl('rtmp://host/'), false);
  });

  it('rejects invalid URL', () => {
    const db = getDb();
    assert.strictEqual(db.validateRtspUrl('not-a-url'), false);
    assert.strictEqual(db.validateRtspUrl(''), false);
    assert.strictEqual(db.validateRtspUrl('://invalid'), false);
  });
});

describe('db user management', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('ensureAdmin', () => {
    it('creates first admin when no users exist', () => {
      getDb().ensureAdmin('admin', 'password123');
      const user = getDb().findUserByUsername('admin');
      assert.ok(user);
      assert.strictEqual(user.username, 'admin');
      assert.ok(user.password_hash);
    });

    it('does not create admin if users already exist', () => {
      getDb().ensureAdmin('firstadmin', 'password123');
      const countBefore = getDb().countUsers();
      getDb().ensureAdmin('secondadmin', 'password456');
      const countAfter = getDb().countUsers();
      assert.strictEqual(countBefore, 1);
      assert.strictEqual(countAfter, 1);
    });
  });

  describe('findUserByUsername', () => {
    it('returns user when found', () => {
      getDb().db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('testuser', 'hash123');
      const user = getDb().findUserByUsername('testuser');
      assert.ok(user);
      assert.strictEqual(user.username, 'testuser');
    });

    it('returns undefined when not found', () => {
      const user = getDb().findUserByUsername('nonexistent');
      assert.strictEqual(user, undefined);
    });
  });

  describe('getUser', () => {
    it('returns user by id', () => {
      const result = getDb().db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('testuser', 'hash123');
      const user = getDb().getUser(result.lastInsertRowid);
      assert.ok(user);
      assert.strictEqual(user.username, 'testuser');
    });

    it('returns undefined for invalid id', () => {
      const user = getDb().getUser(99999);
      assert.strictEqual(user, undefined);
    });
  });

  describe('userExists', () => {
    it('returns true for existing user', () => {
      const result = getDb().db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('testuser', 'hash123');
      assert.strictEqual(getDb().userExists(result.lastInsertRowid), true);
    });

    it('returns false for non-existing user', () => {
      assert.strictEqual(getDb().userExists(99999), false);
    });
  });

  describe('listUsers', () => {
    it('returns all users ordered by id', () => {
      getDb().db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('user1', 'hash1');
      getDb().db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('user2', 'hash2');
      const users = getDb().listUsers();
      assert.strictEqual(users.length, 2);
      assert.strictEqual(users[0].username, 'user1');
      assert.strictEqual(users[1].username, 'user2');
    });

    it('returns empty array when no users', () => {
      const users = getDb().listUsers();
      assert.strictEqual(users.length, 0);
    });
  });

  describe('countUsers', () => {
    it('returns correct count', () => {
      assert.strictEqual(getDb().countUsers(), 0);
      getDb().db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('user1', 'hash1');
      assert.strictEqual(getDb().countUsers(), 1);
      getDb().db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('user2', 'hash2');
      assert.strictEqual(getDb().countUsers(), 2);
    });
  });

  describe('createUser', () => {
    it('creates user with hashed password', () => {
      const id = getDb().createUser('newuser', 'password123');
      assert.ok(id > 0);
      const user = getDb().findUserByUsername('newuser');
      assert.ok(user);
      assert.strictEqual(user.username, 'newuser');
      assert.ok(bcrypt.compareSync('password123', user.password_hash));
    });

    it('returns the new user id', () => {
      const id1 = getDb().createUser('user1', 'pass1');
      const id2 = getDb().createUser('user2', 'pass2');
      assert.ok(id2 > id1);
    });
  });

  describe('updateUserPassword', () => {
    it('updates password hash', () => {
      const result = getDb().db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('testuser', 'oldhash');
      getDb().updateUserPassword(result.lastInsertRowid, 'newpassword');
      const user = getDb().db.prepare('SELECT password_hash FROM users WHERE id = ?').get(result.lastInsertRowid);
      assert.ok(bcrypt.compareSync('newpassword', user.password_hash));
    });
  });

  describe('deleteUser', () => {
    it('removes user from database', () => {
      const result = getDb().db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('testuser', 'hash123');
      assert.strictEqual(getDb().userExists(result.lastInsertRowid), true);
      getDb().deleteUser(result.lastInsertRowid);
      assert.strictEqual(getDb().userExists(result.lastInsertRowid), false);
    });
  });

  describe('verifyPassword', () => {
    it('returns true for correct password', () => {
      const hash = bcrypt.hashSync('correctpassword', 10);
      assert.strictEqual(getDb().verifyPassword('correctpassword', hash), true);
    });

    it('returns false for wrong password', () => {
      const hash = bcrypt.hashSync('correctpassword', 10);
      assert.strictEqual(getDb().verifyPassword('wrongpassword', hash), false);
    });
  });
});

describe('db camera management', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('createCamera', () => {
    it('creates camera with all fields', () => {
      const id = getDb().createCamera(
        'Garden Camera',
        '192.168.1.100',
        554,
        '/stream1',
        'admin',
        'secret',
        '{"crf":23}'
      );
      assert.ok(id > 0);
      const cam = getDb().getCamera(id);
      assert.strictEqual(cam.display_name, 'Garden Camera');
      assert.strictEqual(cam.rtsp_host, '192.168.1.100');
      assert.strictEqual(cam.rtsp_port, 554);
      assert.strictEqual(cam.rtsp_path, '/stream1');
      assert.strictEqual(cam.rtsp_username, 'admin');
      assert.strictEqual(cam.rtsp_password, 'secret');
    });

    it('builds and stores rtsp_url', () => {
      const id = getDb().createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      const cam = getDb().getCamera(id);
      assert.strictEqual(cam.rtsp_url, 'rtsp://192.168.1.1:554/live');
    });

    it('throws error for invalid RTSP URL (empty host)', () => {
      assert.throws(() => {
        getDb().createCamera('Test', '', 554, '/path', '', '');
      }, /Invalid RTSP URL/);
    });

    it('accepts valid RTSP URL with http-like host', () => {
      const id = getDb().createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      assert.ok(id > 0);
    });

    it('stores ffmpeg_options as JSON string', () => {
      const id = getDb().createCamera('Test', '192.168.1.1', 554, '/live', '', '', { crf: 23, preset: 'fast' });
      const cam = getDb().getCamera(id);
      const opts = JSON.parse(cam.ffmpeg_options);
      assert.strictEqual(opts.crf, 23);
      assert.strictEqual(opts.preset, 'fast');
    });
  });

  describe('getCamera', () => {
    it('returns camera by id', () => {
      const id = getDb().createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      const cam = getDb().getCamera(id);
      assert.ok(cam);
      assert.strictEqual(cam.id, id);
    });

    it('returns undefined for invalid id', () => {
      const cam = getDb().getCamera(99999);
      assert.strictEqual(cam, undefined);
    });
  });

  describe('listCameras', () => {
    it('returns all cameras ordered by id', () => {
      getDb().createCamera('Cam1', '192.168.1.1', 554, '/live', '', '');
      getDb().createCamera('Cam2', '192.168.1.2', 554, '/live', '', '');
      const cameras = getDb().listCameras();
      assert.strictEqual(cameras.length, 2);
      assert.strictEqual(cameras[0].display_name, 'Cam1');
      assert.strictEqual(cameras[1].display_name, 'Cam2');
    });

    it('returns empty array when no cameras', () => {
      const cameras = getDb().listCameras();
      assert.strictEqual(cameras.length, 0);
    });
  });

  describe('updateCamera', () => {
    it('updates all fields', () => {
      const id = getDb().createCamera('Old Name', '192.168.1.1', 554, '/old', '', '');
      getDb().updateCamera(id, 'New Name', '192.168.1.2', 8554, '/new', 'user', 'pass');
      const cam = getDb().getCamera(id);
      assert.strictEqual(cam.display_name, 'New Name');
      assert.strictEqual(cam.rtsp_host, '192.168.1.2');
      assert.strictEqual(cam.rtsp_port, 8554);
      assert.strictEqual(cam.rtsp_path, '/new');
      assert.strictEqual(cam.rtsp_username, 'user');
      assert.strictEqual(cam.rtsp_password, 'pass');
    });

    it('throws error for invalid RTSP URL (empty host)', () => {
      const id = getDb().createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      assert.throws(() => {
        getDb().updateCamera(id, 'Test', '', 554, '/path', '', '');
      }, /Invalid RTSP URL/);
    });

    it('updates ffmpeg_options when provided', () => {
      const id = getDb().createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      getDb().updateCamera(id, 'Test', '192.168.1.1', 554, '/live', '', '', '{"crf":20}');
      const cam = getDb().getCamera(id);
      assert.strictEqual(JSON.parse(cam.ffmpeg_options).crf, 20);
    });

    it('preserves ffmpeg_options when not provided', () => {
      const id = getDb().createCamera('Test', '192.168.1.1', 554, '/live', '', '', '{"crf":25}');
      getDb().updateCamera(id, 'Updated', '192.168.1.1', 554, '/live', '', '');
      const cam = getDb().getCamera(id);
      assert.strictEqual(JSON.parse(cam.ffmpeg_options).crf, 25);
    });
  });

  describe('deleteCamera', () => {
    it('removes camera from database', () => {
      const id = getDb().createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      assert.ok(getDb().getCamera(id));
      getDb().deleteCamera(id);
      assert.strictEqual(getDb().getCamera(id), undefined);
    });
  });
});

describe('db settings', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('getSetting', () => {
    it('returns stored value', () => {
      getDb().db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('test_key', 'test_value');
      assert.strictEqual(getDb().getSetting('test_key'), 'test_value');
    });

    it('returns empty string for unknown key', () => {
      assert.strictEqual(getDb().getSetting('unknown_key'), '');
    });
  });

  describe('setSetting', () => {
    it('stores value', () => {
      getDb().setSetting('test_key', 'test_value');
      assert.strictEqual(getDb().getSetting('test_key'), 'test_value');
    });

    it('updates existing value', () => {
      getDb().setSetting('test_key', 'value1');
      getDb().setSetting('test_key', 'value2');
      assert.strictEqual(getDb().getSetting('test_key'), 'value2');
    });

    it('converts value to string', () => {
      getDb().setSetting('number_key', 42);
      assert.strictEqual(getDb().getSetting('number_key'), '42');
    });
  });

  describe('getAllSettings', () => {
    it('returns all settings', () => {
      getDb().setSetting('key1', 'value1');
      getDb().setSetting('key2', 'value2');
      const settings = getDb().getAllSettings();
      assert.strictEqual(settings.key1, 'value1');
      assert.strictEqual(settings.key2, 'value2');
    });
  });
});

describe('db chat messages', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('addChatMessage', () => {
    it('stores message with all fields', () => {
      const id = getDb().addChatMessage('user1', 'Hello!', '2026-03-19T10:00:00Z', '192.168.1.1');
      assert.ok(id > 0);
    });

    it('stores message without ip address', () => {
      const id = getDb().addChatMessage('user1', 'Hello!', '2026-03-19T10:00:00Z');
      assert.ok(id > 0);
    });
  });

  describe('getChatMessages', () => {
    it('returns messages in chronological order', () => {
      getDb().addChatMessage('user1', 'First', '2026-03-19T10:00:00Z');
      getDb().addChatMessage('user2', 'Second', '2026-03-19T10:01:00Z');
      getDb().addChatMessage('user1', 'Third', '2026-03-19T10:02:00Z');
      const messages = getDb().getChatMessages(10);
      assert.strictEqual(messages.length, 3);
      assert.strictEqual(messages[0].text, 'First');
      assert.strictEqual(messages[2].text, 'Third');
    });

    it('respects limit', () => {
      for (let i = 0; i < 20; i++) {
        getDb().addChatMessage('user', `Message ${i}`, `2026-03-19T10:0${i}:00Z`);
      }
      const messages = getDb().getChatMessages(5);
      assert.strictEqual(messages.length, 5);
    });

    it('includes ip_address', () => {
      getDb().addChatMessage('user', 'Test', '2026-03-19T10:00:00Z', '192.168.1.100');
      const messages = getDb().getChatMessages(10);
      assert.strictEqual(messages[0].ip_address, '192.168.1.100');
    });
  });

  describe('deleteChatMessage', () => {
    it('removes message', () => {
      const id = getDb().addChatMessage('user', 'Test', '2026-03-19T10:00:00Z');
      const before = getDb().getChatMessages(100);
      getDb().deleteChatMessage(id);
      const after = getDb().getChatMessages(100);
      assert.strictEqual(after.length, before.length - 1);
    });
  });

  describe('deleteChatMessages', () => {
    it('removes multiple messages', () => {
      const id1 = getDb().addChatMessage('user', 'Test1', '2026-03-19T10:00:00Z');
      const id2 = getDb().addChatMessage('user', 'Test2', '2026-03-19T10:01:00Z');
      const id3 = getDb().addChatMessage('user', 'Test3', '2026-03-19T10:02:00Z');
      getDb().deleteChatMessages([id1, id3]);
      const messages = getDb().getChatMessages(100);
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].text, 'Test2');
    });

    it('handles empty array', () => {
      getDb().addChatMessage('user', 'Test', '2026-03-19T10:00:00Z');
      getDb().deleteChatMessages([]);
      const messages = getDb().getChatMessages(100);
      assert.strictEqual(messages.length, 1);
    });
  });

  describe('clearAllChatMessages', () => {
    it('removes all messages', () => {
      getDb().addChatMessage('user', 'Test1', '2026-03-19T10:00:00Z');
      getDb().addChatMessage('user', 'Test2', '2026-03-19T10:01:00Z');
      getDb().clearAllChatMessages();
      const messages = getDb().getChatMessages(100);
      assert.strictEqual(messages.length, 0);
    });
  });
});

describe('db IP bans', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('addBan', () => {
    it('stores ban with all fields', () => {
      const result = getDb().addBan('192.168.1.100', 'Spam', 'admin');
      assert.strictEqual(result, true);
      assert.strictEqual(getDb().isIpBanned('192.168.1.100'), true);
    });

    it('updates existing ban', () => {
      getDb().addBan('192.168.1.100', 'Spam', 'admin');
      getDb().addBan('192.168.1.100', 'Updated reason', 'mod');
      const bans = getDb().listBans();
      assert.strictEqual(bans.length, 1);
      assert.strictEqual(bans[0].reason, 'Updated reason');
    });
  });

  describe('removeBan', () => {
    it('removes ban', () => {
      getDb().addBan('192.168.1.100', 'Spam', 'admin');
      assert.strictEqual(getDb().isIpBanned('192.168.1.100'), true);
      getDb().removeBan('192.168.1.100');
      assert.strictEqual(getDb().isIpBanned('192.168.1.100'), false);
    });
  });

  describe('isIpBanned', () => {
    it('returns true for banned IP', () => {
      getDb().addBan('192.168.1.100', 'Spam', 'admin');
      assert.strictEqual(getDb().isIpBanned('192.168.1.100'), true);
    });

    it('returns false for non-banned IP', () => {
      assert.strictEqual(getDb().isIpBanned('192.168.1.100'), false);
    });
  });

  describe('listBans', () => {
    it('returns all bans ordered by date', () => {
      getDb().addBan('192.168.1.100', 'Spam', 'admin');
      getDb().addBan('192.168.1.101', 'Abuse', 'admin');
      const bans = getDb().listBans();
      assert.strictEqual(bans.length, 2);
    });
  });
});

describe('db snapshots', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('addSnapshot', () => {
    it('stores snapshot with all fields', () => {
      getDb().addSnapshot('snap-001.png', 'User1', 'Garden Camera');
      const snapshots = getDb().getLatestSnapshots(10);
      assert.strictEqual(snapshots.length, 1);
      assert.strictEqual(snapshots[0].filename, 'snap-001.png');
      assert.strictEqual(snapshots[0].nickname, 'User1');
      assert.strictEqual(snapshots[0].camera_name, 'Garden Camera');
    });
  });

  describe('getSnapshot', () => {
    it('returns snapshot by id', () => {
      const result = getDb().db.prepare('INSERT INTO snapshots (filename, nickname, camera_name) VALUES (?, ?, ?)').run('snap.png', 'User', 'Cam');
      const snap = getDb().getSnapshot(result.lastInsertRowid);
      assert.ok(snap);
      assert.strictEqual(snap.filename, 'snap.png');
    });
  });

  describe('getLatestSnapshots', () => {
    it('returns N most recent snapshots', () => {
      for (let i = 0; i < 10; i++) {
        getDb().addSnapshot(`snap-${i}.png`, `User${i}`, 'Cam');
      }
      const snapshots = getDb().getLatestSnapshots(5);
      assert.strictEqual(snapshots.length, 5);
      assert.strictEqual(snapshots[0].filename, 'snap-9.png');
    });
  });

  describe('getAllSnapshots', () => {
    it('returns all snapshots with limit', () => {
      for (let i = 0; i < 100; i++) {
        getDb().addSnapshot(`snap-${i}.png`, `User${i}`, 'Cam');
      }
      const snapshots = getDb().getAllSnapshots(50);
      assert.strictEqual(snapshots.length, 50);
    });
  });

  describe('setSnapshotStarred', () => {
    it('stars a snapshot', () => {
      const result = getDb().db.prepare('INSERT INTO snapshots (filename, nickname, camera_name) VALUES (?, ?, ?)').run('snap.png', 'User', 'Cam');
      getDb().setSnapshotStarred(result.lastInsertRowid, true);
      const snap = getDb().getSnapshot(result.lastInsertRowid);
      assert.strictEqual(snap.starred, 1);
    });

    it('unstars previous starred snapshot', () => {
      const r1 = getDb().db.prepare('INSERT INTO snapshots (filename, nickname, camera_name, starred) VALUES (?, ?, ?, 1)').run('snap1.png', 'User', 'Cam');
      const r2 = getDb().db.prepare('INSERT INTO snapshots (filename, nickname, camera_name) VALUES (?, ?, ?)').run('snap2.png', 'User', 'Cam');
      getDb().setSnapshotStarred(r2.lastInsertRowid, true);
      const snap1 = getDb().getSnapshot(r1.lastInsertRowid);
      const snap2 = getDb().getSnapshot(r2.lastInsertRowid);
      assert.strictEqual(snap1.starred, 0);
      assert.strictEqual(snap2.starred, 1);
    });

    it('unstars a snapshot', () => {
      const result = getDb().db.prepare('INSERT INTO snapshots (filename, nickname, camera_name, starred) VALUES (?, ?, ?, 1)').run('snap.png', 'User', 'Cam');
      getDb().setSnapshotStarred(result.lastInsertRowid, false);
      const snap = getDb().getSnapshot(result.lastInsertRowid);
      assert.strictEqual(snap.starred, 0);
    });
  });

  describe('getStarredSnapshot', () => {
    it('returns the starred snapshot', () => {
      getDb().db.prepare('INSERT INTO snapshots (filename, nickname, camera_name, starred) VALUES (?, ?, ?, 1)').run('starred.png', 'User', 'Cam');
      const snap = getDb().getStarredSnapshot();
      assert.ok(snap);
      assert.strictEqual(snap.filename, 'starred.png');
    });

    it('returns undefined when none starred', () => {
      const snap = getDb().getStarredSnapshot();
      assert.strictEqual(snap, undefined);
    });
  });

  describe('deleteSnapshot', () => {
    it('removes snapshot', () => {
      const result = getDb().db.prepare('INSERT INTO snapshots (filename, nickname, camera_name) VALUES (?, ?, ?)').run('snap.png', 'User', 'Cam');
      getDb().deleteSnapshot(result.lastInsertRowid);
      const snap = getDb().getSnapshot(result.lastInsertRowid);
      assert.strictEqual(snap, undefined);
    });
  });

  describe('deleteSnapshots', () => {
    it('removes multiple snapshots', () => {
      const r1 = getDb().db.prepare('INSERT INTO snapshots (filename, nickname, camera_name) VALUES (?, ?, ?)').run('snap1.png', 'User', 'Cam');
      const r2 = getDb().db.prepare('INSERT INTO snapshots (filename, nickname, camera_name) VALUES (?, ?, ?)').run('snap2.png', 'User', 'Cam');
      const r3 = getDb().db.prepare('INSERT INTO snapshots (filename, nickname, camera_name) VALUES (?, ?, ?)').run('snap3.png', 'User', 'Cam');
      getDb().deleteSnapshots([r1.lastInsertRowid, r3.lastInsertRowid]);
      const snapshots = getDb().getAllSnapshots(100);
      assert.strictEqual(snapshots.length, 1);
      assert.strictEqual(snapshots[0].filename, 'snap2.png');
    });
  });
});

describe('db motion incidents', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('addMotionIncident', () => {
    it('creates incident with required fields', () => {
      const id = getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/incident.mp4');
      assert.ok(id > 0);
      const incident = getDb().getMotionIncident(id);
      assert.strictEqual(incident.camera_id, 1);
      assert.strictEqual(incident.started_at, '2026-03-19T10:00:00Z');
      assert.strictEqual(incident.file_path, '/clips/incident.mp4');
    });
  });

  describe('endMotionIncident', () => {
    it('sets end time and size', () => {
      const id = getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/incident.mp4');
      getDb().endMotionIncident(id, '2026-03-19T10:01:00Z', 1024000);
      const incident = getDb().getMotionIncident(id);
      assert.strictEqual(incident.ended_at, '2026-03-19T10:01:00Z');
      assert.strictEqual(incident.size_bytes, 1024000);
    });
  });

  describe('updateMotionIncidentLastMotion', () => {
    it('updates last motion time', () => {
      const id = getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/incident.mp4');
      getDb().updateMotionIncidentLastMotion(id, '2026-03-19T10:00:30Z');
      const incident = getDb().getMotionIncident(id);
      assert.strictEqual(incident.last_motion_at, '2026-03-19T10:00:30Z');
    });
  });

  describe('setMotionIncidentStar', () => {
    it('stars incident', () => {
      const id = getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/incident.mp4');
      getDb().setMotionIncidentStar(id, true);
      const incident = getDb().getMotionIncident(id);
      assert.strictEqual(incident.starred, 1);
    });

    it('unstars incident', () => {
      const id = getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/incident.mp4');
      getDb().setMotionIncidentStar(id, true);
      getDb().setMotionIncidentStar(id, false);
      const incident = getDb().getMotionIncident(id);
      assert.strictEqual(incident.starred, 0);
    });
  });

  describe('getUnstarredMotionIncidentTotals', () => {
    it('counts unstarred ended incidents', () => {
      const id1 = getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      const id2 = getDb().addMotionIncident(1, '2026-03-19T11:00:00Z', '/clips/2.mp4');
      const id3 = getDb().addMotionIncident(1, '2026-03-19T12:00:00Z', '/clips/3.mp4');
      getDb().endMotionIncident(id1, '2026-03-19T10:01:00Z', 1000);
      getDb().endMotionIncident(id2, '2026-03-19T11:01:00Z', 2000);
      getDb().setMotionIncidentStar(id2, true);
      const totals = getDb().getUnstarredMotionIncidentTotals();
      assert.strictEqual(totals.count, 1);
      assert.strictEqual(totals.bytes, 1000);
    });

    it('excludes ongoing incidents', () => {
      const id = getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      const totals = getDb().getUnstarredMotionIncidentTotals();
      assert.strictEqual(totals.count, 0);
    });
  });

  describe('getOldestUnstarredMotionIncidents', () => {
    it('returns oldest unstarred ended incidents', () => {
      const id1 = getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      const id2 = getDb().addMotionIncident(1, '2026-03-19T11:00:00Z', '/clips/2.mp4');
      const id3 = getDb().addMotionIncident(1, '2026-03-19T12:00:00Z', '/clips/3.mp4');
      getDb().endMotionIncident(id1, '2026-03-19T10:01:00Z', 1000);
      getDb().endMotionIncident(id2, '2026-03-19T11:01:00Z', 2000);
      getDb().endMotionIncident(id3, '2026-03-19T12:01:00Z', 3000);
      getDb().setMotionIncidentStar(id2, true);
      const oldest = getDb().getOldestUnstarredMotionIncidents(10);
      assert.strictEqual(oldest.length, 2);
      assert.strictEqual(oldest[0].id, id1);
    });
  });

  describe('deleteMotionIncident', () => {
    it('removes incident', () => {
      const id = getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      getDb().deleteMotionIncident(id);
      const incident = getDb().getMotionIncident(id);
      assert.strictEqual(incident, undefined);
    });
  });

  describe('deleteMotionIncidents', () => {
    it('removes multiple incidents', () => {
      const id1 = getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      const id2 = getDb().addMotionIncident(1, '2026-03-19T11:00:00Z', '/clips/2.mp4');
      const id3 = getDb().addMotionIncident(1, '2026-03-19T12:00:00Z', '/clips/3.mp4');
      getDb().deleteMotionIncidents([id1, id3]);
      assert.strictEqual(getDb().getMotionIncident(id1), undefined);
      assert.ok(getDb().getMotionIncident(id2));
      assert.strictEqual(getDb().getMotionIncident(id3), undefined);
    });
  });

  describe('listRecentMotionIncidents', () => {
    it('returns incidents with camera name', () => {
      const camId = getDb().createCamera('Test Cam', '192.168.1.1', 554, '/live', '', '');
      const id = getDb().addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      getDb().endMotionIncident(id, '2026-03-19T10:01:00Z', 1000);
      const incidents = getDb().listRecentMotionIncidents(10);
      assert.strictEqual(incidents.length, 1);
      assert.strictEqual(incidents[0].camera_name, 'Test Cam');
    });
  });

  describe('listMotionIncidentsForDate', () => {
    it('returns incidents for specific date', () => {
      const camId = getDb().createCamera('Test Cam', '192.168.1.1', 554, '/live', '', '');
      const id1 = getDb().addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      const id2 = getDb().addMotionIncident(camId, '2026-03-19T11:00:00Z', '/clips/2.mp4');
      const id3 = getDb().addMotionIncident(camId, '2026-03-20T10:00:00Z', '/clips/3.mp4');
      getDb().endMotionIncident(id1, '2026-03-19T10:01:00Z', 1000);
      getDb().endMotionIncident(id2, '2026-03-19T11:01:00Z', 2000);
      getDb().endMotionIncident(id3, '2026-03-20T10:01:00Z', 3000);
      const incidents = getDb().listMotionIncidentsForDate(camId, '2026-03-19');
      assert.strictEqual(incidents.length, 2);
    });

    it('excludes ongoing incidents', () => {
      const camId = getDb().createCamera('Test Cam', '192.168.1.1', 554, '/live', '', '');
      const id1 = getDb().addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      getDb().addMotionIncident(camId, '2026-03-19T11:00:00Z', '/clips/2.mp4');
      getDb().endMotionIncident(id1, '2026-03-19T10:01:00Z', 1000);
      const incidents = getDb().listMotionIncidentsForDate(camId, '2026-03-19');
      assert.strictEqual(incidents.length, 1);
    });
  });
});

describe('db visitor tracking', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('recordVisit', () => {
    it('stores visit', () => {
      getDb().recordVisit('visitor-123');
      const stats = getDb().getVisitorStats();
      assert.ok(stats.uniqueToday >= 1);
    });

    it('ignores empty key', () => {
      getDb().recordVisit('');
      const stats = getDb().getVisitorStats();
      assert.strictEqual(stats.uniqueToday, 0);
    });

    it('ignores very long key', () => {
      const longKey = 'x'.repeat(200);
      getDb().recordVisit(longKey);
      const stats = getDb().getVisitorStats();
      assert.strictEqual(stats.uniqueToday, 0);
    });

    it('counts unique visitors', () => {
      getDb().recordVisit('visitor-1');
      getDb().recordVisit('visitor-2');
      getDb().recordVisit('visitor-1');
      const stats = getDb().getVisitorStats();
      assert.strictEqual(stats.uniqueToday, 2);
    });
  });

  describe('getVisitorStats', () => {
    it('returns today, week, month counts', () => {
      getDb().recordVisit('visitor-1');
      getDb().recordVisit('visitor-2');
      const stats = getDb().getVisitorStats();
      assert.ok(stats.uniqueToday >= 0);
      assert.ok(stats.uniqueWeek >= 0);
      assert.ok(stats.uniqueMonth >= 0);
      assert.ok(Array.isArray(stats.daily));
    });
  });

  describe('clearVisitorHistory', () => {
    it('removes all visits', () => {
      getDb().recordVisit('visitor-1');
      getDb().recordVisit('visitor-2');
      getDb().clearVisitorHistory();
      const stats = getDb().getVisitorStats();
      assert.strictEqual(stats.uniqueToday, 0);
    });
  });
});

describe('db audit log', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('addAuditLog', () => {
    it('stores audit entry with all fields', () => {
      getDb().addAuditLog(1, 'admin', 'user.create', '{"test":true}', '192.168.1.1', 'req-123');
      const logs = getDb().getAuditLogs(10);
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].user_id, 1);
      assert.strictEqual(logs[0].username, 'admin');
      assert.strictEqual(logs[0].action, 'user.create');
      assert.strictEqual(logs[0].ip_address, '192.168.1.1');
      assert.strictEqual(logs[0].request_id, 'req-123');
    });

    it('stores entry without user', () => {
      getDb().addAuditLog(null, null, 'auth.login.failed', '{}', '192.168.1.1', 'req-123');
      const logs = getDb().getAuditLogs(10);
      assert.strictEqual(logs[0].user_id, null);
      assert.strictEqual(logs[0].username, null);
    });
  });

  describe('getAuditLogs', () => {
    it('returns logs ordered by time descending', () => {
      getDb().addAuditLog(1, 'admin', 'action1', '{}', '127.0.0.1', 'r1');
      getDb().addAuditLog(1, 'admin', 'action2', '{}', '127.0.0.1', 'r2');
      getDb().addAuditLog(1, 'admin', 'action3', '{}', '127.0.0.1', 'r3');
      const logs = getDb().getAuditLogs(10);
      assert.strictEqual(logs.length, 3);
      assert.strictEqual(logs[0].action, 'action3');
      assert.strictEqual(logs[2].action, 'action1');
    });

    it('respects limit', () => {
      for (let i = 0; i < 20; i++) {
        getDb().addAuditLog(1, 'admin', `action${i}`, '{}', '127.0.0.1', `r${i}`);
      }
      const logs = getDb().getAuditLogs(5);
      assert.strictEqual(logs.length, 5);
    });
  });
});

describe('db clear functions', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('clearMotionRecordings', () => {
    it('removes all motion incidents and returns file paths', () => {
      getDb().addMotionIncident(1, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      getDb().addMotionIncident(1, '2026-03-19T11:00:00Z', '/clips/2.mp4');
      const paths = getDb().clearMotionRecordings();
      assert.strictEqual(paths.length, 2);
      assert.ok(paths.includes('/clips/1.mp4'));
      assert.ok(paths.includes('/clips/2.mp4'));
    });
  });
});
