const db = require('./db');
const app = require('./app');
const ffmpeg = require('./ffmpeg');
const websocket = require('./websocket');
const fixtures = require('./fixtures');

module.exports = {
  ...db,
  ...app,
  ...ffmpeg,
  ...websocket,
  fixtures,
};
