FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src/ ./src/
COPY scripts/build-offline.mjs ./scripts/build-offline.mjs
COPY vendor/solver.global.js ./vendor/solver.global.js
COPY index.html styles.css station-v2.css data.js ship-data.js ./
RUN npm run build

FROM nginx:stable-alpine
COPY --from=build /app/index.html /app/styles.css /app/station-v2.css /app/data.js /app/ship-data.js /app/bundle.js /usr/share/nginx/html/
EXPOSE 80
