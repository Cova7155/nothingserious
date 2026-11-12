import asyncio, os, sys
from playwright.async_api import async_playwright
BASE = os.environ.get('BASE', 'http://localhost:8788')
import os
OUT = '/tmp/dex-shots/pack/'
os.makedirs(OUT, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'))
        for name, vp, mob in [('m390', {'width': 390, 'height': 844}, True), ('m360', {'width': 360, 'height': 740}, True), ('d1280', {'width': 1280, 'height': 860}, False)]:
            ctx = await b.new_context(viewport=vp, is_mobile=mob, has_touch=mob, device_scale_factor=3 if mob else 2)
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(BASE + '/', wait_until='networkidle'); await pg.wait_for_timeout(1400)
            await pg.screenshot(path=OUT + f'{name}_home.png')
            el = pg.locator('.pkwrap').first
            await el.screenshot(path=OUT + f'{name}_pack.png')
            if name == 'm390':
                await pg.goto(BASE + '/unlimited', wait_until='networkidle'); await pg.wait_for_timeout(1400)
                await pg.locator('.pkwrap').first.screenshot(path=OUT + f'{name}_unl_pack.png')
                await pg.goto(BASE + '/', wait_until='networkidle'); await pg.wait_for_timeout(300)
                await pg.locator('.pkwrap').first.screenshot(path=OUT + f'{name}_pack_loading.png')
                await pg.wait_for_timeout(1200)
                await pg.click('#ripBtn'); await pg.wait_for_timeout(330)
                await pg.screenshot(path=OUT + f'{name}_rip.png')
            print(name, 'errors', errs)
            await ctx.close()
        await b.close()
asyncio.run(main())
