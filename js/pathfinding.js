/* ===================================================================
   pathfinding.js
   - Dijkstra shortest path over the node/edge graph of a floor
   - Bearing math to convert floor-plan pixel geometry into real-world
     compass bearings, using the floor's northOffsetDeg calibration.
=================================================================== */

const WPPath = (() => {

  function buildAdjacency(nodes, edges) {
    const adj = new Map();
    nodes.forEach(n => adj.set(n.id, []));
    edges.forEach(e => {
      if (!adj.has(e.aId) || !adj.has(e.bId)) return;
      adj.get(e.aId).push({ to: e.bId, dist: e.distanceM, edgeId: e.id });
      adj.get(e.bId).push({ to: e.aId, dist: e.distanceM, edgeId: e.id });
    });
    return adj;
  }

  // Classic Dijkstra with a simple array-based priority queue.
  // Fine for campus-scale graphs (tens to low hundreds of nodes).
  function dijkstra(nodes, edges, startId, endId) {
    const adj = buildAdjacency(nodes, edges);
    const dist = new Map(nodes.map(n => [n.id, Infinity]));
    const prev = new Map();
    const visited = new Set();
    dist.set(startId, 0);

    const queue = new Set(nodes.map(n => n.id));

    while (queue.size) {
      let u = null, best = Infinity;
      for (const id of queue) {
        if (dist.get(id) < best) { best = dist.get(id); u = id; }
      }
      if (u === null) break; // remaining nodes unreachable
      queue.delete(u);
      visited.add(u);
      if (u === endId) break;

      for (const { to, dist: w } of (adj.get(u) || [])) {
        if (visited.has(to)) continue;
        const alt = dist.get(u) + w;
        if (alt < dist.get(to)) {
          dist.set(to, alt);
          prev.set(to, u);
        }
      }
    }

    if (dist.get(endId) === Infinity || dist.get(endId) === undefined) {
      return null; // no path
    }

    const path = [endId];
    let cur = endId;
    while (cur !== startId) {
      cur = prev.get(cur);
      if (cur === undefined) return null;
      path.unshift(cur);
    }
    return { path, distanceM: dist.get(endId) };
  }

  // Bearing (0-360, 0 = compass North) from point A to point B in
  // floor-plan pixel space, corrected by the floor's north offset.
  // Image axes: x right, y down. "Image-up" (-y) is treated as the
  // calibration reference direction before applying northOffsetDeg.
  function bearingBetween(a, b, northOffsetDeg = 0) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const rawDeg = Math.atan2(dx, -dy) * (180 / Math.PI); // 0=image-up, 90=right
    return ((rawDeg + northOffsetDeg) % 360 + 360) % 360;
  }

  function pixelDistance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  // Signed turn needed, -180..180, positive = turn right/clockwise.
  function signedDelta(fromDeg, toDeg) {
    return (((toDeg - fromDeg) % 360) + 540) % 360 - 180;
  }

  // Human-readable turn instruction from a signed angle delta.
  function turnLabel(deltaDeg) {
    const a = Math.abs(deltaDeg);
    if (a < 20) return 'Go straight';
    if (a < 60) return deltaDeg > 0 ? 'Bear right' : 'Bear left';
    if (a < 135) return deltaDeg > 0 ? 'Turn right' : 'Turn left';
    return deltaDeg > 0 ? 'Turn sharp right' : 'Turn sharp left';
  }

  // Build turn-by-turn steps for a resolved path of node objects.
  function buildSteps(pathNodes, northOffsetDeg) {
    const steps = [];
    let prevBearing = null;
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const a = pathNodes[i], b = pathNodes[i + 1];
      const bearing = bearingBetween(a, b, northOffsetDeg);
      const distM = pixelDistance(a, b) / (a.__pxPerMeter || 1);
      const instruction = prevBearing === null
        ? 'Head toward ' + b.label
        : turnLabel(signedDelta(prevBearing, bearing)) + ' toward ' + b.label;
      steps.push({ from: a, to: b, bearing, distM, instruction });
      prevBearing = bearing;
    }
    return steps;
  }

  return { dijkstra, buildAdjacency, bearingBetween, pixelDistance, signedDelta, turnLabel, buildSteps };
})();
