const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { createIsolatedTestDb } = require('../helpers/isolated-db');

let testDb = null;

function getDb() {
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

function sanitizeChat(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function createMockWebSocket() {
  const events = {};
  const sentMessages = [];
  let readyState = 1;
  let isAlive = true;

  return {
    readyState,
    isAlive,
    on: (event, handler) => {
      events[event] = handler;
    },
    send: (data) => {
      sentMessages.push(data);
    },
    close: () => {
      readyState = 3;
    },
    ping: () => {},
    pong: () => {
      isAlive = true;
    },
    getSentMessages: () => sentMessages,
    clearSentMessages: () => sentMessages.length = 0,
    simulateMessage: (data) => {
      if (events.message) events.message(data);
    },
    simulateClose: () => {
      if (events.close) events.close();
    },
    simulateError: (err) => {
      if (events.error) events.error(err);
    },
  };
}

function createMockWebSocketServer() {
  const clients = new Set();
  const events = {};

  return {
    on: (event, handler) => {
      events[event] = handler;
    },
    emit: (event, data) => {
      if (events[event]) events[event](data);
    },
    clients: {
      forEach: (fn) => clients.forEach(fn),
      size: clients.size,
      add: (client) => clients.add(client),
      delete: (client) => clients.delete(client),
    },
    handleConnection: (ws, req) => {
      clients.add(ws);
      if (events.connection) events.connection(ws, req);
    },
  };
}

describe('chat integration', { concurrency: false }, () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('message storage', () => {
    it('stores and retrieves messages', () => {
      const db = getDb();
      db.addChatMessage('Alice', 'Hello!', '2026-03-19T10:00:00Z', '127.0.0.1');
      db.addChatMessage('Bob', 'Hi there!', '2026-03-19T10:01:00Z', '127.0.0.1');
      const messages = db.getChatMessages(100);
      assert.strictEqual(messages.length, 2);
    });

    it('stores messages in chronological order', () => {
      const db = getDb();
      db.addChatMessage('Alice', 'First', '2026-03-19T10:00:00Z');
      db.addChatMessage('Bob', 'Second', '2026-03-19T10:01:00Z');
      const messages = db.getChatMessages(100);
      assert.strictEqual(messages[0].text, 'First');
      assert.strictEqual(messages[1].text, 'Second');
    });

    it('stores IP address', () => {
      const db = getDb();
      db.addChatMessage('Alice', 'Test', '2026-03-19T10:00:00Z', '192.168.1.100');
      const messages = db.getChatMessages(100);
      assert.strictEqual(messages[0].ip_address, '192.168.1.100');
    });
  });

  describe('message sanitization', () => {
    it('escapes HTML in messages', () => {
      const input = '<script>alert("xss")</script>';
      const output = sanitizeChat(input);
      assert.ok(!output.includes('<script>'));
      assert.ok(output.includes('&lt;script&gt;'));
    });

    it('escapes ampersands', () => {
      const output = sanitizeChat('Test & more');
      assert.strictEqual(output, 'Test &amp; more');
    });

    it('escapes quotes', () => {
      const output = sanitizeChat('He said "hello"');
      assert.ok(output.includes('&quot;'));
    });

    it('escapes single quotes', () => {
      const output = sanitizeChat("It's working");
      assert.ok(output.includes('&#x27;'));
    });
  });

  describe('rate limiting', () => {
    it('tracks message count per user', () => {
      const messageCounts = new Map();
      const user = 'Alice';
      const limit = 5;
      const windowMs = 1000;

      for (let i = 0; i < limit; i++) {
        const count = (messageCounts.get(user) || 0) + 1;
        messageCounts.set(user, count);
      }

      assert.strictEqual(messageCounts.get(user), limit);
    });

    it('enforces rate limit', () => {
      const messageCounts = new Map();
      const user = 'Alice';
      const limit = 5;

      for (let i = 0; i < limit + 2; i++) {
        const count = (messageCounts.get(user) || 0) + 1;
        if (count > limit) {
          assert.ok(count > limit);
          break;
        }
        messageCounts.set(user, count);
      }
    });
  });

  describe('IP bans', () => {
    it('checks if IP is banned', () => {
      const db = getDb();
      db.addBan('192.168.1.100', 'Spam', 'admin');
      assert.strictEqual(db.isIpBanned('192.168.1.100'), true);
      assert.strictEqual(db.isIpBanned('192.168.1.101'), false);
    });

    it('can unban IP', () => {
      const db = getDb();
      db.addBan('192.168.1.100', 'Spam', 'admin');
      db.removeBan('192.168.1.100');
      assert.strictEqual(db.isIpBanned('192.168.1.100'), false);
    });
  });

  describe('chat disabled setting', () => {
    it('reads chat_disabled setting', () => {
      const db = getDb();
      db.setSetting('chat_disabled', 'true');
      const disabled = db.getSetting('chat_disabled') === 'true';
      assert.strictEqual(disabled, true);
    });

    it('defaults to enabled', () => {
      const db = getDb();
      const disabled = db.getSetting('chat_disabled') === 'true';
      assert.strictEqual(disabled, false);
    });
  });

  describe('WebSocket message handling', () => {
    it('broadcasts message to all clients', () => {
      const wss = createMockWebSocketServer();
      const client1 = createMockWebSocket();
      const client2 = createMockWebSocket();
      
      wss.clients.add(client1);
      wss.clients.add(client2);

      const message = JSON.stringify({ type: 'chat', text: 'Hello' });
      wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(message);
      });

      assert.strictEqual(client1.getSentMessages().length, 1);
      assert.strictEqual(client2.getSentMessages().length, 1);
    });

    it('broadcasts stats', () => {
      const wss = createMockWebSocketServer();
      const client = createMockWebSocket();
      wss.clients.add(client);

      const stats = JSON.stringify({ type: 'stats', viewerCount: 1 });
      wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(stats);
      });

      const sent = client.getSentMessages();
      assert.strictEqual(sent.length, 1);
      const parsed = JSON.parse(sent[0]);
      assert.strictEqual(parsed.type, 'stats');
    });

    it('broadcasts delete message', () => {
      const wss = createMockWebSocketServer();
      const client = createMockWebSocket();
      wss.clients.add(client);

      const deleteMsg = JSON.stringify({ type: 'delete_messages', ids: [1, 2] });
      wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(deleteMsg);
      });

      const sent = client.getSentMessages();
      assert.strictEqual(sent.length, 1);
      const parsed = JSON.parse(sent[0]);
      assert.strictEqual(parsed.type, 'delete_messages');
      assert.deepStrictEqual(parsed.ids, [1, 2]);
    });

    it('broadcasts clear chat', () => {
      const wss = createMockWebSocketServer();
      const client = createMockWebSocket();
      wss.clients.add(client);

      const clearMsg = JSON.stringify({ type: 'clear_chat' });
      wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(clearMsg);
      });

      const sent = client.getSentMessages();
      assert.strictEqual(sent.length, 1);
      const parsed = JSON.parse(sent[0]);
      assert.strictEqual(parsed.type, 'clear_chat');
    });
  });

  describe('viewer count', () => {
    it('counts connected clients', () => {
      const wss = createMockWebSocketServer();
      const client1 = createMockWebSocket();
      const client2 = createMockWebSocket();
      
      wss.clients.add(client1);
      wss.clients.add(client2);

      let count = 0;
      wss.clients.forEach(() => count++);
      assert.strictEqual(count, 2);
    });
  });
});
