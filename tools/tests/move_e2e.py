# old addresses (workers.dev, dex.godpack.live) -> pokerarity.com, carrying the device's progress along
import asyncio, os
from playwright.async_api import async_playwright
LOCAL = 'http://localhost:8788'
OLD = 'http://godpack-dex.godpack-live-worker.workers.dev'
fails = []
def ok(c, m):
    print(('ok   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--host-resolver-rules=MAP godpack-dex.godpack-live-worker.workers.dev 127.0.0.1:8788, MAP dex.godpack.live 127.0.0.1:8788'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        # the new address is served by the local dev server
        async def proxy(route):
            url = route.request.url.replace('https://pokerarity.com', LOCAL)
            resp = await route.fetch(url=url)
            await route.fulfill(response=resp)
        await ctx.route('https://pokerarity.com/**', proxy)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        # make a real guest on the server first, then seed the old address's storage with it
        prof = await (await ctx.request.post(LOCAL + '/api/player/new', data='{}', headers={'cf-connecting-ip': '10.77.0.1'})).json()
        await ctx.add_init_script(script=f"""
          if (location.hostname.endsWith('.workers.dev') && !localStorage.getItem('gpdex:profile')) {{
            localStorage.setItem('gpdex:profile', JSON.stringify({{ id: '{prof['id']}', key: '{prof['key']}', code: '{prof['code']}' }}));
            localStorage.setItem('gpdex:history', JSON.stringify({{ 8: {{ score: 75, t: [0,1,0,-1,0,0,0], p: [-1,-1,-1,-1,-1,-1,-1], at: 1, sent: false }} }}));
            localStorage.setItem('gpdex:extra', JSON.stringify({{ unlimited: {{ best: 222, played: 3 }}, packs: {{ fire: 300 }}, archive: {{ 3: 150 }} }}));
            localStorage.setItem('gpdex:settings', JSON.stringify({{ sound: false, haptics: true }}));
          }}""")
        await pg.goto(OLD + '/boards?scope=country')
        await pg.wait_for_url('https://pokerarity.com/**', timeout=8000)
        await pg.wait_for_timeout(2500)
        ok(pg.url == 'https://pokerarity.com/boards?scope=country', f'moved to the new address on the same page, hash removed: {pg.url}')
        st = await pg.evaluate("({ p: JSON.parse(localStorage.getItem('gpdex:profile')), h: JSON.parse(localStorage.getItem('gpdex:history')), x: JSON.parse(localStorage.getItem('gpdex:extra')), s: JSON.parse(localStorage.getItem('gpdex:settings')) })")
        ok(st['p'] and st['p']['id'] == prof['id'], 'profile came along')
        ok(st['h'].get('8', {}).get('sent') is True, f"unsent score came along and was sent: {st['h'].get('8')}")
        ok(st['x']['unlimited']['best'] == 222 and st['x']['packs'].get('fire') == 300 and st['x']['archive'].get('3') == 150, 'unlimited, packs and archive came along')
        ok(st['s']['sound'] is False, 'settings came along')
        ok(st['p'].get('code') == prof['code'] and st['p'].get('country') == 'US', 'profile refreshed from the server')
        # a second visit to the old address with nothing stored just redirects
        ctx2 = await b.new_context(); await ctx2.route('https://pokerarity.com/**', proxy)
        pg2 = await ctx2.new_page()
        await pg2.goto(OLD + '/faq'); await pg2.wait_for_url('https://pokerarity.com/**', timeout=8000)
        ok(pg2.url == 'https://pokerarity.com/faq', f'empty device: plain redirect {pg2.url}')
        pg3 = await ctx2.new_page()
        await pg3.goto('http://dex.godpack.live/boards'); await pg3.wait_for_url('https://pokerarity.com/**', timeout=8000)
        ok(pg3.url == 'https://pokerarity.com/boards', f'dex.godpack.live forwards too: {pg3.url}')
        ok(not errs, f'no page errors {errs[:3]}')
        await b.close()
    print('FAILED: ' + '; '.join(fails) if fails else 'ALL PASSED')
asyncio.run(main())
