# Court card sources

The twelve SVGs here (jack / queen / king × 4 suits) are the **source art** for the
court cards. They are not served — `public/cards/*.webp` is what ships.

## Provenance

All 52 card faces come from the public-domain
[*vector-playing-cards*](http://code.google.com/p/vector-playing-cards/) set. The
files in this directory are the originals, unmodified. The shipped WebP files are
rasterised derivatives of them; the shipped `public/cards/*.svg` pip and ace faces
are the same originals run through SVGO. Nothing has been redrawn or replaced.

## Why the court cards are raster and the rest are not

The set is auto-traced, and the court cards are pathological: a single one reaches
1.1 MB, with ~5,000 coordinate pairs inside one `d` attribute. Twelve of them came
to 7.73 MB against a 49 KB JS bundle.

Lossless optimisation doesn't solve it — the cost is node count, not coordinate
precision, so SVGO tops out around 44% on these. Cards render at most ~340 device
pixels wide, so a 512 px raster is indistinguishable at play size and ~89% smaller.

The pip and ace faces are simple enough that vector already wins: the ace of spades
is 24 KB as SVG but 26 KB as WebP. They stay SVG and just get SVGO'd.

| | before | after |
| --- | --- | --- |
| 12 court cards | 7.73 MB SVG | 0.87 MB WebP (512 px, q0.85) |
| 40 pip + ace cards | 0.48 MB SVG | 0.21 MB SVG (SVGO) |
| **total** | **8.21 MB** | **1.08 MB** |

## Regenerating

```bash
npm run cards:rasterize    # art/cards-src/*.svg -> public/cards/*.webp
npm run cards:optimize     # SVGO over public/cards/*.svg in place
```

Both are one-off; their output is committed and neither runs during `npm run build`.
`WIDTH` and `QUALITY` env vars override the rasterizer's defaults.

Two settings were chosen by measurement and are worth not re-litigating blind:

- **q0.85.** Raising it to 0.95 costs 39% more bytes and improves whole-board
  fidelity by 0.04 percentage points — the residual difference is downscale
  resampling, not compression.
- **SVGO `floatPrecision: 2`,** and **no `removeDimensions`.** These files load as
  `HTMLImageElement`s; stripping width/height makes Chrome infer a 300×150 intrinsic
  size instead of the viewBox ratio, which letterboxes the art inside
  `drawSvgFace`'s `drawImage` call.
