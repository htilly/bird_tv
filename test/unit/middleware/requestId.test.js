const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createMockRequest, createMockResponse } = require('../../helpers/app');
const { requestIdMiddleware } = require('../../middleware/requestId');

describe('middleware/requestId.requestIdMiddleware', () => {
  it('generates new request ID when not provided', () => {
    const req = createMockRequest({ headers: {} });
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    requestIdMiddleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.ok(req.requestId);
    assert.ok(typeof req.requestId === 'string');
    assert.ok(req.requestId.length > 0);
  });

  it('uses existing X-Request-ID header', () => {
    const existingId = 'existing-request-id-123';
    const req = createMockRequest({ 
      headers: { 'x-request-id': existingId } 
    });
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    requestIdMiddleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.requestId, existingId);
  });

  it('sets X-Request-ID response header', () => {
    const req = createMockRequest({ headers: {} });
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    requestIdMiddleware(req, res, next);

    assert.ok(res.headers['x-request-id']);
    assert.strictEqual(res.headers['x-request-id'], req.requestId);
  });

  it('propagates existing ID to response header', () => {
    const existingId = 'propagated-id-456';
    const req = createMockRequest({ 
      headers: { 'x-request-id': existingId } 
    });
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    requestIdMiddleware(req, res, next);

    assert.strictEqual(res.headers['x-request-id'], existingId);
  });

  it('generates UUID format for new IDs', () => {
    const req = createMockRequest({ headers: {} });
    const res = createMockResponse();
    requestIdMiddleware(req, res, () => {});

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.ok(uuidRegex.test(req.requestId), 'Request ID should be UUID format');
  });

  it('handles case-insensitive header lookup', () => {
    const existingId = 'case-test-id';
    const req = createMockRequest({ 
      headers: { 'X-Request-Id': existingId }
    });
    const res = createMockResponse();
    requestIdMiddleware(req, res, () => {});

    assert.strictEqual(req.requestId, existingId);
  });
});
