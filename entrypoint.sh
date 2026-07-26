#!/bin/sh
# entrypoint.sh
# Downloads yt-dlp at container startup if requested and ensures binary exists

set -e

YTDLP_BIN_PATH="${YTDLP_PATH:-./yt-dlp}"
YTDLP_VER="${YTDLP_VERSION:-}"

download_yt_dlp() {
  if [ -z "$YTDLP_VER" ] || [ "$YTDLP_VER" = "" ]; then
    echo "No YTDLP_VERSION provided; skipping yt-dlp download."
    return
  fi

  # A pinned version never needs to change once downloaded. "latest" is the
  # exception: the binary is baked in at container start and otherwise never
  # updates again, so it silently goes stale (yt-dlp regularly needs updates
  # to keep working against Instagram/TikTok/etc. API changes). Re-fetch it
  # on every start so "latest" actually stays latest.
  if [ "$YTDLP_VER" != "latest" ] && [ -x "$YTDLP_BIN_PATH" ]; then
    echo "yt-dlp already present at $YTDLP_BIN_PATH (pinned version $YTDLP_VER)"
    return
  fi

  if [ "$YTDLP_VER" = "latest" ]; then
    URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    echo "Refreshing yt-dlp to the latest release …"
  else
    URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VER}/yt-dlp"
  fi

  echo "Downloading yt-dlp ($YTDLP_VER) to $YTDLP_BIN_PATH"
  mkdir -p "$(dirname "$YTDLP_BIN_PATH")"
  TMP_PATH="${YTDLP_BIN_PATH}.tmp"
  if command -v wget >/dev/null 2>&1; then
    wget -q -O "$TMP_PATH" "$URL" || {
      echo "Failed to download yt-dlp from $URL"
      rm -f "$TMP_PATH"
      return 1
    }
  elif command -v curl >/dev/null 2>&1; then
    curl -s -L -o "$TMP_PATH" "$URL" || {
      echo "Failed to download yt-dlp from $URL"
      rm -f "$TMP_PATH"
      return 1
    }
  else
    echo "Neither wget nor curl available to download yt-dlp"
    return 1
  fi

  chmod +x "$TMP_PATH"
  mv "$TMP_PATH" "$YTDLP_BIN_PATH"
  echo "yt-dlp downloaded and made executable"
}

# Try downloading if requested
download_yt_dlp || true

# exec the main process (passed as CMD)
exec "$@"
