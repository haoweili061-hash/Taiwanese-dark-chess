const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const piecesTemplate = [
  ["帥", "red"], ["仕", "red"], ["仕", "red"], ["相", "red"], ["相", "red"],
  ["俥", "red"], ["俥", "red"], ["傌", "red"], ["傌", "red"], ["炮", "red"], ["炮", "red"],
  ["兵", "red"], ["兵", "red"], ["兵", "red"], ["兵", "red"], ["兵", "red"],
  ["將", "black"], ["士", "black"], ["士", "black"], ["象", "black"], ["象", "black"],
  ["車", "black"], ["車", "black"], ["馬", "black"], ["馬", "black"], ["包", "black"], ["包", "black"],
  ["卒", "black"], ["卒", "black"], ["卒", "black"], ["卒", "black"], ["卒", "black"]
];

const ranks = {
  "帥": 7, "將": 7,
  "仕": 6, "士": 6,
  "相": 5, "象": 5,
  "俥": 4, "車": 4,
  "傌": 3, "馬": 3,
  "炮": 2, "包": 2,
  "兵": 1, "卒": 1
};

const rooms = new Map();
const users = new Map();
const sessions = new Map();
const pendingMatches = new Map();
let matchQueue = null;

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(12).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt] = String(stored).split(":");
  return hashPassword(password, salt) === stored;
}

function getUserByToken(token) {
  const username = sessions.get(token);
  return username ? users.get(username) : null;
}

function makeId(size = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < size; i++) id += alphabet[crypto.randomInt(alphabet.length)];
  return id;
}

function shuffle(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function normalizeRules(rules = {}) {
  return {
    darkEat: rules.darkEat !== false,
    combo: rules.combo !== false,
    rook: rules.rook !== false,
    cannon: rules.cannon !== false,
    horse: rules.horse !== false,
    drawLimit: Math.max(5, Math.min(100, Number(rules.drawLimit) || 25)),
    turnTimeLimit: Math.max(15, Math.min(300, Number(rules.turnTimeLimit) || 60))
  };
}

function createGame(rules) {
  return {
    pieces: shuffle(piecesTemplate).map(([name, color]) => ({ name, color, flipped: false })),
    currentTurn: "red",
    selectedIndex: null,
    comboMode: false,
    logs: ["新局開始，紅方先手。"],
    ghostMarks: {},
    turnCount: 1,
    noCaptureTurns: 0,
    gameOver: false,
    winner: null,
    rules: normalizeRules(rules),
    startedAt: Date.now(),
    endedAt: null,
    turnStartedAt: Date.now(),
    scoreRecorded: false,
    version: 1
  };
}

function publicUser(user) {
  if (!user) return null;
  return {
    username: user.username,
    rating: user.rating,
    wins: user.wins,
    losses: user.losses,
    history: user.history.slice(-12).reverse()
  };
}

function publicRoom(room, playerId = null) {
  const side = playerId ? room.players[playerId] || null : null;
  const isSpectator = Boolean(playerId && room.spectators[playerId]);
  return {
    roomCode: room.code,
    playerId,
    side,
    role: side ? "player" : isSpectator ? "spectator" : null,
    players: Object.values(room.players),
    playerNames: room.playerNames,
    score: room.score,
    ranked: room.ranked,
    mode: room.mode,
    spectatorCount: Object.keys(room.spectators).length,
    ready: Object.keys(room.players).length === 2,
    game: room.game
  };
}

function createRoom({ rules, ranked = false, mode = "room", redName = "紅方" } = {}) {
  let code = makeId();
  while (rooms.has(code)) code = makeId();
  const playerId = crypto.randomUUID();
  const room = {
    code,
    players: { [playerId]: "red" },
    playerNames: { red: redName, black: "黑方" },
    playerUsers: { red: redName || null, black: null },
    spectators: {},
    score: { red: 0, black: 0 },
    ranked,
    mode,
    game: createGame(rules),
    updatedAt: Date.now()
  };
  rooms.set(code, room);
  return { room, playerId };
}

function colorName(color) {
  return color === "red" ? "紅方" : "黑方";
}

function addLog(game, text) {
  game.logs.unshift(text);
  if (game.logs.length > 18) game.logs.pop();
}

function switchTurn(game) {
  game.currentTurn = game.currentTurn === "red" ? "black" : "red";
  game.selectedIndex = null;
  game.comboMode = false;
  game.turnCount += 1;
  game.turnStartedAt = Date.now();
}

function endGame(game, message, winner = null) {
  game.gameOver = true;
  game.winner = winner;
  if (!game.endedAt) game.endedAt = Date.now();
  game.selectedIndex = null;
  game.comboMode = false;
  addLog(game, message);
}

function recordRoomResult(room) {
  const game = room.game;
  if (!game.gameOver || game.scoreRecorded) return;
  game.scoreRecorded = true;
  if (game.winner) room.score[game.winner] += 1;

  const duration = Math.floor(((game.endedAt || Date.now()) - game.startedAt) / 1000);
  const redUser = users.get(normalizeUsername(room.playerUsers.red));
  const blackUser = users.get(normalizeUsername(room.playerUsers.black));
  const winnerName = game.winner ? room.playerUsers[game.winner] || colorName(game.winner) : "平局";
  const ratingChanges = room.ranked ? calculateRatingChanges(room, duration) : { red: 0, black: 0 };

  [
    { user: redUser, side: "red", opponent: room.playerUsers.black || "黑方" },
    { user: blackUser, side: "black", opponent: room.playerUsers.red || "紅方" }
  ].forEach(({ user, side, opponent }) => {
    if (!user) return;
    const won = game.winner === side;
    if (game.winner) {
      if (won) user.wins += 1;
      else user.losses += 1;
    }
    user.history.push({
      time: new Date().toISOString(),
      opponent,
      result: game.winner ? (won ? "勝" : "敗") : "平",
      winner: winnerName,
      duration,
      score: `${room.score.red}:${room.score.black}`,
      ranked: room.ranked,
      ratingChange: ratingChanges[side] || 0
    });
    if (user.history.length > 50) user.history.shift();
  });

  if (room.ranked && redUser && blackUser) {
    redUser.rating = Math.max(100, redUser.rating + ratingChanges.red);
    blackUser.rating = Math.max(100, blackUser.rating + ratingChanges.black);
  }
}

function calculateRatingChanges(room, duration) {
  const game = room.game;
  if (!game.winner) return { red: 0, black: 0 };

  const redAlive = game.pieces.filter(piece => piece && piece.color === "red").length;
  const blackAlive = game.pieces.filter(piece => piece && piece.color === "black").length;
  const winnerAlive = game.winner === "red" ? redAlive : blackAlive;
  const loserAlive = game.winner === "red" ? blackAlive : redAlive;

  const pieceBonus = Math.min(8, Math.max(0, winnerAlive - loserAlive));
  const speedBonus = duration <= 180 ? 4 : duration <= 360 ? 2 : 0;
  const longGamePenalty = duration >= 900 ? 2 : 0;
  const turnBonus = game.turnCount <= 20 ? 3 : game.turnCount <= 40 ? 1 : 0;

  const winnerGain = Math.max(8, Math.min(28, 10 + pieceBonus + speedBonus + turnBonus - longGamePenalty));
  const loserLoss = Math.max(6, Math.min(22, 8 + Math.floor(pieceBonus / 2) + Math.floor(speedBonus / 2) + (turnBonus > 0 ? 1 : 0)));

  return game.winner === "red"
    ? { red: winnerGain, black: -loserLoss }
    : { red: -loserLoss, black: winnerGain };
}

function addNoCaptureTurn(game) {
  game.noCaptureTurns += 1;
  if (game.noCaptureTurns >= game.rules.drawLimit) {
    endGame(game, `${game.rules.drawLimit} 回合沒有吃子，平局。`);
  }
}

function checkWinByElimination(game) {
  const redAlive = game.pieces.some(piece => piece && piece.color === "red");
  const blackAlive = game.pieces.some(piece => piece && piece.color === "black");
  if (!redAlive) endGame(game, "紅方沒有棋子了，黑方獲勝。", "black");
  if (!blackAlive) endGame(game, "黑方沒有棋子了，紅方獲勝。", "red");
}

function getXY(index) {
  return { x: index % 8, y: Math.floor(index / 8) };
}

function isNextTo(a, b) {
  const A = getXY(a);
  const B = getXY(b);
  return Math.abs(A.x - B.x) + Math.abs(A.y - B.y) === 1;
}

function isDiagonalOneStep(a, b) {
  const A = getXY(a);
  const B = getXY(b);
  return Math.abs(A.x - B.x) === 1 && Math.abs(A.y - B.y) === 1;
}

function isSameLine(a, b) {
  const A = getXY(a);
  const B = getXY(b);
  return A.x === B.x || A.y === B.y;
}

function getBetweenIndexes(a, b) {
  const A = getXY(a);
  const B = getXY(b);
  const result = [];
  if (A.x === B.x) {
    for (let y = Math.min(A.y, B.y) + 1; y < Math.max(A.y, B.y); y++) result.push(y * 8 + A.x);
  }
  if (A.y === B.y) {
    for (let x = Math.min(A.x, B.x) + 1; x < Math.max(A.x, B.x); x++) result.push(A.y * 8 + x);
  }
  return result;
}

function isRook(piece) { return piece.name === "俥" || piece.name === "車"; }
function isCannon(piece) { return piece.name === "炮" || piece.name === "包"; }
function isHorse(piece) { return piece.name === "傌" || piece.name === "馬"; }

function canNormalEat(attacker, defender) {
  if (attacker.color === defender.color) return false;
  const attackerIsSoldier = attacker.name === "兵" || attacker.name === "卒";
  const defenderIsKing = defender.name === "帥" || defender.name === "將";
  const attackerIsKing = attacker.name === "帥" || attacker.name === "將";
  const defenderIsSoldier = defender.name === "兵" || defender.name === "卒";
  if (attackerIsSoldier && defenderIsKing) return true;
  if (attackerIsKing && defenderIsSoldier) return false;
  return ranks[attacker.name] >= ranks[defender.name];
}

function canRookEat(game, fromIndex, toIndex) {
  if (!game.rules.rook || !isSameLine(fromIndex, toIndex)) return false;
  const between = getBetweenIndexes(fromIndex, toIndex);
  return between.length >= 1 && between.every(index => game.pieces[index] === null);
}

function canCannonEat(game, fromIndex, toIndex) {
  if (!game.rules.cannon || !isSameLine(fromIndex, toIndex)) return false;
  const blockers = getBetweenIndexes(fromIndex, toIndex).filter(index => game.pieces[index] !== null);
  return blockers.length === 1;
}

function canHorseEat(game, fromIndex, toIndex) {
  return game.rules.horse && isDiagonalOneStep(fromIndex, toIndex);
}

function canEat(game, attacker, defender, fromIndex, toIndex) {
  if (!attacker || !defender || attacker.color === defender.color) return false;
  if (isRook(attacker) && game.rules.rook) return canRookEat(game, fromIndex, toIndex);
  if (isCannon(attacker) && game.rules.cannon) return canCannonEat(game, fromIndex, toIndex);
  if (isHorse(attacker) && game.rules.horse) return canHorseEat(game, fromIndex, toIndex);
  return isNextTo(fromIndex, toIndex) && canNormalEat(attacker, defender);
}

function canAttemptEat(game, attacker, defender, fromIndex, toIndex) {
  if (!attacker || !defender) return false;
  if (defender.flipped && attacker.color === defender.color) return false;
  if (isNextTo(fromIndex, toIndex)) return true;
  if (isRook(attacker) && game.rules.rook && canRookEat(game, fromIndex, toIndex)) return true;
  if (isCannon(attacker) && game.rules.cannon && canCannonEat(game, fromIndex, toIndex)) return true;
  if (isHorse(attacker) && game.rules.horse && canHorseEat(game, fromIndex, toIndex)) return true;
  return false;
}

function applyAction(room, playerId, action) {
  const game = room.game;
  resolveTimeout(room);
  const side = room.players[playerId];
  if (!side && room.spectators[playerId]) return { ok: false, message: "觀戰者不能操作棋局。" };
  if (!side) return { ok: false, message: "你不在這個房間。" };
  if (Object.keys(room.players).length < 2) return { ok: false, message: "還在等待對手加入。" };
  if (game.gameOver && action.type !== "restart") return { ok: false, message: "這局已經結束。" };

  if (action.type === "select") {
    const index = Number(action.index);
    if (!Number.isInteger(index) || index < 0 || index > 31) return { ok: false, message: "位置錯誤。" };
    if (side !== game.currentTurn) return { ok: false, message: "還沒輪到你。" };
    handleClick(game, index);
    game.version += 1;
    recordRoomResult(room);
    return { ok: true };
  }

  if (action.type === "surrender") {
    if (side !== game.currentTurn) return { ok: false, message: "輪到你時才能投降。" };
    const winner = side === "red" ? "black" : "red";
    endGame(game, `${colorName(side)}投降，${colorName(winner)}獲勝。`, winner);
    game.version += 1;
    recordRoomResult(room);
    return { ok: true };
  }

  if (action.type === "restart") {
    room.game = createGame(room.game.rules);
    room.game.version += 1;
    return { ok: true };
  }

  return { ok: false, message: "未知動作。" };
}

function resolveTimeout(room) {
  const game = room.game;
  if (!game || game.gameOver) return;
  const limitMs = game.rules.turnTimeLimit * 1000;
  if (Date.now() - game.turnStartedAt < limitMs) return;
  const loser = game.currentTurn;
  const winner = loser === "red" ? "black" : "red";
  endGame(game, `${colorName(loser)}超時，${colorName(winner)}獲勝。`, winner);
  game.version += 1;
  recordRoomResult(room);
}

function handleClick(game, index) {
  const target = game.pieces[index];
  if (game.selectedIndex === null) {
    if (target && !target.flipped) {
      target.flipped = true;
      addLog(game, `${colorName(game.currentTurn)}翻開 ${target.name}`);
      addNoCaptureTurn(game);
      if (!game.gameOver) switchTurn(game);
      return;
    }
    if (target && target.flipped && target.color === game.currentTurn) game.selectedIndex = index;
    return;
  }

  if (index === game.selectedIndex) {
    if (game.comboMode) {
      addNoCaptureTurn(game);
      if (!game.gameOver) switchTurn(game);
    } else {
      game.selectedIndex = null;
    }
    return;
  }

  const attacker = game.pieces[game.selectedIndex];
  if (!attacker || attacker.color !== game.currentTurn) {
    game.selectedIndex = null;
    return;
  }

  if (!target) {
    if (!game.comboMode && isNextTo(game.selectedIndex, index)) {
      game.pieces[index] = attacker;
      game.pieces[game.selectedIndex] = null;
      addLog(game, `${colorName(game.currentTurn)}移動 ${attacker.name}`);
      addNoCaptureTurn(game);
      if (!game.gameOver) switchTurn(game);
    } else {
      addLog(game, "這一步不能移動。");
    }
    return;
  }

  if (game.comboMode && !canAttemptEat(game, attacker, target, game.selectedIndex, index)) {
    addLog(game, "連吃中只能點選這顆棋可攻擊的位置。");
    return;
  }

  if (!target.flipped && !game.rules.darkEat) {
    target.flipped = true;
    addLog(game, `${colorName(game.currentTurn)}翻開 ${target.name}`);
    addNoCaptureTurn(game);
    if (!game.gameOver) switchTurn(game);
    return;
  }

  tryEat(game, game.selectedIndex, index);
}

function tryEat(game, fromIndex, toIndex) {
  const attacker = game.pieces[fromIndex];
  const defender = game.pieces[toIndex];
  if (!attacker || !defender) return;

  const wasHidden = !defender.flipped;
  if (canEat(game, attacker, defender, fromIndex, toIndex)) {
    game.noCaptureTurns = 0;
    if (wasHidden) {
      game.ghostMarks[toIndex] = { name: defender.name, color: defender.color, eatenBy: attacker.name };
    }
    game.pieces[toIndex] = attacker;
    game.pieces[fromIndex] = null;
    addLog(game, wasHidden
      ? `${colorName(game.currentTurn)}暗吃成功：${attacker.name} 吃掉 ${colorName(defender.color)}${defender.name}`
      : `${colorName(game.currentTurn)}吃掉 ${colorName(defender.color)}${defender.name}`);
    checkWinByElimination(game);
    if (!game.gameOver) {
      if (game.rules.combo) {
        game.selectedIndex = toIndex;
        game.comboMode = true;
      } else {
        switchTurn(game);
      }
    }
    return;
  }

  if (wasHidden) {
    defender.flipped = true;
    addLog(game, `${colorName(game.currentTurn)}暗吃失敗，翻出 ${colorName(defender.color)}${defender.name}`);
    addNoCaptureTurn(game);
    if (!game.gameOver) switchTurn(game);
  } else {
    addLog(game, `不能吃：${attacker.name} 吃不了 ${defender.name}`);
    game.selectedIndex = fromIndex;
  }
}

function serveStatic(req, res) {
  const requested = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".css" ? "text/css; charset=utf-8"
      : ext === ".js" ? "text/javascript; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/register") {
      const body = await readBody(req);
      const username = String(body.username || "").trim();
      const usernameKey = normalizeUsername(username);
      const password = String(body.password || "");
      if (username.length < 2 || password.length < 8) return json(res, 400, { ok: false, message: "帳號至少 2 字，密碼至少 8 碼。" });
      if (users.has(usernameKey)) return json(res, 409, { ok: false, message: "這個帳號已被註冊。" });
      const user = { username, passwordHash: hashPassword(password), rating: 1000, wins: 0, losses: 0, history: [] };
      users.set(usernameKey, user);
      const token = crypto.randomUUID();
      sessions.set(token, usernameKey);
      return json(res, 200, { token, user: publicUser(user) });
    }

    if (req.method === "POST" && req.url === "/api/login") {
      const body = await readBody(req);
      const user = users.get(normalizeUsername(body.username));
      if (!user || !verifyPassword(body.password || "", user.passwordHash)) return json(res, 401, { ok: false, message: "帳號或密碼錯誤。" });
      const token = crypto.randomUUID();
      sessions.set(token, user.username);
      return json(res, 200, { token, user: publicUser(user) });
    }

    if (req.method === "GET" && req.url.startsWith("/api/me")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      return json(res, 200, { user: publicUser(getUserByToken(url.searchParams.get("token"))) });
    }

    if (req.method === "GET" && req.url === "/api/leaderboard") {
      const leaderboard = Array.from(users.values())
        .filter(user => user.rating >= 1200)
        .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
        .slice(0, 20)
        .map(user => ({
          username: user.username,
          rating: user.rating,
          wins: user.wins,
          losses: user.losses
        }));
      return json(res, 200, { leaderboard });
    }

    if (req.method === "POST" && req.url === "/api/create-room") {
      const body = await readBody(req);
      const user = getUserByToken(body.token);
      const { room, playerId } = createRoom({ rules: body.rules, ranked: Boolean(body.ranked), redName: user ? user.username : "紅方" });
      room.playerUsers.red = user ? user.username : null;
      return json(res, 200, publicRoom(room, playerId));
    }

    if (req.method === "POST" && req.url === "/api/quick-match") {
      const body = await readBody(req);
      const user = getUserByToken(body.token);
      if (!user) return json(res, 401, { ok: false, message: "請先登入才能配對。" });
      if (matchQueue && matchQueue.username !== user.username) {
        const waiting = matchQueue;
        matchQueue = null;
        const { room, playerId: redId } = createRoom({ rules: waiting.rules, ranked: waiting.ranked, mode: "match", redName: waiting.username });
        const blackId = crypto.randomUUID();
        room.players[blackId] = "black";
        room.playerNames.black = user.username;
        room.playerUsers.red = waiting.username;
        room.playerUsers.black = user.username;
        room.ranked = waiting.ranked || Boolean(body.ranked);
        pendingMatches.set(waiting.username, { roomCode: room.code, playerId: redId });
        return json(res, 200, {
          matched: true,
          roomCode: room.code,
          red: { playerId: redId, username: waiting.username },
          black: { playerId: blackId, username: user.username },
          state: publicRoom(room, blackId)
        });
      }
      matchQueue = { username: user.username, rules: body.rules, ranked: Boolean(body.ranked), queuedAt: Date.now() };
      return json(res, 200, { matched: false, message: "已加入配對，等待對手。" });
    }

    if (req.method === "GET" && req.url.startsWith("/api/match-status")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const user = getUserByToken(url.searchParams.get("token"));
      if (!user) return json(res, 401, { ok: false, message: "請先登入。" });
      const match = pendingMatches.get(user.username);
      if (!match) return json(res, 200, { matched: false });
      pendingMatches.delete(user.username);
      const room = rooms.get(match.roomCode);
      return json(res, 200, { matched: true, state: publicRoom(room, match.playerId) });
    }

    if (req.method === "POST" && req.url === "/api/join-room") {
      const body = await readBody(req);
      const user = getUserByToken(body.token);
      const code = String(body.roomCode || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return json(res, 404, { ok: false, message: "找不到這個房間。" });
      const existingPlayer = body.playerId && room.players[body.playerId];
      const existingSpectator = body.playerId && room.spectators[body.playerId];
      const playerId = existingPlayer || existingSpectator ? body.playerId : crypto.randomUUID();
      if (!existingPlayer && !existingSpectator) {
        if (Object.keys(room.players).length < 2) {
          room.players[playerId] = "black";
          room.playerNames.black = user ? user.username : "黑方";
          room.playerUsers.black = user ? user.username : null;
        } else {
          room.spectators[playerId] = true;
        }
      }
      room.updatedAt = Date.now();
      return json(res, 200, publicRoom(room, playerId));
    }

    if (req.method === "GET" && req.url.startsWith("/api/state")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const room = rooms.get(String(url.searchParams.get("roomCode") || "").toUpperCase());
      if (!room) return json(res, 404, { ok: false, message: "找不到這個房間。" });
      resolveTimeout(room);
      room.updatedAt = Date.now();
      return json(res, 200, publicRoom(room, url.searchParams.get("playerId")));
    }

    if (req.method === "POST" && req.url === "/api/action") {
      const body = await readBody(req);
      const room = rooms.get(String(body.roomCode || "").trim().toUpperCase());
      if (!room) return json(res, 404, { ok: false, message: "找不到這個房間。" });
      const result = applyAction(room, body.playerId, body.action || {});
      room.updatedAt = Date.now();
      return json(res, result.ok ? 200 : 400, { ...result, state: publicRoom(room, body.playerId) });
    }

    serveStatic(req, res);
  } catch (error) {
    json(res, 500, { ok: false, message: error.message });
  }
});

setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 6;
  for (const [code, room] of rooms) {
    if (room.updatedAt < cutoff) rooms.delete(code);
  }
  if (matchQueue && matchQueue.queuedAt < Date.now() - 1000 * 60 * 5) matchQueue = null;
}, 1000 * 60 * 10).unref();

server.listen(PORT, () => {
  console.log(`Dark Chess Online running at http://localhost:${PORT}`);
});
