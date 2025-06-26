# Simple Dockerfile for Railway
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY . .

# Environment
ENV NODE_ENV=production

# Expose port
EXPOSE $PORT

# Start app
CMD ["npm", "start"]
