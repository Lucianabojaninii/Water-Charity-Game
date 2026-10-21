const COLS = 10;
const ROWS = 20;
const TARGET_LAYERS = 10;
const GAME_SECONDS = 180;

const SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
};
const PIECE_KEYS = Object.keys(SHAPES);
const SCORE_VALUES = [0, 100, 300, 500, 800];
const boardElement = document.querySelector("#board");
const activeLayer = document.querySelector("#activePiece");
const ghostLayer = document.querySelector("#ghostPiece");
const previewElement = document.querySelector("#nextPreview");
const overlay = document.querySelector("#overlay");
const overlayTitle = document.querySelector("#overlayTitle");
const overlayKicker = document.querySelector("#overlayKicker");
const overlayText = document.querySelector("#overlayText");
const finalStats = document.querySelector("#finalStats");
const startButton = document.querySelector("#startButton");
const timerElement = document.querySelector("#timer");
const scoreElement = document.querySelector("#score");
const layersElement = document.querySelector("#layers");
const progressBar = document.querySelector("#progressBar");
const layerMessage = document.querySelector("#layerMessage");
const blockCount = document.querySelector("#blockCount");

let grid;
let activePiece;
let nextPiece;
let score = 0;
let layers = 0;
let secondsLeft = GAME_SECONDS;
let clockTimer;
let animationFrame = null;
let loopActive = false;
let lastFrameTime = 0;
let dropElapsed = 0;
let groundedElapsed = 0;
let hardDropTarget = null;
let hardDropElapsed = 0;
let clearingRows = [];
let blockNumber = 0;
let gameState = "ready";
let cellSize = 0;
let activeBlocks = [];
let ghostBlocks = [];
let repeatTimer;
let repeatInterval;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const LOCK_DELAY = 400;
const HARD_DROP_DURATION = 120;

// The lag came from rebuilding 200 cells and both piece layers every frame.
// The board now redraws only on state changes, while RAF moves one cached layer.

function gravityInterval() { return Math.max(150, 800 - layers * 55); }

function measureBoard() {
  const styles = getComputedStyle(boardElement);
  cellSize = (boardElement.clientWidth - parseFloat(styles.borderLeftWidth) - parseFloat(styles.borderRightWidth)) / COLS;
  boardElement.style.setProperty("--cell-size", `${cellSize}px`);
}

function makeBoard() {
  const layersToKeep = [ghostLayer, activeLayer];
  boardElement.replaceChildren(...layersToKeep);
  for (let index = 0; index < COLS * ROWS; index += 1) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.setAttribute("role", "gridcell");
    boardElement.append(cell);
  }
  measureBoard();
}

function emptyGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function cloneMatrix(matrix) {
  return matrix.map(row => [...row]);
}

function randomPiece() {
  const key = PIECE_KEYS[Math.floor(Math.random() * PIECE_KEYS.length)];
  const matrix = cloneMatrix(SHAPES[key]);
  return { key, matrix, row: -1, col: Math.floor((COLS - matrix[0].length) / 2), muddy: blockNumber >= 3 && Math.random() < 0.15 };
}

function rotateMatrix(matrix) {
  return matrix[0].map((_, column) => matrix.map(row => row[column]).reverse());
}

function collision(piece, row = piece.row, col = piece.col, matrix = piece.matrix) {
  return matrix.some((line, rowIndex) => line.some((filled, colIndex) => {
    if (!filled) return false;
    const targetRow = row + rowIndex;
    const targetCol = col + colIndex;
    return targetCol < 0 || targetCol >= COLS || targetRow >= ROWS || (targetRow >= 0 && grid[targetRow][targetCol]);
  }));
}

function renderLocked() {
  const cells = boardElement.querySelectorAll(".cell");
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cell = cells[row * COLS + col];
      const value = grid[row][col];
      cell.className = value ? `cell filled piece-${value.key.toLowerCase()}${value.muddy ? " muddy" : ""}` : "cell";
    }
  }
  clearingRows.forEach(row => {
    for (let col = 0; col < COLS; col += 1) cells[row * COLS + col].classList.add("clearing");
  });
}

function createPieceLayers(piece) {
  activeLayer.replaceChildren();
  ghostLayer.replaceChildren();
  activeBlocks = [];
  ghostBlocks = [];
  piece.matrix.forEach(line => line.forEach(filled => {
    if (!filled) return;
    const activeBlock = document.createElement("div");
    const ghostBlock = document.createElement("div");
    activeBlock.className = `piece-block piece-${piece.key.toLowerCase()}${piece.muddy ? " muddy" : ""}`;
    ghostBlock.className = `piece-block piece-${piece.key.toLowerCase()}${piece.muddy ? " muddy" : ""}`;
    ghostBlock.classList.add("ghost-block");
    activeLayer.append(activeBlock);
    ghostLayer.append(ghostBlock);
    activeBlocks.push(activeBlock);
    ghostBlocks.push(ghostBlock);
  }));
  updatePieceShape();
}

function updatePieceShape() {
  if (!activePiece) return;
  let blockIndex = 0;
  activePiece.matrix.forEach((line, rowIndex) => line.forEach((filled, colIndex) => {
    if (!filled) return;
    const offset = `translate3d(${colIndex * cellSize}px, ${rowIndex * cellSize}px, 0)`;
    activeBlocks[blockIndex].style.transform = offset;
    ghostBlocks[blockIndex].style.transform = offset;
    blockIndex += 1;
  }));
}

function updatePiecePosition(row = activePiece?.row ?? 0) {
  if (!activePiece) return;
  const x = activePiece.col * cellSize;
  const y = row * cellSize;
  activeLayer.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function updateGhostPosition() {
  if (!activePiece) return;
  ghostLayer.style.transform = `translate3d(${activePiece.col * cellSize}px, ${ghostRow() * cellSize}px, 0)`;
}

function ghostRow() {
  if (!activePiece) return 0;
  let row = activePiece.row;
  while (!collision(activePiece, row + 1)) row += 1;
  return row;
}

function redrawBoard() {
  renderLocked();
}

function refreshPieceVisuals() {
  if (!activePiece) {
    activeLayer.replaceChildren();
    ghostLayer.replaceChildren();
    activeBlocks = [];
    ghostBlocks = [];
    return;
  }
  updatePieceShape();
  updatePiecePosition();
  updateGhostPosition();
}

function renderPreview() {
  previewElement.replaceChildren();
  const matrix = nextPiece.matrix;
  const offsetRow = Math.floor((4 - matrix.length) / 2);
  const offsetCol = Math.floor((4 - matrix[0].length) / 2);
  for (let row = 0; row < 16; row += 1) {
    const cell = document.createElement("span");
    const sourceRow = Math.floor(row / 4) - offsetRow;
    const sourceCol = row % 4 - offsetCol;
    if (matrix[sourceRow]?.[sourceCol]) cell.className = `preview-cell piece-${nextPiece.key.toLowerCase()}${nextPiece.muddy ? " muddy" : ""}`;
    previewElement.append(cell);
  }
}

function setMessage(message) { layerMessage.textContent = message; }
function updateStats() {
  scoreElement.textContent = score.toLocaleString();
  layersElement.textContent = layers;
  progressBar.style.width = `${Math.min(100, layers / TARGET_LAYERS * 100)}%`;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, "0");
  timerElement.textContent = `${minutes}:${seconds}`;
  timerElement.classList.toggle("warning", secondsLeft <= 10 && gameState === "playing");
}

function setScore(value) { score = Math.max(0, value); updateStats(); }

function spawnPiece() {
  blockNumber += 1;
  activePiece = nextPiece || randomPiece();
  activePiece.row = -1;
  activePiece.col = Math.floor((COLS - activePiece.matrix[0].length) / 2);
  dropElapsed = 0;
  groundedElapsed = 0;
  hardDropTarget = null;
  nextPiece = randomPiece();
  blockCount.textContent = String(blockNumber).padStart(2, "0");
  renderPreview();
  createPieceLayers(activePiece);
  updatePiecePosition();
  if (collision(activePiece)) endGame(false, "The well reached the top.");
}

function stopAnimationLoop() {
  loopActive = false;
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
}

function startAnimationLoop() {
  stopAnimationLoop();
  loopActive = true;
  lastFrameTime = performance.now();
  animationFrame = requestAnimationFrame(frame);
}

function frame(now) {
  if (!loopActive || gameState !== "playing") { animationFrame = null; return; }
  if (!activePiece) { animationFrame = requestAnimationFrame(frame); return; }
  const deltaTime = Math.min(100, Math.max(0, now - lastFrameTime));
  lastFrameTime = now;

  if (hardDropTarget !== null) {
    hardDropElapsed += deltaTime;
    const progress = prefersReducedMotion.matches ? 1 : Math.min(1, hardDropElapsed / HARD_DROP_DURATION);
    updatePiecePosition(activePiece.row + (hardDropTarget - activePiece.row) * progress);
    if (progress >= 1) { activePiece.row = hardDropTarget; hardDropTarget = null; lockPiece(); }
  } else {
    const interval = gravityInterval();
    dropElapsed += deltaTime;
    // The board row changes only after enough accumulated milliseconds pass.
    // The piece glides between those integer rows using the remaining elapsed time.
    if (!prefersReducedMotion.matches && dropElapsed >= interval && !collision(activePiece, activePiece.row + 1)) {
      activePiece.row += 1;
      dropElapsed %= interval;
      groundedElapsed = 0;
      updatePiecePosition();
    }
    if (collision(activePiece, activePiece.row + 1)) {
      groundedElapsed += deltaTime;
      if (groundedElapsed >= LOCK_DELAY || prefersReducedMotion.matches) lockPiece();
    } else groundedElapsed = 0;
    if (activePiece) {
      const glide = prefersReducedMotion.matches || collision(activePiece, activePiece.row + 1) ? 0 : dropElapsed / interval;
      updatePiecePosition(activePiece.row + glide);
    }
  }
  if (loopActive && gameState === "playing") animationFrame = requestAnimationFrame(frame);
}

function lockPiece() {
  activePiece.matrix.forEach((line, rowIndex) => line.forEach((filled, colIndex) => {
    const row = activePiece.row + rowIndex;
    const col = activePiece.col + colIndex;
    if (filled && row >= 0) grid[row][col] = { key: activePiece.key, muddy: activePiece.muddy };
  }));
  if (activePiece.muddy) { setScore(score - 25); setMessage("Muddy block! -25 points. Keep the water clean."); }
  activePiece = null;
  refreshPieceVisuals();
  redrawBoard();
  clearRows();
  if (!clearingRows.length && gameState === "playing") spawnPiece();
  else if (clearingRows.length) stopAnimationLoop();
}

function clearRows() {
  const completeRows = [];
  for (let row = 0; row < ROWS; row += 1) if (grid[row].every(Boolean)) completeRows.push(row);
  if (!completeRows.length) return;
  const muddyRows = completeRows.filter(row => grid[row].some(cell => cell.muddy)).length;
  clearingRows = completeRows;
  renderLocked();
  boardElement.classList.add("flash");
  setTimeout(() => {
    grid = grid.filter((_, row) => !completeRows.includes(row));
    while (grid.length < ROWS) grid.unshift(Array(COLS).fill(null));
    layers += completeRows.length;
    setScore(score + SCORE_VALUES[completeRows.length] + muddyRows * 50);
    setMessage(muddyRows ? `Purified! +${muddyRows * 50} bonus. Layer laid!` : completeRows.length > 1 ? `${completeRows.length} layers laid at once!` : layers === 5 ? "Halfway to clean water!" : "Layer laid! Keep stacking.");
    clearingRows = [];
    boardElement.classList.remove("flash");
    if (layers >= TARGET_LAYERS) endGame(true);
    else if (gameState === "playing") { spawnPiece(); startAnimationLoop(); }
  }, prefersReducedMotion.matches ? 1 : 180);
}

function move(horizontal) {
  if (gameState !== "playing" || !activePiece || collision(activePiece, activePiece.row, activePiece.col + horizontal)) return;
  activePiece.col += horizontal; groundedElapsed = 0; refreshPieceVisuals();
}

function rotate() {
  if (gameState !== "playing" || !activePiece) return;
  const rotated = rotateMatrix(activePiece.matrix);
  for (const kick of [0, -1, 1, -2, 2]) {
    if (!collision(activePiece, activePiece.row, activePiece.col + kick, rotated)) {
      activePiece.matrix = rotated;
      activePiece.col += kick;
      groundedElapsed = 0;
      refreshPieceVisuals();
      return;
    }
  }
}

function softDrop() {
  if (gameState !== "playing" || !activePiece) return;
  if (!collision(activePiece, activePiece.row + 1)) { activePiece.row += 1; dropElapsed = 0; groundedElapsed = 0; setScore(score + 1); refreshPieceVisuals(); }
}

function hardDrop() {
  if (gameState !== "playing" || !activePiece) return;
  let distance = 0;
  let targetRow = activePiece.row;
  while (!collision(activePiece, targetRow + 1)) { targetRow += 1; distance += 1; }
  setScore(score + distance * 2);
  hardDropTarget = targetRow;
  hardDropElapsed = 0;
  updateGhostPosition();
}

function startGame() {
  stopAnimationLoop();
  clearInterval(clockTimer);
  grid = emptyGrid(); score = 0; layers = 0; secondsLeft = GAME_SECONDS; blockNumber = 0; gameState = "playing"; nextPiece = null;
  clearingRows = []; hardDropTarget = null; dropElapsed = 0; groundedElapsed = 0; overlay.hidden = true; setMessage("The first stone is yours."); updateStats(); spawnPiece(); redrawBoard(); startAnimationLoop();
  clockTimer = setInterval(() => { secondsLeft -= 1; updateStats(); if (secondsLeft <= 0) endGame(false, "The water clock ran dry."); }, 1000);
}

function pauseGame() {
  if (gameState === "playing") { gameState = "paused"; stopAnimationLoop(); clearInterval(clockTimer); showOverlay("Paused", "Take a breath. The well will wait for you.", "Resume building", false); }
  else if (gameState === "paused") resumeGame();
}

function resumeGame() { gameState = "playing"; lastFrameTime = performance.now(); overlay.hidden = true; startAnimationLoop(); clockTimer = setInterval(() => { secondsLeft -= 1; updateStats(); if (secondsLeft <= 0) endGame(false, "The water clock ran dry."); }, 1000); }

function showOverlay(kicker, text, buttonText, showFinal) { overlayKicker.textContent = kicker; overlayText.textContent = text; startButton.textContent = buttonText; finalStats.hidden = !showFinal; overlay.hidden = false; }

function endGame(won, reason = "") {
  if (gameState === "won" || gameState === "over") return;
  gameState = won ? "won" : "over"; stopAnimationLoop(); clearInterval(clockTimer); updateStats();
  overlayTitle.innerHTML = won ? "Water <em>works.</em>" : "Keep the well <em>growing.</em>";
  showOverlay(won ? "Well complete" : "Build paused", won ? "You made clean water feel a little closer." : reason, won ? "Build another well" : "Try again", true);
  finalStats.innerHTML = `Final score: <strong>${score.toLocaleString()}</strong><br><small>${layers} of ${TARGET_LAYERS} layers · ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")} left</small>`;
  if (won) celebrate();
}

function celebrate() {
  const colors = ["#FFC907", "#2E9DF7", "#4FCB53", "#FF902A", "#F5402C", "#8BD1CB"];
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 70; index += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece"; piece.style.left = `${Math.random() * 100}%`; piece.style.background = colors[index % colors.length]; piece.style.setProperty("--fall", `${2 + Math.random() * 2.5}s`); piece.style.setProperty("--delay", `${Math.random() * .7}s`); piece.style.setProperty("--drift", `${-120 + Math.random() * 240}px`); fragment.append(piece);
  }
  document.querySelector("#confetti").replaceChildren(fragment);
}

function stopRepeating() {
  clearTimeout(repeatTimer); clearInterval(repeatInterval); repeatTimer = null; repeatInterval = null;
}

function beginRepeating(action, repeatable = true) {
  stopRepeating(); action();
  if (!repeatable) return;
  repeatTimer = setTimeout(() => { repeatInterval = setInterval(action, 50); }, 180);
}

document.addEventListener("keydown", event => {
  const actions = { ArrowLeft: () => move(-1), ArrowRight: () => move(1), ArrowDown: softDrop };
  if (actions[event.key]) { event.preventDefault(); if (!event.repeat) beginRepeating(actions[event.key]); return; }
  if (event.key === "ArrowUp") { event.preventDefault(); if (!event.repeat) rotate(); }
  if (event.key === " ") { event.preventDefault(); if (!event.repeat) hardDrop(); }
  if (event.key.toLowerCase() === "p") { event.preventDefault(); pauseGame(); }
});
document.addEventListener("keyup", event => { if (["ArrowLeft", "ArrowRight", "ArrowDown"].includes(event.key)) stopRepeating(); });
document.querySelectorAll("[data-action]").forEach(button => {
  const action = { left: () => move(-1), right: () => move(1), rotate, down: softDrop, drop: hardDrop }[button.dataset.action];
  const repeatable = ["left", "right", "down"].includes(button.dataset.action);
  button.addEventListener("pointerdown", event => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); beginRepeating(action, repeatable); });
  button.addEventListener("pointerup", stopRepeating); button.addEventListener("pointercancel", stopRepeating); button.addEventListener("pointerleave", stopRepeating);
});
startButton.addEventListener("click", () => gameState === "paused" ? resumeGame() : startGame());
document.querySelector("#pauseButton").addEventListener("click", pauseGame);
document.querySelector("#resetButton").addEventListener("click", startGame);
window.addEventListener("resize", () => { measureBoard(); refreshPieceVisuals(); });

makeBoard(); grid = emptyGrid(); nextPiece = randomPiece(); renderPreview(); updateStats();
if (new URLSearchParams(window.location.search).get("autostart") === "1") startGame();