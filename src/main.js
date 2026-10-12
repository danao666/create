import Matter from 'matter-js';
import './style.css';
import { PHYSICS, createPhysicsEngine, createPhysicsBall, createPhysicsPolygon, pushMergeNeighbours } from './physics.js';
import shapes from './generated/cat-shapes.json';
import { CAT_STAGES } from './stages.js';
import { createRewards, grantRewards, consumeReviveCard } from './rewards.js';
import { createCelebration } from './celebration.js';

const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;

const WIDTH = 420;
const HEIGHT = 620;
const WALL = 16;
const FLOOR_Y = HEIGHT - 12;
const DANGER_Y = 92;
const PREVIEW_Y = 49;
const TOP_STAGE = 4;
const BEST_KEY = 'hecheng-damaodie-best';
const stageImages = shapes.map(shape => {
  if (!shape) return null;
  const image = new Image();
  image.src = `${import.meta.env.BASE_URL}images/${shape.file}`;
  image.onload = () => {
    if (shapes[nextStage] === shape) updateNextPreview();
  };
  return image;
});

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const engine = createPhysicsEngine();

const boundaries = [
  Bodies.rectangle(-WALL / 2, HEIGHT / 2, WALL, HEIGHT * 2, { isStatic: true, label: 'wall-left', friction: 0.08 }),
  Bodies.rectangle(WIDTH + WALL / 2, HEIGHT / 2, WALL, HEIGHT * 2, { isStatic: true, label: 'wall-right', friction: 0.08 }),
  Bodies.rectangle(WIDTH / 2, FLOOR_Y + WALL / 2, WIDTH, WALL, { isStatic: true, label: 'floor', friction: 0.08 }),
];
Composite.add(engine.world, boundaries);

const scoreElement = document.querySelector('#score');
const bestElement = document.querySelector('#best-score');
const nextPreview = document.querySelector('#next-preview');
const roundElement = document.querySelector('#round-number');
const gameOverOverlay = document.querySelector('#game-over');
const victoryOverlay = document.querySelector('#victory');
const reviveButton = document.querySelector('#revive');
const reviveHint = document.querySelector('#revive-hint');
const celebration = createCelebration(document.querySelector('#celebration'));
let rewards = createRewards();
let hasWon = false;
let dropTimeout = null;
let score = 0;
let bestScore = readBestScore();
let nextStage = randomStage();
let activeStage = null;
let aimX = WIDTH / 2;
let canDrop = true;
let isGameOver = false;
let mergeQueue = new Set();
let dangerSince = new Map();
let mergeFlash = [];
let lastFrame = performance.now();
let accumulatedTime = 0;
let round = 1;

function readBestScore() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; }
  catch { return 0; }
}

function randomStage() {
  return Math.floor(Math.random() * TOP_STAGE);
}

function stageOf(body) {
  return CAT_STAGES[body.plugin.stage];
}

function makeCat(x, y, stage, { isSensor = false } = {}) {
  const data = CAT_STAGES[stage];
  const options = { label: 'cat', isSensor };
  const body = shapes[stage]
    ? createPhysicsPolygon(x, y, data.radius, shapes[stage].vertices, options)
    : createPhysicsBall(x, y, data.radius, options);
  body.plugin.stage = stage;
  body.plugin.merged = false;
  return body;
}

function addNextCat() {
  if (isGameOver) return;
  activeStage = nextStage;
  nextStage = randomStage();
  aimX = clampAim(aimX, activeStage);
  updateNextPreview();
  canDrop = true;
}

function clampAim(x, stage) {
  const radius = CAT_STAGES[stage].radius;
  const draw = shapes[stage]?.draw ?? { x: -1, width: 2 };
  return Math.max(WALL - draw.x * radius, Math.min(WIDTH - WALL - (draw.x + draw.width) * radius, x));
}

function updateNextPreview() {
  const preview = CAT_STAGES[nextStage];
  const image = stageImages[nextStage], shape = shapes[nextStage];
  if (shape && image?.complete && image.naturalWidth) {
    const thumbnail = document.createElement('canvas');
    thumbnail.width = thumbnail.height = 64;
    thumbnail.style.width = thumbnail.style.height = '36px';
    const { crop } = shape;
    const scale = 60 / Math.max(crop.width, crop.height);
    const width = crop.width * scale, height = crop.height * scale;
    thumbnail.getContext('2d').drawImage(image, crop.x, crop.y, crop.width, crop.height,
      (64 - width) / 2, (64 - height) / 2, width, height);
    nextPreview.replaceChildren(thumbnail);
  } else {
    nextPreview.textContent = preview.emoji;
  }
  nextPreview.style.background = preview.color;
  nextPreview.style.fontSize = `${Math.min(27, 15 + preview.radius / 6)}px`;
}

function dropCat() {
  if (!canDrop || isGameOver) return;
  const radius = CAT_STAGES[activeStage].radius;
  const x = clampAim(aimX, activeStage);
  const body = makeCat(x, PREVIEW_Y + radius, activeStage);
  Body.setVelocity(body, { x: 0, y: PHYSICS.dropVelocity });
  Composite.add(engine.world, body);
  canDrop = false;
  dropTimeout = window.setTimeout(() => {
    dropTimeout = null;
    addNextCat();
  }, 420);
}

function award(points) {
  score += points;
  scoreElement.textContent = score.toLocaleString('zh-CN');
  const earned = grantRewards(rewards, score);
  updateReviveInventory();
  earned.forEach((milestone, lane) => {
    announce(`🎟 达到 ${milestone.toLocaleString('zh-CN')} 分！获得一张复活卡`, lane);
  });
  if (score > bestScore) {
    bestScore = score;
    bestElement.textContent = bestScore.toLocaleString('zh-CN');
    try { localStorage.setItem(BEST_KEY, String(bestScore)); } catch { /* storage may be disabled */ }
  }
}

function updateReviveInventory() {
  document.querySelector('#revive-count').textContent = String(rewards.cards);
  reviveButton.textContent = `使用复活卡继续（剩余 ${rewards.cards} 张）`;
  reviveButton.classList.toggle('hidden', rewards.cards === 0);
  reviveHint.classList.toggle('hidden', rewards.cards === 0);
}

function announce(message, lane = 0) {
  const notice = document.createElement('div');
  notice.className = 'reward-danmaku';
  notice.textContent = message;
  notice.style.top = `${64 + lane * 42}px`;
  notice.addEventListener('animationend', () => notice.remove(), { once: true });
  document.querySelector('#reward-barrage').append(notice);
}

function onCollisionStart({ pairs }) {
  for (const pair of pairs) {
    const bodyA = pair.bodyA.parent, bodyB = pair.bodyB.parent;
    if (bodyA.label !== 'cat' || bodyB.label !== 'cat') continue;
    const stageA = bodyA.plugin.stage;
    if (stageA !== bodyB.plugin.stage || stageA >= CAT_STAGES.length - 1) continue;
    if (bodyA.plugin.merged || bodyB.plugin.merged) continue;
    bodyA.plugin.merged = true;
    bodyB.plugin.merged = true;
    mergeQueue.add({ bodyA, bodyB });
  }
}

Events.on(engine, 'collisionStart', onCollisionStart);

function resolveMerges() {
  if (isGameOver) { mergeQueue.clear(); return; }
  if (!mergeQueue.size) return;
  for (const { bodyA, bodyB } of mergeQueue) {
    if (!Composite.get(engine.world, bodyA.id, 'body') || !Composite.get(engine.world, bodyB.id, 'body')) continue;
    const stage = bodyA.plugin.stage;
    const x = (bodyA.position.x + bodyB.position.x) / 2;
    const y = (bodyA.position.y + bodyB.position.y) / 2;
    // Removing a supporting ball changes the stack; allow its neighbours to settle again.
    for (const pair of engine.pairs.list) {
      if (!pair.isActive) continue;
      const parentA = pair.bodyA.parent, parentB = pair.bodyB.parent;
      const affected = parentA === bodyA || parentA === bodyB
        || parentB === bodyA || parentB === bodyB;
      if (!affected) continue;
      for (const neighbour of [parentA, parentB]) {
        if (!neighbour.isStatic && neighbour !== bodyA && neighbour !== bodyB) {
          Sleeping.set(neighbour, false);
        }
      }
    }
    Composite.remove(engine.world, bodyA);
    Composite.remove(engine.world, bodyB);
    const upgraded = makeCat(x, y, stage + 1);
    // Upgrading changes disk area as a gameplay rule; retain centre-of-mass
    // velocity rather than injecting a new upward impulse.
    const combinedMass = bodyA.mass + bodyB.mass;
    Body.setVelocity(upgraded, {
      x: (bodyA.mass * bodyA.velocity.x + bodyB.mass * bodyB.velocity.x) / combinedMass,
      y: (bodyA.mass * bodyA.velocity.y + bodyB.mass * bodyB.velocity.y) / combinedMass,
    });
    Composite.add(engine.world, upgraded);
    pushMergeNeighbours(engine, upgraded);
    mergeFlash.push({ x, y, born: performance.now(), color: CAT_STAGES[stage + 1].color });
    award(CAT_STAGES[stage + 1].points);
    if (stage + 1 === CAT_STAGES.length - 1) { winGame(); break; }
  }
  mergeQueue.clear();
}

function updateDangerLine(now) {
  if (isGameOver) return;
  const currentCats = Composite.allBodies(engine.world).filter((body) => body.label === 'cat' && !body.isSensor);
  const present = new Set(currentCats.map((body) => body.id));
  for (const id of dangerSince.keys()) if (!present.has(id)) dangerSince.delete(id);
  for (const body of currentCats) {
    const aboveLine = body.bounds.min.y < DANGER_Y;
    const almostSettled = Math.abs(body.velocity.x) < 0.35 && Math.abs(body.velocity.y) < 0.45
      && Math.abs(body.angularVelocity) < 0.02;
    if (!aboveLine || !almostSettled) {
      dangerSince.delete(body.id);
      continue;
    }
    const since = dangerSince.get(body.id) ?? now;
    dangerSince.set(body.id, since);
    if (now - since > 950) endGame();
  }
}

function endGame() {
  if (isGameOver) return;
  isGameOver = true;
  clearTimeout(dropTimeout);
  canDrop = false;
  updateReviveInventory();
  document.querySelector('#final-score').textContent = score.toLocaleString('zh-CN');
  gameOverOverlay.classList.remove('hidden');
  (rewards.cards ? reviveButton : document.querySelector('#restart')).focus();
}

function winGame() {
  if (isGameOver) return;
  hasWon = true;
  isGameOver = true;
  canDrop = false;
  clearTimeout(dropTimeout);
  document.querySelector('#victory-score').textContent = score.toLocaleString('zh-CN');
  const image = stageImages.at(-1), shape = shapes.at(-1);
  const portrait = document.querySelector('#victory-cat');
  const portraitCtx = portrait.getContext('2d');
  portraitCtx.clearRect(0, 0, 144, 144);
  if (shape && image?.complete && image.naturalWidth) {
    const { crop } = shape, scale = 136 / Math.max(crop.width, crop.height);
    const w = crop.width * scale, h = crop.height * scale;
    portraitCtx.drawImage(image, crop.x, crop.y, crop.width, crop.height, (144 - w) / 2, (144 - h) / 2, w, h);
  }
  victoryOverlay.classList.remove('hidden');
  document.querySelector('#victory-restart').focus();
  celebration.start();
}

function reviveGame() {
  if (!isGameOver || hasWon || !consumeReviveCard(rewards)) return;
  clearTimeout(dropTimeout);
  for (const body of Composite.allBodies(engine.world)) {
    if (body.label !== 'cat') continue;
    if (body.bounds.min.y < DANGER_Y + 120) Composite.remove(engine.world, body);
    else { body.plugin.merged = false; Sleeping.set(body, false); }
  }
  mergeQueue.clear(); dangerSince.clear();
  isGameOver = false;
  accumulatedTime = 0;
  gameOverOverlay.classList.add('hidden');
  updateReviveInventory();
  addNextCat();
  announce('🎟 复活成功！继续冲击哈基仙');
  canvas.focus();
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawBackground() {
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, '#fffdf8');
  bg.addColorStop(1, '#fffaf0');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#faf2e6';
  roundedRect(ctx, WALL, 4, WIDTH - WALL * 2, HEIGHT - WALL - 1, 13);
  ctx.fill();
  ctx.save();
  ctx.setLineDash([5, 6]);
  ctx.strokeStyle = '#e8ad89';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(WALL + 10, DANGER_Y);
  ctx.lineTo(WIDTH - WALL - 10, DANGER_Y);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#d49a79';
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('危险线', WIDTH - 25, DANGER_Y - 7);
  ctx.textAlign = 'left';
}

function drawCat(body) {
  const { radius, emoji, color } = stageOf(body);
  const { x, y } = body.position;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(body.angle ?? 0);
  const shape = shapes[body.plugin.stage], image = stageImages[body.plugin.stage];
  if (shape && image?.complete && image.naturalWidth) {
    const { crop, draw } = shape;
    ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height,
      draw.x * radius, draw.y * radius, draw.width * radius, draw.height * radius);
    ctx.restore();
    return;
  }
  const gradient = ctx.createRadialGradient(-radius * .32, -radius * .38, radius * .08, 0, 0, radius * 1.12);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(.34, color);
  gradient.addColorStop(1, color);
  ctx.fillStyle = gradient;
  ctx.shadowColor = '#78634c1c';
  ctx.shadowBlur = body.isSleeping ? 4 : 7;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#ffffffa0';
  ctx.lineWidth = Math.max(1, radius * .055);
  ctx.stroke();
  ctx.font = `${Math.floor(radius * 1.13)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 0, 1);
  ctx.restore();
}

function drawAim() {
  if (!canDrop || isGameOver || activeStage === null) return;
  const radius = CAT_STAGES[activeStage].radius;
  const x = clampAim(aimX, activeStage);
  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = '#d6aa88a0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 3);
  ctx.lineTo(x, DANGER_Y - 5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = .84;
  drawCat(makePreviewBody(x, PREVIEW_Y + radius, activeStage));
  ctx.restore();
}

function makePreviewBody(x, y, stage) {
  return { label: 'cat', plugin: { stage }, position: { x, y }, isSleeping: true };
}

function drawMerges(now) {
  mergeFlash = mergeFlash.filter((flash) => now - flash.born < 280);
  for (const flash of mergeFlash) {
    const progress = (now - flash.born) / 280;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = flash.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(flash.x, flash.y, 20 + progress * 48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function render(now) {
  const delta = Math.min(now - lastFrame, 100);
  lastFrame = now;
  accumulatedTime = isGameOver ? 0 : accumulatedTime + delta;
  while (!isGameOver && accumulatedTime >= PHYSICS.step) {
    Engine.update(engine, PHYSICS.step);
    resolveMerges();
    accumulatedTime -= PHYSICS.step;
  }
  updateDangerLine(now);
  drawBackground();
  drawAim();
  for (const body of Composite.allBodies(engine.world)) {
    if (body.label === 'cat' && !body.isSensor) drawCat(body);
  }
  drawMerges(now);
  requestAnimationFrame(render);
}

function setAimFromPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  aimX = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
}

canvas.addEventListener('pointermove', setAimFromPointer);
canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  setAimFromPointer(event);
  dropCat();
});

window.addEventListener('keydown', (event) => {
  if (isGameOver) return;
  if (['ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  if (event.code === 'ArrowLeft' || event.code === 'KeyA') aimX -= 24;
  if (event.code === 'ArrowRight' || event.code === 'KeyD') aimX += 24;
  if (event.code === 'Space' || event.code === 'ArrowDown' || event.code === 'Enter') dropCat();
  aimX = clampAim(aimX, activeStage ?? 0);
});

function restartGame() {
  clearTimeout(dropTimeout);
  celebration.stop();
  for (const body of Composite.allBodies(engine.world)) if (body.label === 'cat') Composite.remove(engine.world, body);
  score = 0;
  scoreElement.textContent = '0';
  isGameOver = false;
  hasWon = false;
  rewards = createRewards();
  updateReviveInventory();
  accumulatedTime = 0;
  document.querySelector('#reward-barrage').replaceChildren();
  dangerSince.clear();
  mergeQueue.clear();
  mergeFlash = [];
  round += 1;
  roundElement.textContent = String(round).padStart(3, '0');
  gameOverOverlay.classList.add('hidden');
  victoryOverlay.classList.add('hidden');
  addNextCat();
  canvas.focus();
}

document.querySelector('#restart').addEventListener('click', restartGame);
document.querySelector('#victory-restart').addEventListener('click', restartGame);
reviveButton.addEventListener('click', reviveGame);

bestElement.textContent = bestScore.toLocaleString('zh-CN');
addNextCat();
requestAnimationFrame(render);
