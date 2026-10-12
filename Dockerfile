# MRA IPD — Next.js standalone image (Node 24 ให้ตรงกับเครื่องพัฒนา และ package-lock.json ต้องสร้างใน Linux: docker run --rm -v "$PWD":/app -w /app node:24-alpine npm install --package-lock-only)
# build: docker compose build   (ต้องต่อ internet ตอน build เพื่อโหลด npm package และฟอนต์ Google)

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
# path ย่อยของเว็บ (ต้องตรงกับ location ใน Nginx) ต้องกำหนดตอน build
ARG BASE_PATH=/mra
ENV NEXT_TELEMETRY_DISABLED=1 BASE_PATH=$BASE_PATH
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Bangkok PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache tzdata && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
