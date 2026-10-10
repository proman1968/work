# Графический компьютер агента: рабочий стол 1280×800, VNC только на loopback,
# Chromium, xdotool/scrot для управления из WORK через docker exec.
# Сборка (нужен Docker): docker build -t work-computer:latest .
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    WORK_PC=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        xvfb openbox obconf x11vnc socat \
        x11-xserver-utils xterm \
        chromium chromium-driver \
        xdotool scrot imagemagick \
        git curl ca-certificates \
        fonts-noto-core \
        procps net-tools \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 -s /bin/bash agent \
    && mkdir -p /workspace /opt/work \
    && chown agent:agent /workspace /opt/work

COPY entrypoint.sh /opt/work/entrypoint.sh
COPY cdp.py /opt/work/cdp.py
RUN chmod +x /opt/work/entrypoint.sh

USER agent
WORKDIR /workspace
EXPOSE 5900

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD pgrep Xvfb >/dev/null && DISPLAY=:99 xdotool getdisplaygeometry 2>/dev/null | grep -q 1280 || exit 1

ENTRYPOINT ["/opt/work/entrypoint.sh"]
