import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import decomp from 'poly-decomp';
import Matter from 'matter-js';

const root = fileURLToPath(new URL('../', import.meta.url));
const resolution = 192;
const alphaThreshold = 64;

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const first = points[0], last = points.at(-1);
  const dx = last[0] - first[0], dy = last[1] - first[1];
  let greatest = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const t = dx || dy ? Math.max(0, Math.min(1,
      ((points[i][0] - first[0]) * dx + (points[i][1] - first[1]) * dy) / (dx * dx + dy * dy))) : 0;
    const distance = Math.hypot(points[i][0] - first[0] - t * dx, points[i][1] - first[1] - t * dy);
    if (distance > greatest) { greatest = distance; index = i; }
  }
  if (greatest <= tolerance) return [first, last];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance)];
}

function signedArea(points) {
  return points.reduce((sum, [x, y], i) => {
    const next = points[(i + 1) % points.length];
    return sum + x * next[1] - next[0] * y;
  }, 0) / 2;
}

function silhouette(png) {
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    if (png.data[(y * png.width + x) * 4 + 3] < alphaThreshold) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (maxX < minX) throw new Error('Image has no visible silhouette');
  const cropWidth = maxX - minX + 1, cropHeight = maxY - minY + 1;
  const scale = Math.min(1, resolution / Math.max(cropWidth, cropHeight));
  const width = Math.max(1, Math.round(cropWidth * scale));
  const height = Math.max(1, Math.round(cropHeight * scale));
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = minX + Math.min(cropWidth - 1, Math.floor((x + 0.5) * cropWidth / width));
    const py = minY + Math.min(cropHeight - 1, Math.floor((y + 0.5) * cropHeight / height));
    mask[y * width + x] = png.data[(py * png.width + px) * 4 + 3] >= alphaThreshold ? 1 : 0;
  }
  // Keep the main connected silhouette, omitting detached specks/whisker fragments.
  const visited = new Uint8Array(mask.length);
  let largest = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const component = [start]; visited[start] = 1;
    for (let i = 0; i < component.length; i++) {
      const p = component[i], x = p % width, y = Math.floor(p / width);
      const neighbours = [];
      if (x > 0) neighbours.push(p - 1);
      if (x + 1 < width) neighbours.push(p + 1);
      if (y > 0) neighbours.push(p - width);
      if (y + 1 < height) neighbours.push(p + width);
      for (const n of neighbours) if (mask[n] && !visited[n]) { visited[n] = 1; component.push(n); }
    }
    if (component.length > largest.length) largest = component;
  }
  mask.fill(0);
  for (const p of largest) mask[p] = 1;
  const edges = new Map();
  const key = (x, y) => y * (width + 1) + x;
  function edge(x, y, nx, ny, direction) {
    const start = key(x, y), end = key(nx, ny);
    if (!edges.has(start)) edges.set(start, []);
    edges.get(start).push({ start, end, point: [x, y], direction, used: false });
  }
  for (const p of largest) {
    const x = p % width, y = Math.floor(p / width);
    if (y === 0 || !mask[p - width]) edge(x, y, x + 1, y, 0);
    if (x + 1 === width || !mask[p + 1]) edge(x + 1, y, x + 1, y + 1, 1);
    if (y + 1 === height || !mask[p + width]) edge(x + 1, y + 1, x, y + 1, 2);
    if (x === 0 || !mask[p - 1]) edge(x, y + 1, x, y, 3);
  }
  const loops = [];
  for (const candidates of edges.values()) for (const first of candidates) {
    if (first.used) continue;
    let current = first;
    const loop = [];
    while (current && !current.used) {
      current.used = true; loop.push(current.point);
      if (current.end === first.start) break;
      const choices = (edges.get(current.end) ?? []).filter(e => !e.used);
      const direction = current.direction;
      // Follow the boundary with occupied pixels on the right at diagonal junctions.
      const priority = [1, 0, 3, 2];
      choices.sort((a, b) => priority.indexOf((a.direction - direction + 4) % 4)
        - priority.indexOf((b.direction - direction + 4) % 4));
      current = choices[0];
    }
    if (loop.length >= 3 && current?.end === first.start) loops.push(loop);
  }
  const outline = loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
  if (!outline) throw new Error('Could not trace a closed silhouette');
  let opposite = 1;
  for (let i = 2; i < outline.length; i++) {
    if (Math.hypot(outline[i][0] - outline[0][0], outline[i][1] - outline[0][1])
      > Math.hypot(outline[opposite][0] - outline[0][0], outline[opposite][1] - outline[0][1])) opposite = i;
  }
  let polygon;
  for (const tolerance of [2.2, 1.2, 0.8, 0.4, 0]) {
    polygon = [...simplify(outline.slice(0, opposite + 1), tolerance).slice(0, -1),
      ...simplify([...outline.slice(opposite), outline[0]], tolerance).slice(0, -1)];
    decomp.removeDuplicatePoints(polygon, 0.001);
    decomp.makeCCW(polygon);
    if (decomp.isSimple(polygon)) break;
  }
  if (!decomp.isSimple(polygon)) throw new Error('Silhouette self-intersects');
  const points = polygon.map(([x, y]) => ({ x: minX + x * cropWidth / width, y: minY + y * cropHeight / height }));
  const bounds = Matter.Bounds.create(points);
  const centre = Matter.Vertices.centre(points);
  const bw = bounds.max.x - bounds.min.x, bh = bounds.max.y - bounds.min.y;
  const unitScale = 2 / Math.max(bw, bh);
  const round = n => Math.round(n * 1e6) / 1e6;
  return {
    vertices: points.map(p => ({ x: round((p.x - centre.x) * unitScale), y: round((p.y - centre.y) * unitScale) })),
    crop: { x: bounds.min.x, y: bounds.min.y, width: bw, height: bh },
    draw: { x: round((bounds.min.x - centre.x) * unitScale), y: round((bounds.min.y - centre.y) * unitScale),
      width: round(bw * unitScale), height: round(bh * unitScale) },
  };
}

const shapes = [];
for (let stage = 1; stage <= 11; stage++) {
  const file = `cat-${String(stage).padStart(2, '0')}.png`;
  let buffer;
  try { buffer = await readFile(`${root}public/images/${file}`); }
  catch (error) { if (error.code === 'ENOENT') { shapes.push(null); continue; } throw error; }
  const png = PNG.sync.read(buffer);
  const shape = silhouette(png);
  shapes.push({ file, ...shape });
  console.log(`${file}: ${shape.vertices.length} outline vertices`);
}
await mkdir(`${root}src/generated`, { recursive: true });
await writeFile(`${root}src/generated/cat-shapes.json`, JSON.stringify(shapes) + '\n');
