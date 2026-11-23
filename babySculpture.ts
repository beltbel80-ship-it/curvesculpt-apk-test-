import * as THREE from 'three';

function sMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0.0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
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

interface BabySdfSample {
  d: number;
  dBody: number;
  dArm: number;
  dLeg: number;
  creviceAo: number;
}

/**
 * Evaluates an anatomical newborn infant SDF in upright rest space:
 *   +Y = head crown (~+0.315), -Y = feet (~-0.335), -Z = face/front, +Z = back
 */
function evaluateBabySdf(x: number, y: number, z: number): BabySdfSample {
  const ax = Math.abs(x);

  // 1. Newborn Head (rounded cranium, chubby cheeks, tiny nose, chin, ears)
  const dCranium = sdEllipsoid(x, y, z, 0.0, 0.242, -0.008, 0.073, 0.079, 0.081, 0.0, -0.05);
  const dCheek = sdEllipsoid(ax, y, z, 0.036, 0.214, -0.052, 0.030, 0.027, 0.028, 0.2, 0.0);
  const dJaw = sdEllipsoid(x, y, z, 0.0, 0.194, -0.038, 0.044, 0.032, 0.042, 0.0, -0.18);
  const dNose = sdEllipsoid(x, y, z, 0.0, 0.222, -0.088, 0.012, 0.013, 0.015, 0.0, 0.1);
  const dEar = sdEllipsoid(ax, y, z, 0.071, 0.228, -0.008, 0.010, 0.019, 0.014, -0.2, 0.0);

  let dHead = sMin(dCranium, dCheek, 0.018);
  dHead = sMin(dHead, dJaw, 0.020);
  dHead = sMin(dHead, dNose, 0.009);
  dHead = sMin(dHead, dEar, 0.007);

  // 2. Short Newborn Neck & Plump Torso
  const dNeck = sdTaperedCapsule(x, y, z, 0.0, 0.140, -0.006, 0.0, 0.195, -0.010, 0.048, 0.043);
  const dChest = sdEllipsoid(x, y, z, 0.0, 0.092, -0.006, 0.082, 0.074, 0.070, 0.0, 0.0);
  const dBelly = sdEllipsoid(x, y, z, 0.0, -0.002, -0.015, 0.084, 0.082, 0.078, 0.0, 0.0);
  const dPelvis = sdEllipsoid(x, y, z, 0.0, -0.068, 0.004, 0.074, 0.054, 0.064, 0.0, 0.0);
  const dShoulders = sdTaperedCapsule(ax, y, z, 0.02, 0.132, -0.005, 0.086, 0.120, -0.006, 0.044, 0.036);

  let dBody = sMin(dHead, dNeck, 0.022);
  dBody = sMin(dBody, dChest, 0.034);
  dBody = sMin(dBody, dShoulders, 0.024);
  dBody = sMin(dBody, dBelly, 0.044);
  dBody = sMin(dBody, dPelvis, 0.042);

  // 3. Newborn Arms (poised outward slightly in rest pose for clean LBS isolation)
  const dUpperArm = sdTaperedCapsule(
    ax,
    y,
    z,
    0.088,
    0.118,
    -0.005,
    0.124,
    0.025,
    -0.020,
    0.031,
    0.025,
  );
  const dForearm = sdTaperedCapsule(
    ax,
    y,
    z,
    0.124,
    0.025,
    -0.020,
    0.112,
    -0.068,
    -0.052,
    0.024,
    0.018,
  );
  const dHand = sdEllipsoid(ax, y, z, 0.108, -0.082, -0.058, 0.018, 0.023, 0.020, 0.0, -0.1);
  let dArm = sMin(dUpperArm, dForearm, 0.014);
  dArm = sMin(dArm, dHand, 0.011);

  // 4. Newborn Legs (plump thighs, calves & tiny feet)
  const dThigh = sdTaperedCapsule(
    ax,
    y,
    z,
    0.054,
    -0.078,
    -0.005,
    0.072,
    -0.186,
    -0.026,
    0.042,
    0.031,
  );
  const dShin = sdTaperedCapsule(
    ax,
    y,
    z,
    0.072,
    -0.186,
    -0.026,
    0.058,
    -0.292,
    -0.006,
    0.030,
    0.021,
  );
  const dFoot = sdTaperedCapsule(
    ax,
    y,
    z,
    0.058,
    -0.308,
    0.002,
    0.060,
    -0.316,
    -0.046,
    0.020,
    0.018,
  );
  let dLeg = sMin(dThigh, dShin, 0.018);
  dLeg = sMin(dLeg, dFoot, 0.012);

  // Blend limbs into torso only near shoulder/hip joints
  const armJoin = 0.018 * smoothstep(0.06, 0.13, y) + 0.002;
  const legJoin = 0.026 * smoothstep(-0.14, -0.05, y) + 0.002;

  let d = sMin(dBody, dArm, armJoin);
  d = sMin(d, dLeg, legJoin);

  // Subtle dorsal groove & neck crease AO
  const spineEnv = smoothstep(-0.08, 0.0, y) * smoothstep(0.16, 0.08, y) * smoothstep(0.0, 0.06, z);
  const spineVal = 0.006 * Math.exp(-(x * x) / (2 * 0.018 * 0.018)) * spineEnv;
  d += spineVal;

  const neckCrease =
    0.007 *
    Math.exp(-Math.pow((y - 0.165) / 0.016, 2)) *
    smoothstep(-0.01, -0.05, z);
  d += neckCrease;

  const creviceAo = Math.max(0.55, 1.0 - (spineVal + neckCrease) * 18.0);
  return { d, dBody, dArm, dLeg, creviceAo };
}

export interface BabyMeshData {
  geometry: THREE.BufferGeometry;
  basePositions: Float32Array;
  armMaskL: Float32Array;
  armMaskR: Float32Array;
  legMaskL: Float32Array;
  legMaskR: Float32Array;
  headMask: Float32Array;
}

export function createBabyMeshData(): BabyMeshData {
  const nx = 46;
  const ny = 76;
  const nz = 40;

  const minX = -0.18;
  const maxX = 0.18;
  const minY = -0.36;
  const maxY = 0.35;
  const minZ = -0.13;
  const maxZ = 0.12;

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
        sdfGrid[nodeIdx(i, j, k)] = evaluateBabySdf(x, y, z).d;
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

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;
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

  // Taubin smoothing (4 passes)
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

  // Evaluate AO & limb isolation masks
  const baseAo = new Float32Array(vertCount);
  const armMaskL = new Float32Array(vertCount);
  const armMaskR = new Float32Array(vertCount);
  const legMaskL = new Float32Array(vertCount);
  const legMaskR = new Float32Array(vertCount);
  const headMask = new Float32Array(vertCount);

  for (let v = 0; v < vertCount; v++) {
    const vx = posArr[v * 3];
    const vy = posArr[v * 3 + 1];
    const vz = posArr[v * 3 + 2];
    const sample = evaluateBabySdf(vx, vy, vz);
    baseAo[v] = sample.creviceAo;

    let am = 0;
    if (Math.abs(vx) > 0.068 && vy > -0.12 && vy < 0.16) {
      am = smoothstep(0.014, -0.014, sample.dArm - sample.dBody);
    }
    armMaskL[v] = vx < 0 ? am : 0;
    armMaskR[v] = vx > 0 ? am : 0;

    let lm = 0;
    if (vy < -0.06) {
      lm = smoothstep(0.015, -0.015, sample.dLeg - sample.dBody);
    }
    legMaskL[v] = vx < 0 ? lm : 0;
    legMaskR[v] = vx > 0 ? lm : 0;

    headMask[v] = smoothstep(0.145, 0.195, vy);
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

  return {
    geometry,
    basePositions,
    armMaskL,
    armMaskR,
    legMaskL,
    legMaskR,
    headMask,
  };
}

export interface BabyTransformPose {
  visible: boolean;
  position: [number, number, number];
  rotationEuler: [number, number, number]; // XYZ Euler applied to babyMesh
  fetalCurl: number; // 0..1 (1 = compact fetal tuck, 0.25 = relaxed cradled)
  limbStir: number;  // gentle newborn stir oscillation
  canalClipActive: boolean;
  canalOutletY: number;
}

const _mBabyArmL = new THREE.Matrix4();
const _mBabyArmR = new THREE.Matrix4();
const _mBabyLegL = new THREE.Matrix4();
const _mBabyLegR = new THREE.Matrix4();
const _mBabyHead = new THREE.Matrix4();
const _mBabyWorld = new THREE.Matrix4();
const _mBabyRot = new THREE.Matrix4();
const _mBabyTrans = new THREE.Matrix4();
const _qBaby = new THREE.Quaternion();
const _eBaby = new THREE.Euler();
const _vBabyPos = new THREE.Vector3();
const _vBabyScale = new THREE.Vector3(1, 1, 1);

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
  _eBaby.set(rx, ry, rz, 'YXZ');
  _mBabyRot.makeRotationFromEuler(_eBaby);
  out.makeTranslation(px + tx, py + ty, pz + tz);
  out.multiply(_mBabyRot);
  _mBabyTrans.makeTranslation(-px, -py, -pz);
  out.multiply(_mBabyTrans);
}

export function applyBabyPose(
  babyData: BabyMeshData,
  babyMesh: THREE.Mesh,
  pose: BabyTransformPose,
): void {
  babyMesh.visible = pose.visible;
  if (!pose.visible) return;

  babyMesh.position.set(pose.position[0], pose.position[1], pose.position[2]);
  babyMesh.rotation.set(pose.rotationEuler[0], pose.rotationEuler[1], pose.rotationEuler[2], 'YXZ');
  babyMesh.updateMatrix();

  const { geometry, basePositions, armMaskL, armMaskR, legMaskL, legMaskR, headMask } = babyData;
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  const vertCount = basePositions.length / 3;

  const curl = pose.fetalCurl;
  const stir = pose.limbStir;

  // Limb matrices: tuck arms & legs inward & anteriorly during fetal curl
  buildPivot(
    _mBabyArmL,
    -0.088,
    0.118,
    -0.005,
    0.58 * curl + stir * 0.08,
    -0.38 * curl,
    0.28 * curl,
    0.012 * curl,
    0,
    -0.01 * curl,
  );
  buildPivot(
    _mBabyArmR,
    0.088,
    0.118,
    -0.005,
    0.58 * curl - stir * 0.08,
    0.38 * curl,
    -0.28 * curl,
    -0.012 * curl,
    0,
    -0.01 * curl,
  );

  // Legs tuck upward & anteriorly toward belly in fetal position
  buildPivot(
    _mBabyLegL,
    -0.054,
    -0.078,
    -0.005,
    0.92 * curl - stir * 0.07,
    -0.16 * curl,
    -0.12 * curl,
    0,
    0.032 * curl,
    -0.018 * curl,
  );
  buildPivot(
    _mBabyLegR,
    0.054,
    -0.078,
    -0.005,
    0.92 * curl + stir * 0.07,
    0.16 * curl,
    0.12 * curl,
    0,
    0.032 * curl,
    -0.018 * curl,
  );

  // Subtle head flexion in birth canal (chin tucked toward chest)
  buildPivot(
    _mBabyHead,
    0,
    0.175,
    -0.008,
    -0.24 * curl + stir * 0.03,
    0,
    0,
  );

  const mAL = _mBabyArmL.elements;
  const mAR = _mBabyArmR.elements;
  const mLL = _mBabyLegL.elements;
  const mLR = _mBabyLegR.elements;
  const mH = _mBabyHead.elements;

  // Build world-relative transform row for canal height test
  _eBaby.set(pose.rotationEuler[0], pose.rotationEuler[1], pose.rotationEuler[2], 'YXZ');
  _qBaby.setFromEuler(_eBaby);
  _vBabyPos.set(pose.position[0], pose.position[1], pose.position[2]);
  _mBabyWorld.compose(_vBabyPos, _qBaby, _vBabyScale);
  const mw = _mBabyWorld.elements;

  for (let i = 0; i < vertCount; i++) {
    const idx = i * 3;
    const rx = basePositions[idx];
    const ry = basePositions[idx + 1];
    const rz = basePositions[idx + 2];

    const wAL = armMaskL[i];
    const wAR = armMaskR[i];
    const wLL = legMaskL[i];
    const wLR = legMaskR[i];
    const wH = headMask[i];
    const wBody = Math.max(0, 1.0 - wAL - wAR - wLL - wLR - wH);

    let px = rx * wBody;
    let py = ry * wBody;
    let pz = rz * wBody;

    if (wAL > 1e-4) {
      px += (mAL[0] * rx + mAL[4] * ry + mAL[8] * rz + mAL[12]) * wAL;
      py += (mAL[1] * rx + mAL[5] * ry + mAL[9] * rz + mAL[13]) * wAL;
      pz += (mAL[2] * rx + mAL[6] * ry + mAL[10] * rz + mAL[14]) * wAL;
    }
    if (wAR > 1e-4) {
      px += (mAR[0] * rx + mAR[4] * ry + mAR[8] * rz + mAR[12]) * wAR;
      py += (mAR[1] * rx + mAR[5] * ry + mAR[9] * rz + mAR[13]) * wAR;
      pz += (mAR[2] * rx + mAR[6] * ry + mAR[10] * rz + mAR[14]) * wAR;
    }
    if (wLL > 1e-4) {
      px += (mLL[0] * rx + mLL[4] * ry + mLL[8] * rz + mLL[12]) * wLL;
      py += (mLL[1] * rx + mLL[5] * ry + mLL[9] * rz + mLL[13]) * wLL;
      pz += (mLL[2] * rx + mLL[6] * ry + mLL[10] * rz + mLL[14]) * wLL;
    }
    if (wLR > 1e-4) {
      px += (mLR[0] * rx + mLR[4] * ry + mLR[8] * rz + mLR[12]) * wLR;
      py += (mLR[1] * rx + mLR[5] * ry + mLR[9] * rz + mLR[13]) * wLR;
      pz += (mLR[2] * rx + mLR[6] * ry + mLR[10] * rz + mLR[14]) * wLR;
    }
    if (wH > 1e-4) {
      px += (mH[0] * rx + mH[4] * ry + mH[8] * rz + mH[12]) * wH;
      py += (mH[1] * rx + mH[5] * ry + mH[9] * rz + mH[13]) * wH;
      pz += (mH[2] * rx + mH[6] * ry + mH[10] * rz + mH[14]) * wH;
    }

    // While inside the birth canal above outletY, smoothly compress radial width
    // so unborn torso/limbs stay cleanly nested inside mother's pelvic cavity
    if (pose.canalClipActive) {
      const parentY = mw[1] * px + mw[5] * py + mw[9] * pz + mw[13];
      if (parentY > pose.canalOutletY) {
        const h = smoothstep(pose.canalOutletY, pose.canalOutletY + 0.14, parentY);
        px *= 1.0 - 0.62 * h;
        pz *= 1.0 - 0.52 * h;
      }
    }

    arr[idx] = px;
    arr[idx + 1] = py;
    arr[idx + 2] = pz;
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
