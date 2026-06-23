// Circle-vs-AABB collision resolution on the XZ plane. The player is treated as
// a circle of `radius`; each collider is an axis-aligned box. We push the circle
// out along the smallest-penetration axis. Cheap and good enough for a flat room.

export function resolveCollisions(x, z, radius, colliders) {
  for (const b of colliders) {
    // Closest point on the box to the circle center.
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    const distSq = dx * dx + dz * dz;

    if (distSq > radius * radius) continue; // no overlap

    if (distSq > 1e-8) {
      // Circle center is outside the box but within radius — push along normal.
      const dist = Math.sqrt(distSq);
      const push = radius - dist;
      x += (dx / dist) * push;
      z += (dz / dist) * push;
    } else {
      // Center is inside the box — eject along the axis of least penetration.
      const toLeft = x - b.minX;
      const toRight = b.maxX - x;
      const toBack = z - b.minZ;
      const toFront = b.maxZ - z;
      const min = Math.min(toLeft, toRight, toBack, toFront);
      if (min === toLeft) x = b.minX - radius;
      else if (min === toRight) x = b.maxX + radius;
      else if (min === toBack) z = b.minZ - radius;
      else z = b.maxZ + radius;
    }
  }
  return { x, z };
}
