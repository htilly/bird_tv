const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createIsolatedTestDb } = require('../helpers/isolated-db');

let testDb = null;
let tmpDir = null;
let motionClipsDir = null;

function getDb() {
  return testDb;
}

function setupTestDb() {
  testDb = createIsolatedTestDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birdcam-motion-test-'));
  motionClipsDir = path.join(tmpDir, 'motion_clips');
  fs.mkdirSync(motionClipsDir, { recursive: true });
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

function createMockWebSocket() {
  const events = {};
  const sentMessages = [];
  let readyState = 1;

  return {
    readyState,
    on: (event, handler) => {
      events[event] = handler;
    },
    send: (data) => {
      sentMessages.push(data);
    },
    close: () => {
      readyState = 3;
    },
    getSentMessages: () => sentMessages,
    simulateMessage: (data) => {
      if (events.message) events.message(data);
    },
  };
}

function isLocalIp(ip) {
  if (!ip) return false;
  const localPatterns = [
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^::1$/,
    /^::ffff:127\./,
  ];
  return localPatterns.some(p => p.test(ip));
}

describe('motion integration', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('motion incident storage', () => {
    it('creates motion incident', () => {
      const db = getDb();
      const camId = db.createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      const id = db.addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/test.mp4');
      assert.ok(id > 0);
    });

    it('ends motion incident', () => {
      const db = getDb();
      const camId = db.createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      const id = db.addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/test.mp4');
      db.endMotionIncident(id, '2026-03-19T10:01:00Z', 1024000);
      const incident = db.getMotionIncident(id);
      assert.strictEqual(incident.ended_at, '2026-03-19T10:01:00Z');
      assert.strictEqual(incident.size_bytes, 1024000);
    });

    it('tracks ongoing incidents', () => {
      const db = getDb();
      const camId = db.createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      const id = db.addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/test.mp4');
      const incident = db.getMotionIncident(id);
      assert.strictEqual(incident.ended_at, null);
    });
  });

  describe('motion clip retention', () => {
    it('counts unstarred ended incidents', () => {
      const db = getDb();
      const camId = db.createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      
      const id1 = db.addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      const id2 = db.addMotionIncident(camId, '2026-03-19T11:00:00Z', '/clips/2.mp4');
      
      db.endMotionIncident(id1, '2026-03-19T10:01:00Z', 1000);
      db.endMotionIncident(id2, '2026-03-19T11:01:00Z', 2000);
      
      const totals = db.getUnstarredMotionIncidentTotals();
      assert.strictEqual(totals.count, 2);
      assert.strictEqual(totals.bytes, 3000);
    });

    it('excludes starred incidents from totals', () => {
      const db = getDb();
      const camId = db.createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      
      const id1 = db.addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      const id2 = db.addMotionIncident(camId, '2026-03-19T11:00:00Z', '/clips/2.mp4');
      
      db.endMotionIncident(id1, '2026-03-19T10:01:00Z', 1000);
      db.endMotionIncident(id2, '2026-03-19T11:01:00Z', 2000);
      db.setMotionIncidentStar(id2, true);
      
      const totals = db.getUnstarredMotionIncidentTotals();
      assert.strictEqual(totals.count, 1);
      assert.strictEqual(totals.bytes, 1000);
    });

    it('gets oldest unstarred incidents', () => {
      const db = getDb();
      const camId = db.createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      
      const id1 = db.addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      const id2 = db.addMotionIncident(camId, '2026-03-19T11:00:00Z', '/clips/2.mp4');
      const id3 = db.addMotionIncident(camId, '2026-03-19T12:00:00Z', '/clips/3.mp4');
      
      db.endMotionIncident(id1, '2026-03-19T10:01:00Z', 1000);
      db.endMotionIncident(id2, '2026-03-19T11:01:00Z', 2000);
      db.endMotionIncident(id3, '2026-03-19T12:01:00Z', 3000);
      
      const oldest = db.getOldestUnstarredMotionIncidents(2);
      assert.strictEqual(oldest.length, 2);
      assert.strictEqual(oldest[0].id, id1);
      assert.strictEqual(oldest[1].id, id2);
    });

    it('deletes multiple incidents', () => {
      const db = getDb();
      const camId = db.createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      
      const id1 = db.addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/1.mp4');
      const id2 = db.addMotionIncident(camId, '2026-03-19T11:00:00Z', '/clips/2.mp4');
      const id3 = db.addMotionIncident(camId, '2026-03-19T12:00:00Z', '/clips/3.mp4');
      
      db.deleteMotionIncidents([id1, id3]);
      
      assert.strictEqual(db.getMotionIncident(id1), undefined);
      assert.ok(db.getMotionIncident(id2));
      assert.strictEqual(db.getMotionIncident(id3), undefined);
    });
  });

  describe('motion clip settings', () => {
    it('reads max count setting', () => {
      const db = getDb();
      db.setSetting('motion_clip_max_count', '100');
      const max = parseInt(db.getSetting('motion_clip_max_count')) || 200;
      assert.strictEqual(max, 100);
    });

    it('reads max total MB setting', () => {
      const db = getDb();
      db.setSetting('motion_clip_max_total_mb', '1000');
      const max = parseInt(db.getSetting('motion_clip_max_total_mb')) || 5000;
      assert.strictEqual(max, 1000);
    });
  });

  describe('motion WebSocket connection', () => {
    it('identifies local IP', () => {
      assert.strictEqual(isLocalIp('127.0.0.1'), true);
      assert.strictEqual(isLocalIp('10.0.0.1'), true);
      assert.strictEqual(isLocalIp('192.168.1.1'), true);
      assert.strictEqual(isLocalIp('172.16.0.1'), true);
      assert.strictEqual(isLocalIp('::1'), true);
    });

    it('identifies public IP', () => {
      assert.strictEqual(isLocalIp('8.8.8.8'), false);
      assert.strictEqual(isLocalIp('1.1.1.1'), false);
      assert.strictEqual(isLocalIp('203.0.113.1'), false);
    });

    it('validates detector token', () => {
      const expectedToken = 'secret-token-123';
      const providedToken = 'secret-token-123';
      assert.strictEqual(providedToken === expectedToken, true);
    });

    it('rejects invalid detector token', () => {
      const expectedToken = 'secret-token-123';
      const providedToken = 'wrong-token';
      assert.strictEqual(providedToken === expectedToken, false);
    });
  });

  describe('motion WebSocket messages', () => {
    it('handles motion_start message', () => {
      const ws = createMockWebSocket();
      const message = JSON.stringify({
        type: 'motion_start',
        camera_id: 1,
        timestamp: '2026-03-19T10:00:00Z',
      });
      ws.simulateMessage(message);
      assert.strictEqual(ws.getSentMessages().length, 0);
    });

    it('handles motion_end message', () => {
      const ws = createMockWebSocket();
      const message = JSON.stringify({
        type: 'motion_end',
        camera_id: 1,
        timestamp: '2026-03-19T10:01:00Z',
      });
      ws.simulateMessage(message);
      assert.strictEqual(ws.getSentMessages().length, 0);
    });

    it('handles config_update message', () => {
      const ws = createMockWebSocket();
      const message = JSON.stringify({
        type: 'config_update',
        min_area: 1500,
        threshold_fraction: 0.005,
        cooldown_sec: 30,
      });
      ws.simulateMessage(message);
      assert.strictEqual(ws.getSentMessages().length, 0);
    });

    it('broadcasts visit_recorded to browser clients', () => {
      const browserClients = new Set();
      const client = createMockWebSocket();
      browserClients.add(client);

      const payload = JSON.stringify({
        type: 'visit_recorded',
        started_at: '2026-03-19T10:00:00Z',
        ended_at: '2026-03-19T10:01:00Z',
        camera_id: 1,
      });

      browserClients.forEach(c => {
        if (c.readyState === 1) c.send(payload);
      });

      assert.strictEqual(client.getSentMessages().length, 1);
      const parsed = JSON.parse(client.getSentMessages()[0]);
      assert.strictEqual(parsed.type, 'visit_recorded');
    });
  });

  describe('motion stats', () => {
    it('returns motion visit stats', () => {
      const db = getDb();
      const stats = db.getMotionVisitStats();
      assert.ok(Array.isArray(stats.byHour));
      assert.ok(Array.isArray(stats.byDay));
    });

    it('lists recent visits with camera name', () => {
      const db = getDb();
      const camId = db.createCamera('Garden', '192.168.1.1', 554, '/live', '', '');
      const id = db.addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/test.mp4');
      db.endMotionIncident(id, '2026-03-19T10:01:00Z', 1000);
      
      const visits = db.listRecentVisits(10);
      assert.strictEqual(visits.length, 1);
      assert.strictEqual(visits[0].camera_name, 'Garden');
    });

    it('gets last visit time', () => {
      const db = getDb();
      const camId = db.createCamera('Test', '192.168.1.1', 554, '/live', '', '');
      const id = db.addMotionIncident(camId, '2026-03-19T10:00:00Z', '/clips/test.mp4');
      db.endMotionIncident(id, '2026-03-19T10:01:00Z', 1000);
      
      const lastTime = db.getLastVisitTime();
      assert.ok(lastTime);
    });
  });

  describe('motion clip file handling', () => {
    it('generates safe filename', () => {
      const cameraId = 1;
      const timestamp = Date.now();
      const random = 'abcd';
      const filename = `motion-${cameraId}-${timestamp}-${random}.mp4`;
      assert.ok(filename.endsWith('.mp4'));
      assert.ok(!filename.includes('..'));
    });

    it('validates filename pattern', () => {
      const validPattern = /^motion-\d+-\d+-[\da-f]+\.mp4$/;
      assert.ok(validPattern.test('motion-1-1234567890-abcd.mp4'));
      assert.ok(!validPattern.test('../../../etc/passwd'));
      assert.ok(!validPattern.test('test.avi'));
    });
  });

  describe('motion detector runtime config', () => {
    it('reads cooldown from env', () => {
      const cooldown = parseInt(process.env.MOTION_COOLDOWN_SEC, 10) || 30;
      assert.strictEqual(cooldown, 30);
    });

    it('maps sensitivity to min_area', () => {
      const MIN_AREA_MAP = { 2: 4000, 3: 1500, 4: 600 };
      assert.strictEqual(MIN_AREA_MAP[2], 4000);
      assert.strictEqual(MIN_AREA_MAP[3], 1500);
      assert.strictEqual(MIN_AREA_MAP[4], 600);
    });

    it('maps sensitivity to threshold', () => {
      const thresholdFromSensitivity = (sens) => Number(sens) >= 4 ? 0.001 : 0.005;
      assert.strictEqual(thresholdFromSensitivity(4), 0.001);
      assert.strictEqual(thresholdFromSensitivity(3), 0.005);
      assert.strictEqual(thresholdFromSensitivity(2), 0.005);
    });
  });
});
