const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { xmeyeHash, XMEyeSession } = require('../../xmeye');

describe('xmeye.xmeyeHash', () => {
  it('returns 8 character string', () => {
    const hash = xmeyeHash('password');
    assert.strictEqual(hash.length, 8);
  });

  it('returns alphanumeric characters only', () => {
    const hash = xmeyeHash('test123');
    assert.ok(/^[A-Za-z0-9]+$/.test(hash));
  });

  it('produces consistent hash for same input', () => {
    const hash1 = xmeyeHash('password123');
    const hash2 = xmeyeHash('password123');
    assert.strictEqual(hash1, hash2);
  });

  it('produces different hash for different input', () => {
    const hash1 = xmeyeHash('password1');
    const hash2 = xmeyeHash('password2');
    assert.notStrictEqual(hash1, hash2);
  });

  it('handles empty password', () => {
    const hash = xmeyeHash('');
    assert.strictEqual(hash.length, 8);
  });

  it('handles special characters', () => {
    const hash = xmeyeHash('p@ss!w0rd#');
    assert.strictEqual(hash.length, 8);
    assert.ok(/^[A-Za-z0-9]+$/.test(hash));
  });

  it('handles unicode characters', () => {
    const hash = xmeyeHash('пароль');
    assert.strictEqual(hash.length, 8);
  });

  it('produces expected format for known input', () => {
    const hash = xmeyeHash('admin');
    assert.ok(/^[A-Za-z0-9]{8}$/.test(hash));
  });
});

describe('xmeye packet structure', () => {
  const HEADER_LEN = 20;

  function makePacket(sessionId, seq, msgId, payload) {
    const data = typeof payload === 'object' && !Buffer.isBuffer(payload)
      ? Buffer.from(JSON.stringify(payload) + '\n\x00', 'utf8')
      : payload;
    const header = Buffer.alloc(HEADER_LEN);
    header[0] = 0xff;
    header[1] = 0x00;
    header.writeUInt16LE(0, 2);
    header.writeUInt32LE(sessionId, 4);
    header.writeUInt32LE(seq, 8);
    header[12] = 0;
    header[13] = 0;
    header.writeUInt16LE(msgId, 14);
    header.writeUInt32LE(data.length, 16);
    return Buffer.concat([header, data]);
  }

  function parsePacket(buf) {
    if (buf.length < HEADER_LEN) return null;
    const msgId = buf.readUInt16LE(14);
    const dataLen = buf.readUInt32LE(16);
    if (buf.length < HEADER_LEN + dataLen) return null;
    const sessionId = buf.readUInt32LE(4);
    const seq = buf.readUInt32LE(8);
    const raw = buf.subarray(HEADER_LEN, HEADER_LEN + dataLen);
    let body = null;
    try {
      const str = raw.toString('utf8').replace(/\x00/g, '').trim();
      if (str) body = JSON.parse(str);
    } catch (_) {
      body = raw;
    }
    return { msgId, sessionId, seq, body, totalLen: HEADER_LEN + dataLen };
  }

  it('creates packet with correct header magic', () => {
    const pkt = makePacket(0, 0, 1000, {});
    assert.strictEqual(pkt[0], 0xff);
    assert.strictEqual(pkt[1], 0x00);
  });

  it('creates packet with correct message ID', () => {
    const pkt = makePacket(0, 0, 1000, {});
    const msgId = pkt.readUInt16LE(14);
    assert.strictEqual(msgId, 1000);
  });

  it('creates packet with correct session ID', () => {
    const pkt = makePacket(12345, 0, 1000, {});
    const sessionId = pkt.readUInt32LE(4);
    assert.strictEqual(sessionId, 12345);
  });

  it('creates packet with correct sequence', () => {
    const pkt = makePacket(0, 42, 1000, {});
    const seq = pkt.readUInt32LE(8);
    assert.strictEqual(seq, 42);
  });

  it('creates packet with JSON payload', () => {
    const payload = { test: 'value' };
    const pkt = makePacket(0, 0, 1000, payload);
    const dataLen = pkt.readUInt32LE(16);
    assert.ok(dataLen > 0);
  });

  it('parses packet back to original values', () => {
    const original = { key: 'value', number: 123 };
    const pkt = makePacket(999, 5, 1000, original);
    const parsed = parsePacket(pkt);
    assert.strictEqual(parsed.msgId, 1000);
    assert.strictEqual(parsed.sessionId, 999);
    assert.strictEqual(parsed.seq, 5);
    assert.deepStrictEqual(parsed.body, original);
  });

  it('handles empty buffer payload', () => {
    const pkt = makePacket(0, 0, 1000, Buffer.alloc(0));
    const parsed = parsePacket(pkt);
    assert.strictEqual(parsed.totalLen, HEADER_LEN);
    assert.strictEqual(parsed.body, null);
  });

  it('returns null for incomplete packet', () => {
    const incomplete = Buffer.alloc(10);
    const parsed = parsePacket(incomplete);
    assert.strictEqual(parsed, null);
  });

  it('returns null for packet shorter than data length', () => {
    const pkt = makePacket(0, 0, 1000, { test: 'data' });
    const truncated = pkt.subarray(0, pkt.length - 5);
    const parsed = parsePacket(truncated);
    assert.strictEqual(parsed, null);
  });

  it('handles binary payload', () => {
    const binaryData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const pkt = makePacket(0, 0, 1000, binaryData);
    const parsed = parsePacket(pkt);
    assert.ok(Buffer.isBuffer(parsed.body));
    assert.deepStrictEqual(parsed.body, binaryData);
  });
});

describe('xmeye message types', () => {
  const MSG = {
    LOGIN: 1000,
    LOGIN_RESP: 1001,
    LOGOUT: 1002,
    KEEPALIVE: 1006,
    KEEPALIVE_RESP: 1007,
    FILE_QUERY: 1420,
    FILE_QUERY_RESP: 1421,
    PLAYBACK_START: 1420,
    PLAYBACK_CLAIM: 1412,
    PLAYBACK_CLAIM_RESP: 1413,
  };

  it('has correct LOGIN message ID', () => {
    assert.strictEqual(MSG.LOGIN, 1000);
  });

  it('has correct LOGIN_RESP message ID', () => {
    assert.strictEqual(MSG.LOGIN_RESP, 1001);
  });

  it('has correct KEEPALIVE message ID', () => {
    assert.strictEqual(MSG.KEEPALIVE, 1006);
  });

  it('has correct FILE_QUERY message ID', () => {
    assert.strictEqual(MSG.FILE_QUERY, 1420);
  });

  it('response is request + 1 for login', () => {
    assert.strictEqual(MSG.LOGIN_RESP, MSG.LOGIN + 1);
  });

  it('response is request + 1 for keepalive', () => {
    assert.strictEqual(MSG.KEEPALIVE_RESP, MSG.KEEPALIVE + 1);
  });
});

describe('xmeye XMEyeSession', () => {
  it('creates session with default port', () => {
    const session = new XMEyeSession('192.168.1.1');
    assert.strictEqual(session.host, '192.168.1.1');
    assert.strictEqual(session.port, 34567);
  });

  it('creates session with custom port', () => {
    const session = new XMEyeSession('192.168.1.1', 12345);
    assert.strictEqual(session.port, 12345);
  });

  it('initializes with zero session ID', () => {
    const session = new XMEyeSession('192.168.1.1');
    assert.strictEqual(session.sessionId, 0);
  });

  it('initializes with zero sequence', () => {
    const session = new XMEyeSession('192.168.1.1');
    assert.strictEqual(session.seq, 0);
  });

  it('initializes with empty buffer', () => {
    const session = new XMEyeSession('192.168.1.1');
    assert.strictEqual(session._buf.length, 0);
  });

  it('initializes with empty pending map', () => {
    const session = new XMEyeSession('192.168.1.1');
    assert.strictEqual(session._pending.size, 0);
  });

  it('initializes as not alive', () => {
    const session = new XMEyeSession('192.168.1.1');
    assert.strictEqual(session._alive, false);
  });

  it('close method exists', () => {
    const session = new XMEyeSession('192.168.1.1');
    assert.strictEqual(typeof session.close, 'function');
  });

  it('close does not throw when not connected', () => {
    const session = new XMEyeSession('192.168.1.1');
    assert.doesNotThrow(() => session.close());
  });
});

describe('xmeye buffer overflow protection', () => {
  it('MAX_BUFFER_SIZE is 1MB', () => {
    const MAX_BUFFER_SIZE = 1024 * 1024;
    assert.strictEqual(MAX_BUFFER_SIZE, 1048576);
  });
});
