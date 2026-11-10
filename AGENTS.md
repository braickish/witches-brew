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
- Stir is triggered by clicking the spoon leaning on the cauldron (deliberately undiscoverable except for an
  occasional glint). The spoon is used up by a stir and comes back when you brew a Skull or better
  (`SPOON_RETURN_TIER`), including a Skull brewed during the stir itself (`spoonOwed`). Stir is a force field: a push around the bowl's center plus a slight lift, capped speed, with a
  grace period on the boil-over check. An invisible lid at y=0 keeps things from leaving the screen.
- Sounds: all synthesized in `sound.js`. Only some ingredients name a `sound` voice in `ingredients.js` (bat, rat,
  cat, ghost); it plays when one is dropped or brewed. Other drops are silent by request. Random ambient noises (owl, howl, wind, creak, crow, whisper) every 9-18 s.
- Boil-over is a ~3.8 s scene before the card: brew dome over the rim, goo streams down the pot sides
  (`potSide` follows the outer bezier), puddle spreads and drowns the fire, steam + sizzle.
- After a stir, a drawn black-cat silhouette walks across the ground and meows. The spoon falls back
  when a Skull or better is brewed (`SPOON_RETURN_TIER`).
- `?autoplay` makes the game play itself; `?debug` (or autoplay) exposes `window.brew` test hooks.
- Deployed on GitHub Pages from `main` at the repo root: https://braickish.github.io/witches-brew/
- Leaderboard: hosted Supabase project `dcbuizimphwlnajjtsfe` (`witches-brew`), separate from spigots. `leaderboard.js` is the
  browser side; the server is two edge functions (`start-run`, `submit-score`) and one migration. The public key can only read
  visible scores; only the functions can write.
- How scores are protected: the browser never sends a score. It gets a one-time game id and seed, records its drops and merges,
  and `submit-score` replays that list through `supabase/functions/_shared/rules.js` to work out the score, checking the drop
  order and cooldown, that merged ingredients existed, and that enough real time has passed. It does no physics, so a carefully
  forged list that waits out the clock would pass. That was a deliberate choice: the aim is stopping scripts posting a score, not bots.
- `rules.js` is loaded by both the game and the server, so scoring, drop odds and the tier count live there. **Any change to it
  needs `npm run deploy:server` as well as a push**, and games in open tabs fail to submit until they reload.
- Names: `_shared/names.js` (obscenity library plus our own list; the library alone missed many slurs). Add any new
  word to `tests/names.test.mjs` too. To remove an entry, tick `hidden` on its row in the Supabase dashboard (Table Editor → `scores`).
- Tests: `npm test` (rules and names), `npm run test:live` (tries to cheat against the real server; nothing reaches the board).
  Don't commit the database password or secret key. The CLI needs neither for `db push` or deploying once logged in.
- Ideas for later: the kids' own drawings as ingredient art (`image:` field), recorded sounds,
  a title-screen animation, tuning stir strength and drop odds.
