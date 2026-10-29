# Witch's Brew

A drop-and-merge browser game built with a parent and two kids. It has a spooky cauldron theme and a limited "Stir" move.

- Static site with no build step: `index.html`, `style.css`, `ingredients.js` (the tier ladder),
  `sound.js` (Web Audio synth, no sound files), `game.js` (physics, rules, canvas drawing, input).
- Physics: Matter.js 0.20.0 from cdnjs. The game steps it at a fixed 60 Hz and draws everything itself on a canvas
  (Matter's renderer isn't used). The game area is 540×700 units, scaled to fit the screen.
- Art: hand-drawn look via rough.js 4.6.6 (jsdelivr). The cauldron, legs, logs, rim and spoon are sketched once per
  resize onto offscreen canvases (`buildArt`) with fixed seeds, then blitted each frame. Flames are animated
  bezier tongues. Ingredients are "stickers": color glow + ink outline + picture. A second, page-wide `#sky`
  canvas draws stars, the moon, bats and a graveyard silhouette behind everything.
- Ingredient shapes: each picture (emoji or `image:` PNG) is drawn to a canvas, its opaque pixels are
  wrapped in a convex hull, trimmed to 14 corners, and scaled to the area of a circle of radius `r`.
  Hulls are convex on purpose: concave bodies need poly-decomp and get jittery. `?shapes` outlines them.
- Brew displacement: a fixed liquid area; each step the level is solved from the area of ingredients
  below it (polygon clipped at the surface). Submerged things get mild buoyancy and drag. The brew
  reaching the rim is a boil-over, same as an ingredient sitting above it. Tune with `LIQUID_START_Y`.
- Merges are queued from `collisionStart`/`collisionActive` and handled after each engine step. The new
  ingredient starts at the old size and grows so it doesn't blow the pile apart.
- Stir is triggered by clicking the spoon leaning on the cauldron (one use per game, deliberately undiscoverable
  except for an occasional glint). Stir is a force field: a push around the bowl's center plus a slight lift, capped speed, with a
  grace period on the boil-over check. An invisible lid at y=0 keeps things from leaving the screen.
- Sounds: all synthesized in `sound.js`. Only some ingredients name a `sound` voice in `ingredients.js` (bat, rat,
  cat, ghost); it plays when one is dropped or brewed. Other drops are silent by request. Random ambient noises (owl, howl, wind, creak, crow, whisper) every 9-18 s.
- Boil-over is a ~3.8 s scene before the card: brew dome over the rim, goo streams down the pot sides
  (`potSide` follows the outer bezier), puddle spreads and drowns the fire, steam + sizzle.
- After a stir, a drawn black-cat silhouette walks across the ground and meows. The spoon falls back
  when a Skull or better is brewed (`SPOON_RETURN_TIER`).
- `?autoplay` makes the game play itself; `?debug` (or autoplay) exposes `window.brew` test hooks.
- Deployed on GitHub Pages from `main` at the repo root: https://braickish.github.io/witches-brew/
- Ideas for later: the kids' own drawings as ingredient art (`image:` field), recorded sounds,
  a title-screen animation, tuning stir strength and drop odds.
