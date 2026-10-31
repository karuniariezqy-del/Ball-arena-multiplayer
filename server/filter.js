'use strict';

/** Automatic profanity filter. Every matched word becomes the $#@%$ mask. */
const BLOCKED = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'fuk', 'fck',
  'shit', 'shitty', 'bullshit', 'bitch', 'bitches', 'bastard',
  'asshole', 'dickhead', 'dick', 'pussy', 'cunt', 'whore', 'slut',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded',
  'rape', 'rapist', 'kys', 'porn', 'sex', 'nazi',
];

const PATTERN = new RegExp(`\\b(${BLOCKED.join('|')})\\b`, 'gi');

function filterProfanity(input) {
  return String(input || '').replace(PATTERN, '$#@%$');
}

function containsProfanity(input) {
  PATTERN.lastIndex = 0;
  return PATTERN.test(String(input || ''));
}

module.exports = { filterProfanity, containsProfanity, MASK: '$#@%$' };
