const bcrypt = require('bcryptjs');

const users = {
  admin: {
    username: 'admin',
    password: 'admin123',
    passwordHash: bcrypt.hashSync('admin123', 10),
  },
  user1: {
    username: 'testuser',
    password: 'testpass123',
    passwordHash: bcrypt.hashSync('testpass123', 10),
  },
  user2: {
    username: 'anotheruser',
    password: 'anotherpass456',
    passwordHash: bcrypt.hashSync('anotherpass456', 10),
  },
};

const cameras = {
  basic: {
    display_name: 'Garden Camera',
    rtsp_host: '192.168.1.100',
    rtsp_port: 554,
    rtsp_path: '/stream1',
    rtsp_username: '',
    rtsp_password: '',
    ffmpeg_options: '{}',
  },
  withAuth: {
    display_name: 'Front Door Camera',
    rtsp_host: '192.168.1.101',
    rtsp_port: 554,
    rtsp_path: '/live/main',
    rtsp_username: 'admin',
    rtsp_password: 'secretpass',
    ffmpeg_options: JSON.stringify({ crf: 23, preset: 'fast' }),
  },
  customPort: {
    display_name: 'Custom Port Camera',
    rtsp_host: 'camera.local',
    rtsp_port: 8554,
    rtsp_path: '/ch0/0',
    rtsp_username: '',
    rtsp_password: '',
    ffmpeg_options: '{}',
  },
};

const rtspUrls = {
  valid: [
    'rtsp://192.168.1.100:554/stream1',
    'rtsp://camera.local/live',
    'rtsp://user:pass@192.168.1.1:554/path',
    'rtsp://localhost:8554/test',
  ],
  invalid: [
    'http://192.168.1.100/stream',
    'https://camera.local/live',
    'ftp://server/file',
    'not-a-url',
    '',
    'rtsp://',
    '://invalid',
  ],
};

const chatMessages = [
  { nickname: 'BirdWatcher', text: 'Just saw a blue tit!' },
  { nickname: 'NatureLover', text: 'Beautiful morning for bird watching' },
  { nickname: 'BirdWatcher', text: 'Here comes a robin!' },
];

const snapshots = [
  { filename: 'snap-001.png', nickname: 'Visitor1', camera_name: 'Garden Camera' },
  { filename: 'snap-002.png', nickname: 'BirdFan', camera_name: 'Garden Camera' },
  { filename: 'snap-003.png', nickname: 'NatureLover', camera_name: 'Front Door Camera' },
];

const motionIncidents = [
  { camera_id: 1, started_at: '2026-03-19T08:00:00Z', file_path: '/clips/incident-001.mp4' },
  { camera_id: 1, started_at: '2026-03-19T09:30:00Z', file_path: '/clips/incident-002.mp4' },
  { camera_id: 2, started_at: '2026-03-19T10:15:00Z', file_path: '/clips/incident-003.mp4' },
];

const bannedIps = [
  { ip_address: '192.168.1.200', reason: 'Spam messages', banned_by: 'admin' },
  { ip_address: '10.0.0.50', reason: 'Inappropriate content', banned_by: 'admin' },
];

const settings = {
  reverseProxy: { key: 'reverse_proxy', value: 'true' },
  requireAuth: { key: 'require_auth_streams', value: 'true' },
  chatDisabled: { key: 'chat_disabled', value: 'true' },
  loginRateMax: { key: 'login_rate_max', value: '5' },
  loginRateWindow: { key: 'login_rate_window_min', value: '10' },
};

const visitorKeys = [
  'visitor-abc123',
  'visitor-xyz789',
  'visitor-qwe456',
];

module.exports = {
  users,
  cameras,
  rtspUrls,
  chatMessages,
  snapshots,
  motionIncidents,
  bannedIps,
  settings,
  visitorKeys,
};
