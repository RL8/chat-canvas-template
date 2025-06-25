FROM node:18-alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm build

# Create health check endpoint
RUN echo '#!/bin/sh\necho "{\\"status\\": \\"healthy\\", \\"timestamp\\": \\"$(date)\\", \\"uptime\\": \\"$(uptime)\\"}" > /tmp/health.json' > /app/health.sh && chmod +x /app/health.sh

# Expose port
EXPOSE 8000

# Add health check script
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]