import asyncio, os
from playwright.async_api import async_playwright
BASE = 'http://localhost:8788'
fails = []
def ok(c, m):
    print(('ok   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'))
        errs = []
        c1 = await b.new_context(viewport={'width': 390, 'height': 844}); h = await c1.new_page()
        c2 = await b.new_context(viewport={'width': 390, 'height': 844}); g = await c2.new_page()
        for pg in (h, g): pg.on('pageerror', lambda e: errs.append(str(e)))
        await h.goto(BASE + '/party', wait_until='networkidle')
        await h.fill('#pn', 'Hosty'); await h.press('#pn', 'Enter')
        await h.wait_for_url('**/party/*', timeout=6000); code = h.url.rsplit('/', 1)[1]
        ok(len(code) == 4, f'room created {code}')
        await g.goto(BASE + '/party/' + code, wait_until='networkidle'); await g.wait_for_timeout(500)
        if await g.locator('#nf').count(): await g.fill('#nf #pn', 'Guesty'); await g.press('#nf #pn', 'Enter')
        await h.wait_for_timeout(1500)
        names = await h.inner_text('#view')
        ok('Hosty' in names and 'Guesty' in names, 'both players in the lobby')
        await h.click('#startBtn'); await h.wait_for_timeout(1500)
        t1, t2 = await h.inner_text('#view'), await g.inner_text('#view')
        ok(('Name a' in t1 or 'Name' in t1) and t1 != names, 'game started for host')
        ok(t2 != '' and 'Guesty' in t2, 'guest sees the game')
        await h.screenshot(path='/tmp/dex-shots/party_host.png'); await g.screenshot(path='/tmp/dex-shots/party_guest.png')
        ok(not errs, f'no page errors {errs[:3]}')
        await b.close()
    print('FAILED: ' + '; '.join(fails) if fails else 'ALL PASSED')
asyncio.run(main())
