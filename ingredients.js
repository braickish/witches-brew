// The ingredient ladder, smallest to largest.
// Two of the same ingredient touching brew into the next one down the list.
//
// Fields:
//   name   shown when you discover it
//   emoji  drawn on the ingredient (used until you add your own picture)
//   r      radius in game units (the cauldron is 390 wide)
//   color  the blob behind the emoji, also used for sparkles
//   tint   optional color washed over the emoji
//   image  optional picture, e.g. 'assets/spider.png'. A square PNG works best;
//          it is cropped to a circle and replaces the emoji.
//
// Only the first five can be dropped; the rest have to be brewed.
const INGREDIENTS = [
  { name: 'Eye of Newt',     emoji: '👁️', r: 14, color: '#9fd36b' },
  { name: 'Spider',          emoji: '🕷️', r: 18, color: '#b49ce0' },
  { name: 'Bat Wing',        emoji: '🦇', r: 24, color: '#8f7fc0' },
  { name: 'Toadstool',       emoji: '🍄', r: 30, color: '#e8b04a' },
  { name: 'Toad',            emoji: '🐸', r: 37, color: '#4d9e47' },
  { name: 'Bone',            emoji: '🦴', r: 45, color: '#7c6a58' },
  { name: 'Skull',           emoji: '💀', r: 54, color: '#5b4a6e' },
  { name: "Jack-o'-Lantern", emoji: '🎃', r: 63, color: '#3a2a1c' },
  { name: 'Crystal Ball',    emoji: '🔮', r: 73, color: '#2f2550' },
  { name: 'Ghost',           emoji: '👻', r: 84, color: '#6f86b8' },
  { name: 'Blood Moon',      emoji: '🌕', r: 96, color: '#5a0d16', tint: '#d4202c' },
];

// How likely each droppable ingredient is to come up next.
const DROP_WEIGHTS = [30, 25, 20, 15, 10];
