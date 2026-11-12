import asyncio, json, sys
from playwright.async_api import async_playwright
# passkey save on a phone, sign-in and merge on a laptop, sign out and back in (Chrome virtual authenticators)
import os
D = json.load(open('public/data/dex.json')); S = D['species']
BASE = os.environ.get('BASE', 'http://localhost:8788')
OUT = '/tmp/dex-shots/'
os.makedirs(OUT, exist_ok=True)
fails = []
def ok(c, m):
    print(('ok   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

def answers(day):
    row = D['days'][(day - 1) % len(D['days'])]
    out = []
    for n, qi in enumerate(row):
        a = sorted(D['pool'][qi]['a'], key=lambda i: -S[i]['f'])
        out.append(S[a[0]]['n'] if n % 2 == 0 else S[a[int(len(a) * .9)]]['n'])
    return out

async def play_daily(pg, day):
    await pg.click('#ripBtn'); await pg.wait_for_timeout(1500)
    for n, name in enumerate(answers(day)):
        await pg.wait_for_selector('#card', timeout=8000)
        await pg.fill('#ans', name); await pg.press('#ans', 'Enter')
        await pg.wait_for_timeout(1700)
        await pg.press('#ans', 'Enter'); await pg.wait_for_timeout(700)
    await pg.wait_for_selector('.results', timeout=10000); await pg.wait_for_timeout(2200)

async def add_auth(ctx, pg):
    cdp = await ctx.new_cdp_session(pg)
    await cdp.send('WebAuthn.enable', {'enableUI': False})
    r = await cdp.send('WebAuthn.addVirtualAuthenticator', {'options': {'protocol': 'ctap2', 'transport': 'internal', 'hasResidentKey': True, 'hasUserVerification': True, 'isUserVerified': True, 'automaticPresenceSimulation': True}})
    return cdp, r['authenticatorId']

def watch(pg, errs, reqs):
    pg.on('pageerror', lambda e: errs.append('pageerror ' + str(e)))
    pg.on('console', lambda m: errs.append('console ' + m.text) if m.type == 'error' else None)
    pg.on('request', lambda r: reqs.append(r.method + ' ' + r.url.replace(BASE, '')) if '/api/' in r.url else None)
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))

async def ls(pg, k):
    return await pg.evaluate(f"JSON.parse(localStorage.getItem('gpdex:{k}') || 'null')")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'))
        # ---------- phone A: guest plays, then saves with a passkey ----------
        ctxA = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        pa = await ctxA.new_page(); errsA, reqsA = [], []; watch(pa, errsA, reqsA)
        cdpA, authA = await add_auth(ctxA, pa)
        await pa.goto(BASE + '/', wait_until='networkidle'); await pa.wait_for_timeout(600)
        day = await pa.evaluate("fetch('/api/health').then(r=>r.json()).then(j=>j.day)")
        ok(await ls(pa, 'profile') is None and not any('player/new' in r for r in reqsA), 'no player is created just by visiting')
        ok(await pa.is_visible('a.back'), 'fresh device shows "Played before? Sign in"')
        await pa.screenshot(path=OUT + 'm_home_fresh.png')
        await pa.goto(BASE + '/boards', wait_until='networkidle'); await pa.wait_for_timeout(700)
        ok(await ls(pa, 'profile') is None, 'boards work without a player')
        ok(await pa.locator('#scopes button').count() >= 3, 'board scopes drawn from geo')
        await pa.screenshot(path=OUT + 'm_boards_guest.png', full_page=True)
        await pa.goto(BASE + '/me', wait_until='networkidle'); await pa.wait_for_timeout(600)
        ok(await pa.is_visible('[data-signin]') and not await pa.is_visible('[data-save]'), 'fresh My DEX offers sign-in only')
        await pa.screenshot(path=OUT + 'm_me_fresh.png')
        await pa.goto(BASE + '/', wait_until='networkidle')
        await play_daily(pa, day)
        prof = await ls(pa, 'profile'); hist = await ls(pa, 'history')
        ok(prof and prof.get('id') and hist.get(str(day), {}).get('sent') is True, 'first score creates the player and is sent')
        ok(any('/daily/ticket' in r for r in reqsA), 'a start ticket was fetched')
        ranks = await pa.inner_text('#ranks') if await pa.locator('#ranks').count() else ''
        ok('#' in ranks, f'results show ranks: {ranks[:60]!r}')
        ok(await pa.locator('#nameForm').count() == 1 and await pa.locator('.savecard').count() == 0, 'first results: name box, no save nudge yet')
        await pa.screenshot(path=OUT + 'm_results_first.png', full_page=True)
        await pa.fill('#tn', 'Ash'); await pa.press('#tn', 'Enter'); await pa.wait_for_timeout(800)
        # an older day on this device makes the streak worth saving
        await pa.evaluate(f"""(() => {{ const h = JSON.parse(localStorage.getItem('gpdex:history')); h[{day - 1}] = {{ score: 120, t: [0,0,1,-1,0,2,0], p: [-1,-1,-1,-1,-1,-1,-1], at: 0, sent: true }}; localStorage.setItem('gpdex:history', JSON.stringify(h)); }})()""")
        await pa.goto(BASE + f'/daily/{day}', wait_until='networkidle'); await pa.wait_for_timeout(1800)
        ok(await pa.locator('.savecard [data-save]').count() == 1, 'results nudge to save once there is a streak')
        await pa.screenshot(path=OUT + 'm_results_nudge.png', full_page=True)
        await pa.click('.savecard [data-later]'); await pa.wait_for_timeout(300)
        meta = await ls(pa, 'meta')
        ok(meta.get('nudges') == 1 and await pa.locator('.savecard').count() == 0, '"Not now" backs off')
        await pa.goto(BASE + '/me', wait_until='networkidle'); await pa.wait_for_timeout(900)
        ok(await pa.is_visible('[data-save]'), 'My DEX offers save')
        await pa.screenshot(path=OUT + 'm_me_unsaved.png', full_page=True)
        await pa.click('[data-save]'); await pa.wait_for_timeout(2000)
        prof = await ls(pa, 'profile')
        ok(prof.get('passkeys') == 1, f"passkey saved (passkeys={prof.get('passkeys')})")
        ok(await pa.is_visible('.saved'), 'My DEX shows saved state')
        await pa.screenshot(path=OUT + 'm_me_saved.png', full_page=True)
        creds = (await cdpA.send('WebAuthn.getCredentials', {'authenticatorId': authA}))['credentials']
        ok(len(creds) == 1 and creds[0]['isResidentCredential'], 'one discoverable credential on the phone')
        accountId, accountScore = prof['id'], (await ls(pa, 'history'))[str(day)]['score']
        await pa.goto(BASE + '/settings', wait_until='networkidle'); await pa.wait_for_timeout(500)
        await pa.screenshot(path=OUT + 'm_settings_saved.png', full_page=True)

        # ---------- laptop B: guest plays yesterday (via API) and today, then signs in ----------
        ctxB = await b.new_context(viewport={'width': 1280, 'height': 900})
        pb = await ctxB.new_page(); errsB, reqsB = [], []; watch(pb, errsB, reqsB)
        cdpB, authB = await add_auth(ctxB, pb)
        await cdpB.send('WebAuthn.addCredential', {'authenticatorId': authB, 'credential': creds[0]})
        await pb.goto(BASE + '/', wait_until='networkidle'); await pb.wait_for_timeout(500)
        await play_daily(pb, day)
        guest = await ls(pb, 'profile')
        r = await pb.evaluate(f"""fetch('/api/daily/submit', {{ method: 'POST', headers: {{ 'content-type': 'application/json', authorization: 'Bearer {guest['id']}.{guest['key']}' }}, body: JSON.stringify({{ day: {day - 1}, picks: [-1,-1,-1,-1,-1,-1,-1] }}) }}).then(r => r.status)""")
        ok(r == 200, 'guest also has yesterday on the server')
        await pb.goto(BASE + '/me', wait_until='networkidle'); await pb.wait_for_timeout(800)
        await pb.screenshot(path=OUT + 'd_me_guest.png', full_page=True)
        await pb.click('[data-signin]'); await pb.wait_for_timeout(2200)
        prof = await ls(pb, 'profile'); hist = await ls(pb, 'history')
        ok(prof.get('id') == accountId and prof.get('name') == 'Ash', 'laptop is now signed in to the phone’s DEX')
        ok(hist.get(str(day), {}).get('score') == accountScore, 'same-day clash keeps the account’s score')
        ok(str(day - 1) in hist, 'the guest’s other day came along')
        me = await pb.evaluate("""(() => { const p = JSON.parse(localStorage.getItem('gpdex:profile')); return fetch('/api/me', { headers: { authorization: 'Bearer ' + p.id + '.' + p.key } }).then(r => r.json()); })()""")
        ok(me['games'] == 2 and me['total'] == accountScore and me['passkeys'] == 1, f"server totals after merge: games {me['games']} total {me['total']}")
        gone = await pb.evaluate(f"""fetch('/api/me', {{ headers: {{ authorization: 'Bearer {guest['id']}.{guest['key']}' }} }}).then(r => r.status)""")
        ok(gone == 401, 'the guest profile was folded in and removed')
        await pb.screenshot(path=OUT + 'd_me_signed_in.png', full_page=True)
        for period in ['day', 'month', 'all']:
            await pb.goto(BASE + f'/boards?period={period}', wait_until='networkidle'); await pb.wait_for_timeout(900)
            mine = await pb.locator('.board li.me').count()
            ok(mine == 1, f'boards {period}: own row highlighted once ({mine})')
            await pb.screenshot(path=OUT + f'd_boards_{period}.png', full_page=True)
        await pb.goto(BASE + '/boards?scope=friends', wait_until='networkidle'); await pb.wait_for_timeout(700)
        await pb.screenshot(path=OUT + 'd_boards_friends.png', full_page=True)
        await pb.goto(BASE + '/settings', wait_until='networkidle'); await pb.wait_for_timeout(500)
        await pb.click('#signOut'); await pb.wait_for_timeout(1200)
        ok(await ls(pb, 'profile') is None and pb.url.rstrip('/') == BASE, 'sign out clears the device and goes home')
        await pb.goto(BASE + '/me', wait_until='networkidle'); await pb.wait_for_timeout(600)
        await pb.click('[data-signin]'); await pb.wait_for_timeout(2000)
        prof = await ls(pb, 'profile')
        ok(prof and prof.get('id') == accountId and len(await ls(pb, 'history')) == 2, 'sign back in restores history')

        # ---------- phone A after the merge: daily sync brings in the laptop's extra day ----------
        await pa.evaluate("(() => { const m = JSON.parse(localStorage.getItem('gpdex:meta') || '{}'); m.synced = 0; localStorage.setItem('gpdex:meta', JSON.stringify(m)); })()")
        await pa.goto(BASE + '/', wait_until='networkidle'); await pa.wait_for_timeout(1500)
        ok(str(day - 1) in (await ls(pa, 'history')), 'phone picks up the merged day on its daily sync')

        for name, errs in [('A', errsA), ('B', errsB)]:
            bad = [e for e in errs if 'Failed to load resource' not in e]
            ok(not bad, f'{name} console clean: {bad[:4]}')
        await b.close()
    print('FAILED: ' + '; '.join(fails) if fails else 'ALL PASSED')
asyncio.run(main())
