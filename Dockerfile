# Railway-optimized Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Environment variables
ENV NODE_ENV=production

# Railway automatically sets PORT, but we need to expose it
EXPOSE 3000

# No health check (Railway handles this)
# Start the application and bind to 0.0.0.0
CMD ["node", "src/index.js"]
