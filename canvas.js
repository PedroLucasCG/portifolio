const canvas = document.getElementById('canvas');
if (!canvas) throw new Error('Missing <canvas id="canvas"> in the HTML.');
const ctx = canvas.getContext('2d');

//------ COMPUTED VALUES --
const css = getComputedStyle(document.documentElement);
const BASE          = (css.getPropertyValue('--base-color')   || '#ececf1').trim();
const SHADOW_DARK   = (css.getPropertyValue('--shadow-dark')  || 'rgba(163,177,198,.55)').trim();
const SHADOW_LIGHT  = (css.getPropertyValue('--shadow-light') || 'rgba(255,255,255,.98)').trim();

// ----- HiDPI resize -----
const state = { w: 0, h: 0, dpr: Math.max(1, window.devicePixelRatio || 1) };
function resize() {
  state.w = canvas.clientWidth;
  state.h = canvas.clientHeight;
  state.dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width  = Math.floor(state.w * state.dpr);
  canvas.height = Math.floor(state.h * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0); // draw in CSS pixels
}
addEventListener('resize', resize, { passive: true });
resize();

// ----- Physics Params -----
const G = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gravity')) || 1600; // px/s^2
const RESTITUTION = 0.84;   // bounciness [0..1]
const FRICTION = 0.008;     // ground friction (tangential damping)
const AIR_DRAG = 0.0008;    // light air resistance
const MAX_DT = 1/60;        // cap large frame jumps
const SUBSTEPS = 1;         // increase to 2–3 for very fast objects

// ----- Utilities -----
function rand(min, max){ return Math.random() * (max - min) + min; }
function clamp(v, a, b){ return Math.min(b, Math.max(a, v)); }

// ===== Neumorphic SOLID sphere helper (outer dual shadows only) =====
function drawNeumorphicSphere(ctx, x, y, r) {
  const off  = Math.max(6, r * 0.35);
  const blur = Math.max(8, r * 0.65);

  // Outer relief — dark (bottom-right)
  ctx.save();
  ctx.shadowColor = SHADOW_DARK;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = off;
  ctx.shadowOffsetY = off;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = BASE;
  ctx.fill();
  ctx.restore();

  // Outer relief — light (top-left)
  ctx.save();
  ctx.shadowColor = SHADOW_LIGHT;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = -off;
  ctx.shadowOffsetY = -off;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = BASE;
  ctx.fill();
  ctx.restore();
}

// ----- Circle Body -----
class Ball {
  constructor(x, y, r){
    this.px = x;
    this.py = y;
    this.vx = 0;
    this.vy = 0;
    this.r  = r;
    this.m  = Math.PI * r * r; // area-based mass
  }
  integrate(dt){
    this.vy += G * dt;
    const drag = Math.exp(-AIR_DRAG * dt * 1000);
    this.vx *= drag; this.vy *= drag;
    this.px += this.vx * dt;
    this.py += this.vy * dt;
  }
  draw(ctx){
    drawNeumorphicSphere(ctx, this.px, this.py, this.r);
  }
}

const balls = [];

// ----- Collision: Ball vs Walls -----
function collideWalls(b) {
  if (b.px - b.r < 0) { b.px = b.r; b.vx = -b.vx * RESTITUTION; }
  if (b.px + b.r > state.w) { b.px = state.w - b.r; b.vx = -b.vx * RESTITUTION; }
  if (b.py - b.r < 0) { b.py = b.r; b.vy = -b.vy * RESTITUTION; }
  if (b.py + b.r > state.h) {
    b.py = state.h - b.r;
    b.vy = -b.vy * RESTITUTION;
    const onGround = Math.abs(b.py + b.r - state.h) < 0.5 && Math.abs(b.vy) < 50;
    if (onGround) {
      b.vx *= (1 - FRICTION);
      if (Math.abs(b.vx) < 2) b.vx = 0;
    }
  }
}

// ----- Collision: Ball vs Ball (impulse) -----
function collideBalls(a, b) {
  const dx = b.px - a.px, dy = b.py - a.py;
  const dist2 = dx*dx + dy*dy, radii = a.r + b.r;
  if (dist2 === 0 || dist2 > radii*radii) return;

  const dist = Math.sqrt(dist2);
  const nx = (dist ? dx/dist : 1), ny = (dist ? dy/dist : 0);

  const penetration = radii - dist;
  const totalMass = a.m + b.m;
  const corrA = penetration * (b.m / totalMass);
  const corrB = penetration * (a.m / totalMass);
  a.px -= nx * corrA; a.py -= ny * corrA;
  b.px += nx * corrB; b.py += ny * corrB;

  const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
  const velAlongNormal = rvx*nx + rvy*ny;
  if (velAlongNormal > 0) return;

  const e = RESTITUTION;
  const j = - (1 + e) * velAlongNormal / (1/a.m + 1/b.m);
  const impX = j * nx, impY = j * ny;
  a.vx -= impX / a.m; a.vy -= impY / a.m;
  b.vx += impX / b.m; b.vy += impY / b.m;

  const tx = -ny, ty = nx;
  const vTan = rvx*tx + rvy*ty;
  const jt = -vTan / (1/a.m + 1/b.m);
  const mu = 0.02;
  const jtClamped = Math.min(mu*Math.abs(j), Math.max(-mu*Math.abs(j), jt));
  a.vx -= (jtClamped * tx) / a.m; a.vy -= (jtClamped * ty) / a.m;
  b.vx += (jtClamped * tx) / b.m; b.vy += (jtClamped * ty) / b.m;
}

// ----- World Step -----
function step(dt) {
  const subDt = Math.min(MAX_DT, dt) / SUBSTEPS;
  for (let s = 0; s < SUBSTEPS; s++) {
    for (const b of balls) b.integrate(subDt);
    for (const b of balls) collideWalls(b);
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        collideBalls(balls[i], balls[j]);
      }
    }
  }
}

// ----- Render -----
function render() {
  // Fill with base color for the neumorphic background
  ctx.save();
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, state.w, state.h);
  ctx.restore();

  for (const b of balls) b.draw(ctx);
}

// ===== Auto-spawn config & helpers =====
const INITIAL_BALLS = 2;        // how many at start
const MAX_BALLS     = 4;       // cap to avoid slowdown
const MIN_SPAWN_MS  = 4000;     // random interval window
const MAX_SPAWN_MS  = 8000;

function spawnRandomBall() {
  const r = Math.round(rand(72, 94));
  const x = rand(r + 8, state.w - r - 8);
  const y = -r - rand(10, 60);         // start slightly above the canvas
  const b = new Ball(x, y, r);
  b.vx = rand(-40, 40);                 // gentle initial nudge
  b.vy = rand(-20, 10);
  balls.push(b);
  if (balls.length > MAX_BALLS) balls.shift(); // remove oldest
}

function scheduleNextSpawn() {
  const ms = rand(MIN_SPAWN_MS, MAX_SPAWN_MS);
  setTimeout(() => {
    spawnRandomBall();
    scheduleNextSpawn();
  }, ms);
}

// ----- Animation Loop -----
let last = performance.now();
function animate(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  step(dt);
  render();
  requestAnimationFrame(animate);
}

// ===== Kickoff =====
// initial batch
for (let i = 0; i < INITIAL_BALLS; i++) spawnRandomBall();
// periodic spawns
scheduleNextSpawn();
// start render loop
requestAnimationFrame(animate);

// ----- Input: Click to spawn / Drag to flick / Double-click to clear -----
let dragStart = null;

function canvasPointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left), y: (e.clientY - rect.top) };
}

canvas.addEventListener('mousedown', (e) => {
  dragStart = { t: performance.now(), ...canvasPointFromEvent(e) };
});

canvas.addEventListener('mouseup', (e) => {
  const end = canvasPointFromEvent(e);
  const now = performance.now();

  const r = Math.round(rand(72, 94));
  const b = new Ball(end.x, end.y, r);

  // Flick velocity if dragged
  if (dragStart) {
    const dt = Math.max(16, now - dragStart.t) / 1000;
    b.vx = (end.x - dragStart.x) / dt * 0.25;
    b.vy = (end.y - dragStart.y) / dt * 0.25;
  }
  b.py = Math.min(b.py, state.h - r - 1);
  b.px += rand(-0.2, 0.2);
  b.py += rand(-0.2, 0.2);

  balls.push(b);
  if (balls.length > MAX_BALLS) balls.shift(); // remove oldest
  dragStart = null;
});

canvas.addEventListener('dblclick', () => { balls.length = 0; });

// Prevent text selection while dragging on some browsers
canvas.addEventListener('dragstart', (e) => e.preventDefault());
