import * as THREE from 'three';
import { BirthStage, NEUTRAL_POSE, PoseState, TouchStyle, TouchZone } from '../types/sculpture';
import { BabyTransformPose } from './babySculpture';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function classifyTouchZone(localPoint: THREE.Vector3): TouchZone {
  const { x, y, z } = localPoint;

  if (y > 1.06) {
    return 'head';
  }
  if (y >= 0.54 && y <= 1.06 && z < 0.04 && Math.abs(x) < 0.36) {
    return 'chest';
  }
  if (y >= 0.24 && y < 0.54) {
    return 'waist';
  }
  if (y >= -0.34 && y < 0.24) {
    if (z > -0.015) {
      return x < 0 ? 'glute-left' : 'glute-right';
    }
    return 'pelvis';
  }
  if (y < -0.34) {
    return 'thigh';
  }
  return 'waist';
}

export interface SoftTissueImpulse {
  rightX: number;
  rightY: number;
  rightZ: number;
  leftX: number;
  leftY: number;
  leftZ: number;
  bustY: number;
  bustZ: number;
}

export function getTouchImpulse(zone: TouchZone, style: TouchStyle = 'playful'): SoftTissueImpulse {
  const amp = style === 'gentle' ? 0.65 : style === 'playful' ? 1.25 : 0.95;
  switch (zone) {
    case 'glute-right':
      return {
        rightX: 0.14 * amp,
        rightY: 0.16 * amp,
        rightZ: -0.26 * amp,
        leftX: -0.05 * amp,
        leftY: 0.06 * amp,
        leftZ: 0.08 * amp,
        bustY: 0.05 * amp,
        bustZ: -0.04 * amp,
      };
    case 'glute-left':
      return {
        rightX: 0.05 * amp,
        rightY: 0.06 * amp,
        rightZ: 0.08 * amp,
        leftX: -0.14 * amp,
        leftY: 0.16 * amp,
        leftZ: -0.26 * amp,
        bustY: 0.05 * amp,
        bustZ: -0.04 * amp,
      };
    case 'chest':
      return {
        rightX: 0.03 * amp,
        rightY: 0.04 * amp,
        rightZ: 0.05 * amp,
        leftX: -0.03 * amp,
        leftY: 0.04 * amp,
        leftZ: 0.05 * amp,
        bustY: 0.16 * amp,
        bustZ: 0.22 * amp,
      };
    case 'pelvis':
    case 'thigh':
      return {
        rightX: 0.08 * amp,
        rightY: 0.12 * amp,
        rightZ: 0.14 * amp,
        leftX: -0.08 * amp,
        leftY: 0.12 * amp,
        leftZ: 0.14 * amp,
        bustY: 0.09 * amp,
        bustZ: 0.08 * amp,
      };
    case 'waist':
      return {
        rightX: 0.12 * amp,
        rightY: 0.09 * amp,
        rightZ: 0.10 * amp,
        leftX: -0.12 * amp,
        leftY: 0.09 * amp,
        leftZ: 0.10 * amp,
        bustY: 0.07 * amp,
        bustZ: 0.06 * amp,
      };
    default:
      return {
        rightX: 0,
        rightY: 0,
        rightZ: 0,
        leftX: 0,
        leftY: 0,
        leftZ: 0,
        bustY: 0,
        bustZ: 0,
      };
  }
}

export function getTargetPoseForZone(
  zone: TouchZone,
  wiggleDirection = 1,
  style: TouchStyle = 'playful',
): PoseState {
  const dir = wiggleDirection >= 0 ? 1 : -1;
  const swayMult = style === 'gentle' ? 0.72 : style === 'playful' ? 1.18 : 0.96;
  const shyMult = style === 'shy' ? 1.18 : style === 'gentle' ? 0.78 : 1.0;

  const base: PoseState = { ...NEUTRAL_POSE };

  switch (zone) {
    case 'glute-right':
      return {
        ...base,
        hipSwayX: -0.072 * swayMult,
        hipTwistY: 0.26 * swayMult,
        kneeTuck: Math.min(1.15, 0.55 * shyMult),
        torsoTwistY: 0.16 * swayMult,
        torsoPitchX: 0.08 * shyMult,
        torsoRollZ: -0.06 * swayMult,
        headPitchX: 0.20 * shyMult,
        headYawY: 0.52 * shyMult,
        headRollZ: -0.14 * shyMult,
        leftShoulderPitch: 0.24,
        leftShoulderAdduct: 0.10,
        leftShoulderYaw: 0.36,
        leftElbowFlex: style === 'shy' ? 1.48 : 0.82,
        leftForearmYaw: style === 'shy' ? 0.72 : 0.45,
        rightShoulderPitch: -0.40,
        rightShoulderAdduct: 0.22,
        rightShoulderYaw: -0.45,
        rightElbowFlex: -0.14,
        rightForearmYaw: -0.92,
        blush: style === 'gentle' ? 0.75 : 1.0,
      };
    case 'glute-left':
      return {
        ...base,
        hipSwayX: 0.072 * swayMult,
        hipTwistY: -0.26 * swayMult,
        kneeTuck: Math.min(1.15, 0.55 * shyMult),
        torsoTwistY: -0.16 * swayMult,
        torsoPitchX: 0.08 * shyMult,
        torsoRollZ: 0.06 * swayMult,
        headPitchX: 0.20 * shyMult,
        headYawY: -0.52 * shyMult,
        headRollZ: 0.14 * shyMult,
        leftShoulderPitch: -0.40,
        leftShoulderAdduct: 0.22,
        leftShoulderYaw: -0.45,
        leftElbowFlex: -0.14,
        leftForearmYaw: -0.92,
        rightShoulderPitch: 0.24,
        rightShoulderAdduct: 0.10,
        rightShoulderYaw: 0.36,
        rightElbowFlex: style === 'shy' ? 1.48 : 0.82,
        rightForearmYaw: style === 'shy' ? 0.72 : 0.45,
        blush: style === 'gentle' ? 0.75 : 1.0,
      };
    case 'chest':
      return {
        ...base,
        hipSwayX: -0.055 * dir * swayMult,
        hipTwistY: 0.18 * dir * swayMult,
        kneeTuck: Math.min(1.15, 0.85 * shyMult),
        torsoTwistY: -0.14 * dir * swayMult,
        torsoPitchX: 0.10 * shyMult,
        torsoRollZ: 0.06 * dir * swayMult,
        headPitchX: 0.28 * shyMult,
        headYawY: -0.40 * dir * swayMult,
        headRollZ: 0.14 * dir * swayMult,
        leftShoulderPitch: 0.34,
        leftShoulderAdduct: 0.10,
        leftShoulderYaw: 0.46,
        leftElbowFlex: style === 'shy' ? 1.24 : 1.08,
        leftForearmYaw: 0.56,
        rightShoulderPitch: 0.32,
        rightShoulderAdduct: 0.14,
        rightShoulderYaw: 0.52,
        rightElbowFlex: 1.56,
        rightForearmYaw: 0.72,
        blush: 1.0,
      };
    case 'pelvis':
      return {
        ...base,
        birthStance: 1.0,
        birthBelly: 0.85,
        torsoPitchX: -0.15,
        headPitchX: -0.16,
        leftShoulderPitch: 0.24,
        leftShoulderAdduct: -0.16,
        leftElbowFlex: 0.56,
        leftForearmYaw: 0.22,
        rightShoulderPitch: 0.24,
        rightShoulderAdduct: -0.16,
        rightElbowFlex: 0.56,
        rightForearmYaw: 0.22,
        blush: 0.45,
      };
    case 'waist':
      return {
        ...base,
        hipSwayX: 0.080 * dir * swayMult,
        hipTwistY: -0.28 * dir * swayMult,
        kneeTuck: 0.45 * shyMult,
        torsoTwistY: 0.22 * dir * swayMult,
        torsoPitchX: 0.07 * shyMult,
        torsoRollZ: -0.10 * dir * swayMult,
        headPitchX: 0.20 * shyMult,
        headYawY: -0.36 * dir * swayMult,
        headRollZ: 0.15 * dir * swayMult,
        leftShoulderPitch: 0.22,
        leftShoulderAdduct: 0.10,
        leftShoulderYaw: 0.30,
        leftElbowFlex: 0.88,
        leftForearmYaw: 0.44,
        rightShoulderPitch: 0.22,
        rightShoulderAdduct: 0.10,
        rightShoulderYaw: 0.30,
        rightElbowFlex: 0.88,
        rightForearmYaw: 0.44,
        blush: style === 'gentle' ? 0.65 : 0.86,
      };
    case 'thigh':
      return {
        ...base,
        hipSwayX: 0.060 * dir * swayMult,
        hipTwistY: -0.22 * dir * swayMult,
        kneeTuck: Math.min(1.15, 0.92 * shyMult),
        torsoTwistY: 0.12 * dir * swayMult,
        torsoPitchX: 0.08 * shyMult,
        torsoRollZ: -0.05 * dir * swayMult,
        headPitchX: 0.22 * shyMult,
        headYawY: 0.34 * dir * swayMult,
        headRollZ: -0.11 * dir * swayMult,
        leftShoulderPitch: 0.26,
        leftShoulderAdduct: 0.16,
        leftShoulderYaw: 0.40,
        leftElbowFlex: 0.48,
        leftForearmYaw: 0.56,
        rightShoulderPitch: 0.22,
        rightShoulderAdduct: 0.12,
        rightShoulderYaw: 0.30,
        rightElbowFlex: 0.45,
        rightForearmYaw: 0.40,
        blush: 0.88,
      };
    case 'head':
      return {
        ...base,
        hipSwayX: -0.032 * dir * swayMult,
        hipTwistY: 0.10 * dir * swayMult,
        kneeTuck: 0.25 * shyMult,
        torsoTwistY: -0.08 * dir * swayMult,
        torsoPitchX: 0.06 * shyMult,
        torsoRollZ: 0.04 * dir * swayMult,
        headPitchX: 0.28 * shyMult,
        headYawY: -0.44 * dir * swayMult,
        headRollZ: 0.16 * dir * swayMult,
        leftShoulderPitch: 0.18,
        leftShoulderAdduct: 0.06,
        leftShoulderYaw: 0.25,
        leftElbowFlex: 0.65,
        leftForearmYaw: 0.28,
        rightShoulderPitch: 0.18,
        rightShoulderAdduct: 0.06,
        rightShoulderYaw: 0.25,
        rightElbowFlex: 0.65,
        rightForearmYaw: 0.28,
        blush: 1.0,
      };
    case 'none':
    default:
      return { ...NEUTRAL_POSE };
  }
}

export function getBirthStage(progress: number): BirthStage {
  if (progress <= 0.001) return 'idle';
  if (progress < 0.14) return 'stance';
  if (progress < 0.36) return 'crowning';
  if (progress < 0.72) return 'emerging';
  if (progress < 0.94) return 'lifting';
  return 'cradling';
}

export function getBirthStageLabel(stage: BirthStage): string {
  switch (stage) {
    case 'stance':
      return 'Doğum Etüdü · Ayaküstü doğum pozisyonu alınıyor';
    case 'crowning':
      return 'Baş Gelişi · İlk olarak bebeğin başı göründü';
    case 'emerging':
      return 'Doğum Süreci · Bebek yavaş yavaş dünyaya geliyor';
    case 'lifting':
      return 'Doğum Süreci · Anne bebeğini kucağına alıyor';
    case 'cradling':
      return 'Doğum Tamamlandı · Anne bebeğini kucağına aldı';
    default:
      return '';
  }
}

export function evaluateBirthChoreography(
  rawProgress: number,
  breathPhase: number,
  elapsedSec: number,
): { motherPose: PoseState; babyPose: BabyTransformPose; stage: BirthStage } {
  const p = clamp01(rawProgress);
  const stage = getBirthStage(p);

  const stanceRamp = smoothstep(0.0, 0.14, p);
  const standUpRamp = smoothstep(0.72, 0.94, p);
  const cradleArms = smoothstep(0.76, 0.96, p);
  const reachDown = smoothstep(0.46, 0.72, p) * (1.0 - cradleArms);

  // Return gracefully to upright standing stance as she lifts and cradles the newborn
  const birthStance = stanceRamp * mix(1.0, 0.0, standUpRamp);
  const birthBelly = stanceRamp * (0.85 - 0.85 * smoothstep(0.18, 0.74, p));

  const effortWave =
    p >= 0.14 && p < 0.72 ? 0.5 + 0.5 * Math.sin(elapsedSec * 2.4) : 0;

  // Stance/crowning arms rest naturally supporting hips/lower belly (NOT protruding horizontally)
  const stanceShoulderPitch = 0.06 * stanceRamp;
  const stanceShoulderAdduct = -0.08 * stanceRamp;
  const stanceShoulderYaw = 0.16 * stanceRamp;
  const stanceElbowFlex = 0.54 * stanceRamp;
  const stanceForearmYaw = 0.44 * stanceRamp;

  const motherPose: PoseState = {
    ...NEUTRAL_POSE,
    birthStance,
    birthBelly,
    torsoPitchX: mix(
      mix(-0.04 * stanceRamp - 0.015 * effortWave, -0.09, reachDown),
      -0.06,
      cradleArms,
    ),
    headPitchX: mix(
      mix(-0.08 * stanceRamp, -0.18, smoothstep(0.14, 0.55, p)),
      -0.22,
      cradleArms,
    ),
    headYawY: 0.14 * cradleArms,
    headRollZ: -0.06 * cradleArms,
    leftShoulderPitch: mix(
      mix(stanceShoulderPitch, 0.24, reachDown),
      0.16,
      cradleArms,
    ),
    leftShoulderAdduct: mix(
      mix(stanceShoulderAdduct, 0.12, reachDown),
      0.15,
      cradleArms,
    ),
    leftShoulderYaw: mix(mix(stanceShoulderYaw, 0.24, reachDown), 0.18, cradleArms),
    leftElbowFlex: mix(
      mix(stanceElbowFlex, 0.56, reachDown),
      1.04,
      cradleArms,
    ),
    leftForearmYaw: mix(
      mix(stanceForearmYaw, 0.36, reachDown),
      0.64,
      cradleArms,
    ),
    rightShoulderPitch: mix(
      mix(stanceShoulderPitch, 0.24, reachDown),
      0.14,
      cradleArms,
    ),
    rightShoulderAdduct: mix(
      mix(stanceShoulderAdduct, 0.12, reachDown),
      0.14,
      cradleArms,
    ),
    rightShoulderYaw: mix(mix(stanceShoulderYaw, 0.24, reachDown), 0.16, cradleArms),
    rightElbowFlex: mix(
      mix(stanceElbowFlex, 0.56, reachDown),
      1.08,
      cradleArms,
    ),
    rightForearmYaw: mix(
      mix(stanceForearmYaw, 0.36, reachDown),
      0.66,
      cradleArms,
    ),
    breathPhase: breathPhase * (p < 0.72 ? 1.4 : 0.85),
    blush: mix(0.32 * stanceRamp, 0.74, smoothstep(0.14, 0.45, p)) * mix(1.0, 0.52, cradleArms),
  };

  if (p < 0.12) {
    return {
      motherPose,
      stage,
      babyPose: {
        visible: false,
        position: [0, -0.04, -0.02],
        rotationEuler: [0, Math.PI, Math.PI],
        fetalCurl: 1.0,
        limbStir: 0,
        canalClipActive: true,
        canalOutletY: -0.35,
      },
    };
  }

  let posX = 0;
  let posY = -0.04;
  let posZ = -0.025;
  let rotX = 0;
  let rotY = Math.PI;
  let rotZ = Math.PI;
  let fetalCurl = 1.0;
  let canalClipActive = true;
  let canalOutletY = -0.35;

  if (p < 0.36) {
    // Head crowning & head emergence first
    const t = smoothstep(0.12, 0.36, p);
    const crownY = mix(-0.35, -0.58, t);
    posY = crownY + 0.315;
    rotY = Math.PI - 0.35 * smoothstep(0.55, 1.0, t);
    canalClipActive = true;
    canalOutletY = -0.35;
  } else if (p < 0.72) {
    // External rotation & slow body emergence; guide baby forward out of knee zone near completion
    const t = smoothstep(0.36, 0.72, p);
    const crownY = mix(-0.58, -0.95, t);
    posY = crownY + 0.315;
    posZ = mix(-0.025, -0.20, smoothstep(0.45, 1.0, t));
    rotY = mix(Math.PI - 0.35, -0.35, smoothstep(0.0, 0.78, t));
    fetalCurl = mix(1.0, 0.72, smoothstep(0.65, 1.0, t));
    canalClipActive = t < 0.82;
    canalOutletY = mix(-0.35, -0.22, smoothstep(0.45, 0.82, t));
  } else {
    // First clear forward in front of thighs/belly (-0.20 -> -0.44), then lift cleanly up into cradled arms (-0.31)
    const tOut = smoothstep(0.72, 0.82, p);
    const tUp = smoothstep(0.78, 0.96, p);
    const tTuck = smoothstep(0.84, 0.98, p);
    posX = mix(0.0, 0.02, tUp);
    posY = mix(-0.635, 0.39, tUp);
    posZ = mix(mix(-0.20, -0.44, tOut), -0.355, tTuck);
    rotX = mix(0.0, 0.16, tUp);
    rotY = mix(-0.35, 0.25, tUp);
    rotZ = mix(Math.PI, 1.18, tUp);
    fetalCurl = mix(0.72, 0.30, tUp);
    canalClipActive = false;
  }

  const limbStir = p > 0.74 ? Math.sin(elapsedSec * 2.1) * 0.65 : 0;

  return {
    motherPose,
    stage,
    babyPose: {
      visible: true,
      position: [posX, posY, posZ],
      rotationEuler: [rotX, rotY, rotZ],
      fetalCurl,
      limbStir,
      canalClipActive,
      canalOutletY,
    },
  };
}

export function getZoneHoverLabel(zone: TouchZone): string {
  switch (zone) {
    case 'glute-right':
      return 'Sağ Kalça';
    case 'glute-left':
      return 'Sol Kalça';
    case 'chest':
      return 'Göğüs';
    case 'pelvis':
      return 'Pelvis (Doğumu Başlat)';
    case 'waist':
      return 'Bel Kıvrımı';
    case 'thigh':
      return 'Üst Bacak';
    case 'head':
      return 'Baş & Yüz';
    default:
      return '';
  }
}

export function getReactionLabel(zone: TouchZone): string {
  switch (zone) {
    case 'glute-left':
    case 'glute-right':
      return 'Utanıp kalçasını kıvırdı ve eliyle kapattı';
    case 'chest':
      return 'Utanıp göğsünü eliyle kapattı';
    case 'pelvis':
      return 'Ayaküstü doğum pozisyonu aldı';
    case 'waist':
      return 'Gıdıklanıp kıvırarak döndü';
    case 'thigh':
      return 'Utanıp bacaklarını toparladı';
    case 'head':
      return 'Utanarak başını çevirdi ve kızardı';
    default:
      return '';
  }
}

/**
 * Relaxed, affectionate bridal-carry posture when held in the male character's arms.
 */
export function getCarriedWomanPose(breathPhase: number): PoseState {
  return {
    ...NEUTRAL_POSE,
    kneeTuck: 0.72,
    torsoPitchX: -0.06,
    torsoTwistY: 0.14,
    torsoRollZ: -0.06,
    headPitchX: 0.14,
    headYawY: 0.36,
    headRollZ: -0.14,
    leftShoulderPitch: 0.68,
    leftShoulderAdduct: 0.14,
    leftShoulderYaw: 0.32,
    leftElbowFlex: 1.24,
    leftForearmYaw: 0.56,
    rightShoulderPitch: 0.42,
    rightShoulderAdduct: 0.12,
    rightShoulderYaw: 0.28,
    rightElbowFlex: 1.18,
    rightForearmYaw: 0.60,
    breathPhase,
    blush: 0.52,
  };
}

/**
 * Happy, warm, affectionate reaction when the male character kisses her ("kadın çok mutlu olur").
 */
export function getHappyKissReactionPose(breathPhase: number, dir = 1): PoseState {
  const d = dir >= 0 ? 1 : -1;
  return {
    ...NEUTRAL_POSE,
    hipSwayX: 0.048 * d,
    hipTwistY: 0.24 * d,
    kneeTuck: 0.18,
    torsoTwistY: 0.16 * d,
    torsoPitchX: -0.04,
    torsoRollZ: -0.06 * d,
    headPitchX: -0.06,
    headYawY: 0.62 * d,
    headRollZ: -0.10 * d,
    leftShoulderPitch: 0.16,
    leftShoulderAdduct: 0.08,
    leftShoulderYaw: 0.20,
    leftElbowFlex: 0.58,
    leftForearmYaw: 0.38,
    rightShoulderPitch: 0.16,
    rightShoulderAdduct: 0.08,
    rightShoulderYaw: 0.20,
    rightElbowFlex: 0.58,
    rightForearmYaw: 0.38,
    breathPhase: breathPhase * 1.25,
    blush: 0.82,
  };
}


