# Agent on a VPS (Docker)

One agent per wallet. Stop the laptop agent before starting this one: two copies would race on nonces and act twice.

1. Docker Engine with the compose plugin on the VPS.
2. Code: `git clone https://github.com/yeheskieltame/portir /opt/portir`.
3. Secrets, copied from the laptop over SSH, never through git or the image:
   `scp -r apps/portiragent/.studio root@<vps>:/opt/portir/apps/portiragent/` (keystore, `.env.local`, `b402/`, `telegram-links.json`),
   then `chown -R 1000:1000 /opt/portir/apps/portiragent/.studio` (the container runs as uid 1000 and writes Telegram links there).
4. Start: `cd /opt/portir && docker compose -f apps/portiragent/deploy/compose.yaml up -d --build`.
   Logs: `docker compose -f apps/portiragent/deploy/compose.yaml logs -f agent`.
5. Brain: the `studio.toml` [llm] model, Groq (`GROQ_API_KEY` in `.studio/.env.local`; `PORTIR_BRAIN=studio` in the compose file overrides the laptop's `claude-cli`).
6. HTTPS: DNS `agent.portir.xyz` A → VPS IP; Caddy in the compose file gets the certificate by itself.
7. App (Vercel): `PORTIR_AGENT_URL` and `NEXT_PUBLIC_AGENT_URL` = `https://agent.portir.xyz`, redeploy.
8. B402: the VPS IP is the one to allowlist.

Update: `git pull && docker compose -f apps/portiragent/deploy/compose.yaml up -d --build`.
Check: `curl https://agent.portir.xyz/ping` → `{"status":"HEALTHY"}`.
