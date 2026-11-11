import asyncio, json
from playwright.async_api import async_playwright
D = json.load(open('public/data/dex.json')); S = D['species']
BASE = 'http://127.0.0.1:8788'
row = D['days'][7]
def ans(n, mode):
    a = sorted(D['pool'][row[n]]['a'], key=lambda i: -S[i]['f'])
    return S[a[0]]['n'] if mode == 'top' else S[a[int(len(a) * .93)]]['n']
async def run(name, vp, mobile):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append('pageerror ' + str(e)))
        pg.on('console', lambda m: errs.append('console ' + m.text) if m.type == 'error' else None)
        await pg.goto(BASE + '/', wait_until='networkidle'); await pg.wait_for_timeout(700)
        await pg.screenshot(path=f'/tmp/dex-shots/{name}2_home.png'); await pg.screenshot(path=f'/tmp/dex-shots/{name}2_home_full.png', full_page=True)
        await pg.click('#ripBtn'); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'/tmp/dex-shots/{name}2_play1.png')
        for n in range(7):
            await pg.wait_for_selector('#card', timeout=6000)
            if n == 1:
                await pg.fill('#ans', 'Pikachu'); await pg.press('#ans', 'Enter'); await pg.wait_for_timeout(350)
                await pg.screenshot(path=f'/tmp/dex-shots/{name}2_bad.png')
            if n == 5: await pg.click('#passBtn')
            else: await pg.fill('#ans', ans(n, 'top' if n in (0, 3) else 'deep')); await pg.press('#ans', 'Enter')
            await pg.wait_for_timeout(300 if n not in (1, 2) else 160)
            if n == 2: await pg.screenshot(path=f'/tmp/dex-shots/{name}2_charge.png')
            await pg.wait_for_timeout(1300)
            if n in (0, 2): await pg.screenshot(path=f'/tmp/dex-shots/{name}2_pull{n}.png')
            await pg.press('#ans', 'Enter'); await pg.wait_for_timeout(600)
        await pg.wait_for_selector('.results', timeout=8000); await pg.wait_for_timeout(1600)
        await pg.screenshot(path=f'/tmp/dex-shots/{name}2_results.png'); await pg.screenshot(path=f'/tmp/dex-shots/{name}2_results_full.png', full_page=True)
        await pg.click('.rcard[data-k="1"]'); await pg.wait_for_timeout(700)
        await pg.screenshot(path=f'/tmp/dex-shots/{name}2_sheet.png')
        await pg.click('[data-go="2"]'); await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'/tmp/dex-shots/{name}2_sheet2.png')
        await pg.go_back(); await pg.wait_for_timeout(500)
        print(name, 'sheet open after back:', await pg.evaluate("document.getElementById('sheet').open"), 'url', pg.url)
        await pg.click('.prow[data-k="0"]'); await pg.wait_for_timeout(500); await pg.click('[data-close]'); await pg.wait_for_timeout(500)
        print(name, 'sheet open after X:', await pg.evaluate("document.getElementById('sheet').open"), 'url', pg.url)
        for path in ['/', '/boards', '/me', '/packs', '/party', '/faq', '/unlimited', '/archive', '/friends', '/settings']:
            await pg.goto(BASE + path, wait_until='networkidle'); await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'/tmp/dex-shots/{name}2_{path.strip("/") or "home_done"}.png', full_page=path in ('/me', '/faq', '/', '/boards'))
        # unlimited quick run with passes
        await pg.goto(BASE + '/unlimited', wait_until='networkidle'); await pg.click('#ripBtn'); await pg.wait_for_timeout(1300)
        for n in range(7):
            await pg.wait_for_selector('#card', timeout=6000); await pg.click('#passBtn'); await pg.wait_for_timeout(500); await pg.press('#ans', 'Enter'); await pg.wait_for_timeout(500)
        await pg.wait_for_selector('.results', timeout=8000); await pg.wait_for_timeout(900)
        await pg.screenshot(path=f'/tmp/dex-shots/{name}2_unl_results.png')
        print(name, 'errors:', errs[:8])
        await b.close()
async def main():
    await run('m', {'width': 390, 'height': 844}, True)
    await run('d', {'width': 1440, 'height': 900}, False)
asyncio.run(main())
