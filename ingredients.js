// The ingredient ladder, smallest to largest.
// Two of the same ingredient touching brew into the next one down the list.
//
// Fields:
//   name   shown when you discover it
//   emoji  the picture (used until you add your own)
//   r      size in game units (the cauldron is 390 wide). The shape is traced from
//          the picture and scaled so it has about the area of a circle this size.
//   color  the glow around it, also used for sparkles
//   tint   optional color washed over the picture
//   image  optional picture, e.g. 'assets/spider.png'. Use a PNG with a transparent
//          background: its outline becomes the ingredient's shape.
//
// Only the first five can be dropped; the rest have to be brewed.
const INGREDIENTS = [
  { name: 'Eye of Newt',     emoji: '👁️', r: 20, color: '#9fd36b' },
  { name: 'Spider',          emoji: '🕷️', r: 24, color: '#b49ce0' },
  { name: 'Bat Wing',        emoji: '🦇', r: 29, color: '#9b7fe0' },
  { name: 'Toadstool',       emoji: '🍄', r: 34, color: '#ff6b4a' },
  { name: 'Toad',            emoji: '🐸', r: 40, color: '#6fd35f' },
  { name: 'Bone',            emoji: '🦴', r: 46, color: '#e8dcc0' },
  { name: 'Skull',           emoji: '💀', r: 53, color: '#c9c2d9' },
  { name: "Jack-o'-Lantern", emoji: '🎃', r: 60, color: '#ff8a2a' },
  { name: 'Crystal Ball',    emoji: '🔮', r: 68, color: '#b06bff' },
  { name: 'Ghost',           emoji: '👻', r: 76, color: '#cfe0ff' },
  { name: 'Blood Moon',      emoji: '🌕', r: 85, color: '#ff3a3a', tint: '#d4202c' },
];

// How likely each droppable ingredient is to come up next.
const DROP_WEIGHTS = [30, 25, 20, 15, 10];
