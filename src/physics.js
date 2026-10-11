import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;

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
  mergeMaxKick: 5.2,
  mergeMaxOutwardSpeed: 7,
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
      const { bodyA, bodyB, normal } = pair.collision;
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

// A one-shot gameplay impulse, separate from ordinary collision restitution.
export function pushMergeNeighbours(engine, mergedBall) {
  const radius = mergedBall.circleRadius;
  const reach = Math.max(60, Math.min(120, radius * 1.4));
  const strength = Math.min(PHYSICS.mergeMaxKick, 2.7 + radius * 0.024);
  for (const body of Composite.allBodies(engine.world)) {
    if (body === mergedBall || body.isStatic || body.isSensor
      || body.label !== 'cat' || body.plugin.merged) continue;
    const dx = body.position.x - mergedBall.position.x;
    const dy = body.position.y - mergedBall.position.y;
    const distance = Math.hypot(dx, dy);
    const gap = Math.max(0, distance - radius - body.circleRadius);
    if (gap >= reach) continue;
    // Degenerate overlaps still get a finite, deterministic outward direction.
    const angle = body.id * 2.399963229728653;
    const nx = distance > 0.001 ? dx / distance : Math.cos(angle);
    const ny = distance > 0.001 ? dy / distance : Math.sin(angle);
    const massFactor = Math.max(0.65, Math.min(1.35, Math.sqrt(mergedBall.mass / body.mass)));
    const velocity = Body.getVelocity(body);
    const outwardSpeed = velocity.x * nx + velocity.y * ny;
    const kick = Math.min(
      PHYSICS.mergeMaxKick,
      strength * massFactor * (1 - gap / reach) ** 2,
      Math.max(0, PHYSICS.mergeMaxOutwardSpeed - outwardSpeed),
    );
    // Do not wake resting balls at the edge with negligible impulses.
    if (kick < 0.3) continue;
    Sleeping.set(body, false);
    Body.setVelocity(body, { x: velocity.x + nx * kick, y: velocity.y + ny * kick });
  }
}
