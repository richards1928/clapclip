# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy lockfiles and install dependencies
COPY package*.json ./
RUN npm ci

# Copy codebase and compile production bundle
COPY . .
RUN npm run build

# Stage 2: Runtime Environment
FROM node:20-alpine AS runner

# Install system utilities: ffmpeg, python3 (for yt-dlp script runner), and curl (for healthcheck)
RUN apk add --no-cache ffmpeg python3 curl nodejs npm

WORKDIR /app

ENV NODE_ENV=production

# Pre-create folders, database directory, and set permissions for non-privileged node user
RUN mkdir -p backups logs temp bin database && \
    chown -R node:node /app

# Create symlink for clipper.db to allow persistent named volume mounting
RUN ln -s /app/database/clipper.db /app/clipper.db && \
    chown -h node:node /app/clipper.db

# Switch to non-root execution
USER node

# Copy dependencies and compiled distribution assets
COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node . .

# Download platform-specific yt-dlp binary during build (ensures no runtime fetch is needed)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/bin/yt-dlp && \
    chmod +x /app/bin/yt-dlp

EXPOSE 5173

# Docker healthcheck configuration
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:5173/api/health || exit 1

# Start server binding globally to allow external routing
CMD ["npx", "vite", "--host", "0.0.0.0"]
