# Derived from Agent37's Dots recipe at b9f29f2ea7d4092303b095ce2cc4445059acd828.
# Keep Hermes' managed model, tools, approvals, gateway and stock entrypoint.
FROM ghcr.io/agent37-platform/hermes:2026.10.05a
USER root
RUN apt-get update && apt-get install -y --no-install-recommends x11vnc novnc websockify x11-utils \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/inkbox-ai/hermes-agent-plugin.git /opt/boundless/inkbox \
    && git -C /opt/boundless/inkbox checkout 753a623bee16f0f56299a6465ddf4fd902b6c38b \
    && rm -rf /opt/boundless/inkbox/.git \
    && uv pip install --python /usr/local/lib/hermes/hermes-agent/venv/bin/python \
       'inkbox>=0.7.6,<1.0.0' 'aiohttp>=3.9' 'segno>=1.5'
ENV BROWSER_CDP_URL=http://127.0.0.1:9222
ENV AGENT37_SCREEN_GEOMETRY=540x1140x24
COPY --chmod=0755 desktop-entrypoint.sh /usr/local/bin/desktop-entrypoint.sh
COPY visible-window.mjs /usr/local/bin/visible-window.mjs
USER node
ENTRYPOINT ["/usr/local/bin/desktop-entrypoint.sh"]
