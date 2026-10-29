# Witch's Brew

A drop-and-merge browser game built with a parent and two kids. It has a spooky cauldron theme and a limited "Stir" move.

- Static site with no build step: `index.html`, `style.css`, `ingredients.js` (the tier ladder),
  `sound.js` (Web Audio synth, no sound files), `game.js` (physics, rules, canvas drawing, input).
- Physics: Matter.js 0.20.0 from cdnjs. The game steps it at a fixed 60 Hz and draws everything itself on a canvas
  (Matter's renderer isn't used). The game area is 480×700 units, scaled to fit the screen.
- Ingredient shapes: each picture (emoji or `image:` PNG) is drawn to a canvas, its opaque pixels are
  wrapped in a convex hull, trimmed to 14 corners, and scaled to the area of a circle of radius `r`.
  Hulls are convex on purpose: concave bodies need poly-decomp and get jittery. `?shapes` outlines them.
- Brew displacement: a fixed liquid area; each step the level is solved from the area of ingredients
  below it (polygon clipped at the surface). Submerged things get mild buoyancy and drag. The brew
  reaching the rim is a boil-over, same as an ingredient sitting above it. Tune with `LIQUID_START_Y`.
- Merges are queued from `collisionStart`/`collisionActive` and handled after each engine step. The new
  ingredient starts at the old size and grows so it doesn't blow the pile apart.
- Stir is a force field: a push around the bowl's center plus a slight lift, capped speed, with a
  grace period on the boil-over check. An invisible lid at y=0 keeps things from leaving the screen.
- `?autoplay` makes the game play itself, which is useful for testing.
- Deployed on GitHub Pages from `main` at the repo root: https://braickish.github.io/witches-brew/
- Ideas for later: the kids' own drawings as ingredient art (`image:` field), recorded sounds,
  a title-screen animation, tuning stir strength and drop odds.
