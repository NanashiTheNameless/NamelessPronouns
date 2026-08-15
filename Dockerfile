FROM node:26-alpine AS deps
WORKDIR /app
RUN npm install --global corepack@latest && corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable
FROM node:26-alpine AS runtime-base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY LICENSE.md ./
COPY src ./src
COPY scripts ./scripts
COPY views ./views
COPY public ./public
COPY db ./db
COPY config ./config
COPY docs/legal ./docs/legal
FROM runtime-base AS operations
RUN apk add --no-cache postgresql-client
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
FROM runtime-base AS runtime
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
