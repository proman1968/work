#!/bin/sh
# Графическая сессия компьютера: Xvfb + openbox + x11vnc (только loopback — наружу
# VNC не выходит: у контейнера вообще нет сети, WORK ходит через docker exec).
# PID 1 — sleep, чтобы контейнер жил; сигналы Docker доходят напрямую.
set -e
GEOM="${WORK_GEOM:-1280x800x24}"

Xvfb :99 -screen 0 "$GEOM" -ac +extension RANDR >/tmp/xvfb.log 2>&1 &
sleep 1
DISPLAY=:99 openbox --sm-disable >/tmp/openbox.log 2>&1 &
# панель не ставим специально: чистый стол + Chromium по требованию агента
DISPLAY=:99 x11vnc -display :99 -localhost -forever -shared -nopw -quiet -bg -o /tmp/x11vnc.log
# фон и стартовый терминал — на пустом чёрном столе не сориентироваться
DISPLAY=:99 xsetroot -solid "#3a3f44" 2>/dev/null || true
DISPLAY=:99 xterm -geometry 158x46+4+4 -bg "#1e1e1e" -fg "#d4d4d4" -fa "DejaVu Sans Mono" -fs 10 >/tmp/xterm.log 2>&1 &
# стартовые приложения агента (опционально): Chromium во весь экран
if [ "$WORK_CHROMIUM" = "1" ]; then
  DISPLAY=:99 chromium --no-sandbox --disable-dev-shm-usage --kiosk --no-first-run about:blank >/tmp/chromium.log 2>&1 &
fi
exec sleep infinity
