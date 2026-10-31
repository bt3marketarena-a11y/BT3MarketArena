FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DISPLAY=:99 \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && \
    npx playwright install --with-deps chromium && \
    apt-get update && \
    apt-get install -y --no-install-recommends xvfb pulseaudio ffmpeg curl && \
    rm -rf /var/lib/apt/lists/*

COPY . .
RUN chmod +x cloud-stream.sh && npm run check

EXPOSE 3000
VOLUME ["/app/artifacts"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:3000/healthz || exit 1

CMD ["./cloud-stream.sh"]
