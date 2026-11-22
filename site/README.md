# KIREA Studio — marketing site

Standalone marketing and download page for KIREA Studio. It is built separately from the Electron renderer and does not import or modify application code.

## Commands

Requires Node 22+ and the repository's installed dependencies.

```bash
npm run dev:site      # local dev server for site/
npm run build:site    # production build to dist-site/
npm run preview:site  # serve the built dist-site/ locally
```

`dist-site/` contains plain static files (`index.html`, hashed CSS/JS, `assets/`). Deploy that directory to any static host. The Vite base is `./`, so the site also works under a subpath.

## Before publishing

The production origin is not known yet, so `site/index.html` intentionally has no `rel="canonical"` or `og:url`. Add both (plus the `twitter:url` equivalent) once the site has a real deployment URL. Also replace the relative `og:image` and `twitter:image` paths with absolute URLs so social crawlers can fetch the preview image.

The repository, release notes, installer, docs, issues, and license links are real verified destinations and should not be replaced with placeholders.

## Product demos and artwork

- `site/assets/shots/` contains real KIREA Studio application screenshots. These are the only images used to demonstrate the product.
- `site/assets/art/` contains original generated artwork for the muse, studios, and section visuals. It is illustrative brand art, never presented as an application screen.
- `site/assets/brand/` contains the existing Kirea mark and favicons.
- `site/assets/fonts/` contains the existing Manrope and Geist Mono faces used by the application.

Screenshots and the release link are pinned to the verified v1.0.1 Windows installer. Update the download URL and displayed version/size only after a new release is published.

## Product tour

The "See KIREA in action" section is a tabbed showcase of six real application screens. The tab labels and explanations live in `site/index.html`; `site/main.js` swaps the screenshot, description and lightbox caption. Screenshot URLs are resolved through Vite's module URL handling so hashed assets work in the production build.

## Motion and accessibility

- Reveals use `IntersectionObserver` and are disabled under `prefers-reduced-motion: reduce`.
- The header, mobile navigation, GPU profile switch, product screenshot tabs, and lightbox use first-party JavaScript only.
- The screenshot tabs use a roving tab index with Arrow, Home, and End key support.
- The lightbox uses a native `<dialog>` with Escape and backdrop dismissal.
- All interactive controls have visible focus styles and accessible names.

## Checks run

```bash
npm run build:site
npm run typecheck
npm test
npm run build
```

The site build writes `dist-site/`; the application build is unchanged.
