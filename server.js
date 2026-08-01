'use strict';

const path = require('path');
const express = require('express');
const { generatePuzzle } = require('./solver');

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_SIZES = [5, 10, 15, 20];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/generate?size=10
// Generates a brand-new randomized puzzle of the requested size and runs it
// through the solvability checker before ever handing it to a client. Only
// verified-solvable puzzles are returned.
app.get('/api/generate', (req, res) => {
  const size = parseInt(req.query.size, 10);
  if (!ALLOWED_SIZES.includes(size)) {
    return res.status(400).json({ error: `size must be one of ${ALLOWED_SIZES.join(', ')}` });
  }

  const puzzle = generatePuzzle(size);
  if (!puzzle) {
    return res.status(503).json({ error: 'Could not generate a solvable puzzle, please try again.' });
  }

  res.json({
    id: `${size}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    size,
    rowClues: puzzle.rowClues,
    colClues: puzzle.colClues,
    solution: puzzle.grid,
    logicOnly: puzzle.logicOnly,
    lives: size + 1,
  });
});

app.listen(PORT, () => {
  console.log(`Nonogram server running at http://localhost:${PORT}`);
  console.log('On your phone (same wifi network), open http://<this-computer-lan-ip>:' + PORT);
});
