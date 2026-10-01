# syntax=docker/dockerfile:1

FROM oven/bun:1.4.1 AS bun

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
ENV NITRO_PRESET=node-server
RUN bun run build \
    && bun build docker/migrate.ts --target=node --outfile=/app/migrate.mjs

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# ffmpeg includes ffprobe. The Python environment includes yt-dlp's YouTube
# challenge solver; use the Node runtime already installed in this image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir 'yt-dlp[default]' \
    && printf '%s\n' '--js-runtimes node' > /etc/yt-dlp.conf \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/media \
    && chown node:node /app/media

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MEDIA_DIR=/app/media \
    PATH="/opt/yt-dlp/bin:${PATH}"

COPY --from=build /app/.output ./.output
COPY --from=build /app/migrate.mjs ./migrate.mjs
COPY drizzle ./drizzle
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/podnoms-entrypoint

USER node
EXPOSE 3000
ENTRYPOINT ["podnoms-entrypoint"]
CMD ["node", ".output/server/index.mjs"]
