#!/bin/sh
set -eu

node /app/migrate.mjs

# YouTube changes often, and an old yt-dlp is refused sooner, so it's updated
# on every start (and every few hours by the ytdlp-update job). A failed update
# isn't fatal; the version already installed is used.
if [ -n "${YTDLP_PIP:-}" ]; then
  "$YTDLP_PIP" install --no-cache-dir --quiet --disable-pip-version-check --upgrade 'yt-dlp[default]' bgutil-ytdlp-pot-provider \
    || echo "Could not update yt-dlp; using $(yt-dlp --version)"
fi

exec "$@"
