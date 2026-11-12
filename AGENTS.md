# Notes for AI tools working on this repo

- **Open pull requests into `main`. Don't push to `main` directly.** `main` is what's live; every change is reviewed and deployed from a pull request.
- **The site's address is https://dex.godpack.live.** Use it for canonical links, Open Graph URLs and sitemaps.
- **SEO tags** live in the `<head>` of `public/index.html` (title, meta description, canonical link, Open Graph, Twitter card).
- **Static SEO files** such as `robots.txt`, `sitemap.xml` or extra landing pages go in `public/` and are served as-is.
- The site is a **single-page app**. `public/js/app.js` renders every route: `/`, `/unlimited`, `/packs`, `/packs/<id>`, `/archive`, `/party`, `/boards`, `/me`, `/friends`, `/faq`, `/settings`. Any other path falls back to `index.html`. `/api/*` is the backend.
- **Leave alone for SEO work:** `src/` (API), `schema.sql`, and `public/data/dex.json` (generated).
- **Cache numbers:** CSS, JS and data files are cached for a year. If you change `public/css/app.css`, anything in `public/js/`, or `public/data/dex.json`, bump the `?v=` number everywhere it appears (`index.html`, the `core.js` import and `const V` in `app.js`).
- **Security headers:** `public/_headers` sets a Content-Security-Policy that only allows files from this site. A script, font, image or API from another site will be blocked unless it's added there.
- **Brand:** the product is "godpack DEX", made by godpack.io. It's fan-made, so keep the line saying it isn't affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon Company. Don't add official Pokémon artwork or sprites.
- Don't add tracking scripts, ads or third-party embeds without asking.
- Players don't sign up; saving uses passkeys. Don't add email capture or login walls.
