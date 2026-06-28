// ============================================================
// Quantum Gomoku - WebSocket Server
// 対戦は 2 人専用（Host = 黒 / Client = 白）
// ============================================================

const WebSocket = require("ws");
const PORT = 8080;

const wss = new WebSocket.Server({ port: PORT });

console.log("Quantum Gomoku WebSocket Server 起動:", PORT);

// --- 接続中のクライアント管理 ---
let clients = {};   // clientId → ws
let players = {};   // playerColor → clientId（1=黒, 2=白）

// --- ブロードキャスト（送信者以外へ送信） ---
function broadcastExcept(senderId, obj) {
  const msg = JSON.stringify(obj);
  for (const cid in clients) {
    if (cid !== senderId) {
      const ws = clients[cid];
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }
}

// --- 新規接続 ---
wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.log("Invalid JSON:", data);
      return;
    }

    const { clientId, type } = msg;

    // 初回接続時に clientId を登録
    if (!clients[clientId]) {
      clients[clientId] = ws;
      console.log("Registered client:", clientId);
    }

    // プレイヤー色登録（hello）
    if (type === "hello") {
      const player = msg.player; // 1=黒, 2=白
      players[player] = clientId;
      console.log(`Player ${player === 1 ? "Black" : "White"} joined:`, clientId);
      return;
    }

    // --- ゲームメッセージは送信者以外へ転送 ---
    switch (type) {
      case "move":
      case "observe":
      case "reset":
      case "z":
      case "q":
        broadcastExcept(clientId, msg);
        break;

      default:
        console.log("Unknown message:", msg);
        break;
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");

    // クライアント削除
    for (const cid in clients) {
      if (clients[cid] === ws) {
        delete clients[cid];

        // プレイヤー登録解除
        for (const p in players) {
          if (players[p] === cid) delete players[p];
        }

        break;
      }
    }
  });
});
