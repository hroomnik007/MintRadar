FROM node:22.23.4-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts
COPY dist/ ./dist/
EXPOSE 3002
USER node
CMD ["node", "dist/index.js"]
