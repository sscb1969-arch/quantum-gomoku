/* =========================
   Quantum Gomoku - Browser Edition
   完全整形版 game.js
   ========================= */

const BOARD_SIZE = 15;
const CELL_SIZE = 40;
const MARGIN = 40;
const STONE_RADIUS = CELL_SIZE / 2 - 2;
const SCREEN_SIZE = MARGIN * 2 + CELL_SIZE * (BOARD_SIZE - 1);
const WINDOW_HEIGHT = SCREEN_SIZE + 40;
const INFO_WIDTH = 230;

const BG_COLOR = "#f0d9b5";
const LINE_COLOR = "#000000";
const BLACK_STONE = "#000000";
const WHITE_STONE = "#ffffff";
const HIGHLIGHT_COLOR = "red";

const canvas = document.getElementById("game");
canvas.width = SCREEN_SIZE + INFO_WIDTH;
canvas.height = WINDOW_HEIGHT;
const ctx = canvas.getContext("2d");

/* =========================
   Game State
   ========================= */
let board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
let probData = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));

let currentPlayer = 1;
let gameOver = false;
let gameStarted = false;
let winPositions = [];
let hoverPos = null;

let blackWins = 0;
let whiteWins = 0;

let resetting = false;
let resetStartTime = 0;

let nextProb = null;
let placedCount = 0;

let selectedRule = null;
let blackPoints = 0;
let whitePoints = 0;
let blackQLeft = 3;
let whiteQLeft = 3;
let blackZLeft = 1;
let whiteZLeft = 1;

let aiMode = false;
let lastTime = performance.now();

/* =========================
   Fade / Start Effects
   ========================= */
let fadeAlpha = 0;
let fadingIn = false;
let showStartMessage = false;
let startMessageTime = 0;

/* =========================
   Secret Command (Konami)
   ========================= */
let secretBuffer = "";
const SECRET_CODE = "uuddlrlrba";

/* =========================
   Utility
   ========================= */
function blinkVisible(speed = 500) {
  return Math.floor(performance.now() / speed) % 2 === 0;
}

function countStones() {
  let c = 0;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== 0) c++;
    }
  }
  return c;
}

/* =========================
   Fade Animation
   ========================= */
function startFadeIn(duration = 800) {
  fadingIn = true;
  fadeAlpha = 1;
  const start = performance.now();

  function loop() {
    const t = (performance.now() - start) / duration;
    fadeAlpha = Math.max(0, 1 - t);
    if (fadeAlpha > 0) requestAnimationFrame(loop);
    else fadingIn = false;
  }

  requestAnimationFrame(loop);
}

/* =========================
   Stone Fade Animation
   ========================= */
function animateStoneFadeAsync(x, y, fromP, toPlayer, duration = 400) {
  return new Promise((resolve) => {
    const start = performance.now();

    function loop() {
      const now = performance.now();
      const t = Math.min(1, (now - start) / duration);

      const ratio = fromP / 100;
      const gray = Math.floor(255 * (1 - ratio));
      const fromColor = { r: gray, g: gray, b: gray };

      const toColor = toPlayer === 1
        ? { r: 0, g: 0, b: 0 }
        : { r: 255, g: 255, b: 255 };

      const r = Math.floor(fromColor.r + (toColor.r - fromColor.r) * t);
      const g = Math.floor(fromColor.g + (toColor.g - fromColor.g) * t);
      const b = Math.floor(fromColor.b + (toColor.b - fromColor.b) * t);

      drawBoard();
      const cx = MARGIN + x * CELL_SIZE;
      const cy = MARGIN + y * CELL_SIZE;
      drawCircle(cx, cy, STONE_RADIUS, `rgb(${r},${g},${b})`, 2, "#ff0000");

      if (t < 1) requestAnimationFrame(loop);
      else resolve();
    }

    requestAnimationFrame(loop);
  });
}

/* =========================
   Drawing
   ========================= */
function drawCircle(x, y, r, color, lineWidth = 0, strokeColor = "#000") {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (color) {
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (lineWidth > 0) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
  }
}

function drawInfoPanel() {
  const panelX = SCREEN_SIZE;

  ctx.fillStyle = "#c8aa78";
  ctx.fillRect(panelX, 0, INFO_WIDTH, WINDOW_HEIGHT);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#503214";
  ctx.strokeRect(panelX, 0, INFO_WIDTH, WINDOW_HEIGHT);

  ctx.fillStyle = "#28140a";
  ctx.font = "bold 32px Meiryo";
  ctx.fillText("情報", panelX + 55, 45);

  let y = 110;
  const line = 45;

  drawCircle(panelX + 30, y - 5, 12, currentPlayer === 1 ? BLACK_STONE : WHITE_STONE, 2);
  ctx.font = "24px Meiryo";
  ctx.fillText(`手番：${currentPlayer === 1 ? "黒" : "白"}`, panelX + 60, y);

  y += line;
  drawCircle(panelX + 30, y - 5, 12, currentPlayer === 1 ? BLACK_STONE : WHITE_STONE, 2);
  ctx.fillText(`次石：${nextProb}`, panelX + 60, y);

  y += line;
  ctx.fillText(`置いた石：${countStones()}`, panelX + 20, y);

  y += 25;
  ctx.beginPath();
  ctx.moveTo(panelX + 10, y);
  ctx.lineTo(panelX + INFO_WIDTH - 10, y);
  ctx.stroke();

  y += line;
  drawCircle(panelX + 30, y - 5, 12, BLACK_STONE, 2);
  ctx.fillText(`黒：${blackWins}勝`, panelX + 60, y);

  y += line;
  drawCircle(panelX + 30, y - 5, 12, WHITE_STONE, 2);
  ctx.fillText(`白：${whiteWins}勝`, panelX + 60, y);

  if (selectedRule === 2) {
    y += 25;
    ctx.beginPath();
    ctx.moveTo(panelX + 10, y);
    ctx.lineTo(panelX + INFO_WIDTH - 10, y);
    ctx.stroke();

    y += line;
    ctx.fillText(`黒Pt：${blackPoints}`, panelX + 20, y);

    y += line;
    ctx.fillText(`白Pt：${whitePoints}`, panelX + 20, y);

    y += 25;
    ctx.beginPath();
    ctx.moveTo(panelX + 10, y);
    ctx.lineTo(panelX + INFO_WIDTH - 10, y);
    ctx.stroke();

    y += line;
    ctx.fillText(`黒Q残：${blackQLeft}`, panelX + 20, y);

    y += line;
    ctx.fillText(`白Q残：${whiteQLeft}`, panelX + 20, y);
  }

  y += 25;
  ctx.beginPath();
  ctx.moveTo(panelX + 10, y);
  ctx.lineTo(panelX + INFO_WIDTH - 10, y);
  ctx.stroke();

  y += line;
  ctx.fillText(`黒Z残：${blackZLeft}`, panelX + 20, y);

  y += line;
  ctx.fillText(`白Z残：${whiteZLeft}`, panelX + 20, y);
}

function drawBoard() {
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, SCREEN_SIZE + INFO_WIDTH, WINDOW_HEIGHT);

  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 1;

  for (let i = 0; i < BOARD_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(MARGIN, MARGIN + i * CELL_SIZE);
    ctx.lineTo(MARGIN + CELL_SIZE * (BOARD_SIZE - 1), MARGIN + i * CELL_SIZE);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(MARGIN + i * CELL_SIZE, MARGIN);
    ctx.lineTo(MARGIN + i * CELL_SIZE, MARGIN + CELL_SIZE * (BOARD_SIZE - 1));
    ctx.stroke();
  }

  ctx.font = "20px Meiryo";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const val = board[y][x];
      const cx = MARGIN + x * CELL_SIZE;
      const cy = MARGIN + y * CELL_SIZE;

      if (val === 1) {
        drawCircle(cx, cy, STONE_RADIUS, BLACK_STONE, 1);
      } else if (val === 2) {
        drawCircle(cx, cy, STONE_RADIUS, WHITE_STONE, 1);
      } else if (val === 3 || val === 4) {
        const p = probData[y][x];
        const ratio = p / 100;
        const gray = Math.floor(255 * (1 - ratio));
        const stoneColor = `rgb(${gray},${gray},${gray})`;
        const textColor = p >= 50 ? "#ffffff" : "#000000";
        drawCircle(cx, cy, STONE_RADIUS, stoneColor, 1);
        ctx.fillStyle = textColor;
        ctx.fillText(String(p), cx, cy);
      }
    }
  }

  ctx.strokeStyle = HIGHLIGHT_COLOR;
  ctx.lineWidth = 3;
  for (const [wx, wy] of winPositions) {
    const cx = MARGIN + wx * CELL_SIZE;
    const cy = MARGIN + wy * CELL_SIZE;
    drawCircle(cx, cy, STONE_RADIUS + 3, null, 3, HIGHLIGHT_COLOR);
  }

  if (hoverPos && !gameOver) {
    const [hx, hy] = hoverPos;
    if (hx >= 0 && hx < BOARD_SIZE && hy >= 0 && hy < BOARD_SIZE) {
      if (board[hy][hx] === 0) {
        const cx = MARGIN + hx * CELL_SIZE;
        const cy = MARGIN + hy * CELL_SIZE;
        drawCircle(cx, cy, STONE_RADIUS, null, 2, "#cccccc");
      }
    }
  }

  drawInfoPanel();
}

/* =========================
   Start Screen
   ========================= */
function drawStartScreen() {
  drawBoard();

  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillRect(0, 0, SCREEN_SIZE + INFO_WIDTH, WINDOW_HEIGHT);

  ctx.fillStyle = "rgb(100,100,255)";
  ctx.font = "bold 48px Meiryo";
  ctx.textAlign = "center";
  ctx.fillText("量子五目並べ", (SCREEN_SIZE + INFO_WIDTH) / 2, 80);

  ctx.fillStyle = "#ffffff";
  ctx.font = "32px Meiryo";
  ctx.fillText("ルール選択", (SCREEN_SIZE + INFO_WIDTH) / 2, 150);

  ctx.font = "20px Meiryo";
  const lines = [
    "1：自動観測ルール（10手ごと観測）",
    "   黒：90 or 70（4:6）  白：30 or 10（4:6）",
    "   10手ごとに自動観測し、5個並べば勝利",
    "",
    "2：Qキー観測ルール（ポイント制）",
    "   黒：90 or 70（4:6）  白：30 or 10（4:6）",
    "   Qキーで観測し、5個並べば勝利",
    "   勝利時にポイント加算",
    "",
    "3：AI対戦（ルール1、自動観測）",
    "",
    "黒白ともに Zキーで確定石を1回使用可能",
  ];

  let y = 200;
  for (const line of lines) {
    ctx.fillText(line, (SCREEN_SIZE + INFO_WIDTH) / 2, y);
    y += 26;
  }

  if (blinkVisible(500)) {
    ctx.fillStyle = "rgb(100,100,200)";
    ctx.font = "24px Meiryo";
    ctx.fillText("1 / 2 / 3 を押してスタート", (SCREEN_SIZE + INFO_WIDTH) / 2, SCREEN_SIZE - 10);
  }
}

/* =========================
   Win Check
   ========================= */
function checkWin(x, y, player) {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (const [dx, dy] of dirs) {
    const coords = [[x, y]];
    let nx = x + dx;
    let ny = y + dy;
    while (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === player) {
      coords.push([nx, ny]);
      nx += dx;
      ny += dy;
    }
    nx = x - dx;
    ny = y - dy;
    while (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === player) {
      coords.push([nx, ny]);
      nx -= dx;
      ny -= dy;
    }
    if (coords.length >= 5) return coords;
  }
  return [];
}

/* =========================
   Probability Observation
   ========================= */
async function applyProbabilityAnimated() {
  const changed = [];

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === 3 || board[y][x] === 4) {
        const p = probData[y][x];
        const newVal = Math.random() * 100 < p ? 1 : 2;

        await animateStoneFadeAsync(x, y, p, newVal, 400);

        board[y][x] = newVal;
        changed.push([x, y]);
      }
    }
  }

  return changed;
}

function revertToGray(changed) {
  for (const [x, y] of changed) {
    const p = probData[y][x];
    if (p == null) continue;
    board[y][x] = p >= 50 ? 3 : 4;
  }
}

/* =========================
   Winner Display
   ========================= */
function calculatePoints() {
  const stones = countStones();
  const speed = Math.max(50, 1200 - stones * 9);

  let totalProb = 0;
  let countProb = 0;

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (probData[y][x] != null) {
        totalProb += probData[y][x];
        countProb++;
      }
    }
  }

  const avgProb = countProb > 0 ? totalProb / countProb : 50;
  const risk = Math.floor(((100 - avgProb) ** 2) * 0.1);

  const streak = currentPlayer === 1 ? blackWins : whiteWins;
  const streakBonus = Math.floor((streak ** 1.5) * 40);

  return speed + risk + streakBonus;
}

function showWinnerRule1(player, positions) {
  winPositions = positions;
  if (player === 1) blackWins++;
  else whiteWins++;

  gameOver = true;

  function loop() {
    drawBoard();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, SCREEN_SIZE + INFO_WIDTH, WINDOW_HEIGHT);

    ctx.fillStyle = "#ffffff";
    ctx.font = "40px Meiryo";
    ctx.textAlign = "center";
    ctx.fillText(player === 1 ? "黒の勝ち!" : "白の勝ち!", (SCREEN_SIZE + INFO_WIDTH) / 2, 80);

    ctx.font = "24px Meiryo";
    ctx.fillText(`黒：${blackWins}勝   白：${whiteWins}勝`, (SCREEN_SIZE + INFO_WIDTH) / 2, 130);

    if (blinkVisible(500)) {
      ctx.fillStyle = "rgb(255,200,200)";
      ctx.fillText("スペースボタンで再試合", (SCREEN_SIZE + INFO_WIDTH) / 2, SCREEN_SIZE - 10);
    }

    if (!resetting && gameOver) requestAnimationFrame(loop);
  }
  loop();
}

/* =========================
   Winner Rule2
   ========================= */
function showWinnerRule2(player, positions) {
  winPositions = positions;
  const pts = calculatePoints();

  if (player === 1) {
    blackWins++;
    blackPoints += pts;
  } else {
    whiteWins++;
    whitePoints += pts;
  }

  gameOver = true;

  function loop() {
    drawBoard();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, SCREEN_SIZE + INFO_WIDTH, WINDOW_HEIGHT);

    ctx.fillStyle = "#ffffff";
    ctx.font = "40px Meiryo";
    ctx.textAlign = "center";
    ctx.fillText(player === 1 ? "黒の勝ち!" : "白の勝ち!", (SCREEN_SIZE + INFO_WIDTH) / 2, 80);

    ctx.font = "24px Meiryo";
    ctx.fillText(`黒ポイント：${blackPoints}   白ポイント：${whitePoints}`, (SCREEN_SIZE + INFO_WIDTH) / 2, 150);

    if (blinkVisible(500)) {
      ctx.fillStyle = "rgb(100,100,200)";
      ctx.fillText("スペースボタンで再試合", (SCREEN_SIZE + INFO_WIDTH) / 2, SCREEN_SIZE - 10);
    }

    if (!resetting && gameOver) requestAnimationFrame(loop);
  }
  loop();
}

/* =========================
   Main Loop
   ========================= */
async function mainLoop(timestamp) {
  const dt = timestamp - lastTime;
  lastTime = timestamp;

  doResetIfNeeded();

  if (!gameStarted) {
    drawStartScreen();
  } else {
    if (aiMode && selectedRule === 1 && currentPlayer === 2 && !gameOver && !resetting) {
      if (!mainLoop.aiWait) mainLoop.aiWait = 0;
      mainLoop.aiWait += dt;

      if (mainLoop.aiWait > 300) {
        mainLoop.aiWait = 0;

        const pos = aiChooseBestMove();
        if (pos) {
          const [x, y] = pos;

          board[y][x] = nextProb >= 50 ? 3 : 4;
          probData[y][x] = nextProb;
          placedCount++;

          if (placedCount % 10 === 0) {
            const changed = await applyProbabilityAnimated();

            let winnerFound = false;
            for (let cy = 0; cy < BOARD_SIZE; cy++) {
              for (let cx = 0; cx < BOARD_SIZE; cx++) {
                if (board[cy][cx] === 1 || board[cy][cx] === 2) {
                  const win = checkWin(cx, cy, board[cy][cx]);
                  if (win.length > 0) {
                    winnerFound = true;
                    showWinnerRule1(board[cy][cx], win);
                    break;
                  }
                }
              }
              if (winnerFound) break;
            }

            if (!winnerFound) {
              setTimeout(() => revertToGray(changed), 2000);
            }
          }

          currentPlayer = 1;
          updateNextProb();
        }
      }
    }

    if (!gameOver && !resetting) {
      drawBoard();
    }
  }

  /* --- Start Message --- */
  if (showStartMessage) {
    const elapsed = performance.now() - startMessageTime;

    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, SCREEN_SIZE + INFO_WIDTH, WINDOW_HEIGHT);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 60px Meiryo";
    ctx.textAlign = "center";
    ctx.fillText("ゲームスタート！", (SCREEN_SIZE + INFO_WIDTH) / 2, SCREEN_SIZE / 2);

    if (elapsed > 1000) {
      showStartMessage = false;
    }
  }

  /* --- Fade In --- */
  if (fadingIn) {
    ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
    ctx.fillRect(0, 0, SCREEN_SIZE + INFO_WIDTH, WINDOW_HEIGHT);
  }

  requestAnimationFrame(mainLoop);
}

/* =========================
   Start Game
   ========================= */
updateNextProb();
startFadeIn();
requestAnimationFrame(mainLoop);
