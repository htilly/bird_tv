#!/usr/bin/env python3
"""
Birdcam Motion Detector
=======================
Reads an RTSP stream, detects motion using OpenCV MOG2 background subtraction,
broadcasts bounding box data over WebSocket, and fires Web Push notifications.

Usage:
    python motion.py

Environment overrides (see config.py for full list):
    MOTION_RTSP_URL, MOTION_MIN_AREA, MOTION_COOLDOWN_SEC, etc.

WebSocket protocol (broadcasts to connected clients):
    {
      "type": "motion",
      "detected": true|false,
      "boxes": [{"x": 10, "y": 20, "w": 100, "h": 80, "area": 8000}, ...],
      "frame_w": 640,
      "frame_h": 480,
      "timestamp": "2024-01-01T12:00:00.000Z"
    }

    {
      "type": "status",
      "connected": true|false,
      "message": "..."
    }

    {
      "type": "config",
      "min_area": 1500,
      "threshold_fraction": 0.005,
      "cooldown_sec": 30
    }
"""

import asyncio
import json
import logging
import signal
import sys
import time
from datetime import datetime, timezone

import cv2
import numpy as np
import websockets
from websockets.server import serve

import config
import push_notifier

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
logger = logging.getLogger('motion')

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
connected_clients: set = set()
last_notification_time: float = 0.0

# Mutable config (can be updated by clients at runtime)
runtime_config = {
    'min_area': config.MIN_CONTOUR_AREA,
    'threshold_fraction': config.MOTION_THRESHOLD_FRACTION,
    'cooldown_sec': config.NOTIFICATION_COOLDOWN_SEC,
}


# ---------------------------------------------------------------------------
# WebSocket helpers
# ---------------------------------------------------------------------------

async def broadcast(message: dict):
    """Send JSON message to all connected WebSocket clients."""
    if not connected_clients:
        return
    data = json.dumps(message)
    dead = set()
    for ws in connected_clients.copy():
        try:
            await ws.send(data)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


async def ws_handler(websocket):
    """Handle incoming WebSocket connections from the browser overlay."""
    logger.info(f"Client connected: {websocket.remote_address}")
    connected_clients.add(websocket)

    # Send current config immediately on connect
    await websocket.send(json.dumps({
        'type': 'config',
        **runtime_config,
    }))

    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
                await handle_client_message(websocket, msg)
            except json.JSONDecodeError:
                pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        logger.info(f"Client disconnected: {websocket.remote_address}")


async def handle_client_message(websocket, msg: dict):
    """Handle messages from browser clients (config updates, subscription saves)."""
    msg_type = msg.get('type')

    if msg_type == 'config_update':
        # Browser can push slider values to update detection sensitivity live
        if 'min_area' in msg:
            runtime_config['min_area'] = max(100, int(msg['min_area']))
        if 'threshold_fraction' in msg:
            runtime_config['threshold_fraction'] = max(0.0001, min(1.0, float(msg['threshold_fraction'])))
        if 'cooldown_sec' in msg:
            runtime_config['cooldown_sec'] = max(5, int(msg['cooldown_sec']))
        logger.info(f"Config updated by client: {runtime_config}")
        # Echo config back to all clients
        await broadcast({'type': 'config', **runtime_config})

    elif msg_type == 'subscribe':
        # Browser sends push subscription object
        subscription = msg.get('subscription')
        if subscription and isinstance(subscription, dict):
            push_notifier.add_subscription(config.SUBSCRIPTIONS_FILE, subscription)
            await websocket.send(json.dumps({'type': 'subscribed', 'ok': True}))
            logger.info("Push subscription saved.")

    elif msg_type == 'unsubscribe':
        endpoint = msg.get('endpoint')
        if endpoint:
            push_notifier.remove_subscription(config.SUBSCRIPTIONS_FILE, endpoint)
            await websocket.send(json.dumps({'type': 'unsubscribed', 'ok': True}))

    elif msg_type == 'ping':
        await websocket.send(json.dumps({'type': 'pong'}))


# ---------------------------------------------------------------------------
# Motion detection loop (runs in a thread executor to avoid blocking asyncio)
# ---------------------------------------------------------------------------

def build_detector():
    """Create and return a fresh MOG2 background subtractor."""
    return cv2.createBackgroundSubtractorMOG2(
        history=config.BG_HISTORY,
        varThreshold=50,
        detectShadows=False,
    )


def process_frame(frame, bg_subtractor) -> tuple[bool, list, int, int]:
    """
    Apply motion detection to a single frame.

    Returns:
        (motion_detected, boxes, frame_w, frame_h)
        boxes = list of {"x", "y", "w", "h", "area"} dicts
    """
    # Resize for processing speed
    h, w = frame.shape[:2]
    scale = config.PROCESS_WIDTH / w
    proc_w = config.PROCESS_WIDTH
    proc_h = int(h * scale)
    small = cv2.resize(frame, (proc_w, proc_h))

    # Convert to grayscale, blur to reduce noise
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

    # Ensure blur kernel is odd
    k = config.BLUR_KERNEL | 1
    blurred = cv2.GaussianBlur(gray, (k, k), 0)

    # Background subtraction
    fg_mask = bg_subtractor.apply(blurred)

    # Morphological operations to fill holes and merge nearby regions
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    fg_mask = cv2.dilate(fg_mask, kernel, iterations=config.DILATE_ITERATIONS)
    fg_mask = cv2.erode(fg_mask, kernel, iterations=1)

    # Find contours
    contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Scale factor to map coordinates back to original resolution
    inv_scale = 1.0 / scale

    boxes = []
    total_motion_area = 0
    frame_area = w * h

    for cnt in contours:
        area_small = cv2.contourArea(cnt)
        area_orig = area_small * (inv_scale ** 2)

        if area_orig < runtime_config['min_area']:
            continue

        x, y, bw, bh = cv2.boundingRect(cnt)
        # Scale back to original frame coordinates
        boxes.append({
            'x': int(x * inv_scale),
            'y': int(y * inv_scale),
            'w': int(bw * inv_scale),
            'h': int(bh * inv_scale),
            'area': int(area_orig),
        })
        total_motion_area += area_orig

    motion_fraction = total_motion_area / frame_area if frame_area > 0 else 0
    motion_detected = motion_fraction >= runtime_config['threshold_fraction']

    return motion_detected, boxes, w, h


async def run_motion_loop(loop: asyncio.AbstractEventLoop):
    """
    Main RTSP capture and motion detection loop.
    Runs indefinitely, reconnecting on failure.
    Broadcasts motion events over WebSocket.
    """
    global last_notification_time
    bg_subtractor = build_detector()
    warmup_frames = 30  # Let background model stabilise before detecting

    while True:
        logger.info(f"Connecting to RTSP: {config.RTSP_URL}")
        await broadcast({'type': 'status', 'connected': False, 'message': 'Connecting to camera...'})

        cap = cv2.VideoCapture(config.RTSP_URL)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Minimize latency

        if not cap.isOpened():
            logger.warning("Failed to open RTSP stream. Retrying in %ds...", config.RECONNECT_DELAY_SEC)
            await broadcast({'type': 'status', 'connected': False, 'message': 'Camera unavailable. Retrying...'})
            await asyncio.sleep(config.RECONNECT_DELAY_SEC)
            bg_subtractor = build_detector()
            warmup_frames = 30
            continue

        logger.info("RTSP stream opened.")
        await broadcast({'type': 'status', 'connected': True, 'message': 'Camera connected.'})

        frame_count = 0
        consecutive_failures = 0
        MAX_FAILURES = 10

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    consecutive_failures += 1
                    if consecutive_failures >= MAX_FAILURES:
                        logger.warning("Too many read failures, reconnecting...")
                        break
                    await asyncio.sleep(0.1)
                    continue

                consecutive_failures = 0
                frame_count += 1

                # Skip detection during warmup (background model learning phase)
                if frame_count <= warmup_frames:
                    _, _, _, _ = process_frame(frame, bg_subtractor)
                    if frame_count == warmup_frames:
                        logger.info("Background model warmed up. Detection active.")
                    await asyncio.sleep(0)  # Yield to event loop
                    continue

                motion_detected, boxes, fw, fh = process_frame(frame, bg_subtractor)

                # Build and broadcast motion event
                event = {
                    'type': 'motion',
                    'detected': motion_detected,
                    'boxes': boxes,
                    'frame_w': fw,
                    'frame_h': fh,
                    'timestamp': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                }

                # Only broadcast to WS if there are clients (avoid building JSON for nothing)
                if connected_clients:
                    await broadcast(event)

                # Fire push notification with cooldown
                if motion_detected and boxes:
                    now = time.time()
                    if now - last_notification_time >= runtime_config['cooldown_sec']:
                        last_notification_time = now
                        logger.info(f"Motion detected! {len(boxes)} region(s). Sending push...")
                        # Run push in background so it doesn't block frame processing
                        asyncio.ensure_future(send_push_async(len(boxes)))

                # Debug window (disabled by default)
                if config.DEBUG_WINDOW:
                    debug_frame = frame.copy()
                    for box in boxes:
                        cv2.rectangle(
                            debug_frame,
                            (box['x'], box['y']),
                            (box['x'] + box['w'], box['y'] + box['h']),
                            (0, 255, 0), 2
                        )
                    cv2.imshow('Motion Debug', debug_frame)
                    if cv2.waitKey(1) & 0xFF == ord('q'):
                        logger.info("Debug window closed.")
                        break

                # Target ~10fps for detection (100ms per frame)
                await asyncio.sleep(0.1)

        except Exception as e:
            logger.error(f"Error in motion loop: {e}")
        finally:
            cap.release()
            if config.DEBUG_WINDOW:
                cv2.destroyAllWindows()

        logger.info(f"Stream ended. Reconnecting in {config.RECONNECT_DELAY_SEC}s...")
        await broadcast({'type': 'status', 'connected': False, 'message': 'Stream interrupted. Reconnecting...'})
        await asyncio.sleep(config.RECONNECT_DELAY_SEC)
        bg_subtractor = build_detector()
        warmup_frames = 30


async def send_push_async(num_boxes: int):
    """Send Web Push notification in a thread pool (non-blocking)."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: push_notifier.notify_all(
        subscriptions_file=config.SUBSCRIPTIONS_FILE,
        title='Motion Detected',
        body=f'Movement detected in {num_boxes} area{"s" if num_boxes != 1 else ""}.',
        icon='/favicon.png',
        vapid_private_key=config.VAPID_PRIVATE_KEY,
        vapid_claims_sub=config.VAPID_CLAIMS_SUB,
    ))


# ---------------------------------------------------------------------------
# Subscription HTTP endpoint (lightweight, no extra framework)
# ---------------------------------------------------------------------------
# The browser POSTs subscription JSON to /motion/subscribe via the Node server.
# The Node server proxies it to the motion WS. No separate HTTP server needed.


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main():
    logger.info(f"Starting Birdcam Motion Detector")
    logger.info(f"WebSocket server on ws://{config.WS_HOST}:{config.WS_PORT}")
    logger.info(f"RTSP source: {config.RTSP_URL}")
    logger.info(f"Min contour area: {config.MIN_CONTOUR_AREA}px²")
    logger.info(f"Notification cooldown: {config.NOTIFICATION_COOLDOWN_SEC}s")

    loop = asyncio.get_event_loop()

    # Start WebSocket server
    ws_server = await serve(ws_handler, config.WS_HOST, config.WS_PORT)
    logger.info(f"WebSocket server listening on ws://{config.WS_HOST}:{config.WS_PORT}")

    # Handle graceful shutdown
    stop_event = asyncio.Event()

    def _signal_handler():
        logger.info("Shutdown signal received.")
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _signal_handler)
        except NotImplementedError:
            pass  # Windows

    # Run motion loop and WS server concurrently
    try:
        await asyncio.gather(
            run_motion_loop(loop),
            stop_event.wait(),
        )
    finally:
        ws_server.close()
        await ws_server.wait_closed()
        logger.info("Motion detector stopped.")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Interrupted.")
        sys.exit(0)
