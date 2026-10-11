import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { PHYSICS, createPhysicsEngine, createPhysicsBall, pushMergeNeighbours } from '../src/physics.js';

const { Body, Composite, Sleeping, Bodies, Engine } = Matter;
const ball = (x, y, radius = 20) => createPhysicsBall(x, y, radius, { label: 'cat' });

test('merging pushes nearby balls radially with distance falloff and wakes them', () => {
  const engine = createPhysicsEngine();
  const merged = ball(200, 200, 40);
  const right = ball(260, 200);
  const left = ball(140, 200);
  const above = ball(200, 140);
  const below = ball(200, 260);
  const farther = ball(285, 200);
  const distant = ball(400, 200);
  Composite.add(engine.world, [merged, right, left, above, below, farther, distant]);
  for (const body of [right, left, above, below, farther, distant]) Sleeping.set(body, true);
  pushMergeNeighbours(engine, merged);
  assert.ok(right.velocity.x > 0 && left.velocity.x < 0);
  assert.ok(right.velocity.x > 12, 'nearby balls receive a dramatic merge kick');
  assert.ok(above.velocity.y < 0 && below.velocity.y > 0);
  assert.ok(farther.velocity.x > 0 && farther.velocity.x < right.velocity.x);
  assert.ok(!right.isSleeping && distant.isSleeping);
  assert.equal(distant.speed, 0);
  assert.equal(merged.speed, 0);
});

test('larger neighbours get smaller kicks and repeated merges limit outward speed', () => {
  const engine = createPhysicsEngine();
  const merged = ball(200, 200, 40);
  const small = ball(260, 200, 20);
  const large = ball(100, 200, 60);
  Composite.add(engine.world, [merged, small, large]);
  pushMergeNeighbours(engine, merged);
  assert.ok(small.speed > large.speed);
  assert.ok(small.speed <= PHYSICS.mergeMaxKick);
  for (let i = 0; i < 10; i++) pushMergeNeighbours(engine, merged);
  assert.ok(small.velocity.x <= PHYSICS.mergeMaxOutwardSpeed + 1e-10);
  Body.setVelocity(small, { x: 25, y: 0 });
  pushMergeNeighbours(engine, merged);
  assert.equal(small.velocity.x, 25, 'existing fast outward motion is not artificially slowed');
});

test('strong merge impulses reverse incoming motion and also displace large and farther balls', () => {
  const engine = createPhysicsEngine();
  const merged = ball(200, 200, 40);
  const incoming = ball(260, 200);
  const large = ball(74, 200, 86);
  const farther = ball(360, 200);
  Composite.add(engine.world, [merged, incoming, large, farther]);
  Body.setVelocity(incoming, { x: -8, y: 0 });
  Sleeping.set(large, true);
  Sleeping.set(farther, true);
  pushMergeNeighbours(engine, merged);
  assert.ok(incoming.velocity.x > 4, 'incoming ball should reverse outward');
  assert.ok(large.velocity.x < -9 && !large.isSleeping, 'large balls should move significantly');
  assert.ok(farther.velocity.x > 1 && !farther.isSleeping, 'expanded range affects farther balls');
});

test('a strongly launched neighbour still falls back and comes to rest', () => {
  const engine = createPhysicsEngine();
  const merged = ball(200, 240, 40);
  const neighbour = ball(200, 180);
  Composite.add(engine.world, [neighbour,
    Bodies.rectangle(200, 408, 600, 16, { isStatic: true, label: 'floor' }),
  ]);
  Sleeping.set(neighbour, true);
  pushMergeNeighbours(engine, merged);
  assert.ok(neighbour.velocity.y < -12);
  for (let i = 0; i < 30 * 1000 / PHYSICS.step; i++) Engine.update(engine, PHYSICS.step);
  assert.ok(neighbour.isSleeping);
  assert.ok(neighbour.position.y > 375 && neighbour.position.y < 383);
});

test('overlapping centres stay finite; walls and balls pending another merge are untouched', () => {
  const engine = createPhysicsEngine();
  const merged = ball(200, 200, 40);
  const overlap = ball(200, 200);
  const wall = ball(260, 200);
  Body.setStatic(wall, true);
  const pending = ball(140, 200);
  pending.plugin.merged = true;
  Composite.add(engine.world, [merged, overlap, wall, pending]);
  pushMergeNeighbours(engine, merged);
  assert.ok(Number.isFinite(overlap.velocity.x) && Number.isFinite(overlap.velocity.y));
  assert.ok(overlap.speed > 0);
  assert.equal(wall.speed, 0);
  assert.equal(pending.speed, 0);
});
