# ANCHOR Abyss: feature inventory against Adobe Lightroom Classic

Abyss is an installable, offline web app (PWA). All decoding, editing and exporting happens on the device, and nothing is uploaded. This inventory follows the modules and panels in Adobe's public Lightroom Classic documentation.

Status key: **Done** works and is covered by the automated browser test or was checked by hand. **Partial** exists but is simpler than Lightroom's version. **Missing** is not built.

## Catalog and import

| Feature | Status | Notes |
|---|---|---|
| Import files and whole folders (picker, drag and drop, OS "open with") | Done | JPEG, PNG, WebP, TIFF, HEIC, and RAW (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2, PEF, SRW and others through LibRaw) |
| Catalog that persists between sessions | Done | Stored in the browser's IndexedDB. Originals are copied into the catalog |
| Catalog backup and restore | Done | Zip file from Preferences |
| Folders panel | Partial | Shows import folders. It can't watch or sync a folder on disk |
| Duplicate detection on import | Done | By name, size and capture time |
| Import presets, renaming and keywords on import | Partial | Keywords and copyright on import. No rename templates on import |
| Tethered capture | Missing | Browsers can't control cameras |

## Library

| Feature | Status | Notes |
|---|---|---|
| Grid, Loupe, Compare, Survey views | Done | |
| Ratings, pick and reject flags, colour labels | Done | Lightroom keyboard shortcuts (0-5, P, X, U, 6-9) |
| Quick Collection, collections, collection sets | Done | |
| Smart collections | Done | Rules on rating, flag, label, keyword, camera, lens, ISO, date, file type, edited state and text |
| Filter bar (text, attribute, metadata) | Done | |
| Keywords and keyword list | Done | Includes keyword counts and filtering |
| Metadata panel (EXIF, title, caption, copyright) | Done | |
| Stacks and virtual copies | Done | |
| Quick Develop | Done | |
| Sort by capture time, name, rating, edit time | Done | |
| Face recognition (People view) | Missing | |
| Write metadata back into original files | Partial | Exported JPEGs carry EXIF and XMP. XMP sidecars export and import for edits |

## Develop

| Feature | Status | Notes |
|---|---|---|
| Profiles (colour, monochrome, artistic, vintage, B&W) | Done | Abyss's own profile looks, not Adobe's camera profiles |
| White balance: presets, eyedropper, auto | Partial | Temp and Tint are relative sliders, not Kelvin values |
| Exposure, Contrast, Highlights, Shadows, Whites, Blacks | Done | GPU, edge-aware local tone |
| Texture, Clarity, Dehaze, Vibrance, Saturation | Done | |
| Auto tone | Done | |
| Tone curve (parametric, point, per-channel) | Done | |
| Colour Mixer (HSL, 8 bands) and B&W mix | Done | Includes targeted adjustment by dragging on the photo |
| Colour Grading (shadows, midtones, highlights, global, blending, balance) | Done | |
| Detail: sharpening with masking, noise reduction | Done | Classic algorithms. No AI Denoise |
| Lens corrections: distortion, vignetting, chromatic aberration, defringe | Partial | Manual and a generic auto estimate from focal length. No lens profile database |
| Transform: vertical, horizontal, rotate, aspect, scale, offset | Done | |
| Upright | Partial | Auto level only. No Vertical, Full or Guided Upright |
| Effects: post-crop vignette, grain | Done | |
| Calibration (shadow tint, RGB primaries) | Done | |
| Crop and straighten (aspect presets, angle, auto straighten, overlays) | Done | |
| Spot removal: heal and clone, visualise spots | Done | |
| Red eye and pet eye | Done | |
| Content-aware or Generative Remove | Missing | |
| Masking: brush, linear gradient, radial gradient | Done | Up to 8 masks per photo, each with add, subtract and intersect |
| Masking: colour range, luminance range | Done | |
| Masking: Select Sky, Select Subject | Partial | Heuristic detection, not AI. Works well on clear skies, weaker on complex scenes |
| Masking: people, objects, background, depth range | Missing | |
| Histogram with drag-to-adjust and clipping warnings | Done | |
| Before and after (split, side by side, hold key) | Done | |
| History, snapshots, undo and redo | Done | |
| Copy, paste, sync settings across photos | Done | With per-group checkboxes |
| Presets: built-in, user, import from XMP and JSON, hover preview | Done | About 22 built-in presets |
| HDR merge | Done | Exposure fusion with alignment. Output is an 8-bit result, not a raw DNG |
| Panorama merge | Partial | Single row, left to right. Optional cylindrical projection. No grid panoramas |
| HDR panorama | Missing | |
| Soft proofing | Missing | |
| Wide-gamut editing and HDR display output | Missing | sRGB pipeline |

## Map, Book, Slideshow, Print, Web

| Feature | Status | Notes |
|---|---|---|
| Map: GPS pins, place photos by dragging, search places | Done | Needs internet for map tiles and search |
| Book: layouts, cover, text pages, PDF export | Partial | Simple layouts. No Blurb upload |
| Slideshow: fade, Ken Burns, music, captions, full screen | Done | No video export |
| Print: single, two up, contact sheet, PDF and printer | Done | No print colour management |
| Web: HTML gallery as a zip | Done | No direct upload |

## Export

| Feature | Status | Notes |
|---|---|---|
| JPEG, PNG, TIFF, WebP | Done | TIFF is 8-bit |
| Resize, output sharpening, quality, watermark | Done | |
| File naming templates | Done | |
| Metadata in exports (EXIF, keywords, title, rating) | Done | |
| Export presets | Done | |
| Export to a folder, a zip, or downloads | Done | Folder export needs Chrome or Edge |
| Publish services (Flickr, Adobe Portfolio and others) | Missing | |
| 16-bit TIFF and DNG export | Missing | |

## Known limits

- Very large images (above roughly 60 megapixels) depend on the device's GPU memory. Editing uses a preview, and export renders in tiles.
- Masks and spot edits are kept in the Abyss catalog and JSON exports, but not written into XMP sidecars.
- There is no cloud sync between devices.
- Speed depends on the browser's WebGL 2 support. Safari works, but Chrome and Edge are fastest.
