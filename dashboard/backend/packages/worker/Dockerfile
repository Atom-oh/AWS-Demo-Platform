# syntax=docker/dockerfile:1.7
FROM node:20.16-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/worker/package.json ./packages/worker/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/shared ./packages/shared
COPY packages/worker ./packages/worker
RUN pnpm --filter @demo-platform/shared build && pnpm --filter @demo-platform/worker build

FROM node:20.16-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /app
# Fail-closed: ignore any stray AWS_ENDPOINT_URL at runtime (prod AWS only).
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/worker/package.json ./packages/worker/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/worker/dist ./packages/worker/dist
RUN pnpm install --frozen-lockfile --prod
# Project/account config — CI copies repo-root projects/ + accounts.yaml into
# ./_config (build context) before building. PROJECTS_DIR / ACCOUNTS_FILE in the
# ECS task def point at these (/app/projects, /app/accounts.yaml).
COPY _config/projects /app/projects
COPY _config/accounts.yaml /app/accounts.yaml
USER node
CMD ["node", "packages/worker/dist/index.js"]
