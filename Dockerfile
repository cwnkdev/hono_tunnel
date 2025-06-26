# Simple Dockerfile for Railway deployment
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript (if needed)
RUN npm run build

# Environment variables
ENV NODE_ENV=production

# Expose port (Railway will set PORT automatically)
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:$PORT/health || exit 1

# Start the application
CMD ["npm", "start"]
