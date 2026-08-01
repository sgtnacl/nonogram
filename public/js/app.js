'use strict';

(function () {
  const SAVE_KEY = 'nonogram-save-v1';
  const LAST_SIZE_KEY = 'nonogram-last-size';
  // Thick divider lines are drawn every SECTION_SIZE rows/columns to help
  // eyeball position on larger boards (like a sudoku box grid).
  const SECTION_SIZE = 4;

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let puzzle = null; // { id, size, rowClues, colClues, solution, lives, logicOnly }
  let board = null; // size x size array of 'empty' | 'fill' | 'x' | 'ghost'
  let mistakeGrid = null; // size x size array of bool - true where the 'x' was caused by a wrong Fill guess (rendered red instead of grey)
  let livesRemaining = 0;
  let currentTool = 'fill';
  let gameActive = false;

  // drag-paint stroke tracking
  let stroke = null; // { action: 'set'|'erase', tool, visited: Set }

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const screenHome = document.getElementById('screen-home');
  const screenGame = document.getElementById('screen-game');
  const sizeSelect = document.getElementById('size-select');
  const btnNewGame = document.getElementById('btn-new-game');
  const btnLoadGame = document.getElementById('btn-load-game');
  const homeStatus = document.getElementById('home-status');

  const btnHome = document.getElementById('btn-home');
  const btnSave = document.getElementById('btn-save');
  const livesDisplay = document.getElementById('lives-display');
  const boardWrapper = document.getElementById('board-wrapper');
  const boardGrid = document.getElementById('board-grid');

  const toolButtons = Array.from(document.querySelectorAll('.tool-btn'));

  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalActions = document.getElementById('modal-actions');

  const loadingOverlay = document.getElementById('loading-overlay');

  // ---------------------------------------------------------------------
  // Screen management
  // ---------------------------------------------------------------------
  function showScreen(name) {
    const home = name === 'home';
    screenHome.classList.toggle('hidden', !home);
    screenGame.classList.toggle('hidden', home);
    screenHome.setAttribute('aria-hidden', String(home === false));
    screenGame.setAttribute('aria-hidden', String(home === true));
  }

  function setLoading(isLoading) {
    loadingOverlay.classList.toggle('hidden', !isLoading);
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    modalActions.innerHTML = '';
  }

  function showModal(title, body, actions) {
    modalTitle.textContent = title;
    modalBody.textContent = body;
    modalActions.innerHTML = '';
    actions.forEach(({ label, kind, onClick }) => {
      const btn = document.createElement('button');
      btn.className = `btn btn-block ${kind === 'primary' ? 'btn-primary' : kind === 'danger' ? 'btn-danger' : 'btn-secondary'}`;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        closeModal();
        onClick && onClick();
      });
      modalActions.appendChild(btn);
    });
    modalOverlay.classList.remove('hidden');
  }

  // ---------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------
  async function fetchPuzzle(size) {
    const res = await fetch(`/api/generate?size=${size}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error (${res.status})`);
    }
    return res.json();
  }

  // ---------------------------------------------------------------------
  // Game setup
  // ---------------------------------------------------------------------
  function makeBlankBoard(size) {
    return Array.from({ length: size }, () => new Array(size).fill('empty'));
  }

  function makeMistakeGrid(size) {
    return Array.from({ length: size }, () => new Array(size).fill(false));
  }

  async function startNewGame(size) {
    setLoading(true);
    homeStatus.textContent = '';
    try {
      const data = await fetchPuzzle(size);
      puzzle = data;
      board = makeBlankBoard(size);
      mistakeGrid = makeMistakeGrid(size);
      livesRemaining = data.lives;
      localStorage.setItem(LAST_SIZE_KEY, String(size));
      enterGameScreen();
    } catch (err) {
      homeStatus.textContent = `Couldn't generate a puzzle: ${err.message}`;
    } finally {
      setLoading(false);
    }
  }

  function enterGameScreen() {
    gameActive = true;
    // Show the screen first - renderBoard() measures #board-wrapper's
    // actual pixel size to compute cell size, which reads as 0 while the
    // screen is still `display:none`.
    showScreen('game');
    renderBoard();
    updateLivesDisplay();
  }

  function restartCurrentPuzzle() {
    if (!puzzle) return;
    board = makeBlankBoard(puzzle.size);
    mistakeGrid = makeMistakeGrid(puzzle.size);
    livesRemaining = puzzle.lives;
    gameActive = true;
    renderBoard();
    updateLivesDisplay();
  }

  // ---------------------------------------------------------------------
  // Save / Load
  // ---------------------------------------------------------------------
  function saveGame() {
    if (!puzzle) return;
    const payload = { puzzle, board, mistakeGrid, livesRemaining };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      flashStatusOnGame('Puzzle saved.');
    } catch (err) {
      flashStatusOnGame('Could not save (storage full?).');
    }
  }

  function loadGame() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      homeStatus.textContent = 'No saved puzzle found.';
      return;
    }
    try {
      const payload = JSON.parse(raw);
      puzzle = payload.puzzle;
      board = payload.board;
      mistakeGrid = payload.mistakeGrid || makeMistakeGrid(puzzle.size);
      livesRemaining = payload.livesRemaining;
      gameActive = livesRemaining > 0;
      enterGameScreen();
    } catch (err) {
      homeStatus.textContent = 'Saved puzzle was corrupted and could not be loaded.';
    }
  }

  function flashStatusOnGame(message) {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.position = 'fixed';
    el.style.bottom = '90px';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
    el.style.background = 'rgba(0,0,0,0.8)';
    el.style.color = '#fff';
    el.style.padding = '8px 16px';
    el.style.borderRadius = '999px';
    el.style.fontSize = '0.85rem';
    el.style.zIndex = '80';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function renderBoard() {
    const size = puzzle.size;
    const maxRowClueCount = Math.max(...puzzle.rowClues.map((c) => c.length));
    const maxColClueCount = Math.max(...puzzle.colClues.map((c) => c.length));

    boardGrid.innerHTML = '';
    boardGrid.style.gridTemplateColumns = `var(--clue-w) repeat(${size}, var(--cell))`;
    boardGrid.style.gridTemplateRows = `var(--clue-h) repeat(${size}, var(--cell))`;

    // corner
    const corner = document.createElement('div');
    corner.className = 'clue-cell clue-corner';
    boardGrid.appendChild(corner);

    // column clues
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('div');
      cell.className = 'clue-cell clue-col';
      if ((c + 1) % SECTION_SIZE === 0 && c !== size - 1) cell.classList.add('sep-right');
      puzzle.colClues[c].forEach((n) => {
        const span = document.createElement('span');
        span.textContent = n === 0 ? '' : String(n);
        cell.appendChild(span);
      });
      boardGrid.appendChild(cell);
    }

    // rows
    for (let r = 0; r < size; r++) {
      const rowClueCell = document.createElement('div');
      rowClueCell.className = 'clue-cell clue-row';
      if ((r + 1) % SECTION_SIZE === 0 && r !== size - 1) rowClueCell.classList.add('sep-bottom');
      puzzle.rowClues[r].forEach((n) => {
        const span = document.createElement('span');
        span.textContent = n === 0 ? '' : String(n);
        rowClueCell.appendChild(span);
      });
      boardGrid.appendChild(rowClueCell);

      for (let c = 0; c < size; c++) {
        const cell = document.createElement('div');
        cell.className = 'board-cell';
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        if ((c + 1) % SECTION_SIZE === 0 && c !== size - 1) cell.classList.add('sep-right');
        if ((r + 1) % SECTION_SIZE === 0 && r !== size - 1) cell.classList.add('sep-bottom');
        applyCellClass(cell, board[r][c], mistakeGrid[r][c]);
        boardGrid.appendChild(cell);
      }
    }

    applySizing(size, maxRowClueCount, maxColClueCount);
  }

  function applyCellClass(cellEl, state, isMistake) {
    cellEl.classList.remove('fill', 'x', 'ghost', 'x-wrong');
    if (state === 'fill') cellEl.classList.add('fill');
    else if (state === 'x') {
      cellEl.classList.add('x');
      if (isMistake) cellEl.classList.add('x-wrong');
    } else if (state === 'ghost') cellEl.classList.add('ghost');
  }

  function updateCellVisual(r, c) {
    const cellEl = boardGrid.querySelector(`.board-cell[data-r="${r}"][data-c="${c}"]`);
    if (cellEl) applyCellClass(cellEl, board[r][c], mistakeGrid[r][c]);
    return cellEl;
  }

  function applySizing(size, maxRowClueCount, maxColClueCount) {
    const availW = boardWrapper.clientWidth - 16;
    const availH = boardWrapper.clientHeight - 16;
    const clueColFactor = 1.8;
    // Column clue headers stack their numbers vertically, so they need
    // noticeably more headroom than the row-clue column to stay legible.
    const clueRowFactor = 2.2;

    const cellFromW = availW / (size + clueColFactor);
    const cellFromH = availH / (size + clueRowFactor);
    let cell = Math.floor(Math.min(cellFromW, cellFromH));
    cell = Math.max(15, Math.min(cell, 46));

    const clueW = Math.round(cell * clueColFactor);
    const clueH = Math.round(cell * clueRowFactor);

    boardGrid.style.setProperty('--cell', `${cell}px`);
    boardGrid.style.setProperty('--clue-w', `${clueW}px`);
    boardGrid.style.setProperty('--clue-h', `${clueH}px`);

    const rowFont = Math.max(9, Math.min(15, Math.floor(cell * 0.52)));
    const colFontByCount = Math.floor(((clueH - 4) / Math.max(1, maxColClueCount)) * 0.88);
    const colFont = Math.max(8, Math.min(15, colFontByCount));
    boardGrid.style.setProperty('--row-clue-font', `${rowFont}px`);
    boardGrid.style.setProperty('--col-clue-font', `${colFont}px`);
  }

  window.addEventListener('resize', () => {
    if (!gameActive || !puzzle) return;
    const maxRowClueCount = Math.max(...puzzle.rowClues.map((c) => c.length));
    const maxColClueCount = Math.max(...puzzle.colClues.map((c) => c.length));
    applySizing(puzzle.size, maxRowClueCount, maxColClueCount);
  });

  // ---------------------------------------------------------------------
  // Lives
  // ---------------------------------------------------------------------
  function updateLivesDisplay() {
    livesDisplay.innerHTML = '';
    for (let i = 0; i < puzzle.lives; i++) {
      const span = document.createElement('span');
      span.className = 'heart' + (i < livesRemaining ? '' : ' lost');
      span.textContent = i < livesRemaining ? '♥' : '♡';
      livesDisplay.appendChild(span);
    }
  }

  // ---------------------------------------------------------------------
  // Gameplay logic
  // ---------------------------------------------------------------------
  function handleCellAction(r, c, action, tool) {
    if (!gameActive) return;
    const key = `${r},${c}`;
    if (stroke && stroke.visited.has(key)) return;
    if (stroke) stroke.visited.add(key);

    const current = board[r][c];

    if (tool === 'x' || tool === 'ghost') {
      if (action === 'erase') {
        if (current === tool) board[r][c] = 'empty';
      } else if (current === 'empty' || current === (tool === 'x' ? 'ghost' : 'x')) {
        board[r][c] = tool;
      }
      // A manually-placed mark is a deliberate choice, not a mistake - always grey.
      mistakeGrid[r][c] = false;
      updateCellVisual(r, c);
      return;
    }

    // tool === 'fill'
    if (action === 'erase') {
      if (current === 'fill') {
        board[r][c] = 'empty';
        updateCellVisual(r, c);
      }
      return;
    }

    if (current === 'fill') return; // already filled, nothing to do on "set"

    const isCorrect = puzzle.solution[r][c] === true;
    if (isCorrect) {
      board[r][c] = 'fill';
      const cellEl = updateCellVisual(r, c);
      checkLineCompletion(r, c);
      checkWin();
      return;
    }

    // Mistake: placing a real square where the solution says empty.
    board[r][c] = 'x';
    mistakeGrid[r][c] = true;
    const cellEl = updateCellVisual(r, c);
    if (cellEl) {
      cellEl.classList.remove('mistake');
      // force reflow so the animation can restart if triggered again quickly
      void cellEl.offsetWidth;
      cellEl.classList.add('mistake');
    }
    livesRemaining = Math.max(0, livesRemaining - 1);
    updateLivesDisplay();
    if (livesRemaining <= 0) {
      gameActive = false;
      setTimeout(() => showGameOverModal(), 350);
    }
  }

  function checkLineCompletion(r, c) {
    checkRowCompletion(r);
    checkColCompletion(c);
  }

  function checkRowCompletion(r) {
    const size = puzzle.size;
    const solutionRow = puzzle.solution[r];
    for (let c = 0; c < size; c++) {
      if (solutionRow[c] && board[r][c] !== 'fill') return; // not complete yet
    }
    // Row complete: mark every remaining (non-fill) cell as X.
    for (let c = 0; c < size; c++) {
      if (!solutionRow[c] && board[r][c] !== 'x') {
        board[r][c] = 'x';
        updateCellVisual(r, c);
      }
    }
  }

  function checkColCompletion(c) {
    const size = puzzle.size;
    for (let r = 0; r < size; r++) {
      if (puzzle.solution[r][c] && board[r][c] !== 'fill') return; // not complete yet
    }
    for (let r = 0; r < size; r++) {
      if (!puzzle.solution[r][c] && board[r][c] !== 'x') {
        board[r][c] = 'x';
        updateCellVisual(r, c);
      }
    }
  }

  function checkWin() {
    const size = puzzle.size;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (puzzle.solution[r][c] && board[r][c] !== 'fill') return;
      }
    }
    gameActive = false;
    // Auto-X any remaining blank/ghost cells across the whole finished board.
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!puzzle.solution[r][c] && board[r][c] !== 'x') {
          board[r][c] = 'x';
          updateCellVisual(r, c);
        }
      }
    }
    setTimeout(() => showWinModal(), 300);
  }

  function showWinModal() {
    showModal(
      'Solved! \u{1F389}',
      `You solved the ${puzzle.size}×${puzzle.size} puzzle with ${livesRemaining} of ${puzzle.lives} lives remaining.`,
      [
        { label: 'New Game', kind: 'primary', onClick: () => showScreen('home') },
        { label: 'Home', kind: 'secondary', onClick: () => showScreen('home') },
      ]
    );
  }

  function showGameOverModal() {
    showModal(
      'Out of lives',
      'You ran out of lives. You can restart this exact puzzle from a blank board, or head home to try a new one.',
      [
        { label: 'Restart Puzzle', kind: 'primary', onClick: () => restartCurrentPuzzle() },
        { label: 'Home', kind: 'secondary', onClick: () => showScreen('home') },
      ]
    );
  }

  // ---------------------------------------------------------------------
  // Pointer / drag-paint interaction
  // ---------------------------------------------------------------------
  function findCellAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const cellEl = el.closest('.board-cell');
    if (!cellEl || !boardGrid.contains(cellEl)) return null;
    return cellEl;
  }

  function beginStroke(cellEl, pointerId) {
    const r = parseInt(cellEl.dataset.r, 10);
    const c = parseInt(cellEl.dataset.c, 10);
    const current = board[r][c];
    const action = current === currentTool ? 'erase' : 'set';
    stroke = { action, tool: currentTool, visited: new Set() };
    boardGrid.setPointerCapture(pointerId);
    handleCellAction(r, c, action, currentTool);
  }

  boardGrid.addEventListener('pointerdown', (e) => {
    const cellEl = e.target.closest('.board-cell');
    if (!cellEl) return;
    e.preventDefault();
    beginStroke(cellEl, e.pointerId);
  });

  boardGrid.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    e.preventDefault();
    const cellEl = findCellAt(e.clientX, e.clientY);
    if (!cellEl) return;
    const r = parseInt(cellEl.dataset.r, 10);
    const c = parseInt(cellEl.dataset.c, 10);
    handleCellAction(r, c, stroke.action, stroke.tool);
  });

  function endStroke(e) {
    if (!stroke) return;
    try {
      boardGrid.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* no-op */
    }
    stroke = null;
  }

  boardGrid.addEventListener('pointerup', endStroke);
  boardGrid.addEventListener('pointercancel', endStroke);

  // ---------------------------------------------------------------------
  // Tool selection
  // ---------------------------------------------------------------------
  toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      currentTool = btn.dataset.tool;
      toolButtons.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  // ---------------------------------------------------------------------
  // Top-level buttons
  // ---------------------------------------------------------------------
  btnNewGame.addEventListener('click', () => {
    const size = parseInt(sizeSelect.value, 10);
    startNewGame(size);
  });

  btnLoadGame.addEventListener('click', () => {
    loadGame();
  });

  btnSave.addEventListener('click', () => {
    saveGame();
  });

  btnHome.addEventListener('click', () => {
    if (gameActive) {
      const ok = confirm('Leave this puzzle? Unsaved progress will be lost unless you save first.');
      if (!ok) return;
    }
    showScreen('home');
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  function init() {
    const lastSize = localStorage.getItem(LAST_SIZE_KEY);
    if (lastSize && Array.from(sizeSelect.options).some((o) => o.value === lastSize)) {
      sizeSelect.value = lastSize;
    }
    showScreen('home');

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(() => {
          /* offline caching is a nice-to-have, ignore failures */
        });
      });
    }
  }

  init();
})();
