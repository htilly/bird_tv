const WebSocket = require('ws');

function createTestWebSocketClient(url, options = {}) {
  let ws = null;
  const messages = [];
  let connected = false;

  function connect() {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(url, {
        headers: {
          origin: options.origin || 'http://localhost:3000',
          ...options.headers,
        },
      });

      ws.on('open', () => {
        connected = true;
        resolve();
      });

      ws.on('error', (err) => {
        if (!connected) reject(err);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          messages.push(msg);
        } catch {
          messages.push({ raw: data.toString() });
        }
      });

      ws.on('close', () => {
        connected = false;
      });
    });
  }

  function send(data) {
    if (!ws || !connected) {
      throw new Error('WebSocket not connected');
    }
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    ws.send(payload);
  }

  function waitForMessage(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const initialLength = messages.length;

      const check = () => {
        if (messages.length > initialLength) {
          resolve(messages[messages.length - 1]);
          return;
        }
        if (Date.now() - startTime > timeout) {
          reject(new Error('Timeout waiting for message'));
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  function waitForMessages(count, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const initialLength = messages.length;

      const check = () => {
        if (messages.length >= initialLength + count) {
          resolve(messages.slice(initialLength));
          return;
        }
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for ${count} messages, got ${messages.length - initialLength}`));
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  function close() {
    if (ws) {
      ws.close();
      ws = null;
      connected = false;
    }
  }

  function isConnected() {
    return connected;
  }

  function getMessages() {
    return [...messages];
  }

  function clearMessages() {
    messages.length = 0;
  }

  return {
    connect,
    send,
    waitForMessage,
    waitForMessages,
    close,
    isConnected,
    getMessages,
    clearMessages,
  };
}

function createMockWebSocketServer() {
  const clients = new Set();
  const events = {};

  const mockServer = {
    on: (event, handler) => {
      events[event] = handler;
    },
    emit: (event, data) => {
      if (events[event]) events[event](data);
    },
    clients: {
      forEach: (fn) => clients.forEach(fn),
      size: clients.size,
    },
    handleConnection: (ws, req) => {
      clients.add(ws);
      if (events.connection) events.connection(ws, req);
    },
    simulateClose: (ws) => {
      clients.delete(ws);
      if (events.close) events.close();
    },
  };

  return mockServer;
}

function createMockWebSocket() {
  const events = {};
  let readyState = WebSocket.OPEN;
  const sentMessages = [];

  const mockWs = {
    readyState,
    send: (data) => {
      sentMessages.push(data);
    },
    on: (event, handler) => {
      events[event] = handler;
    },
    close: () => {
      readyState = WebSocket.CLOSED;
      if (events.close) events.close();
    },
    terminate: () => {
      readyState = WebSocket.CLOSED;
      if (events.close) events.close();
    },
    ping: () => {},
    pong: () => {},
    simulateMessage: (data) => {
      if (events.message) events.message(data);
    },
    simulateClose: () => {
      readyState = WebSocket.CLOSED;
      if (events.close) events.close();
    },
    simulateError: (err) => {
      if (events.error) events.error(err);
    },
    getSentMessages: () => [...sentMessages],
    clearSentMessages: () => {
      sentMessages.length = 0;
    },
  };

  return mockWs;
}

module.exports = {
  createTestWebSocketClient,
  createMockWebSocketServer,
  createMockWebSocket,
};
