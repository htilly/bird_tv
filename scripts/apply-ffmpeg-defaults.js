#!/usr/bin/env node
/**
 * One-off: apply DEFAULT_FFMPEG_OPTIONS to all existing cameras in the DB.
 */
const db = require('../db');
const { DEFAULT_FFMPEG_OPTIONS } = require('../streamManager');

const cameras = db.listCameras();
if (cameras.length === 0) {
  console.log('Inga kameror i databasen.');
  process.exit(0);
}

const optsJson = JSON.stringify(DEFAULT_FFMPEG_OPTIONS);
for (const cam of cameras) {
  db.updateCamera(
    cam.id,
    cam.display_name,
    cam.rtsp_host,
    cam.rtsp_port,
    cam.rtsp_path,
    cam.rtsp_username,
    cam.rtsp_password,
    optsJson
  );
  console.log(`Kamera id=${cam.id} "${cam.display_name}": ffmpeg_options uppdaterade till nya defaults.`);
}
console.log(`Klart: ${cameras.length} kamera(r) uppdaterade.`);
