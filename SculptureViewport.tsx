import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {
  applyMalePose,
  createMaleMaterialController,
  createMaleMeshData,
  MaleMeshData,
} from '../three/maleSculpture';
import {
  applySculpturePose,
  createSculptureMeshData,
  SculptMeshData,
  updateSculptureMorph,
} from '../three/sculptureGeometry';
import { createSculptureMaterialController } from '../three/sculptureMaterials';
import {
  classifyTouchZone,
  getCarriedWomanPose,
  getHappyKissReactionPose,
  getTargetPoseForZone,
  getTouchImpulse,
} from '../three/sculptureReactions';
import { createStudioStage } from '../three/studioPedestal';
import {
  DEFAULT_SCULPT_PARAMS,
  NEUTRAL_POSE,
  PoseState,
  TouchZone,
} from '../types/sculpture';

export interface MoveVector {
  x: number;
  y: number;
}

export interface CarryStatus {
  canPickUp: boolean;
  isCarrying: boolean;
  canKiss: boolean;
  isKissing: boolean;
  womanHappy: boolean;
}

interface SculptureViewportProps {
  moveInputRef: React.MutableRefObject<MoveVector>;
  carryToggleSeq: number;
  kissSeq: number;
  resetCameraSeq: number;
  onCarryStatusChange?: (status: CarryStatus) => void;
  onTouchReaction?: (zone: TouchZone) => void;
  onHoverZone?: (zone: TouchZone) => void;
  onWebglError?: () => void;
}

interface SpringChannel {
  pos: number;
  vel: number;
}

function stepSpring(
  ch: SpringChannel,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
  limit = 0.048,
): boolean {
  const force = -stiffness * (ch.pos - target) - damping * ch.vel;
  ch.vel += force * dt;
  ch.pos = THREE.MathUtils.clamp(ch.pos + ch.vel * dt, -limit, limit);
  const settled = Math.abs(ch.pos - target) < 0.00025 && Math.abs(ch.vel) < 0.002;
  if (settled) {
    ch.pos = target;
    ch.vel = 0;
  }
  return !settled;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function angleDiff(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const _tmpVec = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _pointerNdc = new THREE.Vector2();
const _localHit = new THREE.Vector3();
const _hoverHit = new THREE.Vector3();

// Carried woman anchor in maleGroup local space (verified in Node)
const _carryLocalPos = new THREE.Vector3(0.16, 0.60, -0.45);
const _carryQRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.02);
const _carryQYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.58);
const _carryLocalQuat = new THREE.Quaternion().multiplyQuaternions(_carryQRoll, _carryQYaw);
const _standPos = new THREE.Vector3(0, 0, 0);
const _standQuat = new THREE.Quaternion();
const _targetCarryPos = new THREE.Vector3();
const _targetCarryQuat = new THREE.Quaternion();
const _maleMat = new THREE.Matrix4();
const _maleQuat = new THREE.Quaternion();
const _maleScale = new THREE.Vector3(1, 1, 1);

const POSE_KEYS = Object.keys(NEUTRAL_POSE) as (keyof PoseState)[];

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createHeartTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2 + 6;
    const grad = ctx.createRadialGradient(cx, cy - 10, 6, cx, cy, 48);
    grad.addColorStop(0, '#ffd4dc');
    grad.addColorStop(0.55, '#f08a9d');
    grad.addColorStop(1, '#d85c77');

    ctx.save();
    ctx.shadowColor = 'rgba(240, 138, 157, 0.55)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 30);
    ctx.bezierCurveTo(cx - 46, cy + 2, cx - 44, cy - 36, cx - 18, cy - 36);
    ctx.bezierCurveTo(cx - 5, cy - 36, cx, cy - 22, cx, cy - 16);
    ctx.bezierCurveTo(cx, cy - 22, cx + 5, cy - 36, cx + 18, cy - 36);
    ctx.bezierCurveTo(cx + 44, cy - 36, cx + 46, cy + 2, cx, cy + 30);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function SculptureViewport({
  moveInputRef,
  carryToggleSeq,
  kissSeq,
  resetCameraSeq,
  onCarryStatusChange,
  onTouchReaction,
  onHoverZone,
  onWebglError,
}: SculptureViewportProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const onCarryStatusRef = useRef(onCarryStatusChange);
  onCarryStatusRef.current = onCarryStatusChange;
  const onTouchReactionRef = useRef(onTouchReaction);
  onTouchReactionRef.current = onTouchReaction;
  const onHoverZoneRef = useRef(onHoverZone);
  onHoverZoneRef.current = onHoverZone;
  const latestMoveInputRef = useRef(moveInputRef);
  latestMoveInputRef.current = moveInputRef;

  const sceneApiRef = useRef<{
    toggleCarry: () => void;
    triggerKiss: () => void;
    resetCamera: () => void;
    wakeLoop: () => void;
  } | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      onWebglError?.();
      return;
    }

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#131115');
    scene.fog = new THREE.FogExp2('#131115', 0.068);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 45);
    const initCamPos = new THREE.Vector3(1.85, 0.65, -4.95);
    const initTarget = new THREE.Vector3(-0.35, -0.24, -0.55);
    camera.position.copy(initCamPos);

    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(initTarget);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.enablePan = true;
    controls.minDistance = 1.1;
    controls.maxDistance = 9.5;
    controls.minPolarAngle = 0.20;
    controls.maxPolarAngle = Math.PI * 0.56;
    controls.update();

    // Lighting Rig
    const hemiLight = new THREE.HemisphereLight('#b7cce6', '#2f231e', 0.74);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#fff1e4', 2.35);
    keyLight.position.set(2.2, 2.5, -2.1);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 14;
    keyLight.shadow.camera.left = -4.2;
    keyLight.shadow.camera.right = 4.2;
    keyLight.shadow.camera.top = 3.2;
    keyLight.shadow.camera.bottom = -3.2;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#c9dcff', 1.40);
    rimLight.position.set(-2.4, 1.8, 2.2);
    scene.add(rimLight);

    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const leftSoftbox = new THREE.RectAreaLight('#fff0e2', 2.2, 2.0, 3.8);
      leftSoftbox.position.set(-2.8, 0.5, -1.8);
      leftSoftbox.lookAt(0, 0.0, 0);
      scene.add(leftSoftbox);

      const rightSoftbox = new THREE.RectAreaLight('#dbe8ff', 1.7, 1.8, 3.6);
      rightSoftbox.position.set(2.6, 0.5, 1.8);
      rightSoftbox.lookAt(0, 0.0, 0);
      scene.add(rightSoftbox);
    }

    // Studio Pedestal & Floor (Woman stays at her exact pedestal spot (0, 0, 0))
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const stage = createStudioStage(maxAniso);
    scene.add(stage.floorMesh);

    const turntableGroup = new THREE.Group();
    turntableGroup.add(stage.pedestalGroup);
    scene.add(turntableGroup);

    // 1. Woman Anatomical Sculpture (exact original rest position at (0, 0, 0))
    const meshData: SculptMeshData = createSculptureMeshData();
    updateSculptureMorph(meshData, DEFAULT_SCULPT_PARAMS);

    const matCtrl = createSculptureMaterialController();
    matCtrl.applyPreset('natural-skin', 'anatomical', 0.38);
    matCtrl.setKeyLightDir(_tmpVec.copy(keyLight.position).normalize());

    const womanPivot = new THREE.Group();
    turntableGroup.add(womanPivot);

    const sculptureMesh = new THREE.Mesh(meshData.geometry, matCtrl.material);
    sculptureMesh.castShadow = !isSoftwareGl;
    sculptureMesh.receiveShadow = true;
    sculptureMesh.layers.enable(1);
    womanPivot.add(sculptureMesh);
    _raycaster.layers.set(1);

    // 2. Controllable Male Character (starts near the pedestal facing her)
    const maleData: MaleMeshData = createMaleMeshData();
    const maleMatCtrl = createMaleMaterialController();
    maleMatCtrl.setKeyLightDir(_tmpVec.copy(keyLight.position).normalize());

    const maleGroup = new THREE.Group();
    const malePos = new THREE.Vector3(-1.35, 0, -1.55);
    let maleYaw = Math.atan2(-(0 - malePos.x), -(0 - malePos.z));

    const getGroundY = (x: number, z: number) => {
      const r = Math.hypot(x, z);
      return -1.66 + 0.22 * smoothstep(0.90, 0.56, r);
    };

    maleGroup.position.set(malePos.x, getGroundY(malePos.x, malePos.z) + 1.44, malePos.z);
    maleGroup.rotation.y = maleYaw;
    turntableGroup.add(maleGroup);

    const maleMesh = new THREE.Mesh(maleData.geometry, maleMatCtrl.material);
    maleMesh.castShadow = !isSoftwareGl;
    maleMesh.receiveShadow = true;
    maleGroup.add(maleMesh);

    // 3. Soft Rose-Gold Floating Heart Sprites for affectionate kiss happiness
    const heartTex = createHeartTexture();
    interface HeartParticle {
      sprite: THREE.Sprite;
      material: THREE.SpriteMaterial;
      active: boolean;
      age: number;
      delay: number;
      duration: number;
      startX: number;
      startY: number;
      startZ: number;
      driftX: number;
      riseY: number;
      driftZ: number;
      baseScale: number;
      phase: number;
    }
    const heartPool: HeartParticle[] = Array.from({ length: 7 }, (_, i) => {
      const material = new THREE.SpriteMaterial({
        map: heartTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      turntableGroup.add(sprite);
      return {
        sprite,
        material,
        active: false,
        age: 0,
        delay: i * 0.16,
        duration: 2.3 + (i % 3) * 0.35,
        startX: 0,
        startY: 0,
        startZ: 0,
        driftX: ((i % 2 === 0 ? 1 : -1) * (0.08 + (i % 3) * 0.05)),
        riseY: 0.72 + (i % 4) * 0.16,
        driftZ: 0.05 * ((i % 3) - 1),
        baseScale: 0.14 + (i % 3) * 0.035,
        phase: i * 1.1,
      };
    });

    function spawnHearts(originX: number, originY: number, originZ: number) {
      for (let i = 0; i < heartPool.length; i++) {
        const h = heartPool[i];
        h.active = true;
        h.age = -h.delay;
        h.startX = originX + Math.sin(i * 1.9) * 0.24;
        h.startY = originY + (i % 3) * 0.16;
        h.startZ = originZ + Math.cos(i * 1.5) * 0.18;
        h.sprite.visible = false;
        h.material.opacity = 0;
      }
    }

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Animation, Locomotion & Reaction State
    let disposed = false;
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();

    // Male character locomotion + carry + kiss state
    let walkPhase = 0;
    let walkSpeed01 = 0;
    let isCarrying = false;
    let carryBlend = 0;
    let kissActive = false;
    let kissTimer = 0;
    let kissSide = 1;
    let kissBlend = 0;
    let kissBurstFired = false;
    let womanHappyTimer = 0;

    let lastReportedCanPickUp = false;
    let lastReportedCarrying = false;
    let lastReportedCanKiss = false;
    let lastReportedIsKissing = false;
    let lastReportedWomanHappy = false;

    // Woman touch reactions & soft springs
    let activeZone: TouchZone = 'none';
    let holdRemaining = 0;
    let squirmElapsed = 10;
    let wiggleDir = 1;
    let shyMomentum = 0;
    const poseCurrent: PoseState = { ...NEUTRAL_POSE };
    const poseRender: PoseState = { ...NEUTRAL_POSE };
    const touchPoint = new THREE.Vector3(0, 0, 0);
    let touchFlash = 0;

    const sprRightX: SpringChannel = { pos: 0, vel: 0 };
    const sprRightY: SpringChannel = { pos: 0, vel: 0 };
    const sprRightZ: SpringChannel = { pos: 0, vel: 0 };
    const sprLeftX: SpringChannel = { pos: 0, vel: 0 };
    const sprLeftY: SpringChannel = { pos: 0, vel: 0 };
    const sprLeftZ: SpringChannel = { pos: 0, vel: 0 };
    const sprBustY: SpringChannel = { pos: 0, vel: 0 };
    const sprBustZ: SpringChannel = { pos: 0, vel: 0 };

    let camResetActive = false;

    function reportCarryStatus(force = false) {
      const dist = Math.hypot(malePos.x, malePos.z);
      const canPickUp = !isCarrying && dist <= 1.45;
      const canKiss = !isCarrying && !kissActive && dist <= 1.65;
      const isKissing = kissActive;
      const womanHappy = womanHappyTimer > 0;
      if (
        force ||
        canPickUp !== lastReportedCanPickUp ||
        isCarrying !== lastReportedCarrying ||
        canKiss !== lastReportedCanKiss ||
        isKissing !== lastReportedIsKissing ||
        womanHappy !== lastReportedWomanHappy
      ) {
        lastReportedCanPickUp = canPickUp;
        lastReportedCarrying = isCarrying;
        lastReportedCanKiss = canKiss;
        lastReportedIsKissing = isKissing;
        lastReportedWomanHappy = womanHappy;
        onCarryStatusRef.current?.({
          canPickUp,
          isCarrying,
          canKiss,
          isKissing,
          womanHappy,
        });
      }
    }
    reportCarryStatus(true);

    function triggerReaction(zone: TouchZone, hitPointLocal?: THREE.Vector3) {
      if (zone === 'none') {
        holdRemaining = 0;
        activeZone = 'none';
        shyMomentum = 0;
        onTouchReactionRef.current?.('none');
        requestRender();
        return;
      }
      activeZone = zone;
      holdRemaining = 3.2;
      squirmElapsed = 0;
      wiggleDir = -wiggleDir;
      shyMomentum = Math.min(1.0, shyMomentum + 0.35);

      const impulse = getTouchImpulse(zone, 'playful');
      sprRightX.vel += impulse.rightX;
      sprRightY.vel += impulse.rightY;
      sprRightZ.vel += impulse.rightZ;
      sprLeftX.vel += impulse.leftX;
      sprLeftY.vel += impulse.leftY;
      sprLeftZ.vel += impulse.leftZ;
      sprBustY.vel += impulse.bustY;
      sprBustZ.vel += impulse.bustZ;

      if (hitPointLocal) {
        touchPoint.copy(hitPointLocal);
      } else {
        touchPoint.set(0, 0.05, -0.18);
      }
      touchFlash = 1.0;
      lastTime = performance.now();
      onTouchReactionRef.current?.(zone);
      requestRender();
    }

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function stepFrame(now: number): boolean {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      let needsMore = false;

      if (camResetActive) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, initCamPos.x, 7.0, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, initCamPos.y, 7.0, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, initCamPos.z, 7.0, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, initTarget.x, 7.0, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, initTarget.y, 7.0, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, initTarget.z, 7.0, dt);
        if (camera.position.distanceTo(initCamPos) < 0.01) {
          camResetActive = false;
        } else {
          needsMore = true;
        }
      }

      // 1. Male Character Camera-Relative Walking & Affectionate Kiss Alignment
      const inp = latestMoveInputRef.current.current;
      const inMag = Math.min(1, Math.hypot(inp.x, inp.y));

      if (kissActive && inMag > 0.2 && kissTimer > 0.4) {
        kissActive = false;
      }

      if (kissActive) {
        kissTimer += dt;
        const targetKissX = 0.14 * kissSide;
        const targetKissZ = 1.36;
        malePos.x = THREE.MathUtils.damp(malePos.x, targetKissX, 6.2, dt);
        malePos.z = THREE.MathUtils.damp(malePos.z, targetKissZ, 6.2, dt);
        maleYaw += angleDiff(maleYaw, 0) * Math.min(1, dt * 8.5);

        const alignDist = Math.hypot(targetKissX - malePos.x, targetKissZ - malePos.z);
        const stepMotion = Math.min(0.45, alignDist * 2.2);
        walkSpeed01 = THREE.MathUtils.damp(walkSpeed01, stepMotion, 9.0, dt);
        if (stepMotion > 0.03) {
          walkPhase += dt * 5.2;
        }

        const rampUp = smoothstep(0.15, 0.95, kissTimer);
        const rampDown = 1 - smoothstep(1.65, 2.55, kissTimer);
        kissBlend = rampUp * rampDown;

        if (kissTimer >= 0.85 && !kissBurstFired) {
          kissBurstFired = true;
          womanHappyTimer = 4.2;
          const kissImp = getTouchImpulse(
            kissSide >= 0 ? 'glute-right' : 'glute-left',
            'gentle',
          );
          sprRightX.vel += kissImp.rightX * 0.7;
          sprRightY.vel += kissImp.rightY * 0.7;
          sprRightZ.vel += kissImp.rightZ * 0.7;
          sprLeftX.vel += kissImp.leftX * 0.7;
          sprLeftY.vel += kissImp.leftY * 0.7;
          sprLeftZ.vel += kissImp.leftZ * 0.7;
          sprBustY.vel += kissImp.bustY * 0.5;
          sprBustZ.vel += kissImp.bustZ * 0.5;
          touchPoint.set(0.14 * kissSide, -0.07, 0.42);
          touchFlash = 1.0;
          spawnHearts(0.12 * kissSide, 0.25, 0.28);
        }

        if (kissTimer >= 2.65) {
          kissActive = false;
          kissBlend = 0;
        }
        needsMore = true;
      } else {
        if (kissBlend > 0.002) {
          kissBlend = THREE.MathUtils.damp(kissBlend, 0, 8.0, dt);
          needsMore = true;
        } else {
          kissBlend = 0;
        }

        if (inMag > 0.04) {
          camera.getWorldDirection(_camDir);
          _camDir.y = 0;
          if (_camDir.lengthSq() < 1e-5) _camDir.set(0, 0, 1);
          _camDir.normalize();
          // Camera right vector on XZ plane: cross(camDir, up) = (-camDir.z, 0, camDir.x)
          _camRight.set(-_camDir.z, 0, _camDir.x);

          const moveX = (_camRight.x * inp.x + _camDir.x * inp.y) / Math.max(1, inMag);
          const moveZ = (_camRight.z * inp.x + _camDir.z * inp.y) / Math.max(1, inMag);

          const moveSpeed = (isCarrying ? 1.55 : 2.05) * inMag;
          const prevX = malePos.x;
          const prevZ = malePos.z;
          malePos.x += moveX * moveSpeed * dt;
          malePos.z += moveZ * moveSpeed * dt;

          // Avoid clipping straight through the woman while she is standing on the pedestal
          if (!isCarrying && carryBlend < 0.15) {
            const dWoman = Math.hypot(malePos.x, malePos.z);
            const minSep = 0.54;
            if (dWoman < minSep && dWoman > 1e-4) {
              malePos.x = (malePos.x / dWoman) * minSep;
              malePos.z = (malePos.z / dWoman) * minSep;
            }
          }

          // Studio arena bounds
          const arenaDist = Math.hypot(malePos.x, malePos.z);
          if (arenaDist > 5.4) {
            malePos.x = (malePos.x / arenaDist) * 5.4;
            malePos.z = (malePos.z / arenaDist) * 5.4;
          }

          // Gently pan camera & target along with the male character
          const dxMoved = malePos.x - prevX;
          const dzMoved = malePos.z - prevZ;
          camera.position.x += dxMoved * 0.85;
          camera.position.z += dzMoved * 0.85;
          controls.target.x += dxMoved * 0.85;
          controls.target.z += dzMoved * 0.85;

          const targetYaw = Math.atan2(-moveX, -moveZ);
          maleYaw += angleDiff(maleYaw, targetYaw) * Math.min(1, dt * 11.0);

          walkSpeed01 = THREE.MathUtils.damp(walkSpeed01, inMag, 12.0, dt);
          walkPhase += dt * (4.8 + moveSpeed * 2.1);
          needsMore = true;
        } else {
          walkSpeed01 = THREE.MathUtils.damp(walkSpeed01, 0, 10.0, dt);
          if (walkSpeed01 > 0.01) {
            needsMore = true;
          }
        }
      }

      // Smoothly turn male to face the woman when picking her up
      const carryTarget = isCarrying ? 1 : 0;
      if (Math.abs(carryBlend - carryTarget) > 0.002) {
        carryBlend = THREE.MathUtils.damp(carryBlend, carryTarget, 7.5, dt);
        if (isCarrying && carryBlend < 0.4) {
          const faceHerYaw = Math.atan2(-(0 - malePos.x), -(0 - malePos.z));
          maleYaw += angleDiff(maleYaw, faceHerYaw) * Math.min(1, dt * 8.0);
        }
        needsMore = true;
      } else {
        carryBlend = carryTarget;
      }

      const groundY = getGroundY(malePos.x, malePos.z);
      maleGroup.position.set(malePos.x, groundY + 1.44, malePos.z);
      maleGroup.rotation.y = maleYaw;

      const livingBreath = !isSoftwareGl;
      const breathWave = livingBreath ? Math.sin(now * 0.0017) * 0.65 : 0;

      applyMalePose(maleData, {
        walkPhase,
        walkSpeed01,
        carryBlend,
        kissBlend,
        breathPhase: breathWave,
      });

      // 2. Woman Posture, Soft-Tissue Springs & Bridal-Carry Transform
      if (holdRemaining > 0) {
        holdRemaining = Math.max(0, holdRemaining - dt);
        if (holdRemaining === 0) {
          activeZone = 'none';
          onTouchReactionRef.current?.('none');
        }
      }
      if (womanHappyTimer > 0) {
        womanHappyTimer = Math.max(0, womanHappyTimer - dt);
        needsMore = true;
      }
      squirmElapsed += dt;
      shyMomentum = THREE.MathUtils.damp(shyMomentum, 0, 0.22, dt);

      reportCarryStatus(false);

      const baseTarget =
        carryBlend > 0.35
          ? getCarriedWomanPose(breathWave)
          : holdRemaining > 0
            ? getTargetPoseForZone(activeZone, wiggleDir, 'playful')
            : womanHappyTimer > 0
              ? getHappyKissReactionPose(breathWave, kissSide)
              : NEUTRAL_POSE;

      const targetPose: PoseState =
        holdRemaining > 0 && carryBlend > 0.35
          ? {
              ...baseTarget,
              headYawY: baseTarget.headYawY + 0.16 * wiggleDir,
              blush: 0.92,
            }
          : baseTarget;

      const poseLambda = holdRemaining > 0 ? 10.0 : womanHappyTimer > 0 ? 6.8 : 5.5;
      for (let i = 0; i < POSE_KEYS.length; i++) {
        const key = POSE_KEYS[i];
        if (
          key === 'jiggleRightX' ||
          key === 'jiggleRightY' ||
          key === 'jiggleRightZ' ||
          key === 'jiggleLeftX' ||
          key === 'jiggleLeftY' ||
          key === 'jiggleLeftZ' ||
          key === 'jiggleBustY' ||
          key === 'jiggleBustZ' ||
          key === 'breathPhase'
        ) {
          continue;
        }
        const nextVal = THREE.MathUtils.damp(poseCurrent[key], targetPose[key], poseLambda, dt);
        poseCurrent[key] = nextVal;
        poseRender[key] = nextVal;
      }

      poseRender.blush = Math.min(1.0, poseCurrent.blush + shyMomentum * 0.20);

      if (womanHappyTimer > 0 && carryBlend < 0.2 && holdRemaining === 0) {
        const happyWave = Math.sin(now * 0.0048) * Math.min(1, womanHappyTimer * 0.7);
        poseRender.hipSwayX += happyWave * 0.014;
        poseRender.torsoRollZ += happyWave * 0.03;
        poseRender.headRollZ -= happyWave * 0.035;
      }

      let wiggleDriveX = 0;
      if (squirmElapsed < 2.2 && holdRemaining > 0 && carryBlend < 0.2) {
        const wiggleEnv = Math.exp(-squirmElapsed * 2.0) * 1.18;
        const sinW = Math.sin(squirmElapsed * 10.5);
        const cosW = Math.cos(squirmElapsed * 10.5);
        wiggleDriveX = sinW * 0.026 * wiggleEnv * wiggleDir;
        poseRender.hipSwayX += wiggleDriveX;
        poseRender.hipTwistY += cosW * 0.12 * wiggleEnv * wiggleDir;
        poseRender.torsoRollZ -= sinW * 0.04 * wiggleEnv * wiggleDir;
      }

      const lagTargetX = -wiggleDriveX * 0.45;
      const lagTargetY = -Math.abs(wiggleDriveX) * 0.35;
      stepSpring(sprRightX, lagTargetX, 165, 8.2, dt);
      stepSpring(sprRightY, lagTargetY, 175, 8.6, dt);
      stepSpring(sprRightZ, 0, 155, 7.8, dt);
      stepSpring(sprLeftX, lagTargetX, 165, 8.2, dt);
      stepSpring(sprLeftY, lagTargetY, 175, 8.6, dt);
      stepSpring(sprLeftZ, 0, 155, 7.8, dt);
      stepSpring(sprBustY, 0, 185, 9.0, dt);
      stepSpring(sprBustZ, 0, 175, 8.8, dt);

      poseRender.jiggleRightX = sprRightX.pos;
      poseRender.jiggleRightY = sprRightY.pos;
      poseRender.jiggleRightZ = sprRightZ.pos;
      poseRender.jiggleLeftX = sprLeftX.pos;
      poseRender.jiggleLeftY = sprLeftY.pos;
      poseRender.jiggleLeftZ = sprLeftZ.pos;
      poseRender.jiggleBustY = sprBustY.pos;
      poseRender.jiggleBustZ = sprBustZ.pos;
      poseRender.breathPhase = breathWave;

      touchFlash = THREE.MathUtils.damp(touchFlash, 0, 0.95, dt);

      applySculpturePose(meshData, poseRender, DEFAULT_SCULPT_PARAMS.hipWidth);
      matCtrl.setReaction(poseRender.blush, touchPoint, touchFlash);

      // Update womanPivot transform (smoothly interpolates from pedestal (0,0,0) into male's arms)
      if (carryBlend > 0.001) {
        const strideBounce = Math.abs(Math.sin(walkPhase)) * 0.026 * walkSpeed01;
        _maleQuat.setFromAxisAngle(_tmpVec.set(0, 1, 0), maleYaw);
        _maleMat.compose(maleGroup.position, _maleQuat, _maleScale);

        _targetCarryPos.copy(_carryLocalPos);
        _targetCarryPos.y += strideBounce;
        _targetCarryPos.applyMatrix4(_maleMat);
        _targetCarryQuat.multiplyQuaternions(_maleQuat, _carryLocalQuat);

        const tPos = smoothstep(0.0, 1.0, carryBlend);
        womanPivot.position.lerpVectors(_standPos, _targetCarryPos, tPos);
        womanPivot.quaternion.slerpQuaternions(_standQuat, _targetCarryQuat, tPos);
      } else {
        womanPivot.position.set(0, 0, 0);
        womanPivot.quaternion.identity();
      }

      // 3. Update floating rose-gold hearts
      for (let i = 0; i < heartPool.length; i++) {
        const h = heartPool[i];
        if (!h.active) continue;
        h.age += dt;
        if (h.age < 0) {
          needsMore = true;
          continue;
        }
        if (h.age >= h.duration) {
          h.active = false;
          h.sprite.visible = false;
          h.material.opacity = 0;
          continue;
        }
        const u = h.age / h.duration;
        const fadeIn = smoothstep(0.0, 0.2, u);
        const fadeOut = 1 - smoothstep(0.55, 1.0, u);
        const sway = Math.sin(h.age * 3.4 + h.phase) * 0.06;
        h.sprite.visible = true;
        h.sprite.position.set(
          h.startX + h.driftX * u + sway,
          h.startY + h.riseY * u,
          h.startZ + h.driftZ * u,
        );
        const pulse = h.baseScale * (0.85 + 0.3 * Math.sin(u * Math.PI));
        h.sprite.scale.set(pulse, pulse, 1);
        h.material.opacity = 0.88 * fadeIn * fadeOut;
        needsMore = true;
      }

      const dampingChanged = controls.update();
      if ((livingBreath || dampingChanged) && !isSoftwareGl) {
        needsMore = true;
      }

      return needsMore;
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;
        const keepGoing = stepFrame(now);
        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (!disposed && (renderDirty || keepGoing)) {
            requestRender();
          }
        };
        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    }

    const onControlStart = () => {
      camResetActive = false;
    };
    const onControlChange = () => {
      requestRender();
    };
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('change', onControlChange);

    // Pointer interaction for touching woman sculpture (drag-safe!)
    let downX = 0;
    let downY = 0;
    let isPointerDown = false;
    let lastHoverCheck = 0;
    let lastReportedHover: TouchZone = 'none';

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onPointerDown = (e: PointerEvent) => {
      isPointerDown = true;
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (isPointerDown) {
        canvas.style.cursor = 'grabbing';
        return;
      }
      const now = performance.now();
      if (now - lastHoverCheck < 65) return;
      lastHoverCheck = now;

      updateNdc(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointerNdc, camera);
      const hits = _raycaster.intersectObject(sculptureMesh, false);
      if (hits.length > 0) {
        canvas.style.cursor = 'pointer';
        const hit = hits[0];
        const restAttr = meshData.geometry.getAttribute('aRestPos') as THREE.BufferAttribute;
        if (hit.face && restAttr) {
          _hoverHit.fromBufferAttribute(restAttr, hit.face.a);
          const hoverZone = classifyTouchZone(_hoverHit);
          if (hoverZone !== lastReportedHover) {
            lastReportedHover = hoverZone;
            onHoverZoneRef.current?.(hoverZone);
          }
        }
      } else {
        canvas.style.cursor = 'grab';
        if (lastReportedHover !== 'none') {
          lastReportedHover = 'none';
          onHoverZoneRef.current?.('none');
        }
      }
    };

    const onPointerLeave = () => {
      if (lastReportedHover !== 'none') {
        lastReportedHover = 'none';
        onHoverZoneRef.current?.('none');
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isPointerDown) return;
      isPointerDown = false;
      const dragDist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dragDist > 6) {
        canvas.style.cursor = 'grab';
        return;
      }
      updateNdc(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointerNdc, camera);
      const hits = _raycaster.intersectObject(sculptureMesh, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const restAttr = meshData.geometry.getAttribute('aRestPos') as THREE.BufferAttribute;
        if (hit.face && restAttr) {
          _localHit.fromBufferAttribute(restAttr, hit.face.a);
        } else {
          _localHit.copy(hit.point);
          sculptureMesh.worldToLocal(_localHit);
        }
        const zone = classifyTouchZone(_localHit);
        // Keep pelvis playful touch reaction when interacted with directly
        triggerReaction(zone === 'pelvis' ? 'waist' : zone, _localHit);
      }
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerup', onPointerUp);

    const onResize = () => {
      if (!container || disposed) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      requestRender();
    };
    window.addEventListener('resize', onResize);

    sceneApiRef.current = {
      toggleCarry: () => {
        if (isCarrying) {
          isCarrying = false;
          // Step male slightly back so he doesn't stand inside her pedestal spot
          const d = Math.hypot(malePos.x, malePos.z);
          if (d < 0.72) {
            const nx = d > 1e-4 ? malePos.x / d : -0.6;
            const nz = d > 1e-4 ? malePos.z / d : -0.8;
            malePos.x = nx * 0.78;
            malePos.z = nz * 0.78;
          }
          reportCarryStatus(true);
          requestRender();
        } else {
          const dist = Math.hypot(malePos.x, malePos.z);
          if (dist <= 1.45) {
            kissActive = false;
            kissBlend = 0;
            isCarrying = true;
            // Position male right beside pedestal at natural pickup distance
            if (dist > 0.68) {
              const scale = 0.66 / dist;
              malePos.x *= scale;
              malePos.z *= scale;
            }
            reportCarryStatus(true);
            requestRender();
          }
        }
      },
      triggerKiss: () => {
        const dist = Math.hypot(malePos.x, malePos.z);
        if (!isCarrying && !kissActive && dist <= 1.65) {
          kissActive = true;
          kissTimer = 0;
          kissBurstFired = false;
          kissSide = malePos.x >= 0 ? 1 : -1;
          activeZone = 'none';
          holdRemaining = 0;
          onTouchReactionRef.current?.('none');
          lastTime = performance.now();
          reportCarryStatus(true);
          requestRender();
        }
      },
      resetCamera: () => {
        camResetActive = true;
        lastTime = performance.now();
        requestRender();
      },
      wakeLoop: () => {
        lastTime = performance.now();
        requestRender();
      },
    };

    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerup', onPointerUp);
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('change', onControlChange);
      controls.dispose();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);

      for (let i = 0; i < heartPool.length; i++) {
        turntableGroup.remove(heartPool[i].sprite);
        heartPool[i].material.dispose();
      }
      heartTex.dispose();

      meshData.geometry.dispose();
      maleData.geometry.dispose();
      matCtrl.dispose();
      maleMatCtrl.dispose();
      stage.dispose();
      envTex.dispose();
      renderer.dispose();
      if (canvas.parentElement === container) {
        container.removeChild(canvas);
      }
      sceneApiRef.current = null;
    };
  }, [onWebglError]);

  useEffect(() => {
    if (carryToggleSeq > 0) {
      sceneApiRef.current?.toggleCarry();
    }
  }, [carryToggleSeq]);

  useEffect(() => {
    if (kissSeq > 0) {
      sceneApiRef.current?.triggerKiss();
    }
  }, [kissSeq]);

  useEffect(() => {
    if (resetCameraSeq > 0) {
      sceneApiRef.current?.resetCamera();
    }
  }, [resetCameraSeq]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#131115]">
      <div ref={mountRef} className="w-full h-full" />
      {contextLost && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#131115]/95 text-[#f3efe9] p-6">
          <div className="max-w-sm text-center space-y-2">
            <h2 className="font-display text-2xl">Grafik Bağlamı Yenileniyor</h2>
            <p className="text-sm text-[#a69e96]">
              3D görünüm bağlamı geçici olarak kesildi. Sayfayı yenileyerek devam edebilirsiniz.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
