FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci
COPY . .
RUN npm exec --workspace @sdn268/api -- prisma generate --schema prisma/schema.prisma
RUN npm run build --workspace @sdn268/shared && npm run build --workspace @sdn268/api
EXPOSE 4000
CMD ["sh", "-c", "npm run db:migrate --workspace @sdn268/api && npm run start --workspace @sdn268/api"]
