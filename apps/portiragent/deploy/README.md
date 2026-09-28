# Agent on a VPS

One agent process per wallet. Stop the laptop agent before starting this one: two copies would race on nonces and act twice.

1. Packages (Ubuntu): Node ≥ 22, pnpm (`corepack enable`), Caddy, and as user `portir`:
   `npm i -g @bnbagent/studio-cli @anthropic-ai/claude-code`, then `claude` once to log in (for `PORTIR_BRAIN=claude-cli`).
2. Code: `git clone https://github.com/yeheskieltame/portir /opt/portir && cd /opt/portir && pnpm install`.
3. Secrets, copied from the laptop over SSH, never through git:
   `scp -r apps/portiragent/.studio portir@<vps>:/opt/portir/apps/portiragent/` (keystore, `.env.local`, `b402/`, `telegram-links.json`).
4. Service: copy `portir-agent.service` to `/etc/systemd/system/`, then `systemctl enable --now portir-agent`; logs: `journalctl -u portir-agent -f`.
5. HTTPS: DNS `agent.portir.xyz` A → VPS IP, copy `Caddyfile` to `/etc/caddy/`, `systemctl reload caddy`.
6. App (Vercel): `PORTIR_AGENT_URL` and `NEXT_PUBLIC_AGENT_URL` = `https://agent.portir.xyz`, redeploy.
7. B402: the VPS IP is the one to allowlist.

Check: `curl https://agent.portir.xyz/ping` → `{"status":"HEALTHY"}`.
