/**
 * Nonogram generation + solvability checking.
 *
 * Approach:
 *  1. Generate a random boolean grid (the "solution").
 *  2. Derive row/column clues from it (standard nonogram run-length clues).
 *  3. Run constraint propagation ("line solving") the same way a human would:
 *     for every row/column, enumerate every placement of blocks that fits the
 *     clue and the length, and intersect them to see which cells must be
 *     filled/empty in every valid placement. Repeat until nothing changes.
 *  4. If propagation alone fully determines the grid, the puzzle is solvable
 *     by pure logic (no guessing) -> accept it.
 *  5. If propagation stalls, fall back to a capped backtracking search to
 *     confirm the clues have a UNIQUE solution (a puzzle with more than one
 *     valid solution is not a fair puzzle). If unique, accept it anyway
 *     (still solvable, just needs a little trial and error). If not unique,
 *     the grid is discarded and a new random grid is tried.
 */

'use strict';

function emptyLineClue() {
  return [0];
}

function getLineClue(line) {
  const clue = [];
  let run = 0;
  for (const cell of line) {
    if (cell) {
      run++;
    } else if (run > 0) {
      clue.push(run);
      run = 0;
    }
  }
  if (run > 0) clue.push(run);
  return clue.length ? clue : emptyLineClue();
}

function randomGridFine(size, density) {
  const grid = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      row.push(Math.random() < density);
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Independent per-cell noise gives every row/column roughly
 * length * density * (1 - density) separate runs on average - fine for a
 * 5x5 or 10x10 board, but for 15/20 that's easily 6-8+ groups per line,
 * which is exactly what made clue lists unreadable (see
 * MAX_GROUPS_PER_LINE below). Generating a coarser grid and upscaling each
 * cell into a block halves the *linear* dimension the runs are computed
 * over, which roughly halves the expected run count for free - a block
 * boundary can only ever extend an existing run, never start a new one.
 */
function randomGrid(size, density) {
  if (size <= 10) {
    return randomGridFine(size, density);
  }

  const block = 2;
  const coarseSize = Math.ceil(size / block);
  const coarse = randomGridFine(coarseSize, density);

  const grid = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      row.push(coarse[Math.floor(r / block)][Math.floor(c / block)]);
    }
    grid.push(row);
  }
  return grid;
}

function getClues(grid) {
  const size = grid.length;
  const rowClues = grid.map(getLineClue);
  const colClues = [];
  for (let c = 0; c < size; c++) {
    const col = [];
    for (let r = 0; r < size; r++) col.push(grid[r][c]);
    colClues.push(getLineClue(col));
  }
  return { rowClues, colClues };
}

/**
 * Enumerate every placement of `clue`'s blocks in a line of `length` cells
 * that is consistent with `known` (an array of true/false/null). Returns an
 * array of full boolean lines. Returns null if a contradiction makes the
 * clue impossible to satisfy (used to detect dead branches during search).
 */
function linePossibilities(clue, known, cap) {
  const length = known.length;
  const blocks = clue.length === 1 && clue[0] === 0 ? [] : clue;
  const results = [];

  // Precompute minimum space each suffix of blocks needs (block + 1 gap each,
  // except no trailing gap needed after the very last block).
  const suffixMin = new Array(blocks.length + 1).fill(0);
  for (let i = blocks.length - 1; i >= 0; i--) {
    suffixMin[i] = suffixMin[i + 1] + blocks[i] + 1;
  }

  function place(blockIndex, pos, current) {
    if (results.length >= cap) return;
    if (blockIndex === blocks.length) {
      const line = current.slice();
      for (let i = pos; i < length; i++) line[i] = false;
      for (let i = 0; i < length; i++) {
        if (known[i] !== null && known[i] !== line[i]) return;
      }
      results.push(line);
      return;
    }
    const blockLen = blocks[blockIndex];
    const remaining = suffixMin[blockIndex + 1]; // space needed after this block
    const maxStart = length - remaining - blockLen;
    for (let start = pos; start <= maxStart; start++) {
      if (results.length >= cap) return;
      const line = current.slice();
      for (let i = pos; i < start; i++) line[i] = false;
      for (let i = start; i < start + blockLen; i++) line[i] = true;
      let gapEnd = start + blockLen;
      const hasTrailingGapCell = blockIndex < blocks.length - 1 && gapEnd < length;
      if (hasTrailingGapCell) {
        line[gapEnd] = false;
        gapEnd++;
      }
      let ok = true;
      for (let i = pos; i < gapEnd && i < length; i++) {
        if (known[i] !== null && known[i] !== line[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      place(blockIndex + 1, gapEnd, line);
    }
  }

  place(0, 0, new Array(length).fill(false));
  return results;
}

/**
 * Intersect all possibilities for a line: true where every possibility
 * agrees the cell is filled, false where every possibility agrees it's
 * empty, null where they disagree (still unknown).
 */
function intersect(possibilities, length) {
  const result = new Array(length).fill(null);
  if (possibilities.length === 0) return null; // contradiction
  for (let i = 0; i < length; i++) {
    let allTrue = true;
    let allFalse = true;
    for (const p of possibilities) {
      if (p[i]) allFalse = false;
      else allTrue = false;
      if (!allTrue && !allFalse) break;
    }
    if (allTrue) result[i] = true;
    else if (allFalse) result[i] = false;
  }
  return result;
}

const LINE_CAP = 20000;

/**
 * Runs constraint propagation on `known` (size x size grid of true/false/null)
 * in place. Returns { changed, contradiction }.
 */
function propagateOnce(size, rowClues, colClues, known) {
  let changed = false;

  for (let r = 0; r < size; r++) {
    const line = known[r];
    const possibilities = linePossibilities(rowClues[r], line, LINE_CAP);
    const deduced = intersect(possibilities, size);
    if (deduced === null) return { changed, contradiction: true };
    for (let c = 0; c < size; c++) {
      if (deduced[c] !== null && known[r][c] === null) {
        known[r][c] = deduced[c];
        changed = true;
      }
    }
  }

  for (let c = 0; c < size; c++) {
    const line = [];
    for (let r = 0; r < size; r++) line.push(known[r][c]);
    const possibilities = linePossibilities(colClues[c], line, LINE_CAP);
    const deduced = intersect(possibilities, size);
    if (deduced === null) return { changed, contradiction: true };
    for (let r = 0; r < size; r++) {
      if (deduced[r] !== null && known[r][c] === null) {
        known[r][c] = deduced[r];
        changed = true;
      }
    }
  }

  return { changed, contradiction: false };
}

function isFull(known) {
  for (const row of known) {
    for (const cell of row) {
      if (cell === null) return false;
    }
  }
  return true;
}

/**
 * Fully propagate until stable. Returns { known, contradiction, solved }.
 */
function propagateToFixpoint(size, rowClues, colClues, known) {
  while (true) {
    const { changed, contradiction } = propagateOnce(size, rowClues, colClues, known);
    if (contradiction) return { contradiction: true, solved: false };
    if (!changed) break;
  }
  return { contradiction: false, solved: isFull(known) };
}

/**
 * Checks whether (rowClues, colClues) describe a puzzle solvable by pure
 * logic/constraint-propagation alone - the same deductions a human solver
 * makes line by line, with no guessing required. This is deliberately
 * stricter than "has at least one solution" (which is trivially true for
 * every generated grid): a puzzle that *needs* guesswork to finish is bad
 * game design (frustrating, and the "lives" penalty would punish an honest
 * guess). Only fully-deducible puzzles are accepted.
 *
 * An earlier version of this checker fell back to an exhaustive backtracking
 * search (counting solutions) whenever propagation stalled, in order to at
 * least accept uniquely-solvable-but-not-purely-logical puzzles. That search
 * is exponential in the worst case and was measured taking 100+ seconds on
 * some 20x20 grids - unacceptable for an interactive "New Game" button. It
 * was removed in favor of simply generating a new random grid instead
 * (see generatePuzzle below), which is dramatically cheaper: propagation
 * itself never blows up (it's just repeated line deductions), so retrying
 * is always fast even when many random grids in a row fail the check.
 */
function checkSolvable(size, rowClues, colClues) {
  const known = Array.from({ length: size }, () => new Array(size).fill(null));
  const result = propagateToFixpoint(size, rowClues, colClues, known);
  const solved = !result.contradiction && result.solved;
  return { solvable: solved, logicOnly: solved };
}

// Fill density per puzzle size. Tuned empirically so that a solvable grid
// (see checkSolvable) is found within a handful of attempts on average,
// while still producing visually varied (not too sparse/blobby) pictures.
const DENSITY_BY_SIZE = {
  5: 0.55,
  10: 0.55,
  15: 0.55,
  20: 0.58,
};

// A row/column clue with too many separate blocks ("groups") is what was
// actually making the clue numbers unreadable - not the grid's separator
// lines - because every extra group is another number stacked into the
// same cramped header cell. Cap how many groups any single line may have.
const MAX_GROUPS_PER_LINE = 4;

function countGroups(clue) {
  return clue.length === 1 && clue[0] === 0 ? 0 : clue.length;
}

/**
 * Generates a random, verified-solvable nonogram puzzle of the given size.
 * Tries multiple random grids (a handful of attempts almost always succeeds)
 * before giving up.
 */
function generatePuzzle(size, maxAttempts = 500) {
  const density = DENSITY_BY_SIZE[size] || 0.5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const grid = randomGrid(size, density);

    // Reject trivial all-empty/all-filled rows or columns - not fun.
    const { rowClues, colClues } = getClues(grid);
    const trivial =
      rowClues.every((c) => c.length === 1 && c[0] === 0) ||
      colClues.every((c) => c.length === 1 && c[0] === 0);
    if (trivial) continue;

    const tooManyGroups =
      rowClues.some((c) => countGroups(c) > MAX_GROUPS_PER_LINE) ||
      colClues.some((c) => countGroups(c) > MAX_GROUPS_PER_LINE);
    if (tooManyGroups) continue;

    const { solvable, logicOnly } = checkSolvable(size, rowClues, colClues);
    if (solvable) {
      return { grid, rowClues, colClues, logicOnly, attempts: attempt + 1 };
    }
  }

  return null;
}

module.exports = {
  getLineClue,
  getClues,
  randomGrid,
  checkSolvable,
  generatePuzzle,
  propagateToFixpoint,
};
