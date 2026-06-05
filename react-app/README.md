# The Ideal Candidate — React rewrite

A faithful 1:1 React (Vite) port of the original single-file `../index.html`. The
original is **not** modified — this is a self-contained copy living in its own folder.

## Run

```bash
cd react-app
npm install
npm run dev      # → http://localhost:5173
```

`npm run build` produces a static bundle in `dist/`; `npm run preview` serves it.

> The local `.npmrc` pins `os=darwin`/`cpu=arm64` so the correct native Rollup
> binary installs on this Mac (the global `~/.npmrc` sets `os=linux`). Remove or
> adjust it if you install on a different platform.

## How it maps to the original

The page is a fixed **1440×750 stage** scaled to fit the viewport. Hovering a
feature highlights it; clicking plays a shared shatter-dive into that feature's scene.

| Original (in `index.html`)            | React component                          |
| ------------------------------------- | ---------------------------------------- |
| ASCII drifting background script      | `src/components/AsciiBackground.jsx`     |
| David ASCII-dither statue             | `src/components/Statue.jsx`              |
| Title + 3 feature label groups        | `App.jsx` title + `Features.jsx`         |
| Hover zones / click-to-dive           | `HoverZones.jsx` (wired in `App.jsx`)    |
| `brain` IIFE — EYE shatter-dive void  | `BrainOverlay.jsx`                       |
| `brainAscii` IIFE — HEAD brain        | `BrainAsciiOverlay.jsx`                  |
| `audioViz` IIFE — MOUTH wave          | `AudioVizOverlay.jsx`                    |
| Stage fit-to-viewport                 | `hooks/useStageFit.js`                   |

Each scene exposes an imperative `{ open, close, isOpen }` handle (via `ref`);
`App` coordinates them so HEAD/MOUTH dive *through* the EYE shatter transition
exactly like the original `brain.open({ reveal })` flow.

### Dependencies

Three.js **r128** (+ its example modules: EffectComposer, GLTFLoader, DRACOLoader,
RectAreaLightUniformsLib, etc.) and GSAP are loaded globally from CDN in `index.html`
— identical to the original — so the ported scene code references `window.THREE` /
`window.gsap` unchanged. All shaders, dither maths, and animation timings are copied
verbatim.

### Assets

Live in `public/` and are served from the site root, matching the original relative
paths (`Brain.glb`, `david_before.png`, `3DSpaceScreens/…`, `BrainSpaceScreens/…`,
`fonts/…`).
