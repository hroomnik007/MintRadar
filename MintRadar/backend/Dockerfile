FROM node:22.23.4-alpine
WORKDIR /app
COPY package*.json ./
# No --omit=optional: sharp's prebuilt libvips binaries (@img/sharp-linuxmusl-x64 + @img/sharp-libvips-linuxmusl-x64)
# are optional dependencies. typescript (an optional peer of nostr-tools, 24 MB) is removed by hand instead.
RUN npm ci --omit=dev --ignore-scripts && rm -rf node_modules/typescript
COPY dist/ ./dist/
EXPOSE 3002
USER node
CMD ["node", "dist/index.js"]
