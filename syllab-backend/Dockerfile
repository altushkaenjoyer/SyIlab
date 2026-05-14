FROM node:20-alpine AS base

# Install build tools for bcrypt native module
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --only=production

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source
COPY src ./src
COPY workers ./workers
COPY openapi.yaml ./openapi.yaml

# Non-root user for security
RUN addgroup -S syllab && adduser -S syllab -G syllab
RUN chown -R syllab:syllab /app
USER syllab

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
