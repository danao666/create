import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { PHYSICS, createPhysicsEngine, createPhysicsBall } from '../src/physics.js';

const { Engine, Bodies, Body, Composite, Events } = Matter;
function advance(engine, seconds) {
  for (let i = 0; i < seconds * 1000 / PHYSICS.step; i++) Engine.update(engine, PHYSICS.step);
}
function floor(engine) {
  Composite.add(engine.world, Bodies.rectangle(200, 408, 600, 16, { isStatic: true }));
}

test('mass range is compressed while retaining disk inertia', () => {
  const small = createPhysicsBall(0, 0, 20);
  const large = createPhysicsBall(0, 0, 40);
  assert.ok(Math.abs(large.mass / small.mass - 2 ** 1.2) < 1e-10);
  assert.ok(large.mass / small.mass < 4);
  assert.equal(small.inertia, small.mass * 20 ** 2 / 2);
});

test('a small ball noticeably accelerates a much larger ball', () => {
  const engine = createPhysicsEngine();
  engine.gravity.y = 0;
  const small = createPhysicsBall(100, 100, 18, { frictionAir: 0, friction: 0 });
  const large = createPhysicsBall(208, 100, 86, { frictionAir: 0, friction: 0 });
  Composite.add(engine.world, [small, large]);
  Body.setVelocity(small, { x: 8, y: 0 });
  advance(engine, 0.15);
  assert.ok(large.velocity.x > 1.5, 'large ball should receive a visible impulse');
});

test('unequal balls conserve linear momentum and dissipate collision energy', () => {
  const engine = createPhysicsEngine();
  engine.gravity.y = 0;
  const a = createPhysicsBall(100, 100, 20, { frictionAir: 0, friction: 0 });
  const b = createPhysicsBall(165, 100, 40, { frictionAir: 0, friction: 0 });
  Body.setVelocity(a, { x: 6, y: 0 });
  Body.setVelocity(b, { x: -1, y: 0 });
  Composite.add(engine.world, [a, b]);
  const momentum = a.mass * 6 - b.mass;
  const energy = (a.mass * 36 + b.mass) / 2;
  advance(engine, 0.2);
  assert.ok(Math.abs(a.mass * a.velocity.x + b.mass * b.velocity.x - momentum) < 0.01);
  assert.ok((a.mass * a.speed ** 2 + b.mass * b.speed ** 2) / 2 < energy);
  assert.ok(b.velocity.x > a.velocity.x, 'balls separate after impact');
});

test('a falling ball bounces, loses height and eventually sleeps', () => {
  const engine = createPhysicsEngine();
  floor(engine);
  const ball = createPhysicsBall(200, 80, 20);
  Body.setVelocity(ball, { x: 0, y: PHYSICS.dropVelocity });
  Composite.add(engine.world, ball);
  let bounced = false;
  let highestRebound = 400;
  Events.on(engine, 'afterUpdate', () => {
    if (ball.velocity.y < -1) bounced = true;
    if (bounced) highestRebound = Math.min(highestRebound, ball.position.y);
  });
  advance(engine, 20);
  assert.ok(bounced);
  assert.ok(highestRebound < 230, 'first rebound should travel over 150 pixels');
  assert.ok(ball.position.y > 375 && ball.position.y < 383);
  assert.ok(ball.isSleeping);
  const position = { ...ball.position };
  advance(engine, 2);
  assert.deepEqual(ball.position, position);
});

test('wall impact reverses normal velocity with decay', () => {
  const engine = createPhysicsEngine();
  engine.gravity.y = 0;
  const ball = createPhysicsBall(100, 100, 20, { frictionAir: 0 });
  Composite.add(engine.world, [ball, Bodies.rectangle(150, 100, 16, 400, { isStatic: true })]);
  Body.setVelocity(ball, { x: 8, y: 0 });
  advance(engine, 0.1);
  assert.ok(ball.velocity.x < 0);
  assert.ok(Math.abs(ball.velocity.x) < 8);
});

test('settled stacks stay still under tiny contacts but wake for direct impacts', () => {
  const engine = createPhysicsEngine();
  floor(engine);
  Composite.add(engine.world, [
    Bodies.rectangle(162, 200, 16, 400, { isStatic: true }),
    Bodies.rectangle(238, 200, 16, 400, { isStatic: true }),
  ]);
  const lower = createPhysicsBall(200, 370, 30);
  const upper = createPhysicsBall(200, 310, 30);
  Composite.add(engine.world, [lower, upper]);
  advance(engine, 15);
  assert.ok(lower.isSleeping && upper.isSleeping);
  const resting = { ...upper.position };
  const tiny = createPhysicsBall(upper.position.x, upper.position.y - 34.8, 5, { frictionAir: 0 });
  Body.setVelocity(tiny, { x: 0, y: 0.02 });
  engine.gravity.y = 0;
  Composite.add(engine.world, tiny);
  advance(engine, 0.5);
  assert.ok(upper.isSleeping);
  assert.deepEqual(upper.position, resting);
  Composite.remove(engine.world, tiny);
  const impact = createPhysicsBall(upper.position.x, upper.position.y - 90, 25);
  Body.setVelocity(impact, { x: 0, y: 8 });
  Composite.add(engine.world, impact);
  advance(engine, 0.1);
  assert.ok(!upper.isSleeping, 'a real impact must wake the resting ball');
});
