"use strict";

// ======================================
//            キャンバス設定
// ======================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ======================================
// 🎯 アスペクト比固定（最重要）
// ======================================

const BASE_WIDTH = 960;
const BASE_HEIGHT = 540;

function resizeCanvas() {

  const scale = Math.min(
    window.innerWidth / BASE_WIDTH,
    window.innerHeight / BASE_HEIGHT
  );

  canvas.style.width = BASE_WIDTH * scale + "px";
  canvas.style.height = BASE_HEIGHT * scale + "px";

}

// 初期実行
resizeCanvas();

// リサイズ対応
window.addEventListener("resize", resizeCanvas);

// 内部解像度は固定（ここ重要）
canvas.width = BASE_WIDTH;
canvas.height = BASE_HEIGHT;

// ======================================
//            基本定数
// ======================================
let gameMode = "hard"; // "normal" or "hard"
let isTouching = false;
let touchStartX = 0;
let leftTouchActive = false;
let swipeDir = 0; // -1 左 / 1 右 / 0 停止
let leftTouchId = null;
let resetTimer = null;   // 📱 長押しリセット用
let gameOverCount = 0;
let bestCopies = Number(localStorage.getItem("bestCopies")) || 0;
const WORLD_WIDTH = 1800;                 // ステージ全長
const CENTER_X = WORLD_WIDTH / 2;         //半分に割ろう
const GROUND_Y = 420;                     // 地面の高さ
const GRAVITY = 0.58;                     // 重力
const MOVE_SPEED = 4.2;                   // 左右移動速度
const JUMP_POWER = -11.5;                 // ジャンプ力
const MAX_JUMPS = 3;                      // 3段ジャンプ
const CAMERA_LEFT_MARGIN = 220;           // カメラ余白
const PLAYER_W = 30;                      // プレイヤー横幅
const PLAYER_H = 30;                      // プレイヤー高さ
const SPAWN_X = 120;                      // 開始位置X
const SPAWN_Y = GROUND_Y - PLAYER_H;      // 開始位置Y
const GOAL_X = WORLD_WIDTH - 140;         // ゴール位置X
const GOAL_W = 70;                        // ゴール幅
const GOAL_H = 90;                        // ゴール高さ
const START_SAFE_TIME = 45;               // 開始直後の無敵フレーム
const START_LINE_X = 160;


// ======================================
//            入力管理
// ======================================

const keys = {};

window.addEventListener("keydown", (e) => {

  keys[e.code] = true;

  // ======================================
  //        タイトル中の操作
  // ======================================
  if (gameState === "title") {
  startFromTitle(); // 何押しても即スタート
  }
  // ==========================
  // 🔙 タイトルに戻る（R+T）
  // ==========================
  if (keys["KeyR"] && keys["KeyT"]) {

    gameState = "title";

    runs = [];
    ghosts = [];
    currentRun = [];

    player = createPlayer();

  }

});

window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
});
// ======================================
// 📱 タッチ開始
// ======================================
window.addEventListener("touchstart", (e) => {

  e.preventDefault();

  // ======================================
  // 🎮 タイトルならスタート
  // ======================================
  if (gameState === "title") {
    startFromTitle();
    return;
  }

  for (let i = 0; i < e.changedTouches.length; i++) {

   
     
        const touch = e.changedTouches[i];

      const rect = canvas.getBoundingClientRect();

      // ==========================
      // 👇 スケール補正（これが本体）
      // ==========================
      const scaleX = canvas.width / canvas.clientWidth;
      const scaleY = canvas.height / canvas.clientHeight;

      const x = (touch.clientX - rect.left) * scaleX;
      const y = (touch.clientY - rect.top) * scaleY;

      const half = canvas.width / 2;
    // ==========================
    // 👇 canvas外タッチは無視
    // ==========================
    if (x < 0 || x > canvas.width || y < 0 || y > canvas.height) {
      continue;
    }

    // ==========================
    // 左側 → 移動専用
    // ==========================
    if (x < half) {

      if (leftTouchId !== null) continue;

      leftTouchActive = true;
      touchStartX = x;
      swipeDir = 0;
      leftTouchId = touch.identifier;

      continue; // 👈 これが超重要（右処理に絶対行かせない）
      
    }

    // ==========================
    // 右側 → ジャンプ専用
    // ==========================
    keys["Space"] = true;

    setTimeout(() => {
      keys["Space"] = false;
    }, 30);

  }

});
// ======================================
// 📱 タッチ終了（完全分離版）
// ======================================
window.addEventListener("touchend", (e) => {

  e.preventDefault();

  for (let i = 0; i < e.changedTouches.length; i++) {

    const t = e.changedTouches[i];

    // 👇 左指だけ見る
    if (t.identifier === leftTouchId) {
      leftTouchId = null;
      leftTouchActive = false;
      swipeDir = 0;
    }

  }

});
// ======================================
//            ステージデータ
// ======================================
// 平らな地面 + ちょい障害物
// y は上端座標
// h は高さ

const obstaclesLeft = [
  { x: 420,  y: 370, w: 34, h: 50  },
  { x: 700,  y: 340, w: 42, h: 80  }
];
let obstacles = [];

// ======================================
//     障害物ミラー生成
// ======================================
function buildObstacles() {

  obstacles = [];

  for (const o of obstaclesLeft) {

    // 左側そのまま追加
    obstacles.push(o);

    // ======================================
    //         右側ミラー生成
    // ======================================

    const mirroredX = CENTER_X + (CENTER_X - o.x - o.w);

    obstacles.push({
      x: mirroredX,
      y: o.y,
      w: o.w,
      h: o.h
    });
  }
}

// ======================================
//            プレイヤー生成
// ======================================

function createPlayer() {
  return {
    x: START_LINE_X - 80,                       // 現在X
    y: SPAWN_Y,                           // 現在Y
    w: PLAYER_W,                          // 横幅
    h: PLAYER_H,                          // 高さ
    vx: 0,                                // X速度
    vy: 0,                                // Y速度
    onGround: true,                       // 地面にいるか
    jumpCount: 0,                         // 空中ジャンプ回数
    finished: false,                      // ゴール済みか
    safeTimer: START_SAFE_TIME,           // 開始直後の無敵
    waiting:true
  };
}

let player = createPlayer();


// ======================================
//            記録データ
// ======================================

let runs = [];                            // 過去プレイ一覧
let currentRun = [];                      // 今回プレイの記録


// ======================================
//            ゴーストクラス
// ======================================

class Ghost {

  constructor(run, index) {
    this.run = run;                       // 再生元フレーム配列
    this.index = index;                   // 何体目か
    this.frame = 0;                       // 再生中フレーム
    this.visible = true;                  // 描画するか
    this.finished = false;                // ゴール済み扱いか
    

    this.state = {                        // 現在の見た目状態
      x: WORLD_WIDTH - SPAWN_X - PLAYER_W,
      y: SPAWN_Y,
      w: PLAYER_W,
      h: PLAYER_H,
      visible: true,
      finished: false
    };

    const blue = Math.max(80, 230 - index * 18);     // コピーごとに少し色変化
    this.color = `rgba(${blue},${blue},255,0.82)`;   // コピー色
  }

  update() {
    if (this.run.length === 0) return;               // 記録が空なら何もしない

    if (this.frame >= this.run.length) {             // 自分のrun.lengthでループ
      this.frame = 0;
    }

    const source = this.run[this.frame];             // 元の記録状態

    // ======================================
    //      反対向き再生（右 → 左へ来る）
    // ======================================
    // 元の x をワールド中心で左右反転する
    // プレイヤーが左から右へ進んだ記録を
    // コピーは右から左へ再生する

    const mirroredX = CENTER_X + (CENTER_X - source.x - source.w);

    this.state = {
      x: mirroredX,
      y: source.y,
      w: source.w,
      h: source.h,
      visible: source.visible,
      finished: source.finished
    };

    this.visible = source.visible;
    this.finished = source.finished;

    this.frame++;                                     // 次フレームへ
  }

  draw() {
    if (!this.visible) return;                        // 非表示なら描かない

    ctx.fillStyle = this.color;
    ctx.fillRect(
      this.state.x - cameraX,
      this.state.y,
      this.state.w,
      this.state.h
    );
  }
}


// ======================================
//            ゴースト管理
// ======================================

let ghosts = [];

function spawnGhosts() {
  ghosts = [];

  runs.forEach((run, index) => {
    ghosts.push(new Ghost(run, index));
  });
}
// ======================================
//      タイトル用ゴースト（複数）
// ======================================
let titleGhosts = [];

function initTitleGhosts() {

  titleGhosts = [];

  for (let i = 0; i < 3; i++) {

    titleGhosts.push({
      x: canvas.width + Math.random() * 400,
      y: GROUND_Y - PLAYER_H,
      w: PLAYER_W,
      h: PLAYER_H,
      vx: -2 - Math.random() * 2,
      vy: 0
    });
  }
}

function updateTitleGhosts() {

  for (const g of titleGhosts) {

    g.x += g.vx;

    if (Math.random() < 0.008 && g.y >= GROUND_Y - PLAYER_H) {
      g.vy = -10 - Math.random() * 2;
    }

    g.vy += GRAVITY;
    g.y += g.vy;

    if (g.y >= GROUND_Y - PLAYER_H) {
      g.y = GROUND_Y - PLAYER_H;
      g.vy = 0;
    }

    if (g.x < -50) {
      g.x = canvas.width + Math.random() * 300;
    }
  }
}

function drawTitleGhosts() {

  for (let i = 0; i < titleGhosts.length; i++) {

    const g = titleGhosts[i];
    const alpha = 0.1 + i * 0.07;

    ctx.fillStyle = `rgba(255,255,255,${alpha})`;

    ctx.fillRect(
      g.x,
      g.y,
      g.w,
      g.h
    );
  }
}

// ======================================
//            UI状態
// ======================================

let gameOverTimer = 0;                    // GAME OVER表示タイマー
let clearTimer = 0;                       // CLEAR表示タイマー
let gameState = "title";


// ======================================
//            カメラ
// ======================================

let cameraX = 0;


// ======================================
//            当たり判定
// ======================================

function rectsHit(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}


// ======================================
//            ジャンプ押下管理
// ======================================

let prevJumpKey = false;

function consumeJumpPress() {
  const now = !!keys["Space"] || !!keys["Enter"];
  const pressed = now && !prevJumpKey;

  prevJumpKey = now;
  return pressed;
}


// ======================================
//            障害物衝突
// ======================================

function moveWithObstacles(obj) {

  // ======================================
  //            横移動
  // ======================================

  obj.x += obj.vx;

  for (const o of obstacles) {
    if (rectsHit(obj, o)) {

      if (obj.vx > 0) {
        obj.x = o.x - obj.w;              // 右移動で当たったら左側へ戻す
      } else if (obj.vx < 0) {
        obj.x = o.x + o.w;                // 左移動で当たったら右側へ戻す
      }

      obj.vx = 0;
    }
  }

  // ======================================
  //            縦移動
  // ======================================

  obj.y += obj.vy;
  obj.onGround = false;

  // 地面との接地
  if (obj.y + obj.h >= GROUND_Y) {
    obj.y = GROUND_Y - obj.h;
    obj.vy = 0;
    obj.onGround = true;
    obj.jumpCount = 0;
  }

  // 障害物との縦衝突
  for (const o of obstacles) {
    if (rectsHit(obj, o)) {

      if (obj.vy > 0) {
        obj.y = o.y - obj.h;              // 上に乗る
        obj.vy = 0;
        obj.onGround = true;
        obj.jumpCount = 0;
      } else if (obj.vy < 0) {
        obj.y = o.y + o.h;                // 下から頭ぶつける
        obj.vy = 0;
      }
    }
  }
}


// ======================================
//            プレイヤー更新
// ======================================

function updatePlayer() {

  player.prevX = player.x;

 // ======================================
  //            左右移動
  // ======================================

  player.vx = 0;

  // PC操作（そのまま残す）
  if (keys["ArrowLeft"] || keys["KeyA"])  player.vx = -MOVE_SPEED;
  if (keys["ArrowRight"] || keys["KeyD"]) player.vx = MOVE_SPEED;

  // スマホ操作（追加）
  if (swipeDir === -1) player.vx = -MOVE_SPEED;
  if (swipeDir === 1)  player.vx = MOVE_SPEED;
  // ======================================
  //            ジャンプ
  // ======================================

  if (consumeJumpPress()) {
    if (player.onGround || player.jumpCount < MAX_JUMPS) {
      player.vy = JUMP_POWER;
      player.onGround = false;
      player.jumpCount++;
    }
  }

  // ======================================
  //            重力
  // ======================================

  player.vy += GRAVITY;

  // ======================================
  //            衝突込み移動
  // ======================================

  moveWithObstacles(player);

  // ======================================
  //            画面端制限
  // ======================================

  if (player.x < 0) {
    player.x = 0;
  }

  if (player.x + player.w > WORLD_WIDTH) {
    player.x = WORLD_WIDTH - player.w;
  }

  // 開始無敵タイマー
  if (player.safeTimer > 0) {
    player.safeTimer--;
  }
  if(player.waiting && (player.x + player.w) > START_LINE_X){
  player.waiting = false;
  }
}


// ======================================
//            ゴール判定
// ======================================

function checkGoal() {
  if (player.finished) return;            // 既にゴール済みなら何もしない

  const goalRect = {
    x: GOAL_X - 10,
    y: GROUND_Y - GOAL_H,
    w: GOAL_W,
    h: GOAL_H
  };

  if (
  player.x + player.w > goalRect.x &&
  player.prevX + player.w <= goalRect.x
  ) {
  roundClear();
  }
}

// ======================================
//          コピーとの当たり判定
// ======================================

function checkGhostHit() {

  if (player.safeTimer > 0) return;

  for (const g of ghosts) {
    if (!g.visible) continue;
    if (g.finished) continue;

    const ghostRect = {
      x: g.state.x,
      y: g.state.y,
      w: g.state.w,
      h: g.state.h
    };

    if (rectsHit(player, ghostRect)) {
      gameOver();
      return;
    }
  }
}
// ======================================
//          記録フレーム保存
// ======================================

function recordCurrentFrame() {

   if(player.waiting) return;
  currentRun.push({
    x: player.x,
    y: player.y,
    w: player.w,
    h: player.h,
    visible: true,
    finished: player.finished
  });
}


// ======================================
//            リセット
// ======================================

function resetPlayerOnly() {
  player = createPlayer();                // プレイヤーだけ初期化
  currentRun = [];                        // 今回の記録は捨てる
  prevJumpKey = false;                    // ジャンプ入力状態リセット
}


// ======================================
//            ゲームオーバー
// ======================================

function gameOver() {
  gameOverTimer = 70;                     // しばらく文字表示
  gameOverCount++;
  resetPlayerOnly();                      // コピー履歴は残して再挑戦
  spawnGhosts(); // ← これ追加（ゴーストも初期化）
  
}


// ======================================
//            ラウンドクリア
// ======================================

function roundClear() {

  // 空ラン防止
  if (currentRun.length > 0) {
    runs.push(currentRun.slice());        // 今回の記録を保存
  }

  clearTimer = 70;                        // CLEAR表示
  player = createPlayer();                // 次ラウンドへ
  currentRun = [];
  prevJumpKey = false;

  spawnGhosts();                          // コピー再生成

  if (runs.length > bestCopies) {
  bestCopies = runs.length;
  localStorage.setItem("bestCopies", bestCopies);
}
}


// ======================================
//            更新
// ======================================

function update() {
  if (gameState !== "play") return;

  // ゴースト先に更新
  for (const g of ghosts) {
    g.update();
  }

  // 先に当たり判定（ここ重要）
  checkGhostHit();

  // そのあとプレイヤー動かす
  updatePlayer();

  checkGoal();
  recordCurrentFrame();

  // ======================================
  //            カメラ追従
  // ======================================

  cameraX = player.x - CAMERA_LEFT_MARGIN;

  if (cameraX < 0) {
    cameraX = 0;
  }

  if (cameraX > WORLD_WIDTH - canvas.width) {
    cameraX = WORLD_WIDTH - canvas.width;
  }

  // UIタイマー更新
  if (gameOverTimer > 0) gameOverTimer--;
  if (clearTimer > 0) clearTimer--;
}


// ======================================
//            背景
// ======================================

function drawBackground() {
  ctx.fillStyle = "#161616";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}


// ======================================
//            グリッド
// ======================================

function drawGrid() {
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;

  for (let x = -(cameraX % 40); x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}


// ======================================
//            地面
// ======================================

function drawGround() {
  ctx.fillStyle = "#343434";
  ctx.fillRect(
    0,
    GROUND_Y,
    canvas.width,
    canvas.height - GROUND_Y
  );
}
// ======================================
//            スタートライン
// ======================================
function drawStartLine(){

ctx.strokeStyle="rgba(255,255,255,0.9)";
ctx.lineWidth=4;

ctx.beginPath();
ctx.moveTo(START_LINE_X-cameraX,0);
ctx.lineTo(START_LINE_X-cameraX,GROUND_Y);
ctx.stroke();

ctx.fillStyle="#fff";
ctx.font="bold 18px sans-serif";
ctx.textAlign="center";

ctx.fillText(
  "START",
  START_LINE_X - cameraX - 40, // ←左にずらす
  GROUND_Y - 110
);

}


// ======================================
//            スタート表示
// ======================================

function drawStartSign() {
  const screenX = 50 - cameraX;

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(screenX, GROUND_Y - 85);
  ctx.lineTo(screenX, GROUND_Y);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("START", screenX + 10, GROUND_Y - 56);
}


// ======================================
//            ゴール表示
// ======================================

function drawGoal() {

  // ======================================
  //         ゴールライン（縦線）
  // ======================================
  ctx.strokeStyle = "rgba(255,80,80,0.95)";
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.moveTo(GOAL_X - cameraX, 0);
  ctx.lineTo(GOAL_X - cameraX, GROUND_Y);
  ctx.stroke();

  // ======================================
  //         GOAL文字
  // ======================================
  ctx.fillStyle = "#ff5a5a";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";

  ctx.fillText(
  "GOAL",
  GOAL_X - cameraX + 40, // ←右にずらす
  GROUND_Y - 110
  );
}

// ======================================
//            障害物描画
// ======================================

function drawObstacles() {
  ctx.fillStyle = "#5b5b5b";

  for (const o of obstacles) {
    ctx.fillRect(
      o.x - cameraX,
      o.y,
      o.w,
      o.h
    );
  }
}


// ======================================
//            ゴースト描画
// ======================================

function drawGhosts() {
  for (const g of ghosts) {
    g.draw();
  }
}


// ======================================
//            プレイヤー描画
// ======================================

function drawPlayer() {

  if (player.safeTimer > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";   // 無敵中は少し薄く
  } else {
    ctx.fillStyle = "#ffffff";
  }

  ctx.fillRect(
    player.x - cameraX,
    player.y,
    player.w,
    player.h
  );
}


// ======================================
//            UI描画
// ======================================
function drawUI() {

  ctx.font = "16px sans-serif";

  // ======================================
  //        COPIES（左上）
  // ======================================
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.6)";

  ctx.fillText(
    `COPIES ${runs.length}`,
    20,
    30
  );

  // ======================================
  //        BEST（右上）
  // ======================================
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.4)";

  ctx.fillText(
    `BEST ${bestCopies}`,
    canvas.width - 20,
    30
  );

  // ======================================
  //        GAME OVER
  // ======================================
  if (gameOverTimer > 0) {

    ctx.textAlign = "center";

    ctx.fillStyle = "rgba(255,70,70,0.95)";
    ctx.font = "bold 64px sans-serif";
    ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2);

    ctx.font = "20px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.8)";

  }

  // ======================================
  //        CLEAR
  // ======================================
  if (clearTimer > 0) {

    ctx.textAlign = "center";

    ctx.fillStyle = "rgba(60,255,150,0.95)";
    ctx.font = "bold 58px sans-serif";

    ctx.fillText("ROUND CLEAR!", canvas.width / 2, canvas.height / 2);
  }
}
//タイトル～～～
function drawTitle() {

  // ======================================
  //        背景（ほんのりグラデ風）
  // ======================================
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#0a0a0a");
  grad.addColorStop(1, "#111");

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ======================================
  //        タイトル（ゆらぎ）
  // ======================================
  const t = performance.now() * 0.002;
  const pulse = Math.sin(t) * 2;

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 68px sans-serif";
  ctx.textAlign = "center";

  ctx.fillText(
    "COPY RUN",
    canvas.width / 2,
    170 + pulse
  );
  // ==========================
  // 🏆 BEST表示
  // ==========================
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "20px sans-serif";

  ctx.fillText(
    `BEST ${bestCopies}`,
    canvas.width / 2,
    210
  );

  // ======================================
  //        下ライン（スタイリッシュ線）
  // ======================================
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(canvas.width / 2 - 120, 190);
  ctx.lineTo(canvas.width / 2 + 120, 190);
  ctx.stroke();

  // ======================================
  //        サブタイトル
  // ======================================
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "18px sans-serif";

  ctx.fillText(
    "Your past will kill you.",
    canvas.width / 2,
    230
  );

  // ======================================
  //        スタート（点滅）
  // ======================================
  const blink = Math.sin(t * 2) > 0;

  ctx.fillStyle = blink
    ? "rgba(255,255,255,0.85)"
    : "rgba(255,255,255,0.25)";

  ctx.font = "22px sans-serif";

  ctx.fillText(
    "Press Any Key",
    canvas.width / 2,
    320
  );

  // ======================================
  //        操作説明（極薄）
  // ======================================
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.font = "15px sans-serif";

  // MOVE
  ctx.fillText(
    "← → / A D   - MOVE",
    canvas.width / 2,
    460
  );

  // JUMP
  ctx.fillText(
    "SPACE        - JUMP",
    canvas.width / 2,
    485
  );

  // RESET
  ctx.fillText(
    "R + T         - COPY RESET",
    canvas.width / 2,
    510
  );
  updateTitleGhosts();
  drawTitleGhosts();
}
// ======================================
//            全体描画
// ======================================

function draw() {
  // ==========================
  // 📱 縦持ちなら案内表示
  // ==========================
  if (isPortrait()) {

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "20px sans-serif";

    ctx.fillText(
      "スマホを横にしてください",
      canvas.width / 2,
      canvas.height / 2
    );

    return;
  }

  if (gameState === "title") {
  drawTitle();
  return;
  }
  drawBackground();
  drawGrid();
  drawGround();
  drawStartLine();
  drawGoal();
  drawObstacles();
  drawGhosts();
  drawPlayer();
  drawUI();
  // ==========================
  // 📱 左スワイプガイド
  // ==========================
  if (isMobile()) {

    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = "56px sans-serif";
    ctx.textAlign = "left";

    ctx.fillText("  ←    →", 30, canvas.height - 30);

  }
  // ==========================
  // 📱 右ジャンプガイド
  // ==========================
  if (isMobile()) {

    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = "50px sans-serif"; // 👈 約3倍
    ctx.textAlign = "right";

    ctx.fillText("JUMP", canvas.width - 30, canvas.height - 30);

  }
}
//  何かの関数
function startFromTitle() {

  gameState = "play";

  runs = [];
  ghosts = [];
  currentRun = [];

  player = createPlayer();
  spawnGhosts();
}
// ======================================
// 📱 スマホ向きチェック
// ======================================
function isPortrait() {
  return window.innerHeight > window.innerWidth;
}
// ======================================
// 📱 スマホ判定
// ======================================
function isMobile() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}
// ======================================
//            メインループ
// ======================================

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}


// ======================================
//            開始
// ======================================
buildObstacles();
spawnGhosts();
initTitleGhosts(); 
loop();
// ======================================
// 📱 スクロール制御（安全版）
// ======================================

// ① window側は一旦無効化（様子見）
window.addEventListener("touchmove", function(e) {
  // e.preventDefault();
}, { passive: false });

// ② canvas内だけスクロール禁止（本命）
canvas.addEventListener("touchmove", function(e) {
  e.preventDefault();
}, { passive: false });
// ======================================
// 📱 スワイプ方向判定（完全版）
// ======================================
window.addEventListener("touchmove", (e) => {

  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / canvas.clientWidth;

  // ==========================
  // 👇 左指が無いなら再取得
  // ==========================
  if (leftTouchId === null) {

    for (let i = 0; i < e.touches.length; i++) {

      const t = e.touches[i];
      const x = (t.clientX - rect.left) * scaleX;

      if (x >= 0 && x < canvas.width / 2) {
        leftTouchId = t.identifier;
        leftTouchActive = true;
        touchStartX = x;
        break;
      }

    }

  }

  if (!leftTouchActive) return;

  // ==========================
  // 👇 左指を特定
  // ==========================
  let touch = null;

  for (let i = 0; i < e.touches.length; i++) {
    if (e.touches[i].identifier === leftTouchId) {
      touch = e.touches[i];
      break;
    }
  }

  // 左指が見つからなかったらリセット
  if (!touch) {
    leftTouchActive = false;
    swipeDir = 0;
    leftTouchId = null;
    return;
  }

  // ==========================
  // 👇 座標補正（ここ重要）
  // ==========================
  const currentX = (touch.clientX - rect.left) * scaleX;
  const dx = currentX - touchStartX;

  // ==========================
  // スワイプ方向決定
  // ==========================
  if (dx > 10 && swipeDir !== 1) {
    swipeDir = 1;
  } else if (dx < -10 && swipeDir !== -1) {
    swipeDir = -1;
  }

  // 👇 毎フレーム更新（ぬるぬる化）
  touchStartX = currentX;

});