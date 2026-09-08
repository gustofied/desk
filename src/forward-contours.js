import { contours, geoPath, line } from 'd3';

// D3 owns the topology. Project each vertex once, then reuse those exact
// coordinates for the fill, its visible boundary, labels and hit testing.
export function forwardContours(values, levels, project, bounds) {
  const [left, top, right, bottom] = bounds;
  const clamp = ([x, y]) => [Math.max(left, Math.min(right, x)), Math.max(top, Math.min(bottom, y))];
  const onFrame = (a, b) => (a[0] === left && b[0] === left) || (a[0] === right && b[0] === right) ||
    (a[1] === top && b[1] === top) || (a[1] === bottom && b[1] === bottom);
  const result = contours().size([values[0].length, values.length]).thresholds(levels)(values.flat());
  return result.map(contour => {
    const coordinates = contour.coordinates.map(polygon => polygon.map(ring => ring.map(point => clamp(project(point)))));
    const paths = [];
    for (const polygon of coordinates) for (const ring of polygon) {
      const n = ring.length - 1;
      const frame = ring.slice(0, n).findIndex((point, i) => onFrame(point, ring[i + 1]));
      if (frame < 0) { paths.push(ring); continue; }
      let section = [];
      for (let i = 1; i <= n; i++) {
        const a = ring[(frame + i) % n], b = ring[(frame + i + 1) % n];
        if (onFrame(a, b)) {
          if (section.length > 1) paths.push(section);
          section = [];
        } else if (a[0] !== b[0] || a[1] !== b[1]) {
          if (!section.length) section.push(a);
          section.push(b);
        }
      }
      if (section.length > 1) paths.push(section);
    }
    return { value: contour.value, coordinates, fill: geoPath()({ ...contour, coordinates }),
      paths: paths.map(points => ({ points, d: line()(points) })) };
  });
}

export function nearestContour(paths, point) {
  let distance = Infinity, key = null, position = null;
  for (const path of paths) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point.x-a[0])*dx + (point.y-a[1])*dy) / (dx*dx + dy*dy || 1)));
    const d = Math.hypot(point.x-a[0]-t*dx, point.y-a[1]-t*dy);
    if (d < distance) { distance = d; key = path.key; position = { x: a[0]+t*dx, y: a[1]+t*dy }; }
  }
  return { distance, key, position };
}
