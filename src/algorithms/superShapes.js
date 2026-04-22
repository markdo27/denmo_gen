/**
 * SuperShapes — Parametric shape generation algorithms.
 *
 * Based on:
 *   - Paul Bourke's Spherical Harmonics:  paulbourke.net/geometry/sphericalh/
 *   - Johan Gielis' SuperFormula:         paulbourke.net/geometry/supershape/
 *   - Andrew Marsh's SuperShapes Generator: andrewmarsh.com/apps/releases/supershapes.html
 *
 * Integration strategy (Option A):
 *   These functions return a scalar RADIUS at a given (θ, φ/t) sample point.
 *   They are used in two ways inside lampMath.js:
 *     1. As PROFILE generators:  r(t) → replaces getProfileRadius() baseline
 *     2. As SURFACE MODIFIERS:   Δr(θ, t) → added inside applyRadiusModifiers()
 *
 * All formulas are pure math — no Three.js dependencies.
 */

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// ─── Safe power: handles negative bases with fractional exponents ────────────
function safePow(base, exp) {
  if (base === 0) return 0;
  if (exp === 0) return 1;
  // For integer exponents, use direct pow
  if (Number.isInteger(exp)) return Math.pow(base, exp);
  // For fractional exponents with negative base, use sign-preserving form
  return Math.sign(base) * Math.pow(Math.abs(base), exp);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SUPERFORMULA  (Johan Gielis, 2003)
//
//    r(θ) = ( |cos(mθ/4)/a|^n2 + |sin(mθ/4)/b|^n3 )^(-1/n1)
//
//    Returns the radial distance for a 2D super-curve at angle θ.
// ═══════════════════════════════════════════════════════════════════════════════
export function superFormula2D(theta, m, n1, n2, n3, a = 1, b = 1) {
  const t1 = Math.abs(Math.cos(m * theta / 4) / a);
  const t2 = Math.abs(Math.sin(m * theta / 4) / b);

  const sum = Math.pow(t1, n2) + Math.pow(t2, n3);
  if (sum === 0) return 0;
  if (n1 === 0) return 0;

  return Math.pow(sum, -1.0 / n1);
}

/**
 * 3D SuperFormula — spherical product of two 2D superformulas.
 *
 * r1(φ) controls latitude modulation (profile silhouette)
 * r2(θ) controls longitude modulation (cross-section shape)
 *
 * For lamp profiles (LatheGeometry), we only use r1(φ) as the profile curve
 * and r2(θ) as a cross-section modifier.
 *
 * @param {number} phi   — latitude angle [0, π]  (maps to height t)
 * @param {number} theta — longitude angle [0, 2π] (maps to radial angle)
 * @param {object} p1    — { m, n1, n2, n3, a, b } for latitude
 * @param {object} p2    — { m, n1, n2, n3, a, b } for longitude
 * @returns {{ x, y, z, r }} — Cartesian + radial distance
 */
export function superFormula3D(phi, theta, p1, p2) {
  const r1 = superFormula2D(phi, p1.m, p1.n1, p1.n2, p1.n3, p1.a, p1.b);
  const r2 = superFormula2D(theta, p2.m, p2.n1, p2.n2, p2.n3, p2.a, p2.b);

  const x = r1 * Math.cos(phi) * r2 * Math.cos(theta);
  const y = r1 * Math.cos(phi) * r2 * Math.sin(theta);
  const z = r1 * Math.sin(phi);

  return {
    x, y, z,
    r: Math.sqrt(x * x + y * y + z * z),
    r1, r2,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SPHERICAL HARMONICS  (Paul Bourke)
//
//    r = sin(m0·φ)^m1 + cos(m2·φ)^m3 + sin(m4·θ)^m5 + cos(m6·θ)^m7
//
//    φ ∈ [0, π],  θ ∈ [0, 2π]
//    m0–m7 are integers ≥ 0  (even indices for frequency, odd for power)
// ═══════════════════════════════════════════════════════════════════════════════
export function sphericalHarmonic(phi, theta, m) {
  let r = 0;
  r += safePow(Math.sin(m[0] * phi), m[1]);
  r += safePow(Math.cos(m[2] * phi), m[3]);
  r += safePow(Math.sin(m[4] * theta), m[5]);
  r += safePow(Math.cos(m[6] * theta), m[7]);
  return r;
}

/**
 * Spherical Harmonic → Cartesian coordinates.
 * @param {number} phi   — [0, π]
 * @param {number} theta — [0, 2π]
 * @param {number[]} m   — [m0, m1, m2, m3, m4, m5, m6, m7]
 * @returns {{ x, y, z, r }}
 */
export function sphericalHarmonicXYZ(phi, theta, m) {
  const r = sphericalHarmonic(phi, theta, m);
  return {
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * Math.sin(phi) * Math.sin(theta),
    r,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SUPER ELLIPSOID
//
//    x = a · sign(cos(φ)) · |cos(φ)|^n · sign(cos(θ)) · |cos(θ)|^e
//    y = b · sign(cos(φ)) · |cos(φ)|^n · sign(sin(θ)) · |sin(θ)|^e
//    z = c · sign(sin(φ)) · |sin(φ)|^n
//
//    n = North/South exponent (squareness along Z)
//    e = East/West exponent   (squareness in XY plane)
//
//    n=1, e=1 → sphere;  n→0, e→0 → cube;  n=2, e=2 → diamond
// ═══════════════════════════════════════════════════════════════════════════════
export function superEllipsoidRadius(phi, theta, n, e, a = 1, b = 1, c = 1) {
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  const x = a * Math.sign(cosPhi) * Math.pow(Math.abs(cosPhi), n)
              * Math.sign(cosTheta) * Math.pow(Math.abs(cosTheta), e);
  const y = b * Math.sign(cosPhi) * Math.pow(Math.abs(cosPhi), n)
              * Math.sign(sinTheta) * Math.pow(Math.abs(sinTheta), e);
  const z = c * Math.sign(sinPhi) * Math.pow(Math.abs(sinPhi), n);

  return Math.sqrt(x * x + y * y + z * z);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. SUPER TOROID
//
//    Uses super-ellipsoid cross-section mapped onto a torus.
//    R = major radius,  r = minor radius
//
//    x = (R + r·|cos(φ)|^n · sign(cos(φ))) · |cos(θ)|^e · sign(cos(θ))
//    y = (R + r·|cos(φ)|^n · sign(cos(φ))) · |sin(θ)|^e · sign(sin(θ))
//    z = r · |sin(φ)|^n · sign(sin(φ))
// ═══════════════════════════════════════════════════════════════════════════════
export function superToroidRadius(phi, theta, R, r, n, e) {
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);

  const rPart = R + r * Math.sign(cp) * Math.pow(Math.abs(cp), n);
  const x = rPart * Math.sign(ct) * Math.pow(Math.abs(ct), e);
  const y = rPart * Math.sign(st) * Math.pow(Math.abs(st), e);
  const z = r * Math.sign(sp) * Math.pow(Math.abs(sp), n);

  return Math.sqrt(x * x + y * y + z * z);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ELLIPTIC TORUS
//
//    x = (c + cos(θ)) · cos(φ)
//    y = (c + cos(θ)) · sin(φ)
//    z = sin(θ) + c·tan(n)·(1 − cos(θ))
//
//    c = tube scale,  n = twist angle
// ═══════════════════════════════════════════════════════════════════════════════
export function ellipticTorusRadius(phi, theta, c, n) {
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const cphi = Math.cos(phi);
  const sphi = Math.sin(phi);
  const tanN = Math.tan(n);

  const x = (c + ct) * cphi;
  const y = (c + ct) * sphi;
  const z = st + c * tanN * (1 - ct);

  return Math.sqrt(x * x + y * y + z * z);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE ADAPTERS
//
// These convert the 3D shape algorithms into 1D radius functions r(t)
// suitable for LatheGeometry profiles.
//
// t ∈ [0, 1] maps to φ ∈ [0, π] (pole-to-pole along the height axis)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SuperFormula profile: sample at a fixed longitude slice, varying latitude.
 * Returns the radius at normalised height t for use as a lamp profile.
 *
 * @param {number} t      — normalised height [0, 1]
 * @param {object} p1     — latitude SuperFormula params { m, n1, n2, n3, a, b }
 * @param {number} scale  — output scale (maps to bottomRadius)
 */
export function superFormulaProfile(t, p1, scale = 1) {
  // Map t to latitude: t=0 → φ=-π/2 (bottom), t=1 → φ=+π/2 (top)
  const phi = (t - 0.5) * Math.PI;
  const r1 = superFormula2D(phi, p1.m, p1.n1, p1.n2, p1.n3, p1.a, p1.b);
  // Use the cosine envelope to create pole-to-pole silhouette
  return Math.abs(r1 * Math.cos(phi)) * scale;
}

/**
 * Spherical Harmonics profile: sample at θ=0 longitude, varying φ.
 * Returns the radial distance at normalised height t.
 */
export function sphericalHarmonicProfile(t, m, scale = 1) {
  // Map t [0,1] → φ [0, π]
  const phi = t * Math.PI;
  // Sample at θ=0 (front-facing slice)
  const r = sphericalHarmonic(phi, 0, m);
  // Convert to cylindrical radius (projection onto XZ plane)
  return Math.abs(r * Math.sin(phi)) * scale;
}

/**
 * Super Ellipsoid profile: returns radius at height t.
 * Creates rounded-cube / pillow lamp silhouettes.
 */
export function superEllipsoidProfile(t, n, e, scale = 1) {
  // Map t [0,1] → φ [-π/2, π/2]
  const phi = (t - 0.5) * Math.PI;
  // Sample at θ=0
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  // Cylindrical radius = x component at θ=0
  const r = Math.pow(Math.abs(cp), n) * scale;
  return Math.max(0.01, r);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODIFIER ADAPTERS
//
// These return a Δr value to ADD to the existing radius inside
// applyRadiusModifiers(). They sample the shape at (θ, t) and return
// a signed displacement.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SuperFormula surface modifier: creates patterned ridges and indentations.
 *
 * @param {number} angle    — radial angle θ [0, 2π]
 * @param {number} t        — normalised height [0, 1]
 * @param {number} m        — symmetry count
 * @param {number} n1,n2,n3 — shape exponents
 * @param {number} depth    — amplitude multiplier
 * @returns {number} Δr displacement
 */
export function superFormulaModifier(angle, t, m, n1, n2, n3, depth) {
  // Evaluate SuperFormula at this (θ, φ) point
  const r = superFormula2D(angle, m, n1, n2, n3, 1, 1);
  // Centre around 1.0 so it adds/subtracts from the base radius
  return (r - 1.0) * depth;
}

/**
 * Spherical Harmonics surface modifier: creates organic waviness.
 *
 * @param {number} angle — radial angle θ [0, 2π]
 * @param {number} t     — normalised height [0, 1]
 * @param {number[]} m   — [m0..m7] harmonic parameters
 * @param {number} depth — amplitude multiplier
 * @returns {number} Δr displacement
 */
export function sphericalHarmonicModifier(angle, t, m, depth) {
  const phi = t * Math.PI;
  const r = sphericalHarmonic(phi, angle, m);
  // Normalise: typical SH values range ~0–4, centre around 2
  return (r - 2.0) * depth * 0.25;
}
