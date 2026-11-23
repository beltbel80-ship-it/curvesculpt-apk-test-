import * as THREE from 'three';

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

interface MaleSdfSample {
  d: number;
  dBody: number;
  dArm: number;
  creviceAo: number;
}

/**
 * Evaluates a taller, athletic male anatomical SDF in rest space:
 *   +Y = crown (~+1.60), -Y = soles (-1.44), -Z = front/face, +Z = back
 */
function evaluateMaleSdf(x: number, y: number, z: number): MaleSdfSample {
  const ax = Math.abs(x);

  // 1. Torso Centerline & Broad-Shouldered V-Taper
  const thoracicCurve = 0.024 * Math.exp(-Math.pow((y - 0.85) / 0.26, 2));
  const lumbarCurve = -0.055 * Math.exp(-Math.pow((y - 0.36) / 0.24, 2));
  const neckForward = -0.022 * smoothstep(1.02, 1.30, y);
  const zCenter = thoracicCurve + lumbarCurve + neckForward;

  const tChest = smoothstep(0.42, 0.96, y) * (1.0 - smoothstep(1.02, 1.22, y));
  const tWaist = Math.exp(-Math.pow((y - 0.36) / 0.22, 2));
  const tShoulderTaper = smoothstep(1.00, 1.20, y);
  const tHip = smoothstep(0.38, -0.08, y);

  // Athletic broad chest/shoulders, trim waist, strong hip structure
  const rx = Math.max(
    0.082,
    0.262 + 0.105 * tChest - 0.028 * tWaist - 0.195 * tShoulderTaper + 0.048 * tHip,
  );
  const rz = Math.max(
    0.075,
    0.175 + 0.036 * tChest - 0.015 * tWaist - 0.095 * tShoulderTaper + 0.025 * tHip,
  );

  const dzTorso = z - zCenter;
  const kx = x / rx;
  const kz = dzTorso / rz;
  const k0 = Math.sqrt(kx * kx + kz * kz);
  const gx = x / (rx * rx);
  const gz = dzTorso / (rz * rz);
  const k1 = Math.sqrt(gx * gx + gz * gz);
  let dTorso = k0 < 1e-5 ? -Math.min(rx, rz) : (k0 * (k0 - 1.0)) / Math.max(1e-5, k1);

  dTorso += smoothstep(1.08, 1.24, y) * 0.28 + smoothstep(-0.10, -0.32, y) * 0.26;

  // 2. Athletic Pectorals, Deltoid-Trapezius Slope, Neck & Strong Male Head
  const dPecs = sdEllipsoid(ax, y, z, 0.128, 0.84, -0.145, 0.132, 0.112, 0.082, 0.16, 0.06);
  const dTraps = sdTaperedCapsule(ax, y, z, 0.075, 1.15, 0.01, 0.375, 1.00, -0.005, 0.098, 0.095);
  const dNeck = sdTaperedCapsule(x, y, z, 0.0, 1.10, -0.012, 0.0, 1.36, -0.028, 0.114, 0.098);

  const dCranium = sdEllipsoid(x, y, z, 0.0, 1.482, -0.012, 0.120, 0.148, 0.140, 0.0, -0.05);
  const dJaw = sdEllipsoid(x, y, z, 0.0, 1.372, -0.048, 0.092, 0.096, 0.106, 0.0, -0.18);
  const dBrow = sdEllipsoid(ax, y, z, 0.039, 1.494, -0.132, 0.038, 0.015, 0.024, 0.12, 0.0);
  const dEyeball = sdEllipsoid(ax, y, z, 0.040, 1.472, -0.130, 0.020, 0.015, 0.020, 0.10, 0.0);
  const dNose = sdEllipsoid(x, y, z, 0.0, 1.438, -0.152, 0.018, 0.042, 0.030, 0.0, 0.18);
  const dLips = sdEllipsoid(x, y, z, 0.0, 1.376, -0.144, 0.028, 0.014, 0.018, 0.0, 0.0);
  const dEar = sdEllipsoid(ax, y, z, 0.116, 1.445, -0.016, 0.015, 0.034, 0.022, -0.22, 0.08);
  const dHairTop = sdEllipsoid(x, y, z, 0.0, 1.512, 0.004, 0.124, 0.126, 0.142, 0.0, -0.10);

  let dHead = sMin(dCranium, dJaw, 0.038);
  dHead = sMin(dHead, dBrow, 0.018);
  const dSocket = sdEllipsoid(ax, y, z, 0.040, 1.472, -0.140, 0.025, 0.016, 0.022, 0.14, 0.0);
  dHead = sMax(dHead, -dSocket * 0.45 + 0.008, 0.016);
  dHead = sMin(dHead, dEyeball, 0.012);
  dHead = sMin(dHead, dNose, 0.016);
  dHead = sMin(dHead, dLips, 0.010);
  dHead = sMin(dHead, dEar, 0.010);
  dHead = sMin(dHead, dHairTop, 0.020);
  const dHeadNeck = sMin(dNeck, dHead, 0.040);

  // 3. Athletic Male Arms & Hands (poised slightly away from hips for zero webbing)
  const dUpperArm = sdTaperedCapsule(ax, y, z, 0.375, 1.00, -0.005, 0.525, 0.52, 0.025, 0.098, 0.078);
  const dForearm = sdTaperedCapsule(ax, y, z, 0.525, 0.52, 0.025, 0.582, 0.11, -0.045, 0.076, 0.050);
  const dPalm = sdEllipsoid(ax, y, z, 0.590, 0.02, -0.052, 0.028, 0.068, 0.048, 0.06, -0.10);
  const dFingers = sdTaperedCapsule(ax, y, z, 0.592, -0.025, -0.055, 0.586, -0.125, -0.065, 0.026, 0.016);

  let dArm = sMin(dUpperArm, dForearm, 0.026);
  const dHand = sMin(dPalm, dFingers, 0.020);
  dArm = sMin(dArm, dHand, 0.022);

  // 4. Pelvis & Tailored Athletic Trousers Silhouette (clean leg separation below y = -0.18)
  const dPelvis = sdEllipsoid(x, y, z, 0.0, -0.06, 0.015, 0.275, 0.21, 0.188, 0.0, 0.0);
  const dGlutes = sdEllipsoid(ax, y, z, 0.128, -0.08, 0.112, 0.145, 0.175, 0.145, -0.12, 0.08);

  const dThigh = sdTaperedCapsule(ax, y, z, 0.165, -0.12, -0.005, 0.150, -0.78, -0.015, 0.148, 0.105);
  const dShin = sdTaperedCapsule(ax, y, z, 0.150, -0.78, -0.015, 0.142, -1.36, -0.005, 0.102, 0.068);
  const dFoot = sdTaperedCapsule(ax, y, z, 0.142, -1.385, 0.036, 0.152, -1.395, -0.205, 0.068, 0.072);

  let dLeg = sMin(dThigh, dShin, 0.052);
  dLeg = sMin(dLeg, dFoot, 0.038);

  let dBody = sMin(dTorso, dPecs, 0.055);
  dBody = sMin(dBody, dTraps, 0.055);
  dBody = sMin(dBody, dHeadNeck, 0.052);
  dBody = sMin(dBody, dPelvis, 0.075);
  dBody = sMin(dBody, dGlutes, 0.068);
  dBody = sMin(dBody, dLeg, 0.072);

  const shoulderBlend = 0.044 * smoothstep(0.76, 0.98, y) + 0.002;
  let d = sMin(dBody, dArm, shoulderBlend);

  // Clean midline leg separation below pelvis so left/right legs never bridge across x=0
  const sepEnvY = smoothstep(-0.18, -0.27, y);
  if (sepEnvY > 0.001) {
    d = sMax(d, 0.030 * sepEnvY - ax, 0.015);
  }

  // Creases & surface AO
  let creviceWeight = 0.0;
  const pecCrease =
    0.012 *
    Math.exp(-Math.pow((y - 0.74) / 0.026, 2)) *
    smoothstep(0.02, 0.10, ax) *
    smoothstep(0.24, 0.15, ax) *
    smoothstep(-0.08, -0.18, z);
  d += pecCrease;
  creviceWeight += pecCrease * 7.5;

  const spineVal =
    0.014 *
    Math.exp(-(x * x) / (2 * 0.032 * 0.032)) *
    smoothstep(0.18, 0.34, y) *
    smoothstep(1.12, 0.90, y) *
    smoothstep(-0.02, 0.10, z);
  d += spineVal;
  creviceWeight += spineVal * 6.0;

  const navelVal =
    0.016 *
    Math.exp(-(x * x) / (2 * 0.015 * 0.015) - Math.pow((y - 0.22) / 0.017, 2)) *
    smoothstep(-0.12, -0.18, z);
  d += navelVal;
  creviceWeight += navelVal * 10.0;

  // Flat soles at y = -1.44
  d = sMax(d, -1.44 - y, 0.016);

  const creviceAo = Math.max(0.45, Math.min(1.0, 1.0 - creviceWeight * 0.54));
  return { d, dBody, dArm, creviceAo };
}

export interface MaleMeshData {
  geometry: THREE.BufferGeometry;
  basePositions: Float32Array;
  baseAo: Float32Array;
  armMask: Float32Array;
}

export interface MalePoseInput {
  walkPhase: number;
  walkSpeed01: number;
  carryBlend: number;
  kissBlend?: number;
  breathPhase: number;
}

export function createMaleMeshData(): MaleMeshData {
  const nx = 72;
  const ny = 152;
  const nz = 54;

  const minX = -0.74;
  const maxX = 0.74;
  const minY = -1.50;
  const maxY = 1.70;
  const minZ = -0.44;
  const maxZ = 0.48;

  const dx = (maxX - minX) / (nx - 1);
  const dy = (maxY - minY) / (ny - 1);
  const dz = (maxZ - minZ) / (nz - 1);

  const sdfGrid = new Float32Array(nx * ny * nz);
  const nodeIdx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  for (let k = 0; k < nz; k++) {
    const z = minZ + k * dz;
    for (let j = 0; j < ny; j++) {
      const y = minY + j * dy;
      for (let i = 0; i < nx; i++) {
        const x = minX + i * dx;
        sdfGrid[nodeIdx(i, j, k)] = evaluateMaleSdf(x, y, z).d;
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
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const cubeEdges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cornerVals = new Float32Array(8);

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

        let sx = 0, sy = 0, sz = 0, crossings = 0;
        for (let e = 0; e < 12; e++) {
          const [a, b] = cubeEdges[e];
          const va = cornerVals[a];
          const vb = cornerVals[b];
          if ((va <= 0) === (vb <= 0)) continue;
          const t = Math.max(0, Math.min(1, va / (va - vb)));
          const [ax, ay, az] = cornerOffsets[a];
          const [bx, by, bz] = cornerOffsets[b];
          sx += mix(ax, bx, t);
          sy += mix(ay, by, t);
          sz += mix(az, bz, t);
          crossings++;
        }
        if (crossings > 0) {
          cellVertIndex[cellIdx(i, j, k)] = positions.length / 3;
          positions.push(
            minX + (i + sx / crossings) * dx,
            minY + (j + sy / crossings) * dy,
            minZ + (k + sz / crossings) * dz,
          );
        }
      }
    }
  }

  const indices: number[] = [];
  const pushQuad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (!flip) indices.push(a, b, c, a, c, d);
    else indices.push(a, c, b, a, d, c);
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

  // 4-pass Taubin smoothing
  const vertCount = positions.length / 3;
  const posArr = new Float32Array(positions);
  const scratchArr = new Float32Array(positions.length);
  const neighbors: number[][] = Array.from({ length: vertCount }, () => []);
  const addEdge = (u: number, v: number) => {
    const list = neighbors[u];
    for (let n = 0; n < list.length; n++) if (list[n] === v) return;
    list.push(v);
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
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
      let ax = 0, ay = 0, az = 0;
      for (let n = 0; n < count; n++) {
        const ni = nb[n] * 3;
        ax += posArr[ni]; ay += posArr[ni + 1]; az += posArr[ni + 2];
      }
      const inv = 1 / count;
      scratchArr[v * 3] = posArr[v * 3] + factor * (ax * inv - posArr[v * 3]);
      scratchArr[v * 3 + 1] = posArr[v * 3 + 1] + factor * (ay * inv - posArr[v * 3 + 1]);
      scratchArr[v * 3 + 2] = posArr[v * 3 + 2] + factor * (az * inv - posArr[v * 3 + 2]);
    }
    posArr.set(scratchArr);
  };
  for (let pass = 0; pass < 4; pass++) {
    smoothStep(0.48);
    smoothStep(-0.50);
  }

  const baseAo = new Float32Array(vertCount);
  const armMask = new Float32Array(vertCount);
  for (let v = 0; v < vertCount; v++) {
    const vx = posArr[v * 3];
    const vy = posArr[v * 3 + 1];
    const vz = posArr[v * 3 + 2];
    const s = evaluateMaleSdf(vx, vy, vz);
    baseAo[v] = s.creviceAo;

    let am = 0;
    if (Math.abs(vx) > 0.31 && vy > -0.22 && vy < 1.08) {
      am = smoothstep(0.025, -0.022, s.dArm - s.dBody);
    }
    armMask[v] = am;
  }

  const geometry = new THREE.BufferGeometry();
  const basePositions = new Float32Array(posArr);
  const restPositions = new Float32Array(posArr);
  geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geometry.setAttribute('aRestPos', new THREE.BufferAttribute(restPositions, 3));
  geometry.setAttribute('aAo', new THREE.BufferAttribute(baseAo, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return { geometry, basePositions, baseAo, armMask };
}

/**
 * Custom shader material for the controllable male figure:
 * warm athletic skin, hazel eyes, eyebrows, short hair, and tailored studio charcoal trousers.
 */
export function createMaleMaterialController(): {
  material: THREE.MeshPhysicalMaterial;
  setKeyLightDir: (dir: THREE.Vector3) => void;
  dispose: () => void;
} {
  const uniforms = {
    uKeyLightDir: { value: new THREE.Vector3(0.55, 0.58, 0.60).normalize() },
  };

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffffff'),
    roughness: 0.44,
    metalness: 0.0,
    clearcoat: 0.14,
    clearcoatRoughness: 0.45,
    sheen: 0.25,
    sheenRoughness: 0.65,
    sheenColor: new THREE.Color('#f7d5bf'),
    ior: 1.42,
    envMapIntensity: 0.95,
  });

  material.customProgramCacheKey = () => 'atelier-male-pbr-v1';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uKeyLightDir = uniforms.uKeyLightDir;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aAo;
        attribute vec3 aRestPos;
        varying float vAo;
        varying vec3 vRestPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vAo = aAo;
        vRestPos = aRestPos;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uKeyLightDir;
        varying float vAo;
        varying vec3 vRestPos;

        float mHash(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float mNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(
              mix(mHash(i + vec3(0,0,0)), mHash(i + vec3(1,0,0)), f.x),
              mix(mHash(i + vec3(0,1,0)), mHash(i + vec3(1,1,0)), f.x),
              f.y
            ),
            mix(
              mix(mHash(i + vec3(0,0,1)), mHash(i + vec3(1,0,1)), f.x),
              mix(mHash(i + vec3(0,1,1)), mHash(i + vec3(1,1,1)), f.x),
              f.y
            ),
            f.z
          );
        }

        float mTrouserMask(vec3 p) {
          float armExcl = smoothstep(0.35, 0.27, abs(p.x));
          float waistY = 0.08 + 0.015 * smoothstep(-0.15, 0.10, p.z);
          float inTrousers = smoothstep(waistY + 0.008, waistY - 0.008, p.y) * smoothstep(-1.33, -1.29, p.y);
          return clamp(inTrousers * armExcl, 0.0, 1.0);
        }

        float mHairMask(vec3 p) {
          if (p.y < 1.38) return 0.0;
          float hairlineZ = -0.025 - 0.055 * smoothstep(1.50, 1.59, p.y) + 0.025 * smoothstep(0.05, 0.11, abs(p.x));
          float crown = smoothstep(hairlineZ - 0.015, hairlineZ + 0.022, p.z) * smoothstep(1.40, 1.48, p.y + p.z * 0.25);
          float topCap = smoothstep(1.555, 1.595, p.y);
          return clamp(max(crown, topCap), 0.0, 1.0);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float ax = abs(vRestPos.x);
        float mVar = mNoise(vRestPos * 5.0);
        float fVar = mNoise(vRestPos * 32.0);
        vec3 skinCol = mix(vec3(0.76, 0.53, 0.42), vec3(0.64, 0.42, 0.32), mVar * 0.45);
        skinCol *= 0.96 + 0.06 * fVar;
        skinCol *= mix(0.68, 1.0, vAo);

        // Eyes & Eyebrows
        float eyeMask = 0.0;
        if (vRestPos.y > 1.43 && vRestPos.z < -0.10) {
          vec2 eu = vec2(ax - 0.040, vRestPos.y - 1.472);
          float alY = 0.0068 * max(0.0, 1.0 - pow(eu.x / 0.016, 2.0));
          float inEye = smoothstep(0.0014, -0.0010, abs(eu.y) - alY) * smoothstep(0.017, 0.013, abs(eu.x));
          float irR = length(eu);
          float irRing = smoothstep(0.0068, 0.0056, irR);
          vec3 irCol = mix(vec3(0.18, 0.14, 0.10), vec3(0.03, 0.03, 0.03), smoothstep(0.0032, 0.0022, irR));
          float glint = smoothstep(0.0020, 0.0005, length(eu - vec2(-0.002, 0.002)));
          irCol += vec3(0.7, 0.72, 0.76) * glint;
          vec3 eyeC = mix(vec3(0.92, 0.90, 0.88), irCol, irRing);
          float lash = smoothstep(0.0020, 0.0, abs(eu.y - alY)) * smoothstep(0.0175, 0.012, abs(eu.x));
          eyeMask = clamp(max(inEye, lash), 0.0, 1.0);
          skinCol = mix(skinCol, mix(eyeC, vec3(0.06, 0.05, 0.04), lash), eyeMask);

          float bY = 1.493 + 0.003 * sin(smoothstep(0.016, 0.062, ax) * 3.14159);
          float brow = smoothstep(0.0042, 0.0015, abs(vRestPos.y - bY)) * smoothstep(0.066, 0.048, ax) * smoothstep(0.014, 0.022, ax);
          skinCol = mix(skinCol, vec3(0.09, 0.07, 0.06), brow * 0.85);
        }

        // Subtle male lips & subtle stubble shadow on jaw
        float mLip = smoothstep(0.024, 0.010, length(vec3(vRestPos.x * 0.9, (vRestPos.y - 1.376) * 2.0, (vRestPos.z + 0.146) * 1.4))) * smoothstep(-0.10, -0.135, vRestPos.z);
        skinCol = mix(skinCol, vec3(0.62, 0.36, 0.34), mLip * 0.65);

        float hairM = mHairMask(vRestPos);
        if (hairM > 0.001) {
          float strand = mNoise(vec3(vRestPos.x * 110.0, vRestPos.y * 55.0, vRestPos.z * 110.0));
          skinCol = mix(skinCol, vec3(0.085, 0.068, 0.058) * (0.85 + 0.3 * strand), hairM);
        }

        // Tailored studio charcoal trousers + subtle waistband
        float trouserM = mTrouserMask(vRestPos);
        if (trouserM > 0.001) {
          float weave = mNoise(vRestPos * 120.0);
          vec3 fabric = vec3(0.11, 0.115, 0.132) * (0.90 + 0.20 * weave);
          float waistBand = smoothstep(0.032, 0.008, abs(vRestPos.y - 0.065));
          fabric = mix(fabric, vec3(0.16, 0.14, 0.13), waistBand * 0.65);
          skinCol = mix(skinCol, fabric, trouserM);
        }

        diffuseColor.rgb *= skinCol;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float trR = mTrouserMask(vRestPos);
        float hrR = mHairMask(vRestPos);
        roughnessFactor = mix(roughnessFactor, 0.56, hrR);
        roughnessFactor = mix(roughnessFactor, 0.78, trR);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 viewLightDir = normalize((viewMatrix * vec4(uKeyLightDir, 0.0)).xyz);
          float ndotl = dot(geometryNormal, viewLightDir);
          float wrap = smoothstep(-0.55, 0.45, ndotl) * (1.0 - smoothstep(-0.05, 0.65, ndotl));
          float trS = mTrouserMask(vRestPos);
          reflectedLight.directDiffuse += vec3(0.78, 0.30, 0.20) * wrap * 0.24 * (1.0 - trS);
          reflectedLight.indirectDiffuse *= mix(0.68, 1.0, vAo);
        }`,
      );
  };

  return {
    material,
    setKeyLightDir: (dir: THREE.Vector3) => {
      uniforms.uKeyLightDir.value.copy(dir).normalize();
    },
    dispose: () => {
      material.dispose();
    },
  };
}

// Reusable scratch matrices for zero-GC frame skinning
const _mPelvis = new THREE.Matrix4();
const _mTorso = new THREE.Matrix4();
const _mHead = new THREE.Matrix4();
const _mThighL = new THREE.Matrix4();
const _mThighR = new THREE.Matrix4();
const _mShinL = new THREE.Matrix4();
const _mShinR = new THREE.Matrix4();
const _mUpperL = new THREE.Matrix4();
const _mUpperR = new THREE.Matrix4();
const _mForeL = new THREE.Matrix4();
const _mForeR = new THREE.Matrix4();
const _mTmpA = new THREE.Matrix4();
const _mTmpRot = new THREE.Matrix4();
const _mTmpTr = new THREE.Matrix4();
const _eul = new THREE.Euler();

function buildPivot(
  out: THREE.Matrix4,
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
  tx = 0,
  ty = 0,
  tz = 0,
): void {
  _eul.set(rx, ry, rz, 'YXZ');
  _mTmpRot.makeRotationFromEuler(_eul);
  out.makeTranslation(px + tx, py + ty, pz + tz);
  out.multiply(_mTmpRot);
  _mTmpTr.makeTranslation(-px, -py, -pz);
  out.multiply(_mTmpTr);
}

function mulMatPoint(
  m: number[],
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
 * Animates the male character with smooth walking locomotion and a bridal-carry arm cradle.
 */
export function applyMalePose(meshData: MaleMeshData, pose: MalePoseInput): void {
  const { geometry, basePositions, armMask } = meshData;
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  const vertCount = basePositions.length / 3;

  const spd = Math.max(0, Math.min(1, pose.walkSpeed01));
  const carry = Math.max(0, Math.min(1, pose.carryBlend));
  const kiss = Math.max(0, Math.min(1, pose.kissBlend ?? 0));
  const ph = pose.walkPhase;

  const s = Math.sin(ph) * spd;
  const c = Math.cos(ph) * spd;
  const strideBounce = Math.abs(Math.sin(ph)) * 0.028 * spd;

  // Pelvis & Torso (supports walking, upright carry, and deep affectionate bow/crouch kiss)
  buildPivot(
    _mPelvis,
    0,
    -0.06,
    0,
    -0.04 * carry - 0.14 * kiss,
    s * 0.06 * (1 - kiss),
    s * 0.025 * (1 - kiss),
    0,
    strideBounce * (1 - kiss) - 0.40 * kiss,
    0.14 * kiss,
  );
  buildPivot(
    _mTmpA,
    0,
    0.34,
    0,
    -0.04 * carry - 1.24 * kiss - pose.breathPhase * 0.012,
    -s * 0.08 * (1 - carry * 0.7) * (1 - kiss),
    0,
  );
  _mTorso.multiplyMatrices(_mPelvis, _mTmpA);

  buildPivot(
    _mTmpA,
    0,
    1.14,
    -0.015,
    0.10 * carry + 0.56 * kiss,
    0.08 * kiss,
    -0.05 * carry,
  );
  _mHead.multiplyMatrices(_mTorso, _mTmpA);

  // Legs (natural walk swing; deep crouch knee bend when kissing low)
  const thighSwingL = s * 0.38 * (1 - kiss) + 0.96 * kiss;
  const thighSwingR = -s * 0.38 * (1 - kiss) + 0.96 * kiss;
  const kneeBendL = (Math.max(0, -c) * 0.48 + spd * 0.05) * (1 - kiss) + 1.64 * kiss;
  const kneeBendR = (Math.max(0, c) * 0.48 + spd * 0.05) * (1 - kiss) + 1.64 * kiss;

  buildPivot(_mTmpA, -0.165, -0.12, 0, thighSwingL, -0.08 * kiss, 0);
  _mThighL.multiplyMatrices(_mPelvis, _mTmpA);
  buildPivot(_mTmpA, -0.150, -0.78, -0.015, -kneeBendL, 0, 0);
  _mShinL.multiplyMatrices(_mThighL, _mTmpA);

  buildPivot(_mTmpA, 0.165, -0.12, 0, thighSwingR, 0.08 * kiss, 0);
  _mThighR.multiplyMatrices(_mPelvis, _mTmpA);
  buildPivot(_mTmpA, 0.150, -0.78, -0.015, -kneeBendR, 0, 0);
  _mShinR.multiplyMatrices(_mThighR, _mTmpA);

  // Arms: walk swing, bridal-carry cradle, or gentle embrace around her hips during kiss
  const armSwing = s * 0.34 * (1 - carry) * (1 - kiss);
  const lShPitch = mix(mix(armSwing, 0.28, carry), -0.18, kiss);
  const lShAdd = mix(mix(0.0, 0.14, carry), 0.12, kiss);
  const lShYaw = mix(mix(0.0, -0.36, carry), -0.24, kiss);
  const lElFlex = mix(mix(0.14 + Math.max(0, s) * 0.18, 1.46, carry), 0.72, kiss);
  const lForeYaw = mix(mix(0.0, -0.48, carry), -0.32, kiss);

  const rShPitch = mix(mix(-armSwing, 0.20, carry), -0.18, kiss);
  const rShAdd = mix(mix(0.0, 0.14, carry), 0.12, kiss);
  const rShYaw = mix(mix(0.0, 0.36, carry), 0.24, kiss);
  const rElFlex = mix(mix(0.14 + Math.max(0, -s) * 0.18, 1.46, carry), 0.72, kiss);
  const rForeYaw = mix(mix(0.0, 0.48, carry), 0.32, kiss);

  buildPivot(_mTmpA, -0.375, 1.00, -0.005, lShPitch, lShYaw, -lShAdd);
  _mUpperL.multiplyMatrices(_mTorso, _mTmpA);
  buildPivot(_mTmpA, -0.525, 0.52, 0.025, lElFlex, lForeYaw, 0);
  _mForeL.multiplyMatrices(_mUpperL, _mTmpA);

  buildPivot(_mTmpA, 0.375, 1.00, -0.005, rShPitch, rShYaw, rShAdd);
  _mUpperR.multiplyMatrices(_mTorso, _mTmpA);
  buildPivot(_mTmpA, 0.525, 0.52, 0.025, rElFlex, rForeYaw, 0);
  _mForeR.multiplyMatrices(_mUpperR, _mTmpA);

  const mPel = _mPelvis.elements;
  const mTor = _mTorso.elements;
  const mHd = _mHead.elements;
  const mTL = _mThighL.elements;
  const mTR = _mThighR.elements;
  const mSL = _mShinL.elements;
  const mSR = _mShinR.elements;
  const mUL = _mUpperL.elements;
  const mUR = _mUpperR.elements;
  const mFL = _mForeL.elements;
  const mFR = _mForeR.elements;

  const out: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < vertCount; i++) {
    const idx = i * 3;
    const rx = basePositions[idx];
    const ry = basePositions[idx + 1];
    const rz = basePositions[idx + 2];

    const wArm = armMask[i];
    const wBody = 1.0 - wArm;
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;

    if (wBody > 1e-4) {
      const mShin = rx >= 0 ? mSR : mSL;
      const mThigh = rx >= 0 ? mTR : mTL;
      if (ry <= -0.84) {
        mulMatPoint(mShin, rx, ry, rz, wBody, out);
      } else if (ry < -0.72) {
        const t = smoothstep(-0.84, -0.72, ry);
        mulMatPoint(mShin, rx, ry, rz, wBody * (1 - t), out);
        mulMatPoint(mThigh, rx, ry, rz, wBody * t, out);
      } else if (ry < -0.24) {
        const t = smoothstep(-0.72, -0.24, ry);
        mulMatPoint(mThigh, rx, ry, rz, wBody * (1 - t), out);
        mulMatPoint(mPel, rx, ry, rz, wBody * t, out);
      } else if (ry <= 0.12) {
        mulMatPoint(mPel, rx, ry, rz, wBody, out);
      } else if (ry < 0.54) {
        const t = smoothstep(0.12, 0.54, ry);
        mulMatPoint(mPel, rx, ry, rz, wBody * (1 - t), out);
        mulMatPoint(mTor, rx, ry, rz, wBody * t, out);
      } else if (ry <= 1.08) {
        mulMatPoint(mTor, rx, ry, rz, wBody, out);
      } else if (ry < 1.32) {
        const t = smoothstep(1.08, 1.32, ry);
        mulMatPoint(mTor, rx, ry, rz, wBody * (1 - t), out);
        mulMatPoint(mHd, rx, ry, rz, wBody * t, out);
      } else {
        mulMatPoint(mHd, rx, ry, rz, wBody, out);
      }
    }

    if (wArm > 1e-4) {
      const wFore = smoothstep(0.60, 0.44, ry);
      const wUp = 1.0 - wFore;
      if (rx >= 0) {
        if (wUp > 1e-4) mulMatPoint(mUR, rx, ry, rz, wArm * wUp, out);
        if (wFore > 1e-4) mulMatPoint(mFR, rx, ry, rz, wArm * wFore, out);
      } else {
        if (wUp > 1e-4) mulMatPoint(mUL, rx, ry, rz, wArm * wUp, out);
        if (wFore > 1e-4) mulMatPoint(mFL, rx, ry, rz, wArm * wFore, out);
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
