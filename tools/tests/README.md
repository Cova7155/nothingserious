# Tests

Run everything from the repo root against a local server:

```bash
npx wrangler d1 execute godpack-dex --local --file=schema.sql
npx wrangler dev --local --port 8788 --local-upstream localhost:8788   # localhost so passkeys work
```

| Script | What it checks |
|---|---|
| `python3 tools/smoke_test.py` | A full daily pack, the answer sheet and an Unlimited pack, phone and desktop. |
| `node tools/tests/api_flow.mjs` | Start tickets, flagged runs, totals, names, friends, caching, passkey hosts, rate limits. |
| `python3 tools/tests/passkeys_e2e.py` | Save with a passkey on a phone, sign in on a laptop, guest merge, sign out and back in. |
| `python3 tools/tests/move_e2e.py` | The old workers.dev address forwards to dex.godpack.live with the device's progress. |
| `python3 tools/tests/pack_shots.py` | Screenshots of the pack (phone, small phone, desktop, Unlimited, mid-rip) in `/tmp/dex-shots/pack`. |
| `python3 tools/tests/party_e2e.py` | Two players join a Hot Pack room and start a game. |
| `node tools/tests/gen_bulk.mjs` + `verify_boards.mjs` | 1,300 synthetic players: every board and rank against a brute-force answer. Load `/tmp/dex-bulk.sql` into the local D1 and run part 2 of `migrations/0002_*.sql` between the two. |
