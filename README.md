# Witch's Brew

A spooky drop-and-merge game. Drop ingredients into the cauldron; when two of the same touch,
they brew into the next, bigger ingredient. Don't let the brew rise over the rim.

**Play:** https://braickish.github.io/witches-brew/

## How to play

- Move to aim, tap or click to drop. Keyboard: ← → to aim, Space to drop.
- **Stir** (🥄 button or S) swirls everything in the cauldron. You get 3; brewing a 💀 or bigger earns one back.
- Quick merges in a row are combos and score extra.
- Anything that sits above the dashed rim line for too long boils the brew over.

## The ingredient ladder

👁️ Eye of Newt → 🕷️ Spider → 🦇 Bat Wing → 🍄 Toadstool → 🐸 Toad → 🦴 Bone → 💀 Skull →
🎃 Jack-o'-Lantern → 🔮 Crystal Ball → 👻 Ghost → 🌕 Blood Moon

Two Blood Moons complete the potion for a big bonus.

## Make it yours

Everything about the ingredients lives in [`ingredients.js`](ingredients.js): names, emoji, sizes and colors.

To use your own drawings, put a square PNG in `assets/` (e.g. `assets/spider.png`) and add
`image: 'assets/spider.png'` to that ingredient. It's cropped to a circle and replaces the emoji.

## Running locally

It's a static site with no build step:

```sh
python3 -m http.server 8765
# open http://localhost:8765/   (add ?autoplay to watch it play itself)
```
