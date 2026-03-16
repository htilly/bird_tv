const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildRtspUrl, validateRtspUrl } = require('../db');

describe('db.buildRtspUrl', () => {
  it('builds URL with host and port only', () => {
    assert.strictEqual(
      buildRtspUrl('192.168.1.100', 554, '', '', ''),
      'rtsp://192.168.1.100:554/'
    );
  });

  it('adds leading slash when path has none', () => {
    assert.strictEqual(
      buildRtspUrl('host', 554, 'stream1', '', ''),
      'rtsp://host:554/stream1'
    );
  });

  it('does not double slash when path starts with /', () => {
    assert.strictEqual(
      buildRtspUrl('host', 554, '/stream1', '', ''),
      'rtsp://host:554/stream1'
    );
  });

  it('includes username and password when given', () => {
    const url = buildRtspUrl('cam.local', 554, '/live', 'admin', 'secret');
    assert.ok(url.startsWith('rtsp://'));
    assert.ok(url.includes('@'));
    assert.ok(url.includes('554/live'));
    assert.ok(url.includes('admin'));
    assert.ok(url.includes('secret'));
  });

  it('encodes special characters in credentials', () => {
    const url = buildRtspUrl('host', 554, '', 'user@name', 'p@ss');
    assert.ok(url.includes('%40')); // @ encoded
  });
});

describe('db.validateRtspUrl', () => {
  it('accepts valid rtsp URL', () => {
    assert.strictEqual(validateRtspUrl('rtsp://192.168.1.1:554/stream1'), true);
    assert.strictEqual(validateRtspUrl('rtsp://host/path'), true);
  });

  it('rejects non-rtsp protocols', () => {
    assert.strictEqual(validateRtspUrl('http://host/'), false);
    assert.strictEqual(validateRtspUrl('https://host/'), false);
  });

  it('rejects invalid URL', () => {
    assert.strictEqual(validateRtspUrl('not-a-url'), false);
    assert.strictEqual(validateRtspUrl(''), false);
  });
});
