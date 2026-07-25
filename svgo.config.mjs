// Optimises the pip/ace card faces in public/cards/. These are simple enough that
// SVG beats a raster (an ace is 24 KB as SVG but 26 KB as WebP), so unlike the court
// cards they stay vector — they just carry Inkscape's editor metadata and far more
// coordinate precision than they need. Cards render at most ~340 device pixels wide
// against a 167-unit viewBox — about 2 px per unit — so two decimal places is still
// ~50x finer than a device pixel, while the sources carry five.
//
// Run via `npm run cards:optimize`. Output is committed; this is not a build step.

export default {
  multipass: true,
  floatPrecision: 2,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          // The faces are drawn at a fixed size into a clipped rect by
          // render.ts's drawSvgFace, which needs the intrinsic ratio to survive.
          removeViewBox: false,
        },
      },
    },
    "sortAttrs",
  ],
};

// Note: `removeDimensions` is deliberately NOT used. These files are loaded as
// HTMLImageElements; without width/height Chrome gives them a 300x150 intrinsic
// size instead of the viewBox ratio, which letterboxes the art inside
// drawSvgFace's drawImage call.
