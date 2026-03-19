const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let rtspServerProcess = null;
let rtspServerPort = 0;

function checkFfmpegAvailable() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkMediaMtxAvailable() {
  try {
    execSync('mediamtx --help', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function startTestRtspServer() {
  if (rtspServerProcess) {
    return { port: rtspServerPort, stop: stopTestRtspServer };
  }

  if (!checkFfmpegAvailable()) {
    console.warn('FFmpeg not available - RTSP tests will be skipped');
    return { port: null, stop: () => {} };
  }

  rtspServerPort = 18554 + Math.floor(Math.random() * 1000);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtsp-test-'));
  const configPath = path.join(tmpDir, 'mediamtx.yml');

  fs.writeFileSync(configPath, `
hlsAddress: :${rtspServerPort + 1}
rtspAddress: :${rtspServerPort}
rtpAddress: :${rtspServerPort + 2}
rtcpAddress: :${rtspServerPort + 3}
paths:
  test:
    source: publisher
`);

  return new Promise((resolve) => {
    try {
      rtspServerProcess = spawn('mediamtx', [configPath], {
        cwd: tmpDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      rtspServerProcess.on('error', () => {
        console.warn('MediaMTX not available - RTSP tests will be skipped');
        rtspServerProcess = null;
        resolve({ port: null, stop: () => {} });
      });

      setTimeout(() => {
        if (rtspServerProcess && !rtspServerProcess.killed) {
          resolve({ port: rtspServerPort, stop: stopTestRtspServer });
        } else {
          resolve({ port: null, stop: () => {} });
        }
      }, 1000);
    } catch {
      resolve({ port: null, stop: () => {} });
    }
  });
}

function stopTestRtspServer() {
  if (rtspServerProcess && !rtspServerProcess.killed) {
    rtspServerProcess.kill('SIGTERM');
    rtspServerProcess = null;
  }
}

function createMockFfmpegProcess() {
  const events = {};
  let killed = false;
  let exitCode = null;
  let exitSignal = null;

  const mockProcess = {
    pid: Math.floor(Math.random() * 10000),
    killed: false,
    stdout: {
      on: (event, handler) => {
        events[`stdout_${event}`] = handler;
      },
      pipe: () => {},
      emit: (event, data) => {
        if (events[`stdout_${event}`]) events[`stdout_${event}`](data);
      },
    },
    stderr: {
      on: (event, handler) => {
        events[`stderr_${event}`] = handler;
      },
      emit: (event, data) => {
        if (events[`stderr_${event}`]) events[`stderr_${event}`](data);
      },
    },
    on: (event, handler) => {
      events[event] = handler;
    },
    once: (event, handler) => {
      events[event] = handler;
    },
    kill: (signal = 'SIGTERM') => {
      killed = true;
      mockProcess.killed = true;
      exitSignal = signal;
      if (signal === 'SIGKILL') {
        exitCode = 137;
      }
      setTimeout(() => {
        if (events.exit) events.exit(exitCode, exitSignal);
      }, 10);
    },
    simulateExit: (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      if (events.exit) events.exit(code, signal);
    },
    simulateError: (err) => {
      if (events.error) events.error(err);
    },
    simulateStderr: (data) => {
      if (events.stderr_data) events.stderr_data(Buffer.from(data));
    },
    simulateStdout: (data) => {
      if (events.stdout_data) events.stdout_data(Buffer.from(data));
    },
  };

  return mockProcess;
}

function createMockSpawn(mockProcess) {
  return (command, args, options) => {
    if (command === 'ffmpeg') {
      return mockProcess;
    }
    return spawn(command, args, options);
  };
}

module.exports = {
  checkFfmpegAvailable,
  checkMediaMtxAvailable,
  startTestRtspServer,
  stopTestRtspServer,
  createMockFfmpegProcess,
  createMockSpawn,
};
