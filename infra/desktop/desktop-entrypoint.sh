#!/bin/bash
set -euo pipefail
PROFILE_DIR="${HOME}/.config/desktop-chromium"
respawn() {
  local log="$1"; shift
  while true; do "$@" >"${log}" 2>&1 || true; sleep 2; done
}
run_chromium() {
  rm -f "${PROFILE_DIR}"/Singleton{Lock,Socket,Cookie}
  /usr/bin/chromium --no-sandbox --test-type --disable-dev-shm-usage \
    --no-first-run --no-default-browser-check --hide-crash-restore-bubble \
    --remote-debugging-port=9222 --user-data-dir="${PROFILE_DIR}" \
    --start-maximized about:blank &
  local browser_pid=$!
  node /usr/local/bin/visible-window.mjs >/tmp/visible-window.log 2>&1 || true
  wait "$browser_pid"
}
start_desktop_view() {
  (
    export DISPLAY=:99
    until /usr/bin/xdpyinfo >/dev/null 2>&1; do sleep 1; done
    respawn /tmp/x11vnc.log /usr/bin/x11vnc -display :99 -rfbport 5900 -localhost -forever -shared -nopw -quiet &
    respawn /tmp/novnc.log /usr/bin/websockify --web /usr/share/novnc 6901 localhost:5900 &
    respawn /tmp/chromium.log run_chromium &
    wait
  ) &
}
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
start_desktop_view
exec /usr/local/bin/entrypoint.sh "$@"
