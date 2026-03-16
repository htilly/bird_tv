const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_FFMPEG_OPTIONS,
  parseFfmpegOptions,
  buildFfmpegArgs,
} = require('../streamManager');

describe('streamManager.parseFfmpegOptions', () => {
  it('returns defaults when camera has no ffmpeg_options', () => {
    const opts = parseFfmpegOptions({});
    assert.strictEqual(opts.rtsp_transport, 'tcp');
    assert.strictEqual(opts.video_codec, 'libx264');
    assert.strictEqual(opts.preset, 'ultrafast');
  });

  it('returns defaults when ffmpeg_options is null', () => {
    const opts = parseFfmpegOptions({ ffmpeg_options: null });
    assert.strictEqual(opts.rtsp_transport, 'tcp');
  });

  it('merges parsed JSON over defaults', () => {
    const opts = parseFfmpegOptions({
      ffmpeg_options: JSON.stringify({ rtsp_transport: 'udp', crf: 23 }),
    });
    assert.strictEqual(opts.rtsp_transport, 'udp');
    assert.strictEqual(opts.crf, 23);
    assert.strictEqual(opts.preset, 'ultrafast');
  });

  it('falls back to defaults on invalid JSON', () => {
    const opts = parseFfmpegOptions({ ffmpeg_options: 'not json' });
    assert.strictEqual(opts.rtsp_transport, 'tcp');
  });
});

describe('streamManager.buildFfmpegArgs', () => {
  const rtspUrl = 'rtsp://192.168.1.1:554/stream1';
  const outBase = '/tmp/hls/cam-1';

  it('includes -i and rtsp URL and output m3u8', () => {
    const args = buildFfmpegArgs(rtspUrl, outBase, {});
    assert.ok(args.includes('-i'));
    assert.strictEqual(args[args.indexOf('-i') + 1], rtspUrl);
    assert.ok(args.some((a) => a.endsWith('.m3u8')));
  });

  it('uses default video codec libx264 and preset', () => {
    const args = buildFfmpegArgs(rtspUrl, outBase, {});
    assert.ok(args.includes('-c:v'));
    assert.ok(args.includes('libx264'));
    assert.ok(args.includes('-preset'));
    assert.ok(args.includes('ultrafast'));
  });

  it('uses -c:v copy when video_codec is copy', () => {
    const args = buildFfmpegArgs(rtspUrl, outBase, { video_codec: 'copy' });
    const copyIdx = args.indexOf('-c:v');
    assert.ok(copyIdx >= 0);
    assert.strictEqual(args[copyIdx + 1], 'copy');
    assert.ok(!args.includes('ultrafast'));
  });

  it('uses -an when audio_codec is none', () => {
    const args = buildFfmpegArgs(rtspUrl, outBase, { audio_codec: 'none' });
    assert.ok(args.includes('-an'));
  });

  it('applies custom options', () => {
    const args = buildFfmpegArgs(rtspUrl, outBase, {
      rtsp_transport: 'udp',
      hls_time: 4,
    });
    assert.ok(args.includes('-rtsp_transport'));
    assert.strictEqual(args[args.indexOf('-rtsp_transport') + 1], 'udp');
    assert.ok(args.includes('-hls_time'));
    assert.strictEqual(args[args.indexOf('-hls_time') + 1], '4');
  });

  it('includes hls_segment_filename with outBase', () => {
    const args = buildFfmpegArgs(rtspUrl, outBase, {});
    assert.ok(args.includes('-hls_segment_filename'));
    const idx = args.indexOf('-hls_segment_filename');
    assert.ok(args[idx + 1].startsWith(outBase));
    assert.ok(args[idx + 1].includes('%03d.ts'));
  });
});
