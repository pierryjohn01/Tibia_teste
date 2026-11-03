(() => {
'use strict';

// ============ CONFIG ============
const TILE = 32;
const VIEW_TILES_X = 15;
const VIEW_TILES_Y = 11;
const MAP_W = 40;
const MAP_H = 30;

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const logEl = document.getElementById('log');
const classPicker = document.getElementById('classPicker');

function hideOldControls() {
  const dpad = document.getElementById('dpad');
  const controls = document.getElementById('controls');
  if (dpad) dpad.style.display = 'none';
  if (controls) controls.style.display = 'none';
}
hideOldControls();

function resize() {
  canvas.width = VIEW_TILES_X * TILE;
  canvas.height = VIEW_TILES_Y * TILE;
  const scale = Math.min(window.innerWidth / canvas.width, window.innerHeight / canvas.height, 1.8);
  canvas.style.width = (canvas.width * scale) + 'px';
  canvas.style.height = (canvas.height * scale) + 'px';
}
window.addEventListener('resize', resize);
resize();

// ============ MAP ============
const map = [];
const T_GRASS = 0, T_WALL = 1, T_WATER = 2, T_PATH = 3;

function generateMap() {
  for (let y = 0; y < MAP_H; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) {
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) row.push(T_WALL);
      else row.push(T_GRASS);
    }
    map.push(row);
  }
  const walls = [
    [5,5],[6,5],[5,6],[10,8],[11,8],[12,8],[20,10],[20,11],[20,12],
    [30,20],[31,20],[32,20],[15,20],[15,21],[15,22],[25,5],[26,5],[27,5]
  ];
  walls.forEach(([x,y]) => { if (map[y] && map[y][x] !== undefined) map[y][x] = T_WALL; });
  for (let y = 14; y < 18; y++) for (let x = 24; x < 30; x++) map[y][x] = T_WATER;
  for (let x = 3; x < 12; x++) map[15][x] = T_PATH;
  for (let y = 3; y < 12; y++) map[y][8] = T_PATH;
}
generateMap();

function isWalkable(x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  const t = map[y][x];
  return t === T_GRASS || t === T_PATH;
}

// ============ STATE ============
let player = null;
let monsters = [];
let drops = [];
let floaters = [];
let particles = [];
let dummy = { x: 3, y: 3, hitFlash: 0 };
let running = false;
let movePath = [];       // fila de passos do player
let pendingTarget = null; // monstro que o player quer atacar

// ============ CLASSES ============
const CLASS_CONFIG = {
  melee:  { name: 'Melee',    color: '#d9534f', hp: 120, atk: 9, range: 1, targets: 8,  skillName: 'Sword' },
  archer: { name: 'Arqueiro', color: '#5cb85c', hp: 90,  atk: 7, range: 4, targets: 4,  skillName: 'Distance' },
  mage:   { name: 'Mago',     color: '#5bc0de', hp: 70,  atk: 6, range: 3, targets: 99, skillName: 'Magic' }
};

function startGame(classKey) {
  const cfg = CLASS_CONFIG[classKey];
  player = {
    x: 8, y: 8,
    classKey, name: cfg.name, color: cfg.color,
    hp: cfg.hp, maxHp: cfg.hp,
    atk: cfg.atk, range: cfg.range, targets: cfg.targets,
    skillName: cfg.skillName,
    xp: 0, level: 1, xpToNext: 50,
    skill: 10, skillXp: 0, skillXpNext: 50,
    gold: 0,
    attackCooldown: 0,
    hurtFlash: 0,
    facing: { x: 0, y: 1 }
  };
  monsters = [];
  drops = [];
  floaters = [];
  particles = [];
  movePath = [];
  pendingTarget = null;
  spawnMonsters(6);
  classPicker.style.display = 'none';
  running = true;
  logMsg('Toque no chão para andar · toque em monstro para atacar');
  updateHUD();
}

function spawnMonsters(n) {
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 80; a++) {
      const x = 2 + Math.floor(Math.random() * (MAP_W - 4));
      const y = 2 + Math.floor(Math.random() * (MAP_H - 4));
      if (!isWalkable(x, y)) continue;
      if (player && Math.abs(x - player.x) + Math.abs(y - player.y) < 5) continue;
      if (monsters.some(m => m.x === x && m.y === y)) continue;
      if (x === dummy.x && y === dummy.y) continue;
      monsters.push({
        x, y, hp: 28, maxHp: 28, atk: 4,
        color: '#8b5a2b', xpReward: 15, goldReward: 3,
        hurtFlash: 0
      });
      break;
    }
  }
}

document.querySelectorAll('.classBtn').forEach(btn => {
  btn.addEventListener('click', () => startGame(btn.dataset.class));
});

// ============ INPUT (touch / click) ============
function canvasTileFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;
  const tx = Math.floor(cx / TILE + cameraX);
  const ty = Math.floor(cy / TILE + cameraY);
  return { tx, ty };
}

function handleTap(e) {
  e.preventDefault();
  if (!player || !running) return;
  const { tx, ty } = canvasTileFromEvent(e);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return;

  // clicou no dummy?
  if (tx === dummy.x && ty === dummy.y) {
    pendingTarget = { isDummy: true };
    movePath = [];
    approachAndAttack();
    return;
  }

  // clicou em monstro?
  const mon = monsters.find(m => m.x === tx && m.y === ty);
  if (mon) {
    pendingTarget = mon;
    movePath = [];
    approachAndAttack();
    return;
  }

  // clicou no chão
  if (isWalkable(tx, ty)) {
    pendingTarget = null;
    const path = findPath(player.x, player.y, tx, ty);
    if (path.length > 0) movePath = path;
  }
}

canvas.addEventListener('pointerdown', handleTap);

// ============ PATHFINDING (BFS simples) ============
function findPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const visited = new Set();
  const queue = [{ x: sx, y: sy, path: [] }];
  visited.add(sx + ',' + sy);
  const dirs = [[0,-1],[0,1],[-1,0],[1,0]];

  while (queue.length) {
    const cur = queue.shift();
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!isWalkable(nx, ny)) continue;
      if (monsters.some(m => m.x === nx && m.y === ny)) continue;
      if (nx === dummy.x && ny === dummy.y) continue;
      const key = nx + ',' + ny;
      if (visited.has(key)) continue;
      visited.add(key);
      const newPath = cur.path.concat([{ x: nx, y: ny }]);
      if (nx === tx && ny === ty) return newPath;
      queue.push({ x: nx, y: ny, path: newPath });
    }
  }
  return [];
}

// ============ APPROACH + ATTACK ============
function approachAndAttack() {
  if (!pendingTarget) return;
  const target = pendingTarget.isDummy ? dummy : pendingTarget;
  if (!target || (pendingTarget.isDummy === false && monsters.indexOf(target) < 0)) {
    pendingTarget = null;
    return;
  }
  const dx = target.x - player.x;
  const dy = target.y - player.y;
  const dist = Math.abs(dx) + Math.abs(dy);

  if (dist <= player.range) {
    // está no alcance: ataca
    player.facing = { x: Math.sign(dx), y: Math.sign(dy) };
    doAttack();
    if (pendingTarget.isDummy) pendingTarget = null;
    else {
      // continua atacando até o alvo morrer
      pendingTarget = target;
    }
    return;
  }

  // fora do alcance: anda em direção ao alvo
  let sx = 0, sy = 0;
  if (Math.abs(dx) > Math.abs(dy)) sx = Math.sign(dx);
  else sy = Math.sign(dy);
  const nx = player.x + sx, ny = player.y + sy;
  if (isWalkable(nx, ny) && !monsters.some(m => m.x === nx && m.y === ny)) {
    player.facing = { x: sx, y: sy };
    player.x = nx; player.y = ny;
    autoPickup();
  } else {
    // tenta caminho alternativo
    const path = findPath(player.x, player.y, target.x, target.y);
    if (path.length > 0) movePath = path;
    else pendingTarget = null;
  }
}

// ============ ATTACK ============
function doAttack() {
  if (!player) return;
  const now = performance.now();
  if (now - player.attackCooldown < 380) return;
  player.attackCooldown = now;

  let hitCount = 0, totalDmg = 0;

  if (player.classKey === 'melee') {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const tx = player.x + dx, ty = player.y + dy;
        const mon = monsters.find(m => m.x === tx && m.y === ty);
        if (mon) {
          const d = damageMonster(mon);
          totalDmg += d; hitCount++;
          floaters.push({ x: tx, y: ty, text: d, color: '#ff6b6b', life: 800, age: 0 });
        }
        if (tx === dummy.x && ty === dummy.y) {
          gainSkillXp(2); hitCount++;
          dummy.hitFlash = 200;
          floaters.push({ x: tx, y: ty, text: '✓', color: '#f5c542', life: 700, age: 0 });
        }
      }
    }
  } else if (player.classKey === 'archer') {
    const inRange = monsters
      .map(m => ({ m, d: Math.abs(m.x - player.x) + Math.abs(m.y - player.y) }))
      .filter(o => o.d <= player.range)
      .sort((a, b) => a.d - b.d)
      .slice(0, player.targets);
    inRange.forEach(o => {
      const d = damageMonster(o.m);
      totalDmg += d; hitCount++;
      floaters.push({ x: o.m.x, y: o.m.y, text: d, color: '#8ee88e', life: 800, age: 0 });
      particles.push({ x: player.x+0.5, y: player.y+0.5, tx: o.m.x+0.5, ty: o.m.y+0.5, life: 200, age: 0, color: '#c9ffc9' });
    });
  } else if (player.classKey === 'mage') {
    const cx = player.x + player.facing.x * 2;
    const cy = player.y + player.facing.y * 2;
    particles.push({ x: player.x+0.5, y: player.y+0.5, tx: cx+0.5, ty: cy+0.5, life: 250, age: 0, color: '#ffcc66' });
    monsters.forEach(m => {
      if (Math.abs(m.x - cx) <= 2 && Math.abs(m.y - cy) <= 2) {
        const d = damageMonster(m);
        totalDmg += d; hitCount++;
        floaters.push({ x: m.x, y: m.y, text: d, color: '#ffb84d', life: 800, age: 0 });
      }
    });
    if (Math.abs(dummy.x - cx) <= 2 && Math.abs(dummy.y - cy) <= 2) {
      gainSkillXp(2); dummy.hitFlash = 200;
    }
  }

  if (hitCount > 0) {
    gainSkillXp(hitCount * 3);
    logMsg(`Acertou ${hitCount} alvo(s) — ${totalDmg} dano`);
  }
  updateHUD();
}

function damageMonster(mon) {
  const dmg = player.atk + Math.floor(player.skill / 4) + Math.floor(Math.random() * 4);
  mon.hp -= dmg;
  mon.hurtFlash = 250;
  if (mon.hp <= 0) killMonster(mon);
  return dmg;
}

function killMonster(mon) {
  const idx = monsters.indexOf(mon);
  if (idx >= 0) monsters.splice(idx, 1);
  gainXP(mon.xpReward);
  player.gold += mon.goldReward;
  drops.push({ x: mon.x, y: mon.y, gold: mon.goldReward });
  for (let i = 0; i < 8; i++) {
    particles.push({
      x: mon.x + 0.5, y: mon.y + 0.5,
      tx: mon.x + 0.5 + (Math.random() - 0.5) * 1.2,
      ty: mon.y + 0.5 + (Math.random() - 0.5) * 1.2,
      life: 500, age: 0, color: '#ff8b3d'
    });
  }
  if (pendingTarget === mon) pendingTarget = null;
  spawnMonsters(1);
}

function autoPickup() {
  const idx = drops.findIndex(d => d.x === player.x && d.y === player.y);
  if (idx >= 0) {
    player.gold += drops[idx].gold;
    logMsg(`+${drops[idx].gold} gold`);
    drops.splice(idx, 1);
    updateHUD();
  }
}

function gainXP(amount) {
  player.xp += amount;
  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level++;
    player.maxHp += 15;
    player.hp = player.maxHp;
    player.atk += 2;
    player.xpToNext = Math.floor(player.xpToNext * 1.5);
    logMsg(`★ Subiu para nível ${player.level}!`);
    updateHUD();
  }
}

function gainSkillXp(amount) {
  player.skillXp += amount;
  while (player.skillXp >= player.skillXpNext) {
    player.skillXp -= player.skillXpNext;
    player.skill++;
    player.skillXpNext = Math.floor(player.skillXpNext * 1.2);
    logMsg(`✦ ${player.skillName} avançou para ${player.skill}!`);
  }
  updateHUD();
}

// ============ MOVIMENTO POR PATH ============
let lastStepTime = 0;
const STEP_DELAY = 140;

function updateMovement(now) {
  if (movePath.length === 0) return;
  if (now - lastStepTime < STEP_DELAY) return;
  lastStepTime = now;
  const next = movePath.shift();
  if (!isWalkable(next.x, next.y)) { movePath = []; return; }
  if (monsters.some(m => m.x === next.x && m.y === next.y)) { movePath = []; return; }
  player.facing = { x: next.x - player.x, y: next.y - player.y };
  player.x = next.x; player.y = next.y;
  autoPickup();
}

// ============ MONSTER AI ============
let lastMonsterTick = 0;
function updateMonsters() {
  const now = performance.now();
  if (now - lastMonsterTick < 700) return;
  lastMonsterTick = now;

  monsters.forEach(m => {
    if (m.hurtFlash > 0) m.hurtFlash -= 700;
    const dx = player.x - m.x, dy = player.y - m.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist === 1) {
      player.hp -= m.atk;
      player.hurtFlash = 220;
      if (player.hp <= 0) {
        logMsg('Você morreu... renascendo.');
        player.hp = player.maxHp;
        player.x = 8; player.y = 8;
        movePath = [];
        pendingTarget = null;
      }
      updateHUD();
      return;
    }
    if (dist < 9) {
      let sx = 0, sy = 0;
      if (Math.abs(dx) > Math.abs(dy)) sx = Math.sign(dx);
      else sy = Math.sign(dy);
      const nx = m.x + sx, ny = m.y + sy;
      if (isWalkable(nx, ny) &&
          !monsters.some(o => o !== m && o.x === nx && o.y === ny) &&
          !(player.x === nx && player.y === ny) &&
          !(dummy.x === nx && dummy.y === ny)) {
        m.x = nx; m.y = ny;
      }
    }
  });

  // se o alvo saiu do alcance enquanto ataca, recomeça aproximação
  if (pendingTarget && !pendingTarget.isDummy) {
    if (monsters.indexOf(pendingTarget) < 0) pendingTarget = null;
  }
}

// ============ RENDER ============
let cameraX = 0, cameraY = 0;
function updateCamera() {
  cameraX = Math.max(0, Math.min(MAP_W - VIEW_TILES_X, player.x - VIEW_TILES_X/2 + 0.5));
  cameraY = Math.max(0, Math.min(MAP_H - VIEW_TILES_Y, player.y - VIEW_TILES_Y/2 + 0.5));
}

const TILE_COLORS = { 0:'#3f7a3f', 1:'#4a4a4a', 2:'#2a4a7a', 3:'#8a7a5a' };

function draw(now) {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!player) return;

  updateCamera();
  const offX = -cameraX * TILE;
  const offY = -cameraY * TILE;

  for (let y = Math.floor(cameraY); y < Math.ceil(cameraY + VIEW_TILES_Y); y++) {
    for (let x = Math.floor(cameraX); x < Math.ceil(cameraX + VIEW_TILES_X); x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const t = map[y][x];
      const px = x * TILE + offX, py = y * TILE + offY;
      ctx.fillStyle = TILE_COLORS[t];
      ctx.fillRect(px, py, TILE, TILE);
      if (t === 0) { ctx.fillStyle='rgba(255,255,255,0.03)'; ctx.fillRect(px, py, TILE, 2); }
      else if (t === 1) { ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fillRect(px, py+TILE-4, TILE, 4); }
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.strokeRect(px+0.5, py+0.5, TILE-1, TILE-1);
    }
  }

  // destacar tile sob o dedo/mouse é opcional; omitido para simplicidade

  drops.forEach(d => {
    const px = d.x * TILE + offX + TILE/2;
    const py = d.y * TILE + offY + TILE/2;
    ctx.fillStyle = '#f5c542';
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#8a6a10'; ctx.stroke();
  });

  drawEntity(dummy.x, dummy.y, offX, offY, '#a08050', 'D', 1, dummy.hitFlash);
  monsters.forEach(m => drawEntity(m.x, m.y, offX, offY, m.color, 'M', m.hp/m.maxHp, m.hurtFlash));
  const flash = player.hurtFlash > 0 && Math.floor(now/80) % 2 === 0;
  drawEntity(player.x, player.y, offX, offY, flash ? '#fff' : player.color, 'P', player.hp/player.maxHp, 0);

  particles = particles.filter(p => {
    p.age += 16;
    const t = Math.min(1, p.age / p.life);
    const x = (p.x + (p.tx - p.x) * t) * TILE + offX;
    const y = (p.y + (p.ty - p.y) * t) * TILE + offY;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(x, y, 4*(1-t)+1, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
    return p.age < p.life;
  });

  floaters = floaters.filter(f => {
    f.age += 16;
    const t = f.age / f.life;
    const px = f.x * TILE + offX + TILE/2;
    const py = f.y * TILE + offY + TILE/2 - t * 24;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = f.color;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText(f.text, px, py); ctx.fillText(f.text, px, py);
    ctx.globalAlpha = 1;
    return f.age < f.life;
  });

  monsters.forEach(m => { if (m.hurtFlash > 0) m.hurtFlash -= 16; });
  if (dummy.hitFlash > 0) dummy.hitFlash -= 16;
  if (player.hurtFlash > 0) player.hurtFlash -= 16;
}

function drawEntity(x, y, offX, offY, color, letter, hpRatio, flash) {
  const px = x * TILE + offX, py = y * TILE + offY;
  const flashing = flash && flash > 0;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(px+TILE/2, py+TILE-4, TILE/3, 4, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = flashing ? '#fff' : color;
  ctx.fillRect(px+4, py+3, TILE-8, TILE-7);
  if (!flashing) { ctx.fillStyle='rgba(255,255,255,0.2)'; ctx.fillRect(px+4, py+3, TILE-8, 3); }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
  ctx.strokeText(letter, px+TILE/2, py+TILE/2); ctx.fillText(letter, px+TILE/2, py+TILE/2);
  if (hpRatio !== undefined && hpRatio < 1) {
    ctx.fillStyle = '#000'; ctx.fillRect(px+3, py-2, TILE-6, 4);
    ctx.fillStyle = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#fbbf24' : '#ef4444';
    ctx.fillRect(px+3, py-2, (TILE-6)*hpRatio, 4);
  }
}

// ============ HUD & LOG ============
function updateHUD() {
  if (!player) return;
  const hpPct = Math.max(0, player.hp / player.maxHp) * 100;
  const xpPct = (player.xp / player.xpToNext) * 100;
  const skPct = (player.skillXp / player.skillXpNext) * 100;
  hud.innerHTML = `
    <div class="name">${player.name} · Nv ${player.level}</div>
    <div class="row"><span>HP</span><span>${Math.max(0,player.hp)}/${player.maxHp}</span></div>
    <div class="barwrap"><div class="bar hp" style="width:${hpPct}%"></div></div>
    <div class="row"><span>XP</span><span>${player.xp}/${player.xpToNext}</span></div>
    <div class="barwrap"><div class="bar xp" style="width:${xpPct}%"></div></div>
    <div class="row"><span>${player.skillName}</span><span>${player.skill}</span></div>
    <div class="barwrap"><div class="bar sk" style="width:${skPct}%"></div></div>
    <div class="row"><span>Gold</span><span style="color:#f5c542">${player.gold}</span></div>
  `;
}

let logTimer = null;
function logMsg(msg) {
  logEl.textContent = msg;
  logEl.classList.add('show');
  if (logTimer) clearTimeout(logTimer);
  logTimer = setTimeout(() => logEl.classList.remove('show'), 1800);
}

// ============ LOOP ============
let lastTime = 0;
function loop(t) {
  const now = t || performance.now();
  if (running && player) {
    updateMonsters();
    updateMovement(now);
    if (pendingTarget) approachAndAttack();
  }
  draw(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

})();
