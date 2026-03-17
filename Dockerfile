FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  python3 make g++ \
  gosu \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN groupadd -r birdcam && useradd -r -g birdcam -d /app birdcam \
  && mkdir -p hls data \
  && chown -R birdcam:birdcam /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
