# godpack DEX: notes for Claude

Owner: Cova7155 (godpack.io team). Live at https://dex.godpack.live (the old workers.dev address forwards there from the browser, carrying local progress).
Cloudflare: worker `godpack-dex`, D1 database `godpack-dex`, Durable Object class `Room`, account id `5a9ae2c332b6a6df673aa931dbb5ff1e`, zone `godpack.live`.

## Deploying
- Ask the user for a Cloudflare API token and pass it as `CLOUDFLARE_API_TOKEN` (with `CLOUDFLARE_ACCOUNT_ID`). Never write a token into the repo.
- Deploy from the repo root with `npx wrangler deploy`.
- Database changes: `npx wrangler d1 execute godpack-dex --remote --command "<sql>"`, one statement at a time (the `--file` upload is blocked in the cloud workspace). Add every change to `migrations/` and to `schema.sql`.
- Secrets: `TICKET_SECRET` (required; set with `npx wrangler secret put TICKET_SECRET`), `DISCORD_WEBHOOK_URL` (optional daily recap).

## How it holds up on its own
- Cron `5 * * * *`: hourly challenge cleanup; 03:05 UTC nightly pruning (see README); 14:05 UTC optional Discord recap.
- Plays older than 400 days are pruned. Never compute all-time totals from `plays`; they live on `players` and are updated on every submit and on merges.
- Day ranks come from `tally`; the month board from `monthly`. Any code that adds, removes or moves a counted play must keep both in step (see `mergePlayers`).
- Flagged plays (`flag` 1 = no start ticket, 2 = forged, stale or too fast) count for history and streaks only.
- Passkeys only work on `dex.godpack.live` and `localhost` (`PASSKEY_HOSTS` in `src/worker.js`). For local passkey tests run `wrangler dev` with `--local-upstream localhost:8788`.

## Reviewing pull requests (the SEO tool opens these)
1. Read the diff. SEO changes belong in the `<head>` of `public/index.html`, `public/robots.txt`, `public/sitemap.xml` or new static pages in `public/`.
2. Push back on anything that touches `src/`, `schema.sql` or `public/data/dex.json`, removes the fan-made disclaimer, adds tracking or ads, or adds official Pokémon art.
3. If CSS, JS or data changed, check the `?v=` cache number was bumped everywhere.
4. Anything loading from another site must also be allowed in the Content-Security-Policy in `public/_headers`, or browsers will block it.
5. Run `npx wrangler dev --local --port 8788 --local-upstream localhost:8788` and the tests in `tools/tests/README.md`; expect no errors.
6. Deploy, check the live site, then merge so `main` matches live.
