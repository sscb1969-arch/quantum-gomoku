/* =========================
   Quantum Gomoku - Browser Edition
   game.js  (WebSocket Online 対戦統合版 + Zモード + タッチ対応)
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
   ★ Zモード（A方式）
   ========================= */
let zMode = false;  // ← Zキーで ON、次のクリックで確定石を置いたら OFF

/* =========================
   ゲーム状態
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

/* --- フェード＆開始演出用 --- */
let fadeAlpha = 0;
let fadingIn = false;
let showStartMessage = false;
let startMessageTime = 0;

/* =========================
   ★ Secret Command（追加）
   ========================= */
let secretBuffer = [];
const SECRET_CODE = [
  "ArrowUp","ArrowUp","ArrowDown","ArrowDown",
  "ArrowLeft","ArrowRight","ArrowLeft","ArrowRight",
  "b","a"
];

/* =========================
   WebSocket Online 対戦
   ========================= */
const WS_DEFAULT_URL = "ws://localhost:8080";
let ws = null;
let onlineMode = false;
let onlinePlayer = 1;
let onlineClientId = Math.random().toString(36).slice(2);
let onlineConnected = false;
let onlineIsHost = false;

function logOnline(msg) {
  console.log("[ONLINE]", msg);
}

function wsSend(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  obj.clientId = onlineClientId;
  ws.send(JSON.stringify(obj));
}

function setupWebSocket(url, playerColor) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();

  onlineMode = true;
  onlinePlayer = playerColor;
  onlineIsHost = (onlinePlayer === 1);

  logOnline(`Connecting to ${url} as ${onlinePlayer === 1 ? "Black(Host)" : "White(Client)"}`);

  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    onlineConnected = true;
    logOnline("WebSocket connected");
    wsSend({ type: "hello", player: onlinePlayer });
  });

  ws.addEventListener("close", () => {
    onlineConnected = false;
    logOnline("WebSocket closed");
  });

  ws.addEventListener("error", (e) => {
    logOnline("WebSocket error: " + e);
  });

  ws.addEventListener("message", (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.clientId === onlineClientId) return;
      handleOnlineMessage(msg);
    } catch (err) {
      console.error("Invalid message", err);
    }
  });
}

/* =========================
   Online Message Handler
   ========================= */
function handleOnlineMessage(msg) {
  if (!onlineMode) return;

  switch (msg.type) {
    case "reset": applyOnlineReset(msg); break;
    case "move": applyOnlineMove(msg); break;
    case "observe": applyOnlineObserve(msg); break;
    case "z": applyOnlineZ(msg); break;
    case "q": applyOnlineQ(msg); break;
  }
}

/* =========================
   Online Reset
   ========================= */
function applyOnlineReset(msg) {
  board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
  probData = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));

  currentPlayer = msg.currentPlayer ?? 1;
  gameOver = false;
  winPositions = [];
  hoverPos = null;
  placedCount = msg.placedCount ?? 0;

  blackQLeft = msg.blackQLeft ?? 3;
  whiteQLeft = msg.whiteQLeft ?? 3;
  blackZLeft = msg.blackZLeft ?? 1;
  whiteZLeft = msg.whiteZLeft ?? 1;

  zMode = false; // ← Zモード解除

  updateNextProb();
}

/* =========================
   Online Move
   ========================= */
function applyOnlineMove(msg) {
  const { x, y, prob, player, placedCount: pc } = msg;
  if (x == null || y == null) return;

  if (board[y][x] !== 0) return;

  currentPlayer = player;
  nextProb = prob;

  if (prob >= 50) board[y][x] = 3;
  else board[y][x] = 4;

  probData[y][x] = prob;
  placedCount = pc;

  if (selectedRule === 1 && placedCount % 10 === 0) {
    if (onlineIsHost) {
      const changed = applyProbabilityForOnline();
      wsSend({ type: "observe", stones: changed });
      checkWinnerAfterObservationRule1();
    }
  }

  currentPlayer = currentPlayer === 1 ? 2 : 1;
  updateNextProb();
}

/* =========================
   Online Observe
   ========================= */
function applyOnlineObserve(msg) {
  const stones = msg.stones || [];
  for (const s of stones) {
    const { x, y, p, val } = s;
    probData[y][x] = p;
    board[y][x] = val;
  }
  checkWinnerAfterObservationRule1();
}

/* =========================
   Online Z（確定石）
   ========================= */
function applyOnlineZ(msg) {
  const { x, y, player, blackZLeft: bz, whiteZLeft: wz } = msg;

  currentPlayer = player;
  blackZLeft = bz;
  whiteZLeft = wz;

  probData[y][x] = null;
  board[y][x] = player;

  const win = checkWin(x, y, player);
  if (win.length > 0) {
    if (selectedRule === 1) showWinnerRule1(player, win);
    else showWinnerRule2(player, win);
  } else {
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateNextProb();
  }
}

/* =========================
   Online Q（観測）
   ========================= */
function applyOnlineQ(msg) {
  const { player, blackQLeft: bq, whiteQLeft: wq } = msg;
  currentPlayer = player;
  blackQLeft = bq;
  whiteQLeft = wq;

  if (onlineIsHost) {
    const changed = applyProbabilityForOnline();
    wsSend({ type: "observe", stones: changed });
    checkWinnerAfterObservationRule2();
  }
}
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
    if (fadeAlpha > 0) {
      requestAnimationFrame(loop);
    } else {
      fadingIn = false;
    }
  }

  requestAnimationFrame(loop);
}

/* =========================
   Stone Fade Animation（観測時の滑らかな変化）
   ========================= */
function animateStoneFade(x, y, fromP, toPlayer, duration = 500) {
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
  }

  requestAnimationFrame(loop);
}

/* =========================
   ★ Secret Command 用 非同期フェード
   ========================= */
function animateStoneFadeAsync(x, y, fromP, toPlayer, duration = 500) {
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
  const panelY = 0;

  ctx.fillStyle = "#c8aa78";
  ctx.fillRect(panelX, panelY, INFO_WIDTH, WINDOW_HEIGHT);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#503214";
  ctx.strokeRect(panelX, panelY, INFO_WIDTH, WINDOW_HEIGHT);

  ctx.fillStyle = "#28140a";
  ctx.font = "bold 32px Meiryo";
  ctx.textAlign = "left";
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

  y += line;
  ctx.fillText(`Online：${onlineMode ? (onlineConnected ? "接続中" : "未接続") : "OFF"}`, panelX + 20, y);

  /* ★ Zモード表示（Z1） */
  y += line;
  ctx.fillText(`Zモード：${zMode ? "ON" : "OFF"}`, panelX + 20, y);
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
  // ★ 盤面を描かない（黒帯も描かない）
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
    "4：オンライン対戦（WebSocket, ルール1ベース）",
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
    ctx.fillText("1 / 2 / 3 / 4 を押してスタート", (SCREEN_SIZE + INFO_WIDTH) / 2, SCREEN_SIZE - 10);
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
function applyProbability() {
  const changed = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === 3 || board[y][x] === 4) {
        const p = probData[y][x];
        const newVal = Math.random() * 100 < p ? 1 : 2;
        animateStoneFade(x, y, p, newVal, 500);
        board[y][x] = newVal;
        changed.push([x, y]);
      }
    }
  }
  return changed;
}

function applyProbabilityForOnline() {
  const changed = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === 3 || board[y][x] === 4) {
        const p = probData[y][x];
        const newVal = Math.random() * 100 < p ? 1 : 2;
        board[y][x] = newVal;
        changed.push({ x, y, p, val: newVal });
      }
    }
  }
  return changed;
}

function revertToGray(changed) {
  for (const [x, y] of changed) {
    const p = probData[y][x];
    if (p == null) continue;
    if (p >= 50) board[y][x] = 3;
    else board[y][x] = 4;
  }
}

function checkWinnerAfterObservationRule1() {
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
}

function checkWinnerAfterObservationRule2() {
  let winnerFound = false;
  for (let cy = 0; cy < BOARD_SIZE; cy++) {
    for (let cx = 0; cx < BOARD_SIZE; cx++) {
      if (board[cy][cx] === 1 || board[cy][cx] === 2) {
        const win = checkWin(cx, cy, board[cy][cx]);
        if (win.length > 0) {
          winnerFound = true;
          showWinnerRule2(board[cy][cx], win);
          break;
        }
      }
    }
    if (winnerFound) break;
  }
}

/* =========================
   Rule 1 / Rule 2 Winner
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
  zMode = false;

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
  zMode = false;

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
   Next Probability
   ========================= */
function updateNextProb() {
  if (currentPlayer === 1) {
    nextProb = Math.random() < 0.4 ? 90 : 70;
  } else {
    nextProb = Math.random() < 0.4 ? 30 : 10;
  }
}

/* =========================
   AI Evaluation
   ========================= */
function evaluateBoardForAI() {
  let score = 0;
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  function lineScore(count, openEnds, isAI) {
    let base = 0;
    if (count >= 5) base = 100000;
    else if (count === 4) base = openEnds === 2 ? 1000 : 200;
    else if (count === 3) base = openEnds === 2 ? 150 : 40;
    else if (count === 2) base = openEnds === 2 ? 30 : 8;
    else if (count === 1) base = 2;
    if (!isAI) base = -base * 1.1;
    return base;
  }

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === 0) continue;
      const player = board[y][x];
      const isAI = player === 2;

      for (const [dx, dy] of dirs) {
        let cnt = 1;
        let openEnds = 0;

        let nx = x + dx;
        let ny = y + dy;
        while (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === player) {
          cnt++;
          nx += dx;
          ny += dy;
        }
        if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === 0) openEnds++;

        nx = x - dx;
        ny = y - dy;
        while (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === player) {
          cnt++;
          nx -= dx;
          ny -= dy;
        }
        if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === 0) openEnds++;

        score += lineScore(cnt, openEnds, isAI);
      }
    }
  }

  const center = (BOARD_SIZE - 1) / 2;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === 2) {
        const dist = Math.abs(x - center) + Math.abs(y - center);
        score += Math.max(0, 10 - dist);
      }
    }
  }

  return score;
}

/* =========================
   AI Move Selection
   ========================= */
function aiChooseBestMove() {
  const empty = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === 0) empty.push([x, y]);
    }
  }
  if (empty.length === 0) return null;

  for (const [x, y] of empty) {
    board[y][x] = 2;
    if (checkWin(x, y, 2).length > 0) {
      board[y][x] = 0;
      return [x, y];
    }
    board[y][x] = 0;
  }

  for (const [x, y] of empty) {
    board[y][x] = 1;
    if (checkWin(x, y, 1).length > 0) {
      board[y][x] = 0;
      return [x, y];
    }
    board[y][x] = 0;
  }

  let bestScore = -1e9;
  let bestMove = empty[Math.floor(Math.random() * empty.length)];
  for (const [x, y] of empty) {
    board[y][x] = 2;
    const s = evaluateBoardForAI();
    board[y][x] = 0;
    if (s > bestScore) {
      bestScore = s;
      bestMove = [x, y];
    }
  }
  return bestMove;
}

/* =========================
   Z Key (確定石) 演出
   ========================= */
function zEffectAnimation(x, y, player) {
  const cx = MARGIN + x * CELL_SIZE;
  const cy = MARGIN + y * CELL_SIZE;

  drawBoard();
  drawCircle(cx, cy, STONE_RADIUS + 10, "rgba(255,240,100,0.6)", 3, "#ffff00");
}

function showZMessage(player) {
  drawBoard();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, SCREEN_SIZE + INFO_WIDTH, WINDOW_HEIGHT);

  ctx.fillStyle = "rgb(255,230,120)";
  ctx.font = "40px Meiryo";
  ctx.textAlign = "center";
  ctx.fillText(
    player === 1 ? "黒の必殺Z!" : "白の必殺Z!",
    (SCREEN_SIZE + INFO_WIDTH) / 2,
    SCREEN_SIZE - 40
  );
}

/* =========================
   Reset
   ========================= */
function resetGame() {
  resetting = true;
  resetStartTime = performance.now();

  if (onlineMode && onlineConnected) {
    wsSend({
      type: "reset",
      currentPlayer: 1,
      placedCount: 0,
      blackQLeft: 3,
      whiteQLeft: 3,
      blackZLeft: 1,
      whiteZLeft: 1
    });
  }
}

function doResetIfNeeded() {
  if (!resetting) return;

  if (performance.now() - resetStartTime >= 500) {
    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    probData = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));

    currentPlayer = 1;
    gameOver = false;
    winPositions = [];
    hoverPos = null;
    placedCount = 0;

    blackQLeft = 3;
    whiteQLeft = 3;
    blackZLeft = 1;
    whiteZLeft = 1;

    zMode = false;

    resetting = false;
    updateNextProb();
  }
}

/* =========================
   Mouse Move
   ========================= */
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const hx = Math.round((mx - MARGIN) / CELL_SIZE);
  const hy = Math.round((my - MARGIN) / CELL_SIZE);

  hoverPos = [hx, hy];
});

/* =========================
   Mouse Click (Place Stone) + Zモード対応
   ========================= */
canvas.addEventListener("mousedown", (e) => {
  if (!gameStarted || gameOver) return;
  if (aiMode && currentPlayer === 2) return;

  if (onlineMode) {
    if (currentPlayer !== onlinePlayer) return;
    if (!onlineConnected) return;
  }

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const x = Math.round((mx - MARGIN) / CELL_SIZE);
  const y = Math.round((my - MARGIN) / CELL_SIZE);

  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;

  /* --- Zモード中：確定石として置く（相手石も上書き可） --- */
  if (zMode && !gameOver) {
    if (currentPlayer === 1 && blackZLeft <= 0) return;
    if (currentPlayer === 2 && whiteZLeft <= 0) return;

    // 相手石も含めて上書き可能（A1仕様）
    zEffectAnimation(x, y, currentPlayer);
    showZMessage(currentPlayer);

    probData[y][x] = null;
    board[y][x] = currentPlayer;

    if (currentPlayer === 1) blackZLeft--;
    else whiteZLeft--;

    if (onlineMode && onlineConnected) {
      wsSend({
        type: "z",
        x,
        y,
        player: currentPlayer,
        blackZLeft,
        whiteZLeft
      });
    }

    const win = checkWin(x, y, currentPlayer);
    if (win.length > 0) {
      if (selectedRule === 1) showWinnerRule1(currentPlayer, win);
      else showWinnerRule2(currentPlayer, win);
    } else {
      currentPlayer = currentPlayer === 1 ? 2 : 1;
      updateNextProb();
    }

    zMode = false; // ← 1手で解除
    return;
  }

  /* --- 通常モード：量子石を置く --- */
  if (board[y][x] !== 0) return;

  if (nextProb >= 50) board[y][x] = 3;
  else board[y][x] = 4;

  probData[y][x] = nextProb;
  placedCount++;

  if (selectedRule === 1 && placedCount % 10 === 0) {
    if (onlineMode) {
      if (onlineIsHost) {
        const changed = applyProbabilityForOnline();
        wsSend({ type: "observe", stones: changed });
        checkWinnerAfterObservationRule1();
      }
    } else {
      const changed = applyProbability();

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
        setTimeout(() => {
          revertToGray(changed);
        }, 2000);
      }
    }
  }

  if (onlineMode && onlineConnected) {
    wsSend({
      type: "move",
      x,
      y,
      prob: nextProb,
      player: currentPlayer,
      placedCount
    });
  }

  currentPlayer = currentPlayer === 1 ? 2 : 1;
  updateNextProb();
}

/* =========================
   ★ Secret Command: 相手の石の半分を奪う
   ========================= */
async function activateSecretCommand() {
  if (gameOver || !gameStarted) return;
  if (onlineMode) return;

  const enemy = currentPlayer === 1 ? 2 : 1;
  const enemyStones = [];

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === enemy) enemyStones.push([x, y]);
    }
  }

  if (enemyStones.length === 0) return;

  let convertCount = Math.floor(enemyStones.length / 2);
  if (convertCount <= 0) convertCount = 1;

  for (let i = enemyStones.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [enemyStones[i], enemyStones[j]] = [enemyStones[j], enemyStones[i]];
  }

  for (let i = 0; i < convertCount; i++) {
    const [x, y] = enemyStones[i];
    await animateStoneFadeAsync(x, y, 50, currentPlayer, 400);
    board[y][x] = currentPlayer;

    const win = checkWin(x, y, currentPlayer);
    if (win.length > 0) {
      if (selectedRule === 1) showWinnerRule1(currentPlayer, win);
      else showWinnerRule2(currentPlayer, win);
      return;
    }
  }
}

/* =========================
   Keyboard Input（Zモード対応版）
   ========================= */
window.addEventListener("keydown", (e) => {

  secretBuffer.push(e.key);
  if (secretBuffer.length > 10) secretBuffer.shift();

  const lower = secretBuffer.map(k => k.toLowerCase());
  const target = SECRET_CODE.map(k => k.toLowerCase());

  if (JSON.stringify(lower) === JSON.stringify(target)) {
    activateSecretCommand();
  }

  if (e.key === "Escape") {
    gameStarted = false;
    gameOver = false;
    aiMode = false;
    selectedRule = null;

    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    probData = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
    winPositions = [];
    hoverPos = null;
    placedCount = 0;

    blackQLeft = 3;
    whiteQLeft = 3;
    blackZLeft = 1;
    whiteZLeft = 1;

    zMode = false;

    currentPlayer = 1;
    updateNextProb();
    startFadeIn();
    return;
  }

  if (!gameStarted) {
    if (["1","2","3","4"].includes(e.key)) {
      if (e.key === "1") {
        selectedRule = 1;
        aiMode = false;
        onlineMode = false;
      } else if (e.key === "2") {
        selectedRule = 2;
        aiMode = false;
        onlineMode = false;
      } else if (e.key === "3") {
        selectedRule = 1;
        aiMode = true;
        onlineMode = false;
      } else if (e.key === "4") {
        selectedRule = 1;
        aiMode = false;
        onlineMode = true;

        const url = prompt("WebSocket サーバー URL を入力してください", WS_DEFAULT_URL) || WS_DEFAULT_URL;
        const color = prompt("あなたの色を選択 (1:黒 / 2:白)", "1");
        const playerColor = color === "2" ? 2 : 1;
        setupWebSocket(url, playerColor);
      }

      gameStarted = true;

      currentPlayer = 1;
      updateNextProb();

      showStartMessage = true;
      startMessageTime = performance.now();
      startFadeIn();
    }
    return;
  }

  if (e.key === " " && gameOver) {
    resetGame();
    startFadeIn();
  }

  /* --- Zキー：Zモード ON（次のクリックで確定石） --- */
  if (e.key.toLowerCase() === "z" && !gameOver) {
    if (currentPlayer === 1 && blackZLeft <= 0) return;
    if (currentPlayer === 2 && whiteZLeft <= 0) return;
    zMode = true;
  }

  if (selectedRule === 2 && e.key.toLowerCase() === "q" && !gameOver) {
    if (currentPlayer === 1 && blackQLeft <= 0) return;
    if (currentPlayer === 2 && whiteQLeft <= 0) return;

    if (onlineMode) {
      if (!onlineConnected) return;
      if (!onlineIsHost) return;

      if (currentPlayer === 1) blackQLeft--;
      else whiteQLeft--;

      wsSend({
        type: "q",
        player: currentPlayer,
        blackQLeft,
        whiteQLeft
      });

      const changed = applyProbabilityForOnline();
      wsSend({ type: "observe", stones: changed });
      checkWinnerAfterObservationRule2();
    } else {
      const changed = applyProbability();

      if (currentPlayer === 1) blackQLeft--;
      else whiteQLeft--;

      let winnerFound = false;
      for (let cy = 0; cy < BOARD_SIZE; cy++) {
        for (let cx = 0; cx < BOARD_SIZE; cx++) {
          if (board[cy][cx] === 1 || board[cy][cx] === 2) {
            const win = checkWin(cx, cy, board[cy][cx]);
            if (win.length > 0) {
              winnerFound = true;
              showWinnerRule2(board[cy][cx], win);
              break;
            }
          }
        }
        if (winnerFound) break;
      }

      if (!winnerFound) {
        setTimeout(() => {
          revertToGray(changed);
        }, 2000);
      }
    }
  }
});
/* =========================
   Main Loop
   ========================= */
function mainLoop(timestamp) {
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

          if (zMode) {
            if (currentPlayer === 1 && blackZLeft <= 0) return;
            if (currentPlayer === 2 && whiteZLeft <= 0) return;

            zEffectAnimation(x, y, currentPlayer);
            showZMessage(currentPlayer);

            probData[y][x] = null;
            board[y][x] = currentPlayer;

            if (currentPlayer === 1) blackZLeft--;
            else whiteZLeft--;

            const win = checkWin(x, y, currentPlayer);
            if (win.length > 0) {
              showWinnerRule1(currentPlayer, win);
            } else {
              currentPlayer = 1;
              updateNextProb();
            }

            zMode = false;
          } else {
            if (nextProb >= 50) board[y][x] = 3;
            else board[y][x] = 4;

            probData[y][x] = nextProb;
            placedCount++;

            if (placedCount % 10 === 0) {
              const changed = applyProbability();

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
                setTimeout(() => {
                  revertToGray(changed);
                }, 2000);
              }
            }

            currentPlayer = 1;
            updateNextProb();
          }
        }
      }
    }

    if (!gameOver && !resetting) {
      drawBoard();
    }
  }

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

/* ============================================================
   📱 スマホ対応：Canvas 自動スケール
   ============================================================ */
function resizeCanvasForMobile() {
  const canvas = document.getElementById("game");

  const SCREEN_W = canvas.width;
  const SCREEN_H = canvas.height;

  const scale = Math.min(
    window.innerWidth / SCREEN_W,
    window.innerHeight / SCREEN_H
  );

  canvas.style.transformOrigin = "top left";
  canvas.style.transform = `scale(${scale})`;
}

window.addEventListener("resize", resizeCanvasForMobile);
window.addEventListener("orientationchange", resizeCanvasForMobile);
setTimeout(resizeCanvasForMobile, 200);

/* ============================================================
   📱 スマホ：タップ → クリック変換
   ============================================================ */
const canvasElement = document.getElementById("game");

canvasElement.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  const rect = canvasElement.getBoundingClientRect();
  const mx = t.clientX - rect.left;
  const my = t.clientY - rect.top;

  canvasElement.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: mx + rect.left,
      clientY: my + rect.top
    })
  );
});

/* ============================================================
   📱 スマホ UI ボタン → キー入力に変換
   ============================================================ */
function bindMobileUIButton(id, key) {
  const btn = document.getElementById(id);
  if (!btn) return;

  btn.addEventListener("click", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });
}

bindMobileUIButton("btn-z", "z");
bindMobileUIButton("btn-q", "q");
bindMobileUIButton("btn-reset", " ");

/* ============================================================
   📱 開始画面のモード選択（暴発防止版）
   ============================================================ */
canvasElement.addEventListener("click", (e) => {
  if (gameStarted) return;

  const rect = canvasElement.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

 /* ============================================================
   📱 開始画面のモード選択（touchend専用・暴発完全防止）
   ============================================================ */
canvasElement.addEventListener("touchend", (e) => {
  if (gameStarted) return;

  const t = e.changedTouches[0];
  const rect = canvasElement.getBoundingClientRect();
  const mx = t.clientX - rect.left;
  const my = t.clientY - rect.top;

  const buttonTop = SCREEN_SIZE - 40;
  const buttonBottom = SCREEN_SIZE;

  if (my < buttonTop || my > buttonBottom) return;

  const totalWidth = SCREEN_SIZE + INFO_WIDTH;
  const quarter = totalWidth / 4;

  let key = null;

  if (mx < quarter) key = "1";
  else if (mx < quarter * 2) key = "2";
  else if (mx < quarter * 3) key = "3";
  else key = "4";

  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
});
