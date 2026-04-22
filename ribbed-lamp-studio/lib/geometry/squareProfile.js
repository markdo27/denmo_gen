/**
 * squareProfile.js
 * Generates a 2D square cross-section polygon with filleted corners.
 * Returns an array of { x, z } points (Y is height axis in Three.js).
 *
 * @param {object} opts
 * @param {number} opts.width        - X dimension (mm)
 * @param {number} opts.depth        - Z dimension (mm)
 * @param {number} opts.cornerRadius - Fillet radius (mm)
 * @param {number} opts.segments     - Arc segments per corner (4–12)
 * @returns {{ x: number, z: number, faceIndex: number, faceT: number }[]}
 *   faceIndex 0–3 identifies which face of the square, faceT [0,1] position along that face
 */
export function squareProfile({ width = 60, depth = 60, cornerRadius = 2, segments = 8 } = {}) {
  const hw = width / 2;
  const hd = depth / 2;
  const r  = Math.min(cornerRadius, hw * 0.4, hd * 0.4);
  const pts = [];

  // Corner centers (inset by r from each corner)
  const corners = [
    { cx:  hw - r, cz:  hd - r, startAngle: 0              }, // top-right
    { cx: -hw + r, cz:  hd - r, startAngle: Math.PI * 0.5  }, // top-left
    { cx: -hw + r, cz: -hd + r, startAngle: Math.PI        }, // bottom-left
    { cx:  hw - r, cz: -hd + r, startAngle: Math.PI * 1.5  }, // bottom-right
  ];

  // Face lengths for faceT calculation
  const faceLength = [
    width  - 2 * r, // top face: left→right
    depth  - 2 * r, // left face: top→bottom
    width  - 2 * r, // bottom face: right→left
    depth  - 2 * r, // right face: bottom→top
  ];
  const totalPerim = 4 * (Math.PI * r / 2) + 2 * (width - 2*r) + 2 * (depth - 2*r);

  corners.forEach((corner, fi) => {
    const { cx, cz, startAngle } = corner;
    // Fillet arc
    for (let s = 0; s <= segments; s++) {
      const angle = startAngle + (s / segments) * (Math.PI / 2);
      pts.push({
        x: cx + r * Math.cos(angle),
        z: cz + r * Math.sin(angle),
        faceIndex: fi,
        faceT: 0,      // arc points get faceT=0 (rib displacement = 0 at corners)
        isArc: true,
      });
    }
    // Straight segment to next corner
    const nextFi = (fi + 1) % 4;
    const nextCorner = corners[nextFi];
    const straight = segments; // number of straight subdivision points
    for (let s = 1; s < straight; s++) {
      const t = s / straight;
      const x = cx + t * (nextCorner.cx - cx);
      const z = cz + t * (nextCorner.cz - cz);
      pts.push({
        x, z,
        faceIndex: fi,
        faceT: t,
        isArc: false,
      });
    }
  });

  return pts;
}

/**
 * Returns the perimeter length of a square profile.
 */
export function squarePerimeter({ width, depth, cornerRadius }) {
  const r = cornerRadius;
  return 2 * (width - 2*r) + 2 * (depth - 2*r) + 2 * Math.PI * r;
}
