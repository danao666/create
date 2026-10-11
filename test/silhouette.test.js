import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import Matter from 'matter-js';
import { CAT_STAGES } from '../src/stages.js';
import { PHYSICS, createPhysicsEngine, createPhysicsPolygon, pushMergeNeighbours } from '../src/physics.js';

const shapes = JSON.parse(readFileSync(new URL('../src/generated/cat-shapes.json', import.meta.url)));
const radii = CAT_STAGES.map(stage => stage.radius);
const { Composite, Bodies, Engine, Vertices, Sleeping } = Matter;

test('uploaded silhouettes have matching visual bounds and area; missing images retain fallback metadata', () => {
  assert.equal(shapes.length, CAT_STAGES.length);
  for (let i = 0; i < shapes.length; i++) {
    const file = `cat-${String(i + 1).padStart(2, '0')}.png`;
    assert.equal(shapes[i] !== null, existsSync(new URL(`../public/images/${file}`, import.meta.url)));
    if (!shapes[i]) continue;
    const shape = shapes[i], radius = radii[i];
    const body = createPhysicsPolygon(200, 120, radius, shape.vertices, { label: 'cat' });
    if (!Vertices.isConvex(shape.vertices)) assert.ok(body.parts.length > 1, `${shape.file} should retain its concave silhouette`);
    assert.ok(!body.circleRadius);
    assert.ok(body.mass > 0 && Number.isFinite(body.inertia) && body.inertia > 0);
    assert.ok(Math.abs(body.bounds.min.x - (200 + shape.draw.x * radius)) < 0.01);
    assert.ok(Math.abs(body.bounds.min.y - (120 + shape.draw.y * radius)) < 0.01);
    assert.ok(Math.abs(body.bounds.max.x - (200 + (shape.draw.x + shape.draw.width) * radius)) < 0.01);
    assert.ok(Math.abs(body.bounds.max.y - (120 + (shape.draw.y + shape.draw.height) * radius)) < 0.01);
    const silhouetteArea = Vertices.area(shape.vertices.map(p => ({ x: p.x * radius, y: p.y * radius })));
    assert.ok(Math.abs(body.area - silhouetteArea) < 0.01, 'decomposition must preserve silhouette area');
    assert.ok(Math.abs(Math.max(shape.draw.width, shape.draw.height) * radius - radius * 2) < 0.01);
  }
});

test('uploaded irregular bodies fall, collide with the floor, and settle without numerical instability', () => {
  for (let i = 0; i < shapes.length; i++) {
    if (!shapes[i]) continue;
    const engine = createPhysicsEngine();
    const body = createPhysicsPolygon(210, 120, radii[i], shapes[i].vertices, { label: 'cat' });
    Composite.add(engine.world, [body,
      Bodies.rectangle(210, 608, 420, 16, { isStatic: true, label: 'floor' }),
      Bodies.rectangle(-8, 0, 16, 2000, { isStatic: true }),
      Bodies.rectangle(428, 0, 16, 2000, { isStatic: true }),
    ]);
    for (let step = 0; step < 30 * 1000 / PHYSICS.step; step++) Engine.update(engine, PHYSICS.step);
    assert.ok(Number.isFinite(body.angle) && Number.isFinite(body.position.x));
    assert.ok(body.isSleeping, `${shapes[i].file} should eventually settle`);
    assert.ok(body.bounds.max.y > 598 && body.bounds.max.y < 601);
    const position = { ...body.position }, angle = body.angle;
    for (let step = 0; step < 120; step++) Engine.update(engine, PHYSICS.step);
    assert.deepEqual(body.position, position);
    assert.equal(body.angle, angle);
  }
});

test('merge shockwaves also wake and propel silhouette bodies', () => {
  const engine = createPhysicsEngine();
  const merged = createPhysicsPolygon(200, 200, 44, shapes[4].vertices, { label: 'cat' });
  const neighbour = createPhysicsPolygon(265, 200, 23, shapes[1].vertices, { label: 'cat' });
  Composite.add(engine.world, [merged, neighbour]);
  Sleeping.set(neighbour, true);
  pushMergeNeighbours(engine, merged);
  assert.ok(!neighbour.isSleeping && neighbour.velocity.x > 10);
  assert.ok(Number.isFinite(neighbour.velocity.y));
});
