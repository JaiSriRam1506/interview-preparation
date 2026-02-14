# Dockerfile
FROM node:18-alpine as backend-builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --only=production
COPY backend/src ./src
COPY backend/.env.production ./.env

FROM node:18-alpine as frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=backend-builder /app ./backend
COPY --from=frontend-builder /app/dist ./frontend/dist

# Install production dependencies
WORKDIR /app/backend
RUN npm install -g pm2

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

EXPOSE 5000
CMD ["pm2-runtime", "src/server.js"]