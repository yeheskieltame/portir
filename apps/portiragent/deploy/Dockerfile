# The Portir agent. Build context: the repo root (the agent reads packages/core and contracts/deployments).
#   docker compose -f apps/portiragent/deploy/compose.yaml up -d --build
FROM node:22-bookworm-slim
RUN corepack enable && npm i -g @anthropic-ai/claude-code && apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# @portir/core and its dependencies, from the root lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @portir/core
COPY packages/core packages/core
COPY contracts/deployments contracts/deployments

# The agent workspace and its lockfile.
COPY apps/portiragent/package.json apps/portiragent/pnpm-lock.yaml apps/portiragent/pnpm-workspace.yaml apps/portiragent/
COPY apps/portiragent/app/agent/package.json apps/portiragent/app/agent/
RUN cd apps/portiragent && pnpm install --frozen-lockfile
COPY apps/portiragent/app/agent apps/portiragent/app/agent

RUN chown -R node:node /app
USER node
WORKDIR /app/apps/portiragent/app/agent
# Secrets are not in the image: .studio (keystore, env, b402 keys, Telegram links) is mounted at ../../.studio.
ENV NODE_ENV=production AGENT_BIND_HOST=0.0.0.0 CLAUDE_CONFIG_DIR=/claude
EXPOSE 9000
CMD ["./node_modules/.bin/tsx", "src/dualMain.ts"]
