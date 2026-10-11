import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite, Events } = Matter;

export const PHYSICS = Object.freeze({
  step: 1000 / 120,
  surfaceDensity: 0.0018,
  massReferenceRadius: 18,
  massExponent: 1.2,
  dropVelocity: 6,
  restitution: 0.92,
  wallRestitution: 0.84,
  bounceThreshold: 0.8, // Matter velocities are pixels per nominal 60 Hz frame.
  frictionAir: 0.004,
  sleepThreshold: 90,
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
