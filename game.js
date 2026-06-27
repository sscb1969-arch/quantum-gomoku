/* =========================
   Quantum Gomoku - Browser Edition
   完全統合版 game.js
   - Zキー：次の1手に適用
   - 開始画面タッチ対応
   - スマホ対応（スケール・タップ変換・UIボタン）
   - WebSocket対応
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

/* --- Zキー：次の1手に適用 --- */
let zPending = false;

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

  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    onlineConnected = true;
    wsSend({ type: "hello", player: onlinePlayer });
  });

  ws.addEventListener("close", () => {
    onlineConnected = false;
  });

  ws.addEventListener("message", (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.clientId === onlineClientId) return;
      handleOnlineMessage(msg);
    } catch {}
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
   Online Apply Functions
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

  updateNextProb();
}

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

function applyOnlineObserve(msg) {
  const stones = msg.stones || [];
  for (const s of stones) {
    const { x, y, p, val } = s;
    probData[y][x] = p;
    board[y][x] = val;
  }
  checkWinnerAfterObservationRule1();
}

function applyOnlineZ(msg) {
  const { x, y, player, blackZLeft: bz, whiteZLeft: wz } = msg;

  currentPlayer = player;
  blackZLeft = bz;
  whiteZLeft = wz;

  probData[y][x] = null;
  board[y][x] = player;

  const win = checkWin(x, y, player);
  if (win.length > 0) {
    showWinnerRule1(player, win);
  } else {
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateNextProb();
  }
}

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
   Drawing Functions
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

      if (val === 1) drawCircle(cx, cy, STONE_RADIUS, BLACK_STONE, 1);
      else if (val === 2) drawCircle(cx, cy, STONE_RADIUS, WHITE_STONE, 1);
      else if (val === 3 || val === 4) {
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
    if (board[hy][hx] === 0) {
      const cx = MARGIN + hx * CELL_SIZE;
      const cy = MARGIN + hy * CELL_SIZE;
      drawCircle(cx, cy, STONE_RADIUS, null, 2, "#cccccc");
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
    "2：Qキー観測ルール（ポイント制）",
    "3：AI対戦（ルール1）",
    "4：オンライン対戦（WebSocket）",
  ];

  let y = 220;
  for (const line of lines) {
    ctx.fillText(line, (SCREEN_SIZE + INFO_WIDTH) / 2, y);
    y += 40;
  }

  if (blinkVisible(500)) {
    ctx.fillStyle = "rgb(100,100,200)";
    ctx.font = "24px Meiryo";
    ctx.fillText("タップ または 1 / 2 / 3 / 4 で開始", (SCREEN_SIZE + INFO_WIDTH) / 2, SCREEN_SIZE - 10);
  }
}

/* =========================
   Start Screen Tap Handling
   ========================= */
function startGameWithRule(rule) {
  if (rule === 1) {
    selectedRule = 1;
    aiMode = false;
    onlineMode = false;
  } else if (rule === 2) {
    selectedRule = 2;
    aiMode = false;
    onlineMode = false;
  } else if (rule === 3) {
    selectedRule = 1;
    aiMode = true;
    onlineMode = false;
  } else if (rule === 4) {
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

function handleStartScreenTap(mx, my) {
  if (my > 200 && my < 240) startGameWithRule(1);
  else if (my > 240 && my < 280) startGameWithRule(2);
  else if (my > 280 && my < 320) startGameWithRule(3);
  else if (my > 320 && my < 360) startGameWithRule(4);
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
   Mouse Click (Place Stone)
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
  if (board[y][x] !== 0) return;

  /* --- Zキー：次の1手に適用 --- */
  if (zPending) {
    probData[y][x] = null;
    board[y][x] = currentPlayer;
    zPending = false;
  } else {
    if (nextProb >= 50) board[y][x] = 3;
    else board[y][x] = 4;
    probData[y][x] = nextProb;
  }

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
      setTimeout(() => revertToGray(changed), 2000);
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
});

/* =========================
   Touch → Click
   ========================= */
canvas.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const mx = t.clientX - rect.left;
  const my = t.clientY - rect.top;

  if (!gameStarted) {
    handleStartScreenTap(mx, my);
    return;
  }

  canvas.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: mx + rect.left,
      clientY: my + rect.top
    })
  );
});

/* =========================
   Keyboard Input
   ========================= */
window.addEventListener("keydown", (e) => {

  /* --- Secret Command Buffer --- */
  secretBuffer.push(e.key);
  if (secretBuffer.length > 10) secretBuffer.shift();

  const lower = secretBuffer.map(k => k.toLowerCase());
  const target = SECRET_CODE.map(k => k.toLowerCase());

  if (JSON.stringify(lower) === JSON.stringify(target)) {
    activateSecretCommand();
  }

  if (!gameStarted) {
    if (["1","2","3","4"].includes(e.key)) {
      startGameWithRule(Number(e.key));
    }
    return;
  }

  if (e.key === " " && gameOver) {
    resetGame();
    startFadeIn();
  }

  /* --- Zキー：次の1手に適用 --- */
  if (e.key.toLowerCase() === "z" && !gameOver) {
    if (currentPlayer === 1 && blackZLeft <= 0) return;
    if (currentPlayer === 2 && whiteZLeft <= 0) return;

    zPending = true;

    if (currentPlayer === 1) blackZLeft--;
    else whiteZLeft--;

    return;
  }

  /* --- Qキー（ルール2） --- */
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

      setTimeout(() => revertToGray(changed), 2000);
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
    if (!gameOver && !resetting) drawBoard();
  }

  if (showStartMessage) {
    const elapsed = performance.now() - startMessageTime;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, SCREEN_SIZE + INFO_WIDTH, WINDOW_HEIGHT);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 60px Meiryo";
    ctx.textAlign = "center";
    ctx.fillText("ゲームスタート！", (SCREEN_SIZE + INFO_WIDTH) / 2, SCREEN_SIZE / 2);

    if (elapsed > 1000) showStartMessage = false;
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

/* =========================
   📱 スマホ対応：Canvas 自動スケール
   ========================= */
function resizeCanvasForMobile() {
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

/* =========================
   📱 スマホ UI ボタン → キー入力
   ========================= */
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
