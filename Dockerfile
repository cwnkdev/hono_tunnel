# Simple Dockerfile without TypeScript build
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source files
COPY . .

# Environment variables
ENV NODE_ENV=production

# Expose port
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:$PORT/health || exit 1

# Start with tsx (no build needed)
CMD ["npx", "tsx", "src/index.ts"]
