// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanName, isOffensive } from '../supabase/functions/_shared/names.js';

const BLOCKED = [
  'fuck', 'FuCk', 'fuk', 'f u c k', 'fvck', 'phuck', 'sh1t', 'shit', 'bitch', 'b1tch', 'asshole', 'cunt', 'dick',
  'pussy', 'nigger', 'n1gger', 'nigga', 'niqqa', 'faggot', 'fag', 'f4ggot', 'spic', 'chink', 'kike', 'coon',
  'wetback', 'gook', 'tranny', 'retard', 'hitler', 'h1tler', 'nazi', 'n4z1', 'kkk', 'whitepower', 'white power',
  'heil', 'rape', 'rapist', 'pedo', 'cum', 'porn', 'slut', 'whore', 'killyourself', 'kys', '1488',
];

const ALLOWED = [
  'Avery', 'Hadley', 'Scunthorpe', 'Dickens', 'Cassandra', 'Bass', 'Hancock', 'Pumpkin', 'Witch', 'Grape',
  'Shitake', 'Assassin', 'Peacock', 'Therapist', 'Nigel', 'Coonan', 'Spicy', 'Cocktail', 'Analise', 'Matsushita',
  'Mike', 'Dan', 'Raccoon', 'Torpedo', 'Japan', 'Heidi', 'Jose', 'Mom 2',
];

for (const name of BLOCKED) test(`blocks ${name}`, () => assert.equal(isOffensive(name), true));
for (const name of ALLOWED) test(`allows ${name}`, () => assert.equal(isOffensive(name), false));

test('tidies names', () => {
  assert.equal(cleanName('  José   M  '), 'Jose M');
  assert.equal(cleanName('Avery'), 'Avery');
});

test('refuses names of the wrong shape or alphabet', () => {
  for (const bad of ['', 'a', 'thirteen chars', '<b>hi</b>', 'fuсk', 'f​uck', '👻👻', 123, null]) {
    assert.equal(cleanName(bad), null);
  }
});
