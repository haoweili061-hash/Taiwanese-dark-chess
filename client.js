const $ = id => document.getElementById(id);

const menuScreen = $("menuScreen");
const onlineScreen = $("onlineScreen");
const gameScreen = $("gameScreen");
const board = $("board");
const statusText = $("status");
const battleLog = $("battleLog");
const redInfo = $("redInfo");
const blackInfo = $("blackInfo");
const redCount = $("redCount");
const blackCount = $("blackCount");
const roomBar = $("roomBar");
const roomLabel = $("roomLabel");
const timerText = $("timerText");
const scoreText = $("scoreText");
const playerNamesText = $("playerNamesText");
const turnTimerText = $("turnTimerText");

const piecesTemplate = [
  ["帥", "red"], ["仕", "red"], ["仕", "red"], ["相", "red"], ["相", "red"],
  ["俥", "red"], ["俥", "red"], ["傌", "red"], ["傌", "red"], ["炮", "red"], ["炮", "red"],
  ["兵", "red"], ["兵", "red"], ["兵", "red"], ["兵", "red"], ["兵", "red"],
  ["將", "black"], ["士", "black"], ["士", "black"], ["象", "black"], ["象", "black"],
  ["車", "black"], ["車", "black"], ["馬", "black"], ["馬", "black"], ["包", "black"], ["包", "black"],
  ["卒", "black"], ["卒", "black"], ["卒", "black"], ["卒", "black"], ["卒", "black"]
];

const ranks = { "帥": 7, "將": 7, "仕": 6, "士": 6, "相": 5, "象": 5, "俥": 4, "車": 4, "傌": 3, "馬": 3, "炮": 2, "包": 2, "兵": 1, "卒": 1 };
const inventory = {
  red: { "帥": 1, "仕": 2, "相": 2, "俥": 2, "傌": 2, "炮": 2, "兵": 5 },
  black: { "將": 1, "士": 2, "象": 2, "車": 2, "馬": 2, "包": 2, "卒": 5 }
};

let mode = "offline";
let game = null;
let score = { red: 0, black: 0 };
let roomCode = "";
let playerId = "";
let playerSide = "";
let playerRole = "";
let spectatorCount = 0;
let playerNames = { red: "紅方", black: "黑方" };
let authToken = localStorage.getItem("darkChessToken") || "";
let currentUser = null;
let pollTimer = null;
let matchPollTimer = null;
let timerInterval = null;
let previousFlipState = [];
let lastSoundSignature = "";

let audioContext = null;
let musicOn = false;
let soundOn = true;
let musicTimer = null;
let musicNodes = [];
let musicStep = 0;
let musicMode = "menu";

function show(screen) {
  [menuScreen, onlineScreen, gameScreen].forEach(item => item.classList.add("hidden"));
  screen.classList.remove("hidden");
}

function getRules() {
  return {
    darkEat: $("darkEatRule").checked,
    combo: $("comboRule").checked,
    rook: $("rookRule").checked,
    cannon: $("cannonRule").checked,
    horse: $("horseRule").checked,
    drawLimit: Number($("drawLimitInput").value) || 25,
    turnTimeLimit: Number($("turnTimeInput").value) || 60
  };
}

function colorName(color) {
  return color === "red" ? "紅方" : "黑方";
}

function roleName() {
  if (playerRole === "spectator") return "觀戰者";
  return playerSide ? colorName(playerSide) : "未入座";
}

function sanitizeText(text) {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "連線失敗");
  return data;
}

async function refreshMe() {
  if (!authToken) return renderProfile();
  try {
    const data = await api(`/api/me?token=${encodeURIComponent(authToken)}`);
    currentUser = data.user;
  } catch {
    currentUser = null;
    authToken = "";
    localStorage.removeItem("darkChessToken");
  }
  renderProfile();
  refreshLeaderboard();
}

async function refreshLeaderboard() {
  try {
    const data = await api("/api/leaderboard");
    const list = data.leaderboard || [];
    $("leaderboardList").innerHTML = list.length
      ? list.map((user, index) => `<div class="history-item">#${index + 1} ${sanitizeText(user.username)}｜${user.rating} 分｜勝 ${user.wins}｜敗 ${user.losses}</div>`).join("")
      : `<div class="history-item">目前尚無 1200 分以上玩家。</div>`;
  } catch {
    $("leaderboardList").innerHTML = `<div class="history-item">排行榜暫時無法載入。</div>`;
  }
}

function renderProfile() {
  $("accountStatus").textContent = currentUser
    ? `已登入：${currentUser.username}｜排位 ${currentUser.rating}`
    : "尚未登入";
  $("profileStats").textContent = currentUser
    ? `勝 ${currentUser.wins}｜敗 ${currentUser.losses}｜排位分 ${currentUser.rating}`
    : "登入後顯示排位分數與歷史紀錄。";
  const history = currentUser && currentUser.history ? currentUser.history : [];
  $("historyList").innerHTML = history.length
    ? history.map(item => {
      const ratingText = item.ranked ? `｜積分 ${item.ratingChange > 0 ? "+" : ""}${item.ratingChange || 0}` : "";
      return `<div class="history-item">${item.ranked ? "排位" : "一般"}｜${sanitizeText(item.result)}｜對手 ${sanitizeText(item.opponent)}｜比分 ${sanitizeText(item.score)}${ratingText}</div>`;
    }).join("")
    : "";
}

function createLocalGame() {
  return {
    pieces: piecesTemplate.slice().sort(() => Math.random() - 0.5).map(([name, color]) => ({ name, color, flipped: false })),
    currentTurn: "red",
    selectedIndex: null,
    comboMode: false,
    logs: ["新局開始，紅方先手。"],
    ghostMarks: {},
    turnCount: 1,
    noCaptureTurns: 0,
    gameOver: false,
    winner: null,
    rules: getRules(),
    startedAt: Date.now(),
    endedAt: null,
    turnStartedAt: Date.now(),
    version: 1
  };
}

function addLog(text) {
  game.logs.unshift(text);
  if (game.logs.length > 18) game.logs.pop();
}

function switchTurn() {
  game.currentTurn = game.currentTurn === "red" ? "black" : "red";
  game.selectedIndex = null;
  game.comboMode = false;
  game.turnCount += 1;
  game.turnStartedAt = Date.now();
}

function endGame(message, winner = null) {
  game.gameOver = true;
  game.winner = winner;
  game.endedAt = game.endedAt || Date.now();
  game.selectedIndex = null;
  game.comboMode = false;
  if (winner) score[winner] += 1;
  addLog(message);
}

function addNoCaptureTurn() {
  game.noCaptureTurns += 1;
  if (game.noCaptureTurns >= game.rules.drawLimit) endGame(`${game.rules.drawLimit} 回合沒有吃子，平局。`);
}

function checkWinByElimination() {
  const redAlive = game.pieces.some(piece => piece && piece.color === "red");
  const blackAlive = game.pieces.some(piece => piece && piece.color === "black");
  if (!redAlive) endGame("紅方沒有棋子了，黑方獲勝。", "black");
  if (!blackAlive) endGame("黑方沒有棋子了，紅方獲勝。", "red");
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
  if (A.x === B.x) for (let y = Math.min(A.y, B.y) + 1; y < Math.max(A.y, B.y); y++) result.push(y * 8 + A.x);
  if (A.y === B.y) for (let x = Math.min(A.x, B.x) + 1; x < Math.max(A.x, B.x); x++) result.push(A.y * 8 + x);
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

function canEat(attacker, defender, fromIndex, toIndex) {
  if (!attacker || !defender || attacker.color === defender.color) return false;
  if (isRook(attacker) && game.rules.rook && isSameLine(fromIndex, toIndex)) {
    const between = getBetweenIndexes(fromIndex, toIndex);
    return between.length >= 1 && between.every(index => game.pieces[index] === null);
  }
  if (isCannon(attacker) && game.rules.cannon && isSameLine(fromIndex, toIndex)) {
    return getBetweenIndexes(fromIndex, toIndex).filter(index => game.pieces[index] !== null).length === 1;
  }
  if (isHorse(attacker) && game.rules.horse) return isDiagonalOneStep(fromIndex, toIndex);
  return isNextTo(fromIndex, toIndex) && canNormalEat(attacker, defender);
}

function canAttemptEat(attacker, defender, fromIndex, toIndex) {
  if (!attacker || !defender) return false;
  if (defender.flipped && attacker.color === defender.color) return false;
  if (isNextTo(fromIndex, toIndex)) return true;
  if (isRook(attacker) && game.rules.rook && isSameLine(fromIndex, toIndex)) {
    const between = getBetweenIndexes(fromIndex, toIndex);
    return between.length >= 1 && between.every(index => game.pieces[index] === null);
  }
  if (isCannon(attacker) && game.rules.cannon && isSameLine(fromIndex, toIndex)) {
    return getBetweenIndexes(fromIndex, toIndex).filter(index => game.pieces[index] !== null).length === 1;
  }
  if (isHorse(attacker) && game.rules.horse) return isDiagonalOneStep(fromIndex, toIndex);
  return false;
}

function canAiTargetDuringCombo(attacker, target, fromIndex, toIndex) {
  if (!attacker || !target) return false;
  if (!target.flipped) return canAttemptEat(attacker, target, fromIndex, toIndex);
  return canEat(attacker, target, fromIndex, toIndex);
}

function handleLocalClick(index) {
  if (!game || game.gameOver) return;
  const target = game.pieces[index];
  if (game.selectedIndex === null) {
    if (target && !target.flipped) {
      target.flipped = true;
      addLog(`${colorName(game.currentTurn)}翻開 ${target.name}`);
      addNoCaptureTurn();
      if (!game.gameOver) switchTurn();
      return;
    }
    if (target && target.flipped && target.color === game.currentTurn) game.selectedIndex = index;
    return;
  }

  if (index === game.selectedIndex) {
    if (game.comboMode) {
      addNoCaptureTurn();
      if (!game.gameOver) switchTurn();
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
      addLog(`${colorName(game.currentTurn)}移動 ${attacker.name}`);
      addNoCaptureTurn();
      if (!game.gameOver) switchTurn();
    } else {
      addLog("這一步不能移動。");
    }
    return;
  }

  if (game.comboMode && !canAttemptEat(attacker, target, game.selectedIndex, index)) {
    addLog("連吃中只能點選這顆棋可攻擊的位置。");
    return;
  }

  if (!target.flipped && !game.rules.darkEat) {
    target.flipped = true;
    addLog(`${colorName(game.currentTurn)}翻開 ${target.name}`);
    addNoCaptureTurn();
    if (!game.gameOver) switchTurn();
    return;
  }

  tryLocalEat(game.selectedIndex, index);
}

function tryLocalEat(fromIndex, toIndex) {
  const attacker = game.pieces[fromIndex];
  const defender = game.pieces[toIndex];
  const wasHidden = defender && !defender.flipped;
  if (!attacker || !defender) return;

  if (canEat(attacker, defender, fromIndex, toIndex)) {
    game.noCaptureTurns = 0;
    if (wasHidden) game.ghostMarks[toIndex] = { name: defender.name, color: defender.color, eatenBy: attacker.name };
    game.pieces[toIndex] = attacker;
    game.pieces[fromIndex] = null;
    addLog(wasHidden ? `${colorName(game.currentTurn)}暗吃成功：${attacker.name} 吃掉 ${colorName(defender.color)}${defender.name}` : `${colorName(game.currentTurn)}吃掉 ${colorName(defender.color)}${defender.name}`);
    checkWinByElimination();
    if (!game.gameOver) {
      if (game.rules.combo) {
        game.selectedIndex = toIndex;
        game.comboMode = true;
      } else {
        switchTurn();
      }
    }
    return;
  }

  if (wasHidden) {
    defender.flipped = true;
    addLog(`${colorName(game.currentTurn)}暗吃失敗，翻出 ${colorName(defender.color)}${defender.name}`);
    addNoCaptureTurn();
    if (!game.gameOver) switchTurn();
  } else {
    addLog(`不能吃：${attacker.name} 吃不了 ${defender.name}`);
    game.selectedIndex = fromIndex;
  }
}

function canCurrentUserAct(ready) {
  if (!ready || !game || game.gameOver) return false;
  if (mode === "online") return playerRole === "player" && playerSide === game.currentTurn;
  if (mode === "ai") return game.currentTurn === "red";
  return true;
}

function rememberFlipState() {
  previousFlipState = game ? game.pieces.map(piece => Boolean(piece && piece.flipped)) : [];
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function updateTimerText() {
  if (!game) return;
  const end = game.endedAt || Date.now();
  timerText.textContent = `對局時間 ${formatDuration((end - game.startedAt) / 1000)}`;
  const limit = game.rules.turnTimeLimit || 60;
  const remaining = game.gameOver ? 0 : Math.max(0, Math.ceil(limit - (Date.now() - game.turnStartedAt) / 1000));
  turnTimerText.textContent = game.gameOver ? "本回合已結束" : `本回合剩餘 ${remaining} 秒`;
  if (remaining <= 0 && mode !== "online" && !game.gameOver) {
    const loser = game.currentTurn;
    const winner = loser === "red" ? "black" : "red";
    endGame(`${colorName(loser)}超時，${colorName(winner)}獲勝。`, winner);
    renderBoard(true);
    rememberFlipState();
  }
}

function renderBoard(ready = true) {
  if (!game) return;
  board.innerHTML = "";
  roomBar.classList.toggle("hidden", mode !== "online");
  if (mode === "online") {
    roomLabel.textContent = `房號 ${roomCode}｜你是${roleName()}｜${playerNames.red} vs ${playerNames.black}｜觀戰 ${spectatorCount} 人`;
  }
  scoreText.textContent = `比分 紅 ${score.red || 0} : ${score.black || 0} 黑`;
  playerNamesText.textContent = `${playerNames.red || "紅方"}（紅） vs ${playerNames.black || "黑方"}（黑）`;
  updateTimerText();

  const activeMatch = ready && !game.gameOver;
  const isSpectator = mode === "online" && playerRole === "spectator";
  $("restartBtn").classList.toggle("hidden", activeMatch);
  $("backMenuBtn").classList.toggle("hidden", activeMatch && !isSpectator);
  $("surrenderBtn").classList.toggle("hidden", !activeMatch || isSpectator);

  if (!ready) statusText.textContent = "等待第二位玩家加入。";
  else if (game.gameOver) statusText.textContent = game.winner ? `遊戲結束：${colorName(game.winner)}獲勝` : "遊戲結束：平局";
  else statusText.textContent = game.comboMode
    ? `第 ${game.turnCount} 回合，${colorName(game.currentTurn)}連吃中`
    : `第 ${game.turnCount} 回合，輪到${colorName(game.currentTurn)}`;

  const disabled = !canCurrentUserAct(ready);
  game.pieces.forEach((piece, index) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    if (disabled) cell.classList.add("disabled");
    if (game.selectedIndex === index) cell.classList.add("selected");

    const ghost = game.ghostMarks[index];
    if (ghost) {
      const ghostDiv = document.createElement("div");
      ghostDiv.className = `ghost-mark ghost-${ghost.color}`;
      ghostDiv.textContent = ghost.name;
      cell.appendChild(ghostDiv);
    }

    if (piece) {
      const pieceDiv = document.createElement("div");
      pieceDiv.className = "piece";
      if (piece.flipped) {
        pieceDiv.textContent = piece.name;
        pieceDiv.classList.add(piece.color);
        if (!previousFlipState[index]) pieceDiv.classList.add("reveal-anim");
      } else {
        pieceDiv.textContent = "?";
      }
      cell.appendChild(pieceDiv);
    }

    cell.addEventListener("click", () => {
      if (disabled) return;
      sendAction({ type: "select", index });
    });
    board.appendChild(cell);
  });

  renderPieceInfo();
  renderLog();
}

function renderPieceInfo() {
  redInfo.innerHTML = "";
  blackInfo.innerHTML = "";
  redCount.textContent = `剩餘：${game.pieces.filter(piece => piece && piece.color === "red").length}`;
  blackCount.textContent = `剩餘：${game.pieces.filter(piece => piece && piece.color === "black").length}`;
  renderSideInfo("red", redInfo);
  renderSideInfo("black", blackInfo);
}

function renderSideInfo(color, container) {
  Object.entries(inventory[color]).forEach(([pieceName, total]) => {
    let hidden = 0;
    let alive = 0;
    let dead = total;
    game.pieces.forEach(piece => {
      if (piece && piece.name === pieceName && piece.color === color) {
        dead -= 1;
        if (piece.flipped) alive += 1;
        else hidden += 1;
      }
    });
    const row = document.createElement("div");
    row.className = "piece-row";
    row.innerHTML = `<strong>${pieceName}</strong> <span class="hidden-state">${"?".repeat(hidden)}</span><span class="alive-state">${"●".repeat(alive)}</span><span class="dead-state">${"×".repeat(dead)}</span>`;
    container.appendChild(row);
  });
}

function renderLog() {
  battleLog.innerHTML = "";
  game.logs.forEach(log => {
    const div = document.createElement("div");
    div.className = "log-item";
    div.textContent = log;
    battleLog.appendChild(div);
  });
}

function getAudioContext() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return audioContext;
}

function playTone(freq, duration = 0.12, volume = 0.04, type = "sine") {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.02);
}

function playSfx(kind) {
  if (!soundOn) return;
  const map = {
    flip: [659, 0.1, 0.045, "sine"],
    move: [392, 0.08, 0.04, "square"],
    capture: [220, 0.16, 0.06, "sawtooth"],
    fail: [147, 0.18, 0.05, "triangle"],
    win: [784, 0.25, 0.06, "sine"],
    select: [523, 0.05, 0.035, "triangle"]
  };
  playTone(...(map[kind] || map.select));
}

function playSoundForState(nextGame) {
  const latest = nextGame && nextGame.logs ? nextGame.logs[0] : "";
  const signature = `${nextGame.version || nextGame.turnCount}-${latest}`;
  if (signature === lastSoundSignature) return;
  lastSoundSignature = signature;
  if (nextGame.gameOver) playSfx("win");
  else if (latest.includes("暗吃成功") || latest.includes("吃掉")) playSfx("capture");
  else if (latest.includes("失敗") || latest.includes("不能")) playSfx("fail");
  else if (latest.includes("移動")) playSfx("move");
  else if (latest.includes("翻開")) playSfx("flip");
}

function startMusic() {
  const ctx = getAudioContext();
  ctx.resume();
  stopMusic();
  musicOn = true;
  $("musicToggleBtn").textContent = "音樂 On";
  const master = ctx.createGain();
  const battle = musicMode === "battle";
  master.gain.value = battle ? 0.036 : 0.025;
  master.connect(ctx.destination);
  const bass = ctx.createOscillator();
  bass.type = "triangle";
  bass.frequency.value = battle ? 196 : 147;
  bass.connect(master);
  bass.start();
  musicNodes = [bass, master];
  const notes = battle ? [392, 440, 523, 587, 523, 440, 392, 330] : [294, 330, 392, 440, 392, 330, 262, 294];
  musicTimer = setInterval(() => {
    if (musicOn) playTone(notes[musicStep % notes.length], battle ? 0.16 : 0.22, battle ? 0.032 : 0.023, battle ? "square" : "sine");
    musicStep += 1;
  }, battle ? 310 : 520);
}

function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  musicNodes.forEach(node => {
    try { if (node.stop) node.stop(); } catch {}
    try { if (node.disconnect) node.disconnect(); } catch {}
  });
  musicNodes = [];
  musicOn = false;
  $("musicToggleBtn").textContent = "音樂 Off";
}

function toggleMusic() {
  if (musicOn) stopMusic();
  else startMusic();
}

function toggleSound() {
  soundOn = !soundOn;
  $("soundToggleBtn").textContent = soundOn ? "音效 On" : "音效 Off";
  if (soundOn) playSfx("select");
}

function setMusicMode(nextMode) {
  if (musicMode === nextMode) return;
  musicMode = nextMode;
  if (musicOn) startMusic();
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerText, 1000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function stopMatchPolling() {
  if (matchPollTimer) clearInterval(matchPollTimer);
  matchPollTimer = null;
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refreshOnlineState, 700);
  startTimer();
}

async function refreshOnlineState() {
  if (mode !== "online" || !roomCode || !playerId) return;
  try {
    const state = await api(`/api/state?roomCode=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(playerId)}`);
    applyServerState(state);
  } catch (error) {
    statusText.textContent = error.message;
  }
}

function applyServerState(state) {
  roomCode = state.roomCode;
  playerId = state.playerId;
  playerSide = state.side;
  playerRole = state.role;
  spectatorCount = state.spectatorCount || 0;
  playerNames = state.playerNames || playerNames;
  score = state.score || score;
  playSoundForState(state.game);
  game = state.game;
  renderBoard(state.ready);
  rememberFlipState();
}

async function sendAction(action) {
  if (mode === "online") {
    try {
      const result = await api("/api/action", { method: "POST", body: { roomCode, playerId, action } });
      applyServerState(result.state);
      await refreshMe();
      await refreshLeaderboard();
    } catch (error) {
      statusText.textContent = error.message;
    }
    return;
  }
  applyLocalAction(action);
}

function applyLocalAction(action) {
  if (action.type === "restart") {
    game = createLocalGame();
    lastSoundSignature = "";
    previousFlipState = [];
    renderBoard(true);
    rememberFlipState();
    return;
  }
  if (game.gameOver) return;
  if (action.type === "surrender") {
    const loser = game.currentTurn;
    const winner = loser === "red" ? "black" : "red";
    endGame(`${colorName(loser)}投降，${colorName(winner)}獲勝。`, winner);
  }
  if (action.type === "select") handleLocalClick(Number(action.index));
  game.version += 1;
  playSoundForState(game);
  renderBoard(true);
  rememberFlipState();
  if (mode === "ai" && !game.gameOver && game.currentTurn === "black") setTimeout(runAiTurn, 450);
}

function runAiTurn() {
  if (!game || game.gameOver || game.currentTurn !== "black") return;

  if (game.comboMode && game.selectedIndex !== null) {
    const attacker = game.pieces[game.selectedIndex];
    const comboTargets = [];
    if (attacker && attacker.color === "black") {
      game.pieces.forEach((target, to) => {
        if (target && canAiTargetDuringCombo(attacker, target, game.selectedIndex, to)) {
          comboTargets.push(to);
        }
      });
    }

    if (comboTargets.length) {
      handleLocalClick(comboTargets[Math.floor(Math.random() * comboTargets.length)]);
    } else {
      handleLocalClick(game.selectedIndex);
    }

    game.version += 1;
    playSoundForState(game);
    renderBoard(true);
    rememberFlipState();

    if (!game.gameOver && game.currentTurn === "black") setTimeout(runAiTurn, 450);
    return;
  }

  const candidates = [];
  game.pieces.forEach((piece, from) => {
    if (!piece || !piece.flipped || piece.color !== "black") return;
    game.pieces.forEach((target, to) => {
      if (from === to) return;
      if (!target && isNextTo(from, to)) candidates.push([from, to]);
      if (target && canAttemptEat(piece, target, from, to)) candidates.unshift([from, to]);
    });
  });
  const hidden = game.pieces.map((piece, index) => piece && !piece.flipped ? index : -1).filter(index => index >= 0);
  if (candidates.length) {
    const [from, to] = candidates[Math.floor(Math.random() * candidates.length)];
    handleLocalClick(from);
    handleLocalClick(to);
  } else if (hidden.length) {
    handleLocalClick(hidden[Math.floor(Math.random() * hidden.length)]);
  }
  game.version += 1;
  playSoundForState(game);
  renderBoard(true);
  rememberFlipState();
}

function startGame(nextMode) {
  mode = nextMode;
  setMusicMode("battle");
  stopPolling();
  score = { red: 0, black: 0 };
  playerNames = nextMode === "ai"
    ? { red: currentUser ? currentUser.username : "玩家", black: "電腦" }
    : { red: currentUser ? currentUser.username : "紅方", black: "黑方" };
  game = createLocalGame();
  lastSoundSignature = "";
  previousFlipState = [];
  if (musicOn) startMusic();
  show(gameScreen);
  startTimer();
  renderBoard(true);
  rememberFlipState();
}

async function registerOrLogin(path) {
  try {
    const data = await api(path, {
      method: "POST",
      body: { username: $("usernameInput").value.trim(), password: $("passwordInput").value }
    });
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem("darkChessToken", authToken);
    renderProfile();
    refreshLeaderboard();
  } catch (error) {
    $("accountStatus").textContent = error.message;
  }
}

$("registerBtn").addEventListener("click", () => registerOrLogin("/api/register"));
$("loginBtn").addEventListener("click", () => registerOrLogin("/api/login"));
$("startLocalBtn").addEventListener("click", () => startGame("offline"));
$("startAiBtn").addEventListener("click", () => startGame("ai"));
$("musicToggleBtn").addEventListener("click", toggleMusic);
$("soundToggleBtn").addEventListener("click", toggleSound);

$("onlineGameBtn").addEventListener("click", () => {
  setMusicMode("menu");
  show(onlineScreen);
  $("onlineStatus").textContent = "";
});

$("quickMatchBtn").addEventListener("click", async () => {
  try {
    stopMatchPolling();
    $("accountStatus").textContent = "配對中...";
    const result = await api("/api/quick-match", {
      method: "POST",
      body: { token: authToken, rules: getRules(), ranked: $("rankedRule").checked }
    });
    if (!result.matched) {
      $("accountStatus").textContent = result.message;
      matchPollTimer = setInterval(async () => {
        try {
          const status = await api(`/api/match-status?token=${encodeURIComponent(authToken)}`);
          if (!status.matched) return;
          stopMatchPolling();
    mode = "online";
    setMusicMode("battle");
    applyServerState(status.state);
          show(gameScreen);
          startPolling();
        } catch (error) {
          $("accountStatus").textContent = error.message;
        }
      }, 1000);
      return;
    }
    mode = "online";
    setMusicMode("battle");
    applyServerState(result.state);
    show(gameScreen);
    startPolling();
  } catch (error) {
    $("accountStatus").textContent = error.message;
  }
});

$("createRoomBtn").addEventListener("click", async () => {
  try {
    $("onlineStatus").textContent = "建立房間中...";
    const state = await api("/api/create-room", {
      method: "POST",
      body: { token: authToken, rules: getRules(), ranked: $("rankedRule").checked }
    });
    mode = "online";
    setMusicMode("battle");
    applyServerState(state);
    show(gameScreen);
    startPolling();
  } catch (error) {
    $("onlineStatus").textContent = error.message;
  }
});

$("joinRoomBtn").addEventListener("click", async () => {
  try {
    $("onlineStatus").textContent = "加入房間中...";
    const state = await api("/api/join-room", {
      method: "POST",
      body: { token: authToken, roomCode: $("roomCodeInput").value.trim().toUpperCase(), playerId }
    });
    mode = "online";
    setMusicMode("battle");
    applyServerState(state);
    show(gameScreen);
    startPolling();
  } catch (error) {
    $("onlineStatus").textContent = error.message;
  }
});

$("backFromOnlineBtn").addEventListener("click", () => show(menuScreen));
$("surrenderBtn").addEventListener("click", () => sendAction({ type: "surrender" }));
$("restartBtn").addEventListener("click", () => sendAction({ type: "restart" }));
$("backMenuBtn").addEventListener("click", async () => {
  if (game && !game.gameOver && mode === "online" && playerRole === "player") await sendAction({ type: "surrender" });
  stopPolling();
  stopMatchPolling();
  mode = "offline";
  setMusicMode("menu");
  roomCode = "";
  playerId = "";
  show(menuScreen);
  await refreshMe();
});
$("copyRoomBtn").addEventListener("click", () => navigator.clipboard.writeText(roomCode));

refreshMe();
refreshLeaderboard();
