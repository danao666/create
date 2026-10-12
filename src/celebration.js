const COLORS = ['#ffd166', '#ff707d', '#c18cff', '#7de1c3', '#74c9ff', '#ff9f50'];

export function createCelebration(canvas) {
  const ctx = canvas.getContext('2d');
  let frame = 0, particles = [], started = 0, lastTime = 0, nextBurst = 0;
  let width = 0, height = 0;
  function resize() {
    if (width === window.innerWidth && height === window.innerHeight) return;
    width = window.innerWidth; height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function stop() {
    cancelAnimationFrame(frame);
    particles = [];
    ctx.clearRect(0, 0, width, height);
    canvas.hidden = true;
  }
  function burst(x, y, count) {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      const speed = 90 + Math.random() * 170;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        age: 0, life: 1.2 + Math.random() * 0.8, color, kind: 'spark' });
    }
  }
  function start() {
    stop(); resize(); canvas.hidden = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 1200 : 7000;
    for (let i = 0; i < (reduced ? 30 : 150); i++) {
      particles.push({ x: Math.random() * width, y: -Math.random() * height * 0.8,
        vx: (Math.random() - 0.5) * 150, vy: 100 + Math.random() * 130,
        age: 0, life: duration / 1000, color: COLORS[i % COLORS.length], kind: 'ribbon',
        angle: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 8 });
    }
    started = lastTime = performance.now(); nextBurst = 0;
    function draw(now) {
      if (now - started >= duration) { stop(); return; }
      resize();
      const dt = Math.min((now - lastTime) / 1000, 0.04);
      lastTime = now;
      const elapsed = (now - started) / 1000;
      if (elapsed >= nextBurst && elapsed < duration / 1000 - 1) {
        burst(width * (0.15 + Math.random() * 0.7), height * (0.15 + Math.random() * 0.4), reduced ? 18 : 54);
        nextBurst = elapsed + 0.4;
      }
      ctx.clearRect(0, 0, width, height);
      particles = particles.filter(p => p.age < p.life && p.y < height + 50);
      for (const p of particles) {
        const previousX = p.x, previousY = p.y;
        p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += (p.kind === 'spark' ? 75 : 25) * dt;
        ctx.globalAlpha = Math.max(0, Math.min(1, (p.life - p.age) * 1.5));
        if (p.kind === 'spark') {
          p.vx *= Math.exp(-0.65 * dt); p.vy *= Math.exp(-0.4 * dt);
          ctx.strokeStyle = p.color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(previousX, previousY); ctx.lineTo(p.x, p.y); ctx.stroke();
        } else {
          p.angle += p.spin * dt;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
          ctx.fillStyle = p.color; ctx.fillRect(-3, -7, 6, 14); ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
  }
  return { start, stop };
}
