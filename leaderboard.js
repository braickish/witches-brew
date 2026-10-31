// The leaderboard: getting a one-time game from the server, asking for a name, and showing the top 100.
// The score itself is worked out on the server (supabase/functions/submit-score).
const Leaderboard = (() => {
  'use strict';

  // These two are meant to be public: they only allow reading the visible scores.
  const SUPABASE_URL = 'https://dcbuizimphwlnajjtsfe.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_Na-sJqr3aMiFiS-svgMBOQ_SViqUyt5';
  const BOARD_SIZE = 100;
  const RUN_MAX_AGE = 23 * 60 * 60 * 1000;   // the server forgets a game after a day

  const $ = (id) => document.getElementById(id);
  const nameForm = $('name-form');
  const nameInput = $('name-input');
  const nameError = $('name-error');
  const nameBtn = $('name-btn');
  const result = $('board-result');
  const boardPanel = $('board-panel');
  const boardList = $('board-list');
  const boardStatus = $('board-status');

  let nextRun = null;
  let finished = null;     // the game waiting for a name: { runId, events, score }
  let yourEntry = null;    // highlighted on the board
  let gamesOver = 0;

  const NAME_ERRORS = {
    name_format: 'Use 2 to 12 letters, numbers or spaces.',
    name_rejected: "That name isn't allowed. Please pick another.",
    not_top: "So close! That score just missed the top 100.",
    run_unavailable: "This brew can't be added any more.",
    invalid_game: "This brew couldn't be added to the leaderboard.",
  };

  async function post(fn, body) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function fetchRun() {
    try {
      const { ok, data } = await post('start-run', {});
      if (ok) nextRun = { id: data.id, seed: data.seed, at: Date.now() };
    } catch {
      // No connection: the game still plays, it just can't go on the leaderboard.
    }
  }

  // Gives the game its next one-time game (or null), and quietly fetches another for after that.
  function takeRun() {
    const run = nextRun && Date.now() - nextRun.at < RUN_MAX_AGE ? nextRun : null;
    nextRun = null;
    fetchRun();
    return run;
  }

  async function fetchBoard() {
    const query = `select=id,name,score&order=score.desc,created_at.asc&limit=${BOARD_SIZE}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scores?${query}`, { headers: { apikey: PUBLISHABLE_KEY } });
    if (!res.ok) throw new Error(`leaderboard ${res.status}`);
    return res.json();
  }

  function showResult(text) {
    result.textContent = text;
    result.classList.toggle('hidden', !text);
  }

  // Called when the game-over card appears.
  async function gameOver({ run, events, score }) {
    const thisGame = ++gamesOver;
    finished = null;
    nameForm.classList.add('hidden');
    showResult('');
    if (score <= 0) return;
    if (!run) {
      showResult("Couldn't reach the leaderboard when this brew began, so it can't be added.");
      return;
    }
    let board;
    try {
      board = await fetchBoard();
    } catch {
      if (thisGame === gamesOver) showResult("Couldn't reach the leaderboard just now.");
      return;
    }
    if (thisGame !== gamesOver) return;      // they've already finished another brew
    if (board.length >= BOARD_SIZE && score <= board[board.length - 1].score) return;
    finished = { runId: run.id, events };
    nameError.classList.add('hidden');
    nameInput.value = loadName();
    nameBtn.disabled = false;
    nameForm.classList.remove('hidden');
  }

  function loadName() {
    try { return localStorage.getItem('brew-name') ?? ''; } catch { return ''; }
  }

  function saveName(name) {
    try { localStorage.setItem('brew-name', name); } catch {}
  }

  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!finished) return;
    nameBtn.disabled = true;
    nameError.classList.add('hidden');
    let response;
    try {
      response = await post('submit-score', { runId: finished.runId, name: nameInput.value, events: finished.events });
    } catch {
      response = { ok: false, data: {} };
    }
    nameBtn.disabled = false;
    if (!response.ok) {
      nameError.textContent = NAME_ERRORS[response.data.error] ?? 'Something went wrong. Please try again.';
      nameError.classList.remove('hidden');
      return;
    }
    const { id, rank, name } = response.data;
    finished = null;
    yourEntry = id;
    saveName(name);
    nameForm.classList.add('hidden');
    showResult(`${name} is number ${rank} on the leaderboard!`);
  });

  async function openBoard() {
    boardPanel.classList.remove('hidden');
    boardList.replaceChildren();
    boardStatus.textContent = 'Stirring up the scores…';
    boardStatus.classList.remove('hidden');
    try {
      const board = await fetchBoard();
      // textContent, never innerHTML: names are shown exactly as text.
      boardList.replaceChildren(...board.map((entry, i) => {
        const row = document.createElement('li');
        const cell = (className, text) => {
          const span = document.createElement('span');
          span.className = className;
          span.textContent = text;
          return span;
        };
        row.append(cell('board-rank', i + 1), cell('board-name', entry.name), cell('board-score', entry.score));
        row.classList.toggle('yours', entry.id === yourEntry);
        return row;
      }));
      boardStatus.textContent = board.length ? '' : 'No brews yet. Yours could be first!';
      boardStatus.classList.toggle('hidden', board.length > 0);
      boardList.querySelector('.yours')?.scrollIntoView({ block: 'center' });
    } catch {
      boardStatus.textContent = "Couldn't reach the leaderboard just now.";
    }
  }

  document.querySelectorAll('.board-link').forEach((link) => link.addEventListener('click', openBoard));
  $('board-close').addEventListener('click', () => boardPanel.classList.add('hidden'));

  // While a name is being typed or the board is open, the keyboard doesn't belong to the cauldron.
  // (offsetParent is null when something, or anything around it, is hidden.)
  const usingKeyboard = () => boardPanel.offsetParent !== null || nameForm.offsetParent !== null;

  return { fetchRun, takeRun, gameOver, usingKeyboard };
})();
