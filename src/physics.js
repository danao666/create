import Matter from 'matter-js';
import decomp from 'poly-decomp';

const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;
Matter.Common.setDecomp(decomp);

export const PHYSICS = Object.freeze({
  step: 1000 / 120,
  surfaceDensity: 0.0018,
  massReferenceRadius: 18,
  massExponent: 1.2,
  dropVelocity: 6,
  restitution: 0.92,
  wallRestitution: 0.84,
  floorRestitution: 0.68,
  bounceThreshold: 0.8, // Matter velocities are pixels per nominal 60 Hz frame.
  frictionAir: 0.004,
  sleepThreshold: 90,
  mergeMaxKick: 14,
  mergeMaxOutwardSpeed: 18,
});

export function createPhysicsEngine() {
  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1.05;
  engine.positionIterations = 8;
  engine.velocityIterations = 8;

  // Sustained, slow contacts dissipate energy instead of repeatedly bouncing.
  Events.on(engine, 'beforeSolve', () => {
    for (const body of Composite.allBodies(engine.world)) {
      if (body.isStatic) continue;
      body.restitution = Body.getSpeed(body) >= PHYSICS.bounceThreshold
        ? PHYSICS.restitution : 0;
    }
  });
  Events.on(engine, 'collisionStart', ({ pairs }) => {
    for (const pair of pairs) {
      const { normal } = pair.collision;
      const bodyA = pair.collision.bodyA.parent;
      const bodyB = pair.collision.bodyB.parent;
      const velocityA = Body.getVelocity(bodyA);
      const velocityB = Body.getVelocity(bodyB);
      const normalSpeed = Math.abs(
        (velocityA.x - velocityB.x) * normal.x
        + (velocityA.y - velocityB.y) * normal.y,
      );
      pair.restitution = normalSpeed < PHYSICS.bounceThreshold ? 0
        : (bodyA.isStatic && bodyA.label === 'floor') || (bodyB.isStatic && bodyB.label === 'floor')
          ? PHYSICS.floorRestitution
          : bodyA.isStatic || bodyB.isStatic ? PHYSICS.wallRestitution
          : PHYSICS.restitution;
    }
  });
  return engine;
}

export function createPhysicsBall(x, y, radius, options = {}) {
  const body = Bodies.circle(x, y, radius, {
    restitution: PHYSICS.restitution,
    friction: 0.18,
    frictionStatic: 0.6,
    frictionAir: PHYSICS.frictionAir,
    sleepThreshold: PHYSICS.sleepThreshold,
    ...options,
  }, 64);
  // Keep the smallest disk's mass, but compress the mass range for stronger
  // small-to-large impacts. Effective area density now decreases with size.
  const reference = PHYSICS.massReferenceRadius;
  const mass = PHYSICS.surfaceDensity * Math.PI * reference ** 2
    * (radius / reference) ** PHYSICS.massExponent;
  Body.setMass(body, mass);
  Body.setInertia(body, mass * radius ** 2 / 2);
  return body;
}

export function createPhysicsPolygon(x, y, radius, outline, options = {}) {
  const vertices = outline.map(p => ({ x: p.x * radius, y: p.y * radius }));
  const body = Bodies.fromVertices(x, y, vertices, {
    restitution: PHYSICS.restitution,
    friction: 0.18,
    frictionStatic: 0.6,
    frictionAir: PHYSICS.frictionAir,
    sleepThreshold: PHYSICS.sleepThreshold,
    ...options,
  }, true, false, 0, false);
  if (!body) throw new Error('Could not create silhouette collision body');
  const equivalentRadius = Math.sqrt(body.area / Math.PI);
  const reference = PHYSICS.massReferenceRadius;
  const mass = PHYSICS.surfaceDensity * Math.PI * reference ** 2
    * (equivalentRadius / reference) ** PHYSICS.massExponent;
  Body.setMass(body, mass);
  // True polygon inertia about its centroid, including the compound parts' offsets.
  let crossSum = 0, momentSum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const cross = a.x * b.y - b.x * a.y;
    crossSum += cross;
    momentSum += cross * (a.x * a.x + a.x * b.x + b.x * b.x
      + a.y * a.y + a.y * b.y + b.y * b.y);
  }
  Body.setInertia(body, mass * momentSum / (6 * crossSum));
  body.plugin.sizeRadius = radius;
  return body;
}

// A one-shot gameplay impulse, separate from ordinary collision restitution.
export function pushMergeNeighbours(engine, mergedBall) {
  const radius = mergedBall.plugin.sizeRadius ?? mergedBall.circleRadius;
  const reach = Math.max(120, Math.min(220, radius * 2));
  const strength = Math.min(PHYSICS.mergeMaxKick, 9 + radius * 0.06);
  for (const body of Composite.allBodies(engine.world)) {
    if (body === mergedBall || body.isStatic || body.isSensor
      || body.label !== 'cat' || body.plugin.merged) continue;
    const dx = body.position.x - mergedBall.position.x;
    const dy = body.position.y - mergedBall.position.y;
    const distance = Math.hypot(dx, dy);
    const neighbourRadius = body.plugin.sizeRadius ?? body.circleRadius;
    const gap = Math.max(0, distance - radius - neighbourRadius);
    if (gap >= reach) continue;
    // Degenerate overlaps still get a finite, deterministic outward direction.
    const angle = body.id * 2.399963229728653;
    const nx = distance > 0.001 ? dx / distance : Math.cos(angle);
    const ny = distance > 0.001 ? dy / distance : Math.sin(angle);
    const massFactor = Math.max(0.9, Math.min(1.25, Math.sqrt(mergedBall.mass / body.mass)));
    const velocity = Body.getVelocity(body);
    const outwardSpeed = velocity.x * nx + velocity.y * ny;
    const kick = Math.min(
      PHYSICS.mergeMaxKick,
      strength * massFactor * (1 - gap / reach) ** 1.2,
      Math.max(0, PHYSICS.mergeMaxOutwardSpeed - outwardSpeed),
    );
    // Do not wake resting balls at the edge with negligible impulses.
    if (kick < 0.3) continue;
    Sleeping.set(body, false);
    Body.setVelocity(body, { x: velocity.x + nx * kick, y: velocity.y + ny * kick });
  }
}
