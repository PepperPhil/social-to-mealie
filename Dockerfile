FROM node:lts-slim AS base

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    wget \
    curl \
    unzip \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN node --run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# yt-dlp version (optional at build/runtime)
ARG YTDLP_VERSION=latest
ENV YTDLP_VERSION=${YTDLP_VERSION}
ENV YTDLP_PATH=./yt-dlp

RUN groupadd -g 1001 nodejs && useradd -r -u 1001 -g nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY ./entrypoint.sh /app/entrypoint.sh

RUN chown -R nextjs:nodejs /app

# Download yt-dlp binary (best effort)
RUN if [ -n "$YTDLP_VERSION" ]; then \
    if [ "$YTDLP_VERSION" = "latest" ]; then \
      YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"; \
    else \
      YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"; \
    fi && \
    wget -q -O $YTDLP_PATH "$YTDLP_URL" && chmod +x $YTDLP_PATH || true; \
  fi

RUN if [ -f "$YTDLP_PATH" ]; then \
    chown nextjs:nodejs "$YTDLP_PATH" || true; \
    chmod +x "$YTDLP_PATH" || true; \
  fi

USER nextjs

EXPOSE 3000

# xenova cache dir (für lokale whisper / transformers)
RUN mkdir -p /app/node_modules/@xenova/.cache/ && chmod 777 -R /app/node_modules/@xenova/

ENTRYPOINT ["/bin/sh","/app/entrypoint.sh"]
CMD ["node", "--run", "start"]
