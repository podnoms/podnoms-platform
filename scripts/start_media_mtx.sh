#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/start_media_mtx.sh [--detach]

Starts MediaMTX in Docker for live broadcasts while developing, using
docker/mediamtx/mediamtx.yml. It asks the dev server (bun run _dev) whether
each stream may publish, and records into MEDIA_DIR as the app expects.

Runs in the foreground (Ctrl-C stops it) unless --detach is given; then stop
it with: docker rm -f podnoms-mediamtx

It uses the host's network, so the app's .env needs:
  LIVE_SECRET=<at least 32 characters>
  LIVE_API_URL=http://localhost:9997
  LIVE_HLS_URL=http://localhost:8888
  LIVE_RTMP_URL=rtmp://localhost/live

Point OBS at rtmp://<this machine>/live with the stream key from the
podcast's Live tab. HLS (8888) and the API (9997) only listen on localhost.

Environment:
  APP_URL  Where the dev server is (default: http://localhost:5173)
  IMAGE    MediaMTX image (default: bluenviron/mediamtx:1)
EOF
}

detach=false
for arg in "$@"; do
  case "$arg" in
    -d|--detach) detach=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
name=podnoms-mediamtx
image="${IMAGE:-bluenviron/mediamtx:1}"
app_url="${APP_URL:-http://localhost:5173}"

# A value from .env, without its quotes; empty if it isn't there.
env_value() {
  [[ -f "$root/.env" ]] || return 0
  # grep fails when the key isn't there, which pipefail would make fatal.
  { grep -E "^$1=" "$root/.env" || true; } | tail -n 1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//"
}

secret="${LIVE_SECRET:-$(env_value LIVE_SECRET)}"
if [[ ${#secret} -lt 32 ]]; then
  echo "Set LIVE_SECRET (at least 32 characters) in .env first, e.g. from: openssl rand -base64 32" >&2
  exit 1
fi

# Recordings go where the app looks for them: MEDIA_DIR/live-recordings.
media_dir="${MEDIA_DIR:-$(env_value MEDIA_DIR)}"
media_dir="${media_dir:-media}"
[[ "$media_dir" = /* ]] || media_dir="$root/$media_dir"
mkdir -p "$media_dir"

# Replace any earlier one, so a changed config or secret takes effect.
docker rm -f "$name" >/dev/null 2>&1 || true

run_args=(
  --name "$name"
  --network host
  # As you, so the app can delete the recordings once they're episodes.
  --user "$(id -u):$(id -g)"
  -v "$root/docker/mediamtx/mediamtx.yml:/mediamtx.yml:ro"
  -v "$media_dir:/app/media"
  -e "MTX_AUTHHTTPADDRESS=$app_url/api/live/auth?token=$secret"
  -e "MTX_APIADDRESS=127.0.0.1:9997"
  -e "MTX_HLSADDRESS=127.0.0.1:8888"
)

echo "Starting $image as $name (RTMP on :1935, asking $app_url)"
if $detach; then
  docker run -d --restart unless-stopped "${run_args[@]}" "$image" >/dev/null
  echo "Running. Logs: docker logs -f $name   Stop: docker rm -f $name"
else
  exec docker run --rm "${run_args[@]}" "$image"
fi
