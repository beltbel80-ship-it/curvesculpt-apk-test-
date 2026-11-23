import * as THREE from 'three';
import { DEFAULT_SCULPT_PARAMS, PoseState, SculptParams } from '../types/sculpture';

// Smooth polynomial minimum (union) & maximum (intersection)
function sMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0.0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function sMax(a: number, b: number, k: number): number {
  return -sMin(-a, -b, k);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Rotated ellipsoid SDF approximation with Euclidean gradient scaling
function sdEllipsoid(
  px: number,
  py: number,
  pz: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  rotY = 0,
  rotX = 0,
): number {
  let x = px - cx;
  let y = py - cy;
  let z = pz - cz;

  if (rotY !== 0) {
    const cyr = Math.cos(rotY);
    const syr = Math.sin(rotY);
    const nx = x * cyr - z * syr;
    const nz = x * syr + z * cyr;
    x = nx;
    z = nz;
  }

  if (rotX !== 0) {
    const cxr = Math.cos(rotX);
    const sxr = Math.sin(rotX);
    const ny = y * cxr - z * sxr;
    const nz = y * sxr + z * cxr;
    y = ny;
    z = nz;
  }

  const kx = x / rx;
  const ky = y / ry;
  const kz = z / rz;
  const k0 = Math.sqrt(kx * kx + ky * ky + kz * kz);
  if (k0 < 1e-6) return -Math.min(rx, ry, rz);

  const gx = x / (rx * rx);
  const gy = y / (ry * ry);
  const gz = z / (rz * rz);
  const k1 = Math.sqrt(gx * gx + gy * gy + gz * gz);

  return (k0 * (k0 - 1.0)) / Math.max(1e-5, k1);
}

// Tapered capsule along arbitrary segment (ax, ay, az) -> (bx, by, bz)
function sdTaperedCapsule(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  ra: number,
  rb: number,
): number {
  const pax = px - ax;
  const pay = py - ay;
  const paz = pz - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const baLenSq = bax * bax + bay * bay + baz * baz;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / baLenSq));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  const dz = paz - baz * h;
  const r = mix(ra, rb, h);
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

interface SdfSampleResult {
  d: number;
  dBody: number;
  dArm: number;
  creviceAo: number;
}

/**
 * Evaluates the full-body anatomical Signed Distance Field at (x, y, z).
 * Coordinate convention:
 *   +X / -X : lateral right / left
 *   +Y / -Y : superior (+1.48 crown) / inferior (-1.44 feet standing on plinth)
 *   +Z / -Z : posterior (gluteal/back) / anterior (chest/face/toes)
 */
function evaluateAnatomySdf(x: number, y: number, z: number): SdfSampleResult {
  const ax = Math.abs(x);

  // 1. Full Spine S-Curve Centerline along Y
  const thoracicCurve = 0.032 * Math.exp(-Math.pow((y - 0.78) / 0.24, 2));
  const lumbarCurve = -0.088 * Math.exp(-Math.pow((y - 0.35) / 0.23, 2));
  const sacralTilt = 0.022 * Math.exp(-Math.pow((y + 0.02) / 0.25, 2));
  const neckForward = -0.024 * smoothstep(0.92, 1.18, y);
  const zCenter = thoracicCurve + lumbarCurve + sacralTilt + neckForward;

  // 2. Torso-to-Pelvis Cross-Section Radii (shoulders -> cinched waist -> lush wide hips)
  const tWaist = Math.exp(-Math.pow((y - 0.43) / 0.20, 2));
  const tChest = smoothstep(0.45, 0.86, y) * (1.0 - smoothstep(0.92, 1.10, y));
  const tShoulderTaper = smoothstep(0.90, 1.09, y);
  const tHip = smoothstep(0.45, -0.05, y);

  // Lateral half-width rx(y): graceful feminine shoulders, narrow waist, wide curvy hips
  const rx = Math.max(
    0.075,
    0.278 - 0.062 * tWaist + 0.042 * tChest - 0.205 * tShoulderTaper + 0.162 * tHip,
  );
  // Sagittal half-depth rz(y)
  const rz = Math.max(
    0.070,
    0.184 - 0.028 * tWaist + 0.018 * tChest - 0.105 * tShoulderTaper + 0.048 * tHip,
  );

  // Subtle lower-abdomen softness anteriorly
  const lowerBelly =
    z < zCenter
      ? 0.026 *
        Math.exp(-Math.pow((y - 0.06) / 0.19, 2)) *
        Math.exp(-Math.pow(ax / 0.22, 2)) *
        smoothstep(zCenter, zCenter - 0.16, z)
      : 0;

  const dzTorso = z - zCenter + lowerBelly * 0.5;
  const kx = x / rx;
  const kz = dzTorso / rz;
  const k0 = Math.sqrt(kx * kx + kz * kz);
  const gx = x / (rx * rx);
  const gz = dzTorso / (rz * rz);
  const k1 = Math.sqrt(gx * gx + gz * gz);
  let dTorso = k0 < 1e-5 ? -Math.min(rx, rz) : (k0 * (k0 - 1.0)) / Math.max(1e-5, k1);

  // Cap torso smoothly above neck base and below pelvis
  const aboveShoulders = smoothstep(0.98, 1.16, y);
  const belowPelvis = smoothstep(-0.10, -0.34, y);
  dTorso += aboveShoulders * 0.28 + belowPelvis * 0.26;

  // 3. Upper Torso Anatomy: Bust, Clavicles, Scapulae, Neck & Classical Sculpted Head
  // Bilateral natural feminine bust with subtle apex projection
  const dBustMain = sdEllipsoid(
    ax,
    y,
    z,
    0.136,
    0.725,
    -0.168,
    0.138,
    0.142,
    0.146,
    0.20,
    0.12,
  );
  const dBustApex = sdEllipsoid(
    ax,
    y,
    z,
    0.135,
    0.722,
    -0.312,
    0.015,
    0.015,
    0.016,
    0.0,
    0.0,
  );
  const dBust = sMin(dBustMain, dBustApex, 0.014);

  // Dorsal scapulae (shoulder blades) for realistic upper-back lighting
  const dScapula = sdEllipsoid(
    ax,
    y,
    z,
    0.135,
    0.81,
    0.118,
    0.115,
    0.145,
    0.072,
    -0.18,
    0.0,
  );

  // Trapezius / shoulder slope
  const dShoulderSlope = sdTaperedCapsule(
    ax,
    y,
    z,
    0.08,
    1.03,
    0.005,
    0.325,
    0.92,
    -0.002,
    0.095,
    0.086,
  );

  // Slender neck
  const dNeck = sdTaperedCapsule(
    x,
    y,
    z,
    0.0,
    1.01,
    -0.012,
    0.0,
    1.24,
    -0.028,
    0.096,
    0.082,
  );

  // Clavicles & sculpted shoulders
  const dClavicle = sdTaperedCapsule(
    ax,
    y,
    z,
    0.04,
    0.96,
    -0.092,
    0.27,
    0.955,
    -0.018,
    0.032,
    0.026,
  );

  // Classical sculpted head (cranium + jawline + brow + eye sockets/lids + cheekbones + nose/lips + ears + hair chignon)
  const dCranium = sdEllipsoid(x, y, z, 0.0, 1.358, -0.015, 0.116, 0.145, 0.136, 0.0, -0.06);
  const dJaw = sdEllipsoid(x, y, z, 0.0, 1.258, -0.048, 0.080, 0.092, 0.100, 0.0, -0.24);
  const dBrow = sdEllipsoid(ax, y, z, 0.036, 1.374, -0.128, 0.034, 0.014, 0.022, 0.12, 0.0);
  const dEyeball = sdEllipsoid(ax, y, z, 0.038, 1.353, -0.126, 0.020, 0.016, 0.020, 0.10, 0.0);
  const dCheekbone = sdEllipsoid(ax, y, z, 0.056, 1.305, -0.092, 0.036, 0.034, 0.036, 0.25, 0.0);
  const dNose = sdEllipsoid(x, y, z, 0.0, 1.320, -0.148, 0.016, 0.038, 0.028, 0.0, 0.18);
  const dUpperLip = sdEllipsoid(x, y, z, 0.0, 1.264, -0.142, 0.026, 0.010, 0.016, 0.0, 0.0);
  const dLowerLip = sdEllipsoid(x, y, z, 0.0, 1.250, -0.140, 0.024, 0.011, 0.016, 0.0, 0.0);
  const dEar = sdEllipsoid(ax, y, z, 0.110, 1.325, -0.016, 0.014, 0.032, 0.022, -0.22, 0.08);
  const dHairCrown = sdEllipsoid(x, y, z, 0.0, 1.378, 0.012, 0.121, 0.136, 0.138, 0.0, -0.08);
  const dHairBun = sdEllipsoid(x, y, z, 0.0, 1.332, 0.122, 0.078, 0.082, 0.086, 0.0, 0.12);

  let dHead = sMin(dCranium, dJaw, 0.042);
  dHead = sMin(dHead, dBrow, 0.018);
  // Carve orbital eye socket slightly, then seat gentle rounded eyeball/eyelid inside
  const dSocket = sdEllipsoid(ax, y, z, 0.039, 1.353, -0.136, 0.024, 0.017, 0.022, 0.14, 0.0);
  dHead = sMax(dHead, -dSocket * 0.45 + 0.008, 0.016);
  dHead = sMin(dHead, dEyeball, 0.012);
  dHead = sMin(dHead, dCheekbone, 0.022);
  dHead = sMin(dHead, dNose, 0.016);
  dHead = sMin(dHead, dUpperLip, 0.010);
  dHead = sMin(dHead, dLowerLip, 0.010);
  dHead = sMin(dHead, dEar, 0.010);
  dHead = sMin(dHead, dHairCrown, 0.024);
  dHead = sMin(dHead, dHairBun, 0.028);
  const dHeadNeck = sMin(dNeck, dHead, 0.042);

  // 4. Arms & Sculpted Hands (Poised outward with thumb & tapered finger silhouette)
  const dUpperArm = sdTaperedCapsule(
    ax,
    y,
    z,
    0.325,
    0.92,
    -0.005,
    0.505,
    0.48,
    0.030,
    0.084,
    0.066,
  );
  const dForearm = sdTaperedCapsule(
    ax,
    y,
    z,
    0.505,
    0.48,
    0.030,
    0.576,
    0.10,
    -0.045,
    0.064,
    0.044,
  );
  const dPalm = sdEllipsoid(
    ax,
    y,
    z,
    0.585,
    0.015,
    -0.052,
    0.026,
    0.062,
    0.044,
    0.06,
    -0.12,
  );
  const dFingers = sdTaperedCapsule(
    ax,
    y,
    z,
    0.587,
    -0.025,
    -0.056,
    0.582,
    -0.115,
    -0.064,
    0.024,
    0.015,
  );
  const dThumb = sdTaperedCapsule(
    ax,
    y,
    z,
    0.572,
    0.045,
    -0.080,
    0.556,
    -0.025,
    -0.102,
    0.015,
    0.011,
  );
  let dArm = sMin(dUpperArm, dForearm, 0.028);
  let dHand = sMin(dPalm, dFingers, 0.020);
  dHand = sMin(dHand, dThumb, 0.012);
  dArm = sMin(dArm, dHand, 0.022);

  // 5. Bilateral Gluteal Sculpting (Hero Centerpiece: Lush, Curvy, "Balık Etli")
  const dGluteMain = sdEllipsoid(
    ax,
    y,
    z,
    0.178,
    -0.068,
    0.184,
    0.224,
    0.242,
    0.240,
    -0.20,
    0.16,
  );
  const dGluteUpper = sdEllipsoid(
    ax,
    y,
    z,
    0.166,
    0.095,
    0.105,
    0.205,
    0.168,
    0.178,
    -0.15,
    -0.12,
  );
  const dGluteLower = sdEllipsoid(
    ax,
    y,
    z,
    0.162,
    -0.182,
    0.154,
    0.186,
    0.132,
    0.172,
    -0.12,
    0.22,
  );
  const dHipPad = sdEllipsoid(
    ax,
    y,
    z,
    0.268,
    -0.095,
    0.015,
    0.195,
    0.232,
    0.205,
    -0.12,
    0.0,
  );

  let dGlutes = sMin(dGluteMain, dGluteUpper, 0.085);
  dGlutes = sMin(dGlutes, dGluteLower, 0.075);
  dGlutes = sMin(dGlutes, dHipPad, 0.095);

  // Combine torso, upper body & glutes into main body SDF (excluding arms)
  let dBody = sMin(dTorso, dBust, 0.065);
  dBody = sMin(dBody, dClavicle, 0.025);
  dBody = sMin(dBody, dScapula, 0.055);
  dBody = sMin(dBody, dShoulderSlope, 0.055);
  dBody = sMin(dBody, dHeadNeck, 0.055);
  dBody = sMin(dBody, dGlutes, 0.095);

  // 6. Full Lower Body: Curvy Thighs -> Knees -> Shapely Calves -> Ankles -> Feet
  const dThighCore = sdTaperedCapsule(
    ax,
    y,
    z,
    0.198,
    -0.12,
    -0.015,
    0.152,
    -0.80,
    -0.025,
    0.178,
    0.110,
  );
  const dThighCurve = sdEllipsoid(
    ax,
    y,
    z,
    0.218,
    -0.35,
    0.008,
    0.180,
    0.275,
    0.192,
    -0.06,
    0.05,
  );
  const dQuadCurve = sdEllipsoid(
    ax,
    y,
    z,
    0.174,
    -0.44,
    -0.052,
    0.158,
    0.30,
    0.160,
    0.04,
    -0.05,
  );
  const dKnee = sdEllipsoid(ax, y, z, 0.148, -0.80, -0.038, 0.096, 0.105, 0.098, 0.0, 0.0);

  const dShin = sdTaperedCapsule(
    ax,
    y,
    z,
    0.148,
    -0.80,
    -0.022,
    0.132,
    -1.36,
    -0.012,
    0.102,
    0.060,
  );
  const dCalf = sdEllipsoid(
    ax,
    y,
    z,
    0.140,
    -1.03,
    0.035,
    0.096,
    0.165,
    0.094,
    0.0,
    0.06,
  );
  const dFoot = sdTaperedCapsule(
    ax,
    y,
    z,
    0.132,
    -1.385,
    0.032,
    0.142,
    -1.395,
    -0.175,
    0.062,
    0.068,
  );

  let dLeg = sMin(dThighCore, dThighCurve, 0.085);
  dLeg = sMin(dLeg, dQuadCurve, 0.075);
  dLeg = sMin(dLeg, dKnee, 0.055);
  dLeg = sMin(dLeg, dShin, 0.055);
  dLeg = sMin(dLeg, dCalf, 0.055);
  dLeg = sMin(dLeg, dFoot, 0.040);

  // Union full legs cleanly into pelvis & glutes
  dBody = sMin(dBody, dLeg, 0.085);

  // Union arms into upper shoulder ONLY (sharp below shoulder so zero hip/arm webbing)
  const shoulderBlend = 0.046 * smoothstep(0.68, 0.90, y) + 0.002;
  let d = sMin(dBody, dArm, shoulderBlend);

  // 7. Anatomical Creases & Surface Sculpting
  let creviceWeight = 0.0;

  // A) Intergluteal Cleft
  const cleftTopEnv = smoothstep(0.20, 0.04, y);
  const cleftBotEnv = smoothstep(-0.34, -0.22, y);
  const cleftZEnv = smoothstep(0.01, 0.17, z);
  const sacralWiden = 1.0 + 0.55 * smoothstep(0.04, 0.18, y);
  const cleftWidth = 0.036 * sacralWiden;
  const cleftDepth = 0.072 * cleftTopEnv * cleftBotEnv * cleftZEnv;
  const cleftVal = cleftDepth * Math.exp(-(x * x) / (2 * cleftWidth * cleftWidth));
  d += cleftVal;
  creviceWeight += cleftVal * 5.2;

  // B) Infragluteal Fold (Under-buttock crease)
  const foldCurveY = -0.272 + 0.36 * Math.pow(ax - 0.145, 2);
  const foldXEnv = smoothstep(0.035, 0.085, ax) * smoothstep(0.355, 0.22, ax);
  const foldZEnv = smoothstep(-0.01, 0.13, z);
  const foldVal =
    0.025 *
    Math.exp(-Math.pow(y - foldCurveY, 2) / (2 * 0.022 * 0.022)) *
    foldXEnv *
    foldZEnv;
  d += foldVal;
  creviceWeight += foldVal * 9.5;

  // C) Full Dorsal Spinal Furrow (from upper back down through lumbar arch)
  const spineEnv = smoothstep(0.14, 0.28, y) * smoothstep(1.04, 0.82, y) * smoothstep(-0.02, 0.10, z);
  const spineVal = 0.018 * Math.exp(-(x * x) / (2 * 0.034 * 0.034)) * spineEnv;
  d += spineVal;
  creviceWeight += spineVal * 6.0;

  // D) Dimples of Venus
  const dimpleDistSq = Math.pow(ax - 0.088, 2) + Math.pow(y - 0.186, 2);
  const dimpleZEnv = smoothstep(0.02, 0.11, z);
  const dimpleVal = 0.015 * Math.exp(-dimpleDistSq / (2 * 0.030 * 0.030)) * dimpleZEnv;
  d += dimpleVal;
  creviceWeight += dimpleVal * 10.0;

  // E) Clean Midline Leg Separation below pelvis so left & right thighs/calves never bridge across x=0
  const sepEnvY = smoothstep(-0.18, -0.27, y);
  if (sepEnvY > 0.001) {
    const dMidGap = 0.032 * sepEnvY - ax;
    d = sMax(d, dMidGap, 0.015);
  }
  const innerEnv = smoothstep(-0.20, -0.32, y) * smoothstep(0.12, 0.0, ax);
  const innerSep = 0.020 * innerEnv * Math.exp(-(x * x) / (2 * 0.042 * 0.042));
  d += innerSep;
  creviceWeight += innerSep * 5.0;

  // F) Subtle Sternum / Under-Bust Separation anteriorly
  const sternumEnv = smoothstep(0.56, 0.68, y) * smoothstep(0.88, 0.74, y) * smoothstep(-0.06, -0.18, z);
  const sternumVal = 0.014 * Math.exp(-(x * x) / (2 * 0.032 * 0.032)) * sternumEnv;
  d += sternumVal;
  creviceWeight += sternumVal * 5.0;

  // G) Back-of-knee popliteal hollow & sternal notch dimple
  const kneeBackEnv = smoothstep(0.0, 0.06, z) * smoothstep(0.06, 0.14, ax) * smoothstep(0.24, 0.14, ax);
  const kneeBackVal = 0.015 * Math.exp(-Math.pow((y + 0.80) / 0.045, 2)) * kneeBackEnv;
  d += kneeBackVal;
  creviceWeight += kneeBackVal * 6.0;

  const notchVal =
    0.014 *
    Math.exp(-(x * x) / (2 * 0.022 * 0.022) - Math.pow((y - 0.96) / 0.024, 2)) *
    smoothstep(-0.04, -0.10, z);
  d += notchVal;
  creviceWeight += notchVal * 5.0;

  // H) Navel (umbilical dimple) & soft abdominal linea alba
  const navelZEnv = smoothstep(-0.14, -0.22, z);
  const navelVal =
    0.020 *
    Math.exp(-(x * x) / (2 * 0.016 * 0.016) - Math.pow((y - 0.155) / 0.018, 2)) *
    navelZEnv;
  d += navelVal;
  creviceWeight += navelVal * 11.0;

  const lineaEnv = smoothstep(0.05, 0.16, y) * smoothstep(0.56, 0.34, y) * navelZEnv;
  const lineaVal = 0.008 * Math.exp(-(x * x) / (2 * 0.022 * 0.022)) * lineaEnv;
  d += lineaVal;
  creviceWeight += lineaVal * 5.0;

  // I) Feminine Pelvic Iliac-Inguinal Lines (V-contour framing lower pelvis anteriorly)
  const ingYEnv = smoothstep(0.06, -0.02, y) * smoothstep(-0.26, -0.16, y);
  const ingExpectedX = 0.038 + 0.56 * smoothstep(-0.22, 0.04, y);
  const ingVal =
    0.011 *
    Math.exp(-Math.pow((ax - ingExpectedX) / 0.024, 2)) *
    ingYEnv *
    smoothstep(-0.08, -0.18, z);
  d += ingVal;
  creviceWeight += ingVal * 7.5;

  // 8. Flat Sole Grounding Plane at y = -1.44 so figure stands flush on pedestal
  d = sMax(d, -1.44 - y, 0.016);

  const creviceAo = Math.max(0.42, Math.min(1.0, 1.0 - creviceWeight * 0.54));
  return { d, dBody, dArm, creviceAo };
}

export interface SculptMeshData {
  geometry: THREE.BufferGeometry;
  basePositions: Float32Array;
  morphedPositions: Float32Array;
  baseAo: Float32Array;
  armMask: Float32Array;
  softGluteR: Float32Array;
  softGluteL: Float32Array;
  softBust: Float32Array;
}

/**
 * Generates a watertight, Taubin-smoothed Surface Nets mesh of the full female figure.
 */
export function createSculptureMeshData(): SculptMeshData {
  const nx = 84;
  const ny = 172;
  const nz = 64;

  const minX = -0.72;
  const maxX = 0.72;
  const minY = -1.52;
  const maxY = 1.56;
  const minZ = -0.44;
  const maxZ = 0.56;

  const dx = (maxX - minX) / (nx - 1);
  const dy = (maxY - minY) / (ny - 1);
  const dz = (maxZ - minZ) / (nz - 1);

  const totalNodes = nx * ny * nz;
  const sdfGrid = new Float32Array(totalNodes);

  const nodeIdx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  for (let k = 0; k < nz; k++) {
    const z = minZ + k * dz;
    for (let j = 0; j < ny; j++) {
      const y = minY + j * dy;
      for (let i = 0; i < nx; i++) {
        const x = minX + i * dx;
        sdfGrid[nodeIdx(i, j, k)] = evaluateAnatomySdf(x, y, z).d;
      }
    }
  }

  const cxCount = nx - 1;
  const cyCount = ny - 1;
  const czCount = nz - 1;
  const cellVertIndex = new Int32Array(cxCount * cyCount * czCount).fill(-1);
  const cellIdx = (i: number, j: number, k: number) => (k * cyCount + j) * cxCount + i;

  const positions: number[] = [];

  const cornerOffsets = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];

  const cubeEdges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  const cornerVals = new Float32Array(8);

  // 1. Place one dual vertex per surface-crossing cell
  for (let k = 0; k < czCount; k++) {
    for (let j = 0; j < cyCount; j++) {
      for (let i = 0; i < cxCount; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [ox, oy, oz] = cornerOffsets[c];
          const v = sdfGrid[nodeIdx(i + ox, j + oy, k + oz)];
          cornerVals[c] = v;
          if (v <= 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;

        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let crossings = 0;

        for (let e = 0; e < 12; e++) {
          const [a, b] = cubeEdges[e];
          const va = cornerVals[a];
          const vb = cornerVals[b];
          if ((va <= 0) === (vb <= 0)) continue;

          const t = Math.max(0, Math.min(1, va / (va - vb)));
          const [ax, ay, az] = cornerOffsets[a];
          const [bx, by, bz] = cornerOffsets[b];
          sumX += mix(ax, bx, t);
          sumY += mix(ay, by, t);
          sumZ += mix(az, bz, t);
          crossings++;
        }

        if (crossings > 0) {
          const vIdx = positions.length / 3;
          cellVertIndex[cellIdx(i, j, k)] = vIdx;
          positions.push(
            minX + (i + sumX / crossings) * dx,
            minY + (j + sumY / crossings) * dy,
            minZ + (k + sumZ / crossings) * dz,
          );
        }
      }
    }
  }

  // 2. Connect neighboring cell vertices across sign-changing grid edges
  const indices: number[] = [];

  const pushQuad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (!flip) {
      indices.push(a, b, c, a, c, d);
    } else {
      indices.push(a, c, b, a, d, c);
    }
  };

  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const s0 = sdfGrid[nodeIdx(i, j, k)] <= 0;
        const s1 = sdfGrid[nodeIdx(i + 1, j, k)] <= 0;
        if (s0 === s1) continue;
        pushQuad(
          cellVertIndex[cellIdx(i, j - 1, k - 1)],
          cellVertIndex[cellIdx(i, j, k - 1)],
          cellVertIndex[cellIdx(i, j, k)],
          cellVertIndex[cellIdx(i, j - 1, k)],
          !s0,
        );
      }
    }
  }

  for (let k = 1; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const s0 = sdfGrid[nodeIdx(i, j, k)] <= 0;
        const s1 = sdfGrid[nodeIdx(i, j + 1, k)] <= 0;
        if (s0 === s1) continue;
        pushQuad(
          cellVertIndex[cellIdx(i - 1, j, k - 1)],
          cellVertIndex[cellIdx(i - 1, j, k)],
          cellVertIndex[cellIdx(i, j, k)],
          cellVertIndex[cellIdx(i, j, k - 1)],
          !s0,
        );
      }
    }
  }

  for (let k = 0; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const s0 = sdfGrid[nodeIdx(i, j, k)] <= 0;
        const s1 = sdfGrid[nodeIdx(i, j, k + 1)] <= 0;
        if (s0 === s1) continue;
        pushQuad(
          cellVertIndex[cellIdx(i - 1, j - 1, k)],
          cellVertIndex[cellIdx(i, j - 1, k)],
          cellVertIndex[cellIdx(i, j, k)],
          cellVertIndex[cellIdx(i - 1, j, k)],
          !s0,
        );
      }
    }
  }

  // 3. Taubin Volume-Preserving Smoothing
  const vertCount = positions.length / 3;
  const posArr = new Float32Array(positions);
  const scratchArr = new Float32Array(positions.length);

  const neighbors: number[][] = Array.from({ length: vertCount }, () => []);
  const addEdge = (u: number, v: number) => {
    const list = neighbors[u];
    for (let n = 0; n < list.length; n++) {
      if (list[n] === v) return;
    }
    list.push(v);
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    addEdge(a, b); addEdge(b, a);
    addEdge(b, c); addEdge(c, b);
    addEdge(c, a); addEdge(a, c);
  }

  const smoothStep = (factor: number) => {
    for (let v = 0; v < vertCount; v++) {
      const nb = neighbors[v];
      const count = nb.length;
      if (count === 0) {
        scratchArr[v * 3] = posArr[v * 3];
        scratchArr[v * 3 + 1] = posArr[v * 3 + 1];
        scratchArr[v * 3 + 2] = posArr[v * 3 + 2];
        continue;
      }
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (let n = 0; n < count; n++) {
        const ni = nb[n] * 3;
        ax += posArr[ni];
        ay += posArr[ni + 1];
        az += posArr[ni + 2];
      }
      const inv = 1 / count;
      const vx = posArr[v * 3];
      const vy = posArr[v * 3 + 1];
      const vz = posArr[v * 3 + 2];
      // Preserve flat soles on plinth at y = -1.44
      const isSole = vy < -1.425;
      const yFactor = isSole ? factor * 0.2 : factor;
      scratchArr[v * 3] = vx + factor * (ax * inv - vx);
      scratchArr[v * 3 + 1] = vy + yFactor * (ay * inv - vy);
      scratchArr[v * 3 + 2] = vz + factor * (az * inv - vz);
    }
    posArr.set(scratchArr);
  };

  for (let pass = 0; pass < 5; pass++) {
    smoothStep(0.50);
    smoothStep(-0.52);
  }

  // 4. Evaluate anatomical crevice AO, SDF-based armMask, and soft-tissue spring weights
  const baseAo = new Float32Array(vertCount);
  const armMask = new Float32Array(vertCount);
  const softGluteR = new Float32Array(vertCount);
  const softGluteL = new Float32Array(vertCount);
  const softBust = new Float32Array(vertCount);

  for (let v = 0; v < vertCount; v++) {
    const vx = posArr[v * 3];
    const vy = posArr[v * 3 + 1];
    const vz = posArr[v * 3 + 2];
    const sample = evaluateAnatomySdf(vx, vy, vz);
    baseAo[v] = sample.creviceAo;

    // Arm membership: strictly determined by SDF proximity (zero bleed into hips/glutes!)
    let am = 0;
    if (Math.abs(vx) > 0.24 && vy > -0.18 && vy < 1.05) {
      am = smoothstep(0.032, -0.032, sample.dArm - sample.dBody);
    }
    armMask[v] = am;

    const bodyFactor = 1.0 - am;
    // Soft-tissue jiggle weights (isolated to right glute, left glute, and bust)
    const gluteEnvY = Math.exp(-Math.pow((vy + 0.07) / 0.22, 2));
    const gluteEnvZ = smoothstep(-0.04, 0.16, vz);
    const gluteCleft = smoothstep(0.015, 0.085, Math.abs(vx));
    const gBase = bodyFactor * gluteEnvY * gluteEnvZ * gluteCleft;
    softGluteR[v] = vx > 0 ? gBase * smoothstep(-0.02, 0.06, vx) : 0;
    softGluteL[v] = vx < 0 ? gBase * smoothstep(0.02, -0.06, vx) : 0;

    const bustEnvY = Math.exp(-Math.pow((vy - 0.72) / 0.14, 2));
    const bustEnvZ = smoothstep(-0.08, -0.22, vz);
    const bustEnvX = smoothstep(0.32, 0.14, Math.abs(vx)) * smoothstep(0.01, 0.06, Math.abs(vx));
    softBust[v] = bodyFactor * bustEnvY * bustEnvZ * bustEnvX;
  }

  const geometry = new THREE.BufferGeometry();
  const basePositions = new Float32Array(posArr);
  const morphedPositions = new Float32Array(posArr);
  const restPositions = new Float32Array(posArr);
  geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geometry.setAttribute('aRestPos', new THREE.BufferAttribute(restPositions, 3));
  geometry.setAttribute('aAo', new THREE.BufferAttribute(baseAo, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return {
    geometry,
    basePositions,
    morphedPositions,
    baseAo,
    armMask,
    softGluteR,
    softGluteL,
    softBust,
  };
}

/**
 * Applies smooth, 60fps real-time parametric sculpting morphs to morphedPositions and rest attribute.
 */
export function updateSculptureMorph(meshData: SculptMeshData, params: SculptParams): void {
  const { geometry, basePositions, morphedPositions, armMask } = meshData;
  const restAttr = geometry.getAttribute('aRestPos') as THREE.BufferAttribute;
  const restArr = restAttr.array as Float32Array;

  const dWaist = params.waistCinched - DEFAULT_SCULPT_PARAMS.waistCinched;
  const dHip = params.hipWidth - DEFAULT_SCULPT_PARAMS.hipWidth;
  const dGlute = params.gluteVolume - DEFAULT_SCULPT_PARAMS.gluteVolume;
  const dLift = params.gluteLift - DEFAULT_SCULPT_PARAMS.gluteLift;
  const dSoft = params.softFullness - DEFAULT_SCULPT_PARAMS.softFullness;
  const dArch = params.lumbarArch - DEFAULT_SCULPT_PARAMS.lumbarArch;

  const vertCount = basePositions.length / 3;

  for (let i = 0; i < vertCount; i++) {
    const idx = i * 3;
    let x = basePositions[idx];
    let y = basePositions[idx + 1];
    let z = basePositions[idx + 2];

    const ax = Math.abs(x);
    const signX = x >= 0 ? 1 : -1;

    // Exact SDF-derived body vs arm isolation so torso/hip morphs NEVER touch arms
    const isTorsoHipZone = 1.0 - armMask[i];

    // 1. Waist Cinched (hourglass taper around y = 0.43, torso only)
    const wWaist = Math.exp(-Math.pow((y - 0.43) / 0.19, 2)) * isTorsoHipZone;
    const waistScale = 1.0 - dWaist * 0.24 * wWaist;
    x *= waistScale;
    z = (z + 0.04) * (1.0 - dWaist * 0.16 * wWaist) - 0.04;

    // 2. Hip Width (broadens/curves iliac & trochanteric silhouette around y = -0.05)
    const wHip = Math.exp(-Math.pow((y + 0.05) / 0.26, 2)) * smoothstep(0.02, 0.24, ax) * isTorsoHipZone;
    x += signX * dHip * 0.102 * wHip;

    // 3. Glute Volume & Projection (posterior fullness, keeping intergluteal cleft defined)
    const wGluteY = Math.exp(-Math.pow((y + 0.07) / 0.23, 2)) * isTorsoHipZone;
    const wGluteZ = smoothstep(-0.04, 0.18, z);
    const cleftPreserve = 0.45 + 0.55 * smoothstep(0.0, 0.09, ax);
    const gluteDisp = dGlute * 0.125 * wGluteY * wGluteZ * cleftPreserve;
    z += gluteDisp;
    x += signX * dGlute * 0.032 * wGluteY * wGluteZ * smoothstep(0.04, 0.22, ax);

    // 4. Glute Lift (raises lower pole & rounds upper shelf)
    const wLiftZone = Math.exp(-Math.pow((y + 0.10) / 0.22, 2)) * smoothstep(0.0, 0.16, z) * isTorsoHipZone;
    y += dLift * 0.058 * wLiftZone;
    const wUpperShelf =
      Math.exp(-Math.pow((y - 0.06) / 0.14, 2)) *
      smoothstep(0.02, 0.18, z) *
      cleftPreserve *
      isTorsoHipZone;
    z += dLift * 0.042 * wUpperShelf;

    // 5. "Balık Etli" Softness & Fullness (upper thighs, lower hips & gentle calf curve)
    const wThighZone = smoothstep(0.10, -0.20, y) * smoothstep(-0.88, -0.58, y) * isTorsoHipZone;
    const thighCenterX = signX * 0.175;
    const thighRadialX = x - thighCenterX;
    x += thighRadialX * (dSoft * 0.19 * wThighZone);
    z += z * (dSoft * 0.16 * wThighZone);

    const wSoftHip = Math.exp(-Math.pow((y + 0.16) / 0.24, 2)) * smoothstep(0.06, 0.26, ax) * isTorsoHipZone;
    x += signX * dSoft * 0.048 * wSoftHip;

    // 6. Lumbar Arch (S-curve lordosis)
    const wLordosis = Math.exp(-Math.pow((y - 0.34) / 0.21, 2)) * isTorsoHipZone;
    const wSacralCounter =
      Math.exp(-Math.pow((y + 0.02) / 0.20, 2)) * smoothstep(-0.05, 0.18, z) * isTorsoHipZone;
    z -= dArch * 0.062 * wLordosis;
    z += dArch * 0.028 * wSacralCounter;

    morphedPositions[idx] = x;
    morphedPositions[idx + 1] = y;
    morphedPositions[idx + 2] = z;
    restArr[idx] = x;
    restArr[idx + 1] = y;
    restArr[idx + 2] = z;
  }

  restAttr.needsUpdate = true;
}

// Pre-allocated scratch matrices & vectors for zero-GC Linear Blend Skinning
const _mPelvis = new THREE.Matrix4();
const _mTorso = new THREE.Matrix4();
const _mHead = new THREE.Matrix4();
const _mKneeL = new THREE.Matrix4();
const _mKneeR = new THREE.Matrix4();
const _mUpperL = new THREE.Matrix4();
const _mForearmL = new THREE.Matrix4();
const _mUpperR = new THREE.Matrix4();
const _mForearmR = new THREE.Matrix4();
const _mFootL = new THREE.Matrix4();
const _mFootR = new THREE.Matrix4();
const _mTempA = new THREE.Matrix4();
const _mRotTmp = new THREE.Matrix4();
const _mTransTmp = new THREE.Matrix4();
const _eulerTmp = new THREE.Euler();

function buildPivotTransform(
  out: THREE.Matrix4,
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
  order: THREE.EulerOrder = 'YXZ',
  tx = 0,
  ty = 0,
  tz = 0,
): THREE.Matrix4 {
  _eulerTmp.set(rx, ry, rz, order);
  _mRotTmp.makeRotationFromEuler(_eulerTmp);
  out.makeTranslation(px + tx, py + ty, pz + tz);
  out.multiply(_mRotTmp);
  _mTransTmp.makeTranslation(-px, -py, -pz);
  out.multiply(_mTransTmp);
  return out;
}

function mulMatPoint(
  m: Float32Array | number[],
  x: number,
  y: number,
  z: number,
  w: number,
  acc: [number, number, number],
): void {
  acc[0] += (m[0] * x + m[4] * y + m[8] * z + m[12]) * w;
  acc[1] += (m[1] * x + m[5] * y + m[9] * z + m[13]) * w;
  acc[2] += (m[2] * x + m[6] * y + m[10] * z + m[14]) * w;
}

/**
 * Applies smooth, distortion-free Linear Blend Skinning (LBS) articulated poses
 * (shy head tilt, hip wiggle/twist, knee tuck, standing birth squat, and Venus-Pudica / cradling arms).
 */
export function applySculpturePose(
  meshData: SculptMeshData,
  pose: PoseState,
  _hipWidthParam?: number,
): void {
  const { geometry, morphedPositions, armMask, softGluteR, softGluteL, softBust } = meshData;
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  const vertCount = morphedPositions.length / 3;

  const hasSoftMotion =
    Math.abs(pose.jiggleRightX) > 1e-4 ||
    Math.abs(pose.jiggleRightY) > 1e-4 ||
    Math.abs(pose.jiggleRightZ) > 1e-4 ||
    Math.abs(pose.jiggleLeftX) > 1e-4 ||
    Math.abs(pose.jiggleLeftY) > 1e-4 ||
    Math.abs(pose.jiggleLeftZ) > 1e-4 ||
    Math.abs(pose.jiggleBustY) > 1e-4 ||
    Math.abs(pose.jiggleBustZ) > 1e-4 ||
    Math.abs(pose.breathPhase) > 1e-4 ||
    Math.abs(pose.birthStance) > 1e-4 ||
    Math.abs(pose.birthBelly) > 1e-4;

  const isNearRest =
    !hasSoftMotion &&
    Math.abs(pose.hipSwayX) < 1e-4 &&
    Math.abs(pose.hipTwistY) < 1e-4 &&
    Math.abs(pose.kneeTuck) < 1e-4 &&
    Math.abs(pose.torsoTwistY) < 1e-4 &&
    Math.abs(pose.torsoPitchX) < 1e-4 &&
    Math.abs(pose.torsoRollZ) < 1e-4 &&
    Math.abs(pose.headPitchX) < 1e-4 &&
    Math.abs(pose.headYawY) < 1e-4 &&
    Math.abs(pose.headRollZ) < 1e-4 &&
    Math.abs(pose.leftShoulderPitch) < 1e-4 &&
    Math.abs(pose.leftShoulderAdduct) < 1e-4 &&
    Math.abs(pose.leftShoulderYaw) < 1e-4 &&
    Math.abs(pose.leftElbowFlex) < 1e-4 &&
    Math.abs(pose.leftForearmYaw) < 1e-4 &&
    Math.abs(pose.rightShoulderPitch) < 1e-4 &&
    Math.abs(pose.rightShoulderAdduct) < 1e-4 &&
    Math.abs(pose.rightShoulderYaw) < 1e-4 &&
    Math.abs(pose.rightElbowFlex) < 1e-4 &&
    Math.abs(pose.rightForearmYaw) < 1e-4;

  if (isNearRest) {
    arr.set(morphedPositions);
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return;
  }

  const stance = Math.max(0, Math.min(1, pose.birthStance));
  const belly = Math.max(0, Math.min(1, pose.birthBelly));

  // 1. Build rigid hierarchical bone matrices
  // Feet remain flush on pedestal (y = -1.44); graceful demi-plié turnout & balanced wide stance
  buildPivotTransform(
    _mFootL,
    -0.132,
    -1.44,
    -0.06,
    0,
    -0.26 * stance,
    0,
    'YXZ',
    -0.170 * stance,
    0,
    0,
  );
  buildPivotTransform(
    _mFootR,
    0.132,
    -1.44,
    -0.06,
    0,
    0.26 * stance,
    0,
    'YXZ',
    0.170 * stance,
    0,
    0,
  );

  // Pelvis root (natural balanced squat drop preserving lush glute curve)
  buildPivotTransform(
    _mPelvis,
    0,
    -0.08,
    0.04,
    -0.03 * stance,
    pose.hipTwistY,
    0,
    'YXZ',
    pose.hipSwayX,
    -0.115 * stance,
    0.012 * stance,
  );

  // Knees: either shy inward tuck OR natural demi-plié aligned over feet
  buildPivotTransform(
    _mKneeL,
    -0.148,
    -0.80,
    -0.025,
    0.04 * stance,
    pose.hipTwistY * 0.28 - 0.24 * stance,
    0,
    'YXZ',
    pose.hipSwayX * 0.38 + pose.kneeTuck * 0.036 - 0.175 * stance,
    -0.045 * stance,
    -pose.kneeTuck * 0.022 - 0.105 * stance,
  );
  buildPivotTransform(
    _mKneeR,
    0.148,
    -0.80,
    -0.025,
    0.04 * stance,
    pose.hipTwistY * 0.28 + 0.24 * stance,
    0,
    'YXZ',
    pose.hipSwayX * 0.38 - pose.kneeTuck * 0.036 + 0.175 * stance,
    -0.045 * stance,
    -pose.kneeTuck * 0.022 - 0.105 * stance,
  );

  // Upper torso (poised upright over pedestal, follows squat vertical drop cleanly)
  const breathLift = pose.breathPhase * 0.004;
  buildPivotTransform(
    _mTorso,
    0,
    0.30,
    -0.02,
    pose.torsoPitchX - pose.breathPhase * 0.015,
    pose.torsoTwistY,
    pose.torsoRollZ,
    'YXZ',
    pose.hipSwayX * 0.25,
    breathLift - 0.110 * stance,
    0.006 * stance,
  );

  // Neck & Head (child of Torso)
  buildPivotTransform(
    _mTempA,
    0,
    1.04,
    -0.015,
    pose.headPitchX,
    pose.headYawY,
    pose.headRollZ,
    'YXZ',
  );
  _mHead.multiplyMatrices(_mTorso, _mTempA);

  // Left Upper Arm & Forearm (children of Torso)
  const sx = 0.325;
  const sy = 0.92;
  const sz = -0.005;
  const ex = 0.505;
  const ey = 0.48;
  const ez = 0.030;

  buildPivotTransform(
    _mTempA,
    -sx,
    sy,
    sz,
    pose.leftShoulderPitch,
    -pose.leftShoulderYaw,
    pose.leftShoulderAdduct,
    'YXZ',
  );
  _mUpperL.multiplyMatrices(_mTorso, _mTempA);

  buildPivotTransform(
    _mTempA,
    -ex,
    ey,
    ez,
    pose.leftElbowFlex,
    -pose.leftForearmYaw,
    0,
    'YXZ',
  );
  _mForearmL.multiplyMatrices(_mUpperL, _mTempA);

  // Right Upper Arm & Forearm (children of Torso)
  buildPivotTransform(
    _mTempA,
    sx,
    sy,
    sz,
    pose.rightShoulderPitch,
    pose.rightShoulderYaw,
    -pose.rightShoulderAdduct,
    'YXZ',
  );
  _mUpperR.multiplyMatrices(_mTorso, _mTempA);

  buildPivotTransform(
    _mTempA,
    ex,
    ey,
    ez,
    pose.rightElbowFlex,
    pose.rightForearmYaw,
    0,
    'YXZ',
  );
  _mForearmR.multiplyMatrices(_mUpperR, _mTempA);

  const mFootL = _mFootL.elements;
  const mFootR = _mFootR.elements;
  const mKneeL = _mKneeL.elements;
  const mKneeR = _mKneeR.elements;
  const mPelvis = _mPelvis.elements;
  const mTorso = _mTorso.elements;
  const mHead = _mHead.elements;
  const mUpperL = _mUpperL.elements;
  const mForearmL = _mForearmL.elements;
  const mUpperR = _mUpperR.elements;
  const mForearmR = _mForearmR.elements;

  const out: [number, number, number] = [0, 0, 0];

  // 2. Per-vertex soft-tissue jiggle/breathing/birth outlet + rigid Linear Blend Skinning
  for (let i = 0; i < vertCount; i++) {
    const idx = i * 3;
    const baseRx = morphedPositions[idx];
    const baseRy = morphedPositions[idx + 1];
    const baseRz = morphedPositions[idx + 2];

    let rx = baseRx;
    let ry = baseRy;
    let rz = baseRz;

    const wArm = armMask[i];
    const wBody = 1.0 - wArm;

    if (hasSoftMotion && wBody > 1e-4) {
      const gR = softGluteR[i];
      const gL = softGluteL[i];
      const bW = softBust[i];
      if (gR > 1e-4) {
        rx += pose.jiggleRightX * gR;
        ry += pose.jiggleRightY * gR;
        rz += pose.jiggleRightZ * gR;
      }
      if (gL > 1e-4) {
        rx += pose.jiggleLeftX * gL;
        ry += pose.jiggleLeftY * gL;
        rz += pose.jiggleLeftZ * gL;
      }
      if (bW > 1e-4) {
        ry += pose.jiggleBustY * bW;
        rz += pose.jiggleBustZ * bW;
      }
      // Subtle ribcage expansion on breath
      if (Math.abs(pose.breathPhase) > 1e-4 && baseRy > 0.45 && baseRy < 0.98) {
        const ribEnv = Math.exp(-Math.pow((baseRy - 0.72) / 0.19, 2)) * wBody;
        const ribScale = pose.breathPhase * 0.018 * ribEnv;
        rx += baseRx * ribScale;
        rz += (baseRz - 0.02) * ribScale * 1.35;
      }
      // Natural late-pregnancy abdominal fullness that gently subsides during delivery
      if (belly > 1e-4 && baseRy > -0.16 && baseRy < 0.56 && baseRz < 0.02) {
        const bellyEnv =
          Math.exp(-Math.pow((baseRy - 0.14) / 0.20, 2)) *
          Math.exp(-Math.pow(baseRx / 0.24, 2)) *
          smoothstep(0.02, -0.14, baseRz);
        rz -= belly * 0.072 * bellyEnv;
      }
    }

    out[0] = 0;
    out[1] = 0;
    out[2] = 0;

    if (wBody > 1e-4) {
      const mFoot = baseRx >= 0 ? mFootR : mFootL;
      const mKnee = baseRx >= 0 ? mKneeR : mKneeL;
      if (baseRy <= -1.32) {
        mulMatPoint(mFoot, rx, ry, rz, wBody, out);
      } else if (baseRy < -0.78) {
        const t = smoothstep(-1.32, -0.78, baseRy);
        mulMatPoint(mFoot, rx, ry, rz, wBody * (1 - t), out);
        mulMatPoint(mKnee, rx, ry, rz, wBody * t, out);
      } else if (baseRy < -0.26) {
        const kneeW = Math.pow(smoothstep(-0.26, -0.78, baseRy), 0.62);
        mulMatPoint(mKnee, rx, ry, rz, wBody * kneeW, out);
        mulMatPoint(mPelvis, rx, ry, rz, wBody * (1 - kneeW), out);
      } else if (baseRy <= 0.08) {
        mulMatPoint(mPelvis, rx, ry, rz, wBody, out);
      } else if (baseRy < 0.58) {
        const t = smoothstep(0.08, 0.58, baseRy);
        mulMatPoint(mPelvis, rx, ry, rz, wBody * (1 - t), out);
        mulMatPoint(mTorso, rx, ry, rz, wBody * t, out);
      } else if (baseRy <= 0.98) {
        mulMatPoint(mTorso, rx, ry, rz, wBody, out);
      } else if (baseRy < 1.24) {
        const t = smoothstep(0.98, 1.24, baseRy);
        mulMatPoint(mTorso, rx, ry, rz, wBody * (1 - t), out);
        mulMatPoint(mHead, rx, ry, rz, wBody * t, out);
      } else {
        mulMatPoint(mHead, rx, ry, rz, wBody, out);
      }
    }

    if (wArm > 1e-4) {
      const wForearm = smoothstep(0.57, 0.39, baseRy);
      const wUpper = 1.0 - wForearm;
      if (baseRx >= 0) {
        if (wUpper > 1e-4) mulMatPoint(mUpperR, rx, ry, rz, wArm * wUpper, out);
        if (wForearm > 1e-4) mulMatPoint(mForearmR, rx, ry, rz, wArm * wForearm, out);
      } else {
        if (wUpper > 1e-4) mulMatPoint(mUpperL, rx, ry, rz, wArm * wUpper, out);
        if (wForearm > 1e-4) mulMatPoint(mForearmL, rx, ry, rz, wArm * wForearm, out);
      }
    }

    arr[idx] = out[0];
    arr[idx + 1] = out[1];
    arr[idx + 2] = out[2];
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

