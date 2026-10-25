# syntax=docker/dockerfile:1

FROM oven/bun:1.4.1-alpine AS bun

# What the app needs at runtime. The test stage builds on this too, so tests
# run against the same ffmpeg, ffprobe and libc that ship.
# ffmpeg includes ffprobe. The Python environment includes yt-dlp's YouTube
# challenge solver; use the Node runtime already installed in this image.
FROM node:22-alpine AS runtime-base
RUN apk add --no-cache ca-certificates ffmpeg python3 \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir 'yt-dlp[default]' \
    && printf '%s\n' '--js-runtimes node' > /etc/yt-dlp.conf
ENV PATH="/opt/yt-dlp/bin:${PATH}"

# Bun's musl build needs libstdc++.
FROM node:22-alpine AS source
WORKDIR /app
RUN apk add --no-cache libgcc libstdc++
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Built only by CI (`--target test`); the published image doesn't depend on it.
FROM runtime-base AS test
WORKDIR /app
RUN apk add --no-cache libgcc libstdc++
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=source /app /app
ENV CI=true
RUN ffmpeg -version && ffprobe -version \
    && bun run typecheck \
    && bun run test

FROM source AS build
ENV NITRO_PRESET=node-server
RUN bun run build \
    && bun build docker/migrate.ts --target=node --outfile=/app/migrate.mjs

FROM runtime-base AS runtime
WORKDIR /app
RUN mkdir -p /app/media \
    && chown node:node /app/media

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MEDIA_DIR=/app/media

COPY --from=build /app/.output ./.output
COPY --from=build /app/migrate.mjs ./migrate.mjs
COPY drizzle ./drizzle
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/podnoms-entrypoint

USER node
EXPOSE 3000
ENTRYPOINT ["podnoms-entrypoint"]
CMD ["node", ".output/server/index.mjs"]
