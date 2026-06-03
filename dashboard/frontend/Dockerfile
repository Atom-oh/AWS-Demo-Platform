# syntax=docker/dockerfile:1.7
# Next.js 14 standalone image for the Stage 3 dashboard. Single-package app
# (NOT a pnpm workspace), so simpler than the backend monorepo Dockerfile.
FROM node:20.16-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are inlined at build time. Prod values are passed as build args
# by the CI (Cognito client id, redirect/logout URIs, AUTH_ENABLED=true).
ARG NEXT_PUBLIC_COGNITO_REGION
ARG NEXT_PUBLIC_COGNITO_DOMAIN
ARG NEXT_PUBLIC_COGNITO_CLIENT_ID
ARG NEXT_PUBLIC_COGNITO_REDIRECT_URI
ARG NEXT_PUBLIC_COGNITO_LOGOUT_URI
ARG NEXT_PUBLIC_AUTH_ENABLED
RUN pnpm build

FROM node:20.16-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Next standalone binds to HOSTNAME; default 'localhost' is unreachable from the
# ALB target health check / CF VPC Origin — must bind all interfaces.
ENV HOSTNAME=0.0.0.0
# Standalone output ships server.js + traced node_modules at the root; static
# assets are NOT bundled into standalone and must be copied alongside.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1
CMD ["node", "server.js"]
