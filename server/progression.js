'use strict';

/** EXP / Level math shared by server and API responses. */

function expForNextLevel(level) {
  return Math.floor(100 + (level - 1) * 55 + Math.pow(level, 2) * 12);
}

/** Returns { level, expIntoLevel, expForNext } for a total EXP amount. */
function levelFromExp(totalExp) {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalExp || 0));
  let need = expForNextLevel(level);
  let guard = 0;
  while (remaining >= need && guard < 500) {
    remaining -= need;
    level += 1;
    need = expForNextLevel(level);
    guard += 1;
  }
  return { level, expIntoLevel: remaining, expForNext: need };
}

module.exports = { expForNextLevel, levelFromExp };
