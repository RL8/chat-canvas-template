FROM node:18-alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package files from agent-js directory
COPY agent-js/package*.json ./

# Install dependencies
RUN npm install

# Copy source code from agent-js directory
COPY agent-js/src ./src
COPY agent-js/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 8000

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Start the application
CMD ["npm", "start"] 