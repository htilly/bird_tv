const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

function validateOrigin(origin, allowedOrigins) {
  if (!allowedOrigins || allowedOrigins.length === 0) return true;
  try {
    const originUrl = new URL(origin);
    return allowedOrigins.some(allowed => {
      if (allowed === '*') return true;
      const allowedUrl = new URL(allowed);
      return originUrl.origin === allowedUrl.origin;
    });
  } catch {
    return false;
  }
}

function validateDetectorToken(token, expectedToken) {
  if (!expectedToken) return false;
  return token === expectedToken;
}

function isLocalIp(ip) {
  if (!ip) return false;
  const localPatterns = [
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^::1$/,
    /^localhost$/,
  ];
  return localPatterns.some(p => p.test(ip));
}

function generateDetectorToken() {
  return crypto.randomBytes(32).toString('hex');
}

describe('security/origin', () => {
  describe('WebSocket origin validation', () => {
    it('accepts matching origin', () => {
      const origin = 'http://localhost:3000';
      const allowed = ['http://localhost:3000'];
      
      assert.strictEqual(validateOrigin(origin, allowed), true);
    });

    it('accepts origin with different port', () => {
      const origin = 'http://localhost:3000';
      const allowed = ['http://localhost:3000', 'http://localhost:8080'];
      
      assert.strictEqual(validateOrigin(origin, allowed), true);
    });

    it('rejects mismatched origin', () => {
      const origin = 'http://evil.com';
      const allowed = ['http://localhost:3000'];
      
      assert.strictEqual(validateOrigin(origin, allowed), false);
    });

    it('rejects different protocol', () => {
      const origin = 'https://localhost:3000';
      const allowed = ['http://localhost:3000'];
      
      assert.strictEqual(validateOrigin(origin, allowed), false);
    });

    it('accepts wildcard', () => {
      const origin = 'http://any-origin.com';
      const allowed = ['*'];
      
      assert.strictEqual(validateOrigin(origin, allowed), true);
    });

    it('rejects malformed origin', () => {
      const origin = 'not-a-url';
      const allowed = ['http://localhost:3000'];
      
      assert.strictEqual(validateOrigin(origin, allowed), false);
    });

    it('handles empty allowed list', () => {
      const origin = 'http://localhost:3000';
      const allowed = [];
      
      assert.strictEqual(validateOrigin(origin, allowed), true);
    });

    it('handles undefined allowed list', () => {
      const origin = 'http://localhost:3000';
      
      assert.strictEqual(validateOrigin(origin, undefined), true);
    });
  });

  describe('detector token validation', () => {
    it('accepts valid token', () => {
      const token = 'valid-token-123';
      const expected = 'valid-token-123';
      
      assert.strictEqual(validateDetectorToken(token, expected), true);
    });

    it('rejects invalid token', () => {
      const token = 'invalid-token';
      const expected = 'valid-token-123';
      
      assert.strictEqual(validateDetectorToken(token, expected), false);
    });

    it('rejects empty token', () => {
      const token = '';
      const expected = 'valid-token';
      
      assert.strictEqual(validateDetectorToken(token, expected), false);
    });

    it('rejects when no expected token', () => {
      const token = 'some-token';
      
      assert.strictEqual(validateDetectorToken(token, null), false);
      assert.strictEqual(validateDetectorToken(token, undefined), false);
    });

    it('generates secure token', () => {
      const token = generateDetectorToken();
      
      assert.ok(token);
      assert.strictEqual(token.length, 64);
      assert.ok(/^[a-f0-9]+$/.test(token));
    });

    it('generates unique tokens', () => {
      const token1 = generateDetectorToken();
      const token2 = generateDetectorToken();
      
      assert.notStrictEqual(token1, token2);
    });
  });

  describe('local IP detection', () => {
    it('identifies localhost', () => {
      assert.strictEqual(isLocalIp('127.0.0.1'), true);
      assert.strictEqual(isLocalIp('127.0.0.100'), true);
    });

    it('identifies 10.x.x.x', () => {
      assert.strictEqual(isLocalIp('10.0.0.1'), true);
      assert.strictEqual(isLocalIp('10.255.255.255'), true);
    });

    it('identifies 192.168.x.x', () => {
      assert.strictEqual(isLocalIp('192.168.0.1'), true);
      assert.strictEqual(isLocalIp('192.168.255.255'), true);
    });

    it('identifies 172.16-31.x.x', () => {
      assert.strictEqual(isLocalIp('172.16.0.1'), true);
      assert.strictEqual(isLocalIp('172.20.0.1'), true);
      assert.strictEqual(isLocalIp('172.31.255.255'), true);
    });

    it('rejects 172.0-15.x.x (not private)', () => {
      assert.strictEqual(isLocalIp('172.15.0.1'), false);
      assert.strictEqual(isLocalIp('172.32.0.1'), false);
    });

    it('identifies IPv6 localhost', () => {
      assert.strictEqual(isLocalIp('::1'), true);
    });

    it('identifies localhost hostname', () => {
      assert.strictEqual(isLocalIp('localhost'), true);
    });

    it('rejects public IPs', () => {
      assert.strictEqual(isLocalIp('8.8.8.8'), false);
      assert.strictEqual(isLocalIp('1.1.1.1'), false);
      assert.strictEqual(isLocalIp('203.0.113.1'), false);
    });

    it('handles invalid input', () => {
      assert.strictEqual(isLocalIp(''), false);
      assert.strictEqual(isLocalIp(null), false);
      assert.strictEqual(isLocalIp(undefined), false);
    });
  });

  describe('motion detector connection rules', () => {
    it('allows local connection without token', () => {
      const ip = '127.0.0.1';
      const token = null;
      
      const allowed = isLocalIp(ip) && !token;
      assert.strictEqual(allowed, true);
    });

    it('requires token for non-local connection', () => {
      const ip = '203.0.113.1';
      const token = null;
      const expectedToken = 'valid-token';
      
      const allowed = isLocalIp(ip) || validateDetectorToken(token, expectedToken);
      assert.strictEqual(allowed, false);
    });

    it('allows non-local with valid token', () => {
      const ip = '203.0.113.1';
      const token = 'valid-token';
      const expectedToken = 'valid-token';
      
      const allowed = isLocalIp(ip) || validateDetectorToken(token, expectedToken);
      assert.strictEqual(allowed, true);
    });

    it('rejects non-local with invalid token', () => {
      const ip = '203.0.113.1';
      const token = 'wrong-token';
      const expectedToken = 'valid-token';
      
      const allowed = isLocalIp(ip) || validateDetectorToken(token, expectedToken);
      assert.strictEqual(allowed, false);
    });
  });
});
