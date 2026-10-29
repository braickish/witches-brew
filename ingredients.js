// The ingredient ladder, smallest to largest.
// Two of the same ingredient touching brew into the next one down the list.
//
// Fields:
//   name     shown when you discover it
//   emoji    the picture (used until you add your own)
//   fallback a simpler emoji for devices that can't show the first one
//   r        size in game units (the cauldron is 390 wide). The shape is traced from
//            the picture and scaled so it has about the area of a circle this size.
//   color    the glow around it, also used for sparkles
//   tint     optional color washed over the picture
//   sound    what it sounds like when dropped (or brewed, for the big ones): squelch, wriggle,
//            scurry, screech, poof, squeak, hiss, rattle, meow, wooo, gong (see sound.js)
//   image    optional picture, e.g. 'assets/spider.png'. Use a PNG with a transparent
//            background: its outline becomes the ingredient's shape.
//
// Only the first five can be dropped; the rest have to be brewed.
const INGREDIENTS = [
  { name: 'Eye of Newt', emoji: '👁️', r: 20, color: '#9fd36b', sound: 'squelch' },
  { name: 'Worm',        emoji: '🪱', r: 24, color: '#ff8fa3', sound: 'wriggle' },
  { name: 'Spider',      emoji: '🕷️', r: 29, color: '#b49ce0', sound: 'scurry' },
  { name: 'Bat',         emoji: '🦇', r: 34, color: '#9b7fe0', sound: 'screech' },
  { name: 'Toadstool',   emoji: '🍄', r: 40, color: '#ff6b4a', sound: 'poof' },
  { name: 'Rat',         emoji: '🐀', r: 46, color: '#d9c3a5', sound: 'squeak' },
  { name: 'Snake',       emoji: '🐍', r: 53, color: '#7ddc5a', sound: 'hiss' },
  { name: 'Skull',       emoji: '💀', r: 60, color: '#c9c2d9', sound: 'rattle' },
  { name: 'Black Cat',   emoji: '🐈‍⬛', fallback: '🐈', r: 68, color: '#a070ff', tint: '#1a1024', sound: 'meow' },
  { name: 'Ghost',       emoji: '👻', r: 76, color: '#cfe0ff', sound: 'wooo' },
  { name: 'Blood Moon',  emoji: '🌕', r: 85, color: '#ff3a3a', tint: '#d4202c', sound: 'gong' },
];

// How likely each droppable ingredient is to come up next.
const DROP_WEIGHTS = [30, 25, 20, 15, 10];
