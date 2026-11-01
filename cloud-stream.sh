#!/usr/bin/env bash
set -Eeuo pipefail

: "${STREAM_RTMP_URL:?Configura STREAM_RTMP_URL con la destinazione RTMP e la stream key.}"
PORT="${PORT:-3000}"
LAUNCHER_LOG="${LAUNCHER_LOG:-/tmp/bt3-launcher.log}"
: > "$LAUNCHER_LOG"
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
# Senza scheda audio: Chromium suona nel sink virtuale e FFmpeg ("default") ne cattura il monitor.
for _ in {1..10}; do pactl info >/dev/null 2>&1 && break; sleep 0.5; done
pactl load-module module-null-sink sink_name=bt3 sink_properties=device.description=BT3 >/dev/null 2>&1 || true
pactl set-default-sink bt3 >/dev/null 2>&1 || true
pactl set-default-source bt3.monitor >/dev/null 2>&1 || true
Xvfb :99 -screen 0 1920x1080x24 -noreset -nolisten tcp &
XVFB_PID=$!
for _ in {1..30}; do
  [[ -S /tmp/.X11-unix/X99 ]] && break
  sleep 1
done
[[ -S /tmp/.X11-unix/X99 ]] || { echo "Xvfb non disponibile." >&2; exit 1; }

node scripts/arenaServer.mjs &
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
node launcher.mjs > >(tee -a "$LAUNCHER_LOG") 2>&1 &
LAUNCHER_PID=$!

# Una sola codifica: con la seconda destinazione (es. YouTube + X) tee duplica
# l'output e onfail=ignore evita che la caduta di un provider fermi l'altro.
if [[ -n "${STREAM_RTMP_URL_SECONDARY:-}" ]]; then
  STREAM_OUTPUT="[f=flv:onfail=ignore]${STREAM_RTMP_URL}|[f=flv:onfail=ignore]${STREAM_RTMP_URL_SECONDARY}"
  STREAM_FORMAT=( -flags +global_header -f tee )
else
  STREAM_OUTPUT="$STREAM_RTMP_URL"
  STREAM_FORMAT=( -f flv )
fi

# Dry-run: STREAM_START_DELAY_SEC lascia arrivare il match (con STREAM_WAIT_FOR_FIGHTING=1
# è il tempo massimo e si parte al primo phase=fighting), STREAM_DURATION_SEC registra una
# durata fissa (anche su file) e chiude lo stack con l'esito di FFmpeg.
STREAM_START_DELAY_SEC="${STREAM_START_DELAY_SEC:-0}"
STREAM_DURATION_SEC="${STREAM_DURATION_SEC:-0}"
STREAM_WAIT_FOR_FIGHTING="${STREAM_WAIT_FOR_FIGHTING:-0}"
DURATION_ARGS=()
if (( STREAM_DURATION_SEC > 0 )); then DURATION_ARGS=( -t "$STREAM_DURATION_SEC" ); fi

start_ffmpeg() {
  ffmpeg -hide_banner -loglevel warning -y \
    -f x11grab -framerate 60 -video_size 1920x1080 -i :99.0 \
    -f pulse -i default \
    -map 0:v -map 1:a "${DURATION_ARGS[@]}" \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -b:v 6000k -maxrate 6000k -bufsize 12000k -g 120 -keyint_min 120 -sc_threshold 0 \
    -c:a aac -b:a 160k -ar 44100 \
    "${STREAM_FORMAT[@]}" "$STREAM_OUTPUT" &
  FFMPEG_PID=$!
}

fighting=0
for (( waited = 0; waited < STREAM_START_DELAY_SEC; waited += 1 )); do
  if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then echo "Il launcher BT3 si è arrestato." >&2; exit 1; fi
  if [[ "$STREAM_WAIT_FOR_FIGHTING" == "1" ]] && grep -q "phase=fighting" "$LAUNCHER_LOG" 2>/dev/null; then
    fighting=1; echo "Combattimento rilevato dopo ${waited}s: avvio FFmpeg."; break
  fi
  sleep 1
done
if [[ "$STREAM_WAIT_FOR_FIGHTING" == "1" && "$fighting" != "1" ]]; then
  echo "Combattimento non raggiunto entro ${STREAM_START_DELAY_SEC}s." >&2; exit 1
fi
start_ffmpeg
while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "Il server HTTP si è arrestato." >&2; exit 1; fi
  if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then echo "Il launcher BT3 si è arrestato." >&2; exit 1; fi
  if ! kill -0 "$FFMPEG_PID" 2>/dev/null; then
    if (( STREAM_DURATION_SEC > 0 )); then
      status=0; wait "$FFMPEG_PID" || status=$?
      exit "$status"
    fi
    wait "$FFMPEG_PID" || true
    echo "FFmpeg disconnesso: nuovo tentativo tra 5 secondi." >&2
    sleep 5
    start_ffmpeg
  fi
  sleep 2
done
