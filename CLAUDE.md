# godpack DEX: notes for Claude

Owner: Cova7155 (godpack.io team). Live at https://godpack-dex.godpack-live-worker.workers.dev
Cloudflare: worker `godpack-dex`, D1 database `godpack-dex`, Durable Object class `Room`, account id `5a9ae2c332b6a6df673aa931dbb5ff1e`.

## Deploying
- Ask the user for a Cloudflare API token and pass it as `CLOUDFLARE_API_TOKEN` (with `CLOUDFLARE_ACCOUNT_ID`). Never write a token into the repo.
- Deploy from the repo root with `npx wrangler deploy`.
- Database changes: `npx wrangler d1 execute godpack-dex --remote --command "<sql>"` (the `--file` upload is blocked in the cloud workspace).

## Reviewing pull requests (the SEO tool opens these)
1. Read the diff. SEO changes belong in the `<head>` of `public/index.html`, `public/robots.txt`, `public/sitemap.xml` or new static pages in `public/`.
2. Push back on anything that touches `src/`, `schema.sql` or `public/data/dex.json`, removes the fan-made disclaimer, adds tracking or ads, or adds official Pokémon art.
3. If CSS, JS or data changed, check the `?v=` cache number was bumped everywhere.
4. Run `npx wrangler dev --port 8788` and `python3 tools/smoke_test.py`; expect no errors.
5. Deploy, check the live site, then merge so `main` matches live.
