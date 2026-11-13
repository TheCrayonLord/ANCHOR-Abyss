# ANCHOR Abyss

A photo catalog and RAW editor that runs in the browser, works offline, and installs like a desktop or phone app. Everything happens on your device.

## Try the built app

The `anchor-abyss-app.zip` file holds the ready-built app. It must be served over http, because service workers and WebAssembly don't run from `file://`.

```
unzip anchor-abyss-app.zip -d abyss
npx serve abyss        # or: python3 -m http.server -d abyss 8080
```

Open the address it prints in Chrome or Edge, then use the browser's Install button to install it as an app.

## Work on the source

Requires Node 20 or later.

```
npm install
npm run dev            # development server
npm run build          # type check and build into dist/
npm run preview        # serve dist/ on port 4174
```

## Tests

```
node tests/make-fixtures.cjs   # synthetic photos (already included)
node tests/make-dng.cjs        # synthetic RAW file (already included)
npm run build && npm run preview &
node tests/e2e.cjs             # 28 browser checks; screenshots in tests/shots/
```

## Layout

- `src/engine/` holds the editing engine: WebGL 2 shaders and renderer, geometry, masks, spot healing, RAW decoding, auto tone, HDR and panorama merge, XMP, export.
- `src/catalog/` holds the IndexedDB catalog, history, collections and smart rules.
- `src/ui/` holds the Library, Develop, Map, Book, Slideshow, Print and Web modules plus dialogs.
- `public/` holds the icon, the manifest and the offline service worker.

See `PLAN.md` for the feature list compared with Lightroom, including what is missing.
