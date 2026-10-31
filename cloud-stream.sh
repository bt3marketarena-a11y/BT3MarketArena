#!/usr/bin/env bash
set -Eeuo pipefail

: "${STREAM_RTMP_URL:?Configura STREAM_RTMP_URL con la destinazione RTMP e la stream key.}"
PORT="${PORT:-3000}"
export DISPLAY=:99
export PORT

SERVER_PID=""
LAUNCHER_PID=""
XVFB_PID=""
FFMPEG_PID=""

cleanup() {
  trap - EXIT INT TERM
  for pid in "$FFMPEG_PID" "$LAUNCHER_PID" "$SERVER_PID" "$XVFB_PID"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

pulseaudio --daemonize=yes --exit-idle-time=-1
Xvfb :99 -screen 0 1920x1080x24 -noreset -nolisten tcp &
XVFB_PID=$!
for _ in {1..30}; do
  [[ -S /tmp/.X11-unix/X99 ]] && break
  sleep 1
done
[[ -S /tmp/.X11-unix/X99 ]] || { echo "Xvfb non disponibile." >&2; exit 1; }

node server.mjs &
SERVER_PID=$!
for _ in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:${PORT}/healthz" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "http://127.0.0.1:${PORT}/healthz" >/dev/null

# inject=0 evita il secondo bootstrap del proxy: il launcher possiede menu e monitor.
BT3_CLOUD_SYNC=1 \
BT3_CLOUD_BASE_URL= \
BT3_TARGET_URL="http://127.0.0.1:${PORT}/runtime.html?hud=0&embedded=0&lang=it&env=BT3_SCALE%3D1%2CBT3_INTERP%3D0&inject=0" \
node launcher.mjs &
LAUNCHER_PID=$!

start_ffmpeg() {
  ffmpeg -hide_banner -loglevel warning \
    -f x11grab -framerate 60 -video_size 1920x1080 -i :99.0 \
    -f pulse -i default \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -b:v 6000k -maxrate 6000k -bufsize 12000k -g 120 -keyint_min 120 -sc_threshold 0 \
    -c:a aac -b:a 160k -ar 44100 \
    -f flv "$STREAM_RTMP_URL" &
  FFMPEG_PID=$!
}

start_ffmpeg
while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "Il server HTTP si è arrestato." >&2; exit 1; fi
  if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then echo "Il launcher BT3 si è arrestato." >&2; exit 1; fi
  if ! kill -0 "$FFMPEG_PID" 2>/dev/null; then
    wait "$FFMPEG_PID" || true
    echo "FFmpeg disconnesso: nuovo tentativo tra 5 secondi." >&2
    sleep 5
    start_ffmpeg
  fi
  sleep 2
done
