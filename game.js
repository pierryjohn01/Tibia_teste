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

function resize() {
  canvas.width = VIEW_TILES_X * TILE;
  canvas.height = VIEW_TILES_Y * TILE;
  const scale = Math.min(window.innerWidth / canvas.width, window.innerHeight / canvas.height, 1.6);
  canvas.style.width = (canvas.width * scale) + 'px';
  canvas.style.height = (canvas.height * scale) + 'px';
}
window.addEventListener('resize', resize);
resize();

// ============ MAP ============
const map = [];
const MAP_TILES = { GRASS: 0, WALL: 1, WATER: 2, PATH: 3 };

function generateMap() {
  for (let y = 0; y < MAP_H; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) {
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) row.push(MAP_TILES.WALL);
      else row.push(MAP_TILES.GRASS);
    }
    map.push(row);
  }
  const walls = [
    [5,5],[6,5],[5,6],
    [10,8],[11,8],[12,8],
    [20,10],[20,11],[20,12],
    [30,20],[31,20],[32,20],
    [15,20],[15,21],[15,22],
    [25,5],[26,5],[27,5]
  ];
  walls.forEach(([x,y]) => { if (map[y] && map[y][x] !== undefined) map[y][x] = MAP_TILES.WALL; });
  for (let y = 14; y < 18; y++) for (let x = 24; x < 30; x++) map[y][x] = MAP_TILES.WATER;
  for (let x = 3; x < 12; x++) map[15][x] = MAP_TILES.PATH;
  for (let y = 3; y < 12; y++) map[y][8] = MAP_TILES.PATH;
}
generateMap();

function isWalkable(x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  const t = map[y][x];
  return t === MAP_TILES.GRASS || t === MAP_TILES.PATH;
}

// ============ STATE ============
let player = null;
let monsters = [];
let drops = [];
let floaters = []; // números de dano
let particles = [];
let dummy = { x: 3, y: 3, hp: 1, maxHp: 1, isDummy: true, hitFlash: 0 };
let running = false;

// ============ INPUT ============
const keys = {};
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === ' ') { e.preventDefault(); doAttack(); }
  if (k === 'e') doPickup();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

document.querySelectorAll('#dpad button[data-dir]').forEach(btn => {
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!player) return;
    const dir = btn.dataset.dir;
    const m = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
    const [dx, dy] = m[dir];
    tryMove(dx, dy);
  });
});

document.getElementById('attackBtn').addEventListener('pointerdown', e => {
  e.preventDefault();
  if (player) doAttack();
});
document.getElementById('pickupBtn').addEventListener('pointerdown', e => {
  e.preventDefault();
  if (player) doPickup();
});

document.querySelectorAll('.classBtn').forEach(btn => {
  btn.addEventListener('click', () => startGame(btn.dataset.class));
});

// ============ CLASSES ============
const CLASS_CONFIG = {
  melee:  { name: 'Melee',   color: '#d9534f', hp: 120, atk: 9,  range: 1, targets: 8,
            skillName: 'Sword', skill: 10, skillXp: 0, skillXpNext: 50 },
  archer: { name: 'Arqueiro', color: '#5cb85c', hp: 90,  atk: 7,  range: 4, targets: 4,
            skillName: 'Distance', skill: 10, skillXp: 0, skillXpNext: 50 },
  mage:   { name: 'Mago',    color: '#5bc0de', hp: 70,  atk: 6,  range: 3, targets: 99,
            skillName: 'Magic', skill: 10, skillXp: 0, skillXpNext: 50 }
};

function startGame(classKey) {
  const cfg = CLASS_CONFIG[classKey];
  player = {
    x: 8, y: 8,
    classKey, name: cfg.name, color: cfg.color,
    hp: cfg.hp, maxHp: cfg.hp,
    atk: cfg.atk, range: cfg.range, targets: cfg.targets,
    xp: 0, level: 1, xpToNext: 50,
    skill: cfg.skill, skillXp: cfg.skillXp, skillXpNext: cfg.skillXpNext,
    skillName: cfg.skillName,
    gold: 0,
    attackCooldown: 0,
    hurtFlash: 0,
    facing: { x: 0, y: 1 }
  };
  monsters = [];
  drops = [];
  floaters = [];
  particles = [];
  spawnMonsters(6);
  classPicker.style.display = 'none';
  running = true;
  logMsg('Bem-vindo, ' + cfg.name + '!');
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
        x, y,
        hp: 28, maxHp: 28, atk: 4,
        color: '#8b5a2b',
        xpReward: 15, goldReward: 3,
        hurtFlash: 0,
        moveTimer: 0
      });
      break;
    }
  }
}

// ============ PLAYER ACTIONS ============
let lastMoveTime = 0;
const MOVE_DELAY = 130;

function tryMove(dx, dy) {
  if (!player) return;
  const now = performance.now();
  if (now - lastMoveTime < MOVE_DELAY) return;
  lastMoveTime = now;
  player.facing = { x: dx, y: dy };
  const nx = player.x + dx, ny = player.y + dy;
  if (!isWalkable(nx, ny)) return;
  if (monsters.some(m => m.x === nx && m.y === ny)) return;
  player.x = nx; player.y = ny;

  // auto pick up drop no tile
  const idx = drops.findIndex(d => d.x === nx && d.y === ny);
  if (idx >= 0) doPickup();
}

function doAttack() {
  if (!player) return;
  const now = performance.now();
  if (now - player.attackCooldown < 380) return;
  player.attackCooldown = now;

  let hitCount = 0;
  let totalDmg = 0;

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
          hitDummy();
          floaters.push({ x: tx, y: ty, text: '✓', color: '#f5c542', life: 700, age: 0 });
          hitCount++;
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
      particles.push({ x: player.x, y: player.y, tx: o.m.x, ty: o.m.y, life: 200, age: 0, color: '#c9ffc9' });
    });
  } else if (player.classKey === 'mage') {
    const cx = player.x + player.facing.x * 2;
    const cy = player.y + player.facing.y * 2;
    particles.push({ x: player.x, y: player.y, tx: cx, ty: cy, life: 250, age: 0, color: '#ffcc66' });
    monsters.forEach(m => {
      if (Math.abs(m.x - cx) <= 2 && Math.abs(m.y - cy) <= 2) {
        const d = damageMonster(m);
        totalDmg += d; hitCount++;
        floaters.push({ x: m.x, y: m.y, text: d, color: '#ffb84d', life: 800, age: 0 });
      }
    });
    if (Math.abs(dummy.x - cx) <= 2 && Math.abs(dummy.y - cy) <= 2) {
      hitDummy();
    }
  }

  if (hitCount > 0) {
    gainSkillXp(hitCount * 3);
    if (player.classKey === 'melee') logMsg(`Golpeou ${hitCount} alvo(s) — ${totalDmg} dano`);
    else if (player.classKey === 'archer') logMsg(`Atirou em ${hitCount} — ${totalDmg} dano`);
    else if (player.classKey === 'mage') logMsg(`Fogo! ${hitCount} alvo(s) — ${totalDmg} dano`);
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
  drops.push({ x: mon.x, y: mon.y, gold: mon.goldReward, life: 20000 });
  // partículas de morte
  for (let i = 0; i < 8; i++) {
    particles.push({
      x: mon.x + 0.5, y: mon.y + 0.5,
      tx: mon.x + 0.5 + (Math.random() - 0.5) * 1.2,
      ty: mon.y + 0.5 + (Math.random() - 0.5) * 1.2,
      life: 500, age: 0, color: '#ff8b3d'
    });
  }
  spawnMonsters(1);
}

function hitDummy() {
  gainSkillXp(2);
}

function doPickup() {
  if (!player) return;
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
}

// ============ RENDER ============
let cameraX = 0, cameraY = 0;
function updateCamera() {
  const halfW = VIEW_TILES_X / 2;
  const halfH = VIEW_TILES_Y / 2;
  cameraX = Math.max(0, Math.min(MAP_W - VIEW_TILES_X, player.x - halfW + 0.5));
  cameraY = Math.max(0, Math.min(MAP_H - VIEW_TILES_Y, player.y - halfH + 0.5));
}

const TILE_COLORS = {
  0: '#3f7a3f', // grama
  1: '#4a4a4a', // parede
  2: '#2a4a7a', // água
  3: '#8a7a5a'  // caminho
};

function draw(now) {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!player) return;

  updateCamera();
  const offX = -cameraX * TILE;
  const offY = -cameraY * TILE;

  // tiles
  for (let y = Math.floor(cameraY); y < Math.ceil(cameraY + VIEW_TILES_Y); y++) {
    for (let x = Math.floor(cameraX); x < Math.ceil(cameraX + VIEW_TILES_X); x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const t = map[y][x];
      const px = x * TILE + offX, py = y * TILE + offY;
      ctx.fillStyle = TILE_COLORS[t];
      ctx.fillRect(px, py, TILE, TILE);

      // textura leve
      if (t === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(px, py, TILE, 2);
      } else if (t === 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(px + ((now/600 + x) % TILE), py + 6, 4, 2);
      } else if (t === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(px, py + TILE - 4, TILE, 4);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    }
  }

  // drops
  drops.forEach(d => {
    const px = d.x * TILE + offX + TILE/2;
    const py = d.y * TILE + offY + TILE/2;
    ctx.fillStyle = '#f5c542';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a6a10';
    ctx.stroke();
  });

  // dummy
  drawEntity(dummy.x, dummy.y, offX, offY, '#a08050', 'D', 1, dummy.hitFlash, now);

  // monsters
  monsters.forEach(m => {
    drawEntity(m.x, m.y, offX, offY, m.color, 'M', m.hp / m.maxHp, m.hurtFlash, now);
  });

  // player
  const flash = player.hurtFlash > 0 && Math.floor(now/80) % 2 === 0;
  drawEntity(player.x, player.y, offX, offY, flash ? '#fff' : player.color, 'P',
             player.hp / player.maxHp, 0, now, true);

  // particles
  particles = particles.filter(p => {
    p.age += 16;
    const t = Math.min(1, p.age / p.life);
    const x = (p.x + (p.tx - p.x) * t) * TILE + offX + TILE/2;
    const y = (p.y + (p.ty - p.y) * t) * TILE + offY + TILE/2;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x, y, 4 * (1-t) + 1, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return p.age < p.life;
  });

  // floaters (dano)
  floaters = floaters.filter(f => {
    f.age += 16;
    const t = f.age / f.life;
    const px = f.x * TILE + offX + TILE/2;
    const py = f.y * TILE + offY + TILE/2 - t * 24;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = f.color;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(f.text, px, py);
    ctx.fillText(f.text, px, py);
    ctx.globalAlpha = 1;
    return f.age < f.life;
  });

  // decair flash de monstros/dummy
  monsters.forEach(m => { if (m.hurtFlash > 0) m.hurtFlash -= 16; });
  if (dummy.hitFlash > 0) dummy.hitFlash -= 16;
  if (player.hurtFlash > 0) player.hurtFlash -= 16;
}

function drawEntity(x, y, offX, offY, color, letter, hpRatio, flash, now, isPlayer) {
  const px = x * TILE + offX;
  const py = y * TILE + offY;
  const flashing = flash && flash > 0;

  // sombra
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(px + TILE/2, py + TILE - 4, TILE/3, 4, 0, 0, Math.PI*2);
  ctx.fill();

  // corpo
  ctx.fillStyle = flashing ? '#fff' : color;
  ctx.fillRect(px + 4, py + 3, TILE - 8, TILE - 7);

  // brilho superior
  if (!flashing) {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(px + 4, py + 3, TILE - 8, 3);
  }

  // letra
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeText(letter, px + TILE/2, py + TILE/2);
  ctx.fillText(letter, px + TILE/2, py + TILE/2);

  // barra de vida
  if (hpRatio !== undefined && hpRatio < 1) {
    ctx.fillStyle = '#000';
    ctx.fillRect(px + 3, py - 2, TILE - 6, 4);
    ctx.fillStyle = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#fbbf24' : '#ef4444';
    ctx.fillRect(px + 3, py - 2, (TILE - 6) * hpRatio, 4);
  }
}

// ============ HUD ============
function updateHUD() {
  if (!player) return;
  const hpPct = Math.max(0, player.hp / player.maxHp) * 100;
  const xpPct = (player.xp / player.xpToNext) * 100;
  const skPct = (player.skillXp / player.skillXpNext) * 100;
  hud.innerHTML = `
    <div class="name">${player.name} · Nv ${player.level}</div>
    <div class="row"><span>HP</span><span>${Math.max(0,player.hp)}/${player.maxHp}</span></div>
    <div class="barwrap"><div class="bar hp" style="width:${
