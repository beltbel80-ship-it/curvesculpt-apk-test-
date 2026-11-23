export type MaterialPresetId =
  | 'natural-skin'
  | 'caramel-skin'
  | 'porcelain-skin'
  | 'carrara-marble'
  | 'sculptor-clay';

export type LightingPresetId = 'studio-softbox' | 'golden-hour' | 'gallery-dramatic';

export type CameraPresetId =
  | 'three-quarter-back'
  | 'posterior'
  | 'side-profile'
  | 'glute-closeup'
  | 'anterior'
  | 'portrait-upper'
  | 'birth-closeup';

export type DrapeMode = 'anatomical' | 'studio-band';

export type TouchStyle = 'gentle' | 'playful' | 'shy';

export type BirthStage = 'idle' | 'stance' | 'crowning' | 'emerging' | 'lifting' | 'cradling';

export type TouchZone =
  | 'none'
  | 'glute-left'
  | 'glute-right'
  | 'chest'
  | 'pelvis'
  | 'waist'
  | 'thigh'
  | 'head';

export interface PoseState {
  // Hip wiggle & twist ("kıvırma")
  hipSwayX: number;
  hipTwistY: number;
  kneeTuck: number;
  // Standing birth stance & pelvic opening ("ayaküstü doğum pozisyonu")
  birthStance: number;
  birthBelly: number;
  // Upper torso shy curl
  torsoTwistY: number;
  torsoPitchX: number;
  torsoRollZ: number;
  // Head bashful tilt ("utanma")
  headPitchX: number;
  headYawY: number;
  headRollZ: number;
  // Left & Right arm cover ("eliyle kapatma")
  leftShoulderPitch: number;
  leftShoulderAdduct: number;
  leftShoulderYaw: number;
  leftElbowFlex: number;
  leftForearmYaw: number;
  rightShoulderPitch: number;
  rightShoulderAdduct: number;
  rightShoulderYaw: number;
  rightElbowFlex: number;
  rightForearmYaw: number;
  // Soft-tissue spring jiggle & living breath
  jiggleRightX: number;
  jiggleRightY: number;
  jiggleRightZ: number;
  jiggleLeftX: number;
  jiggleLeftY: number;
  jiggleLeftZ: number;
  jiggleBustY: number;
  jiggleBustZ: number;
  breathPhase: number;
  // Shader blush intensity (0..1)
  blush: number;
}

export const NEUTRAL_POSE: PoseState = {
  hipSwayX: 0,
  hipTwistY: 0,
  kneeTuck: 0,
  birthStance: 0,
  birthBelly: 0,
  torsoTwistY: 0,
  torsoPitchX: 0,
  torsoRollZ: 0,
  headPitchX: 0,
  headYawY: 0,
  headRollZ: 0,
  leftShoulderPitch: 0,
  leftShoulderAdduct: 0,
  leftShoulderYaw: 0,
  leftElbowFlex: 0,
  leftForearmYaw: 0,
  rightShoulderPitch: 0,
  rightShoulderAdduct: 0,
  rightShoulderYaw: 0,
  rightElbowFlex: 0,
  rightForearmYaw: 0,
  jiggleRightX: 0,
  jiggleRightY: 0,
  jiggleRightZ: 0,
  jiggleLeftX: 0,
  jiggleLeftY: 0,
  jiggleLeftZ: 0,
  jiggleBustY: 0,
  jiggleBustZ: 0,
  breathPhase: 0,
  blush: 0,
};

export interface SculptParams {
  waistCinched: number;     // 0..1 (default 0.72 - dramatic hourglass waist)
  hipWidth: number;         // 0..1 (default 0.78 - wide curvy hips)
  gluteVolume: number;      // 0..1 (default 0.85 - very curvy, lush glutes)
  gluteLift: number;        // 0..1 (default 0.62 - sculpted lift & round upper shelf)
  softFullness: number;     // 0..1 (default 0.82 - "balık etli" lush thighs & hip softness)
  lumbarArch: number;       // 0..1 (default 0.74 - deep S-curve lordosis)
}

export interface SilhouettePreset {
  id: string;
  label: string;
  params: SculptParams;
}

export const DEFAULT_SCULPT_PARAMS: SculptParams = {
  waistCinched: 0.76,
  hipWidth: 0.82,
  gluteVolume: 0.86,
  gluteLift: 0.64,
  softFullness: 0.84,
  lumbarArch: 0.76,
};

export const SILHOUETTE_PRESETS: SilhouettePreset[] = [
  {
    id: 'kivrimli-balik-etli',
    label: 'Kıvrımlı & Balık Etli',
    params: { ...DEFAULT_SCULPT_PARAMS },
  },
  {
    id: 'kum-saati',
    label: 'Belirgin Kum Saati',
    params: {
      waistCinched: 0.92,
      hipWidth: 0.86,
      gluteVolume: 0.88,
      gluteLift: 0.74,
      softFullness: 0.72,
      lumbarArch: 0.84,
    },
  },
  {
    id: 'dolgun-klasik',
    label: 'Dolgun Klasik',
    params: {
      waistCinched: 0.54,
      hipWidth: 0.88,
      gluteVolume: 0.84,
      gluteLift: 0.50,
      softFullness: 0.95,
      lumbarArch: 0.66,
    },
  },
  {
    id: 'atletik-kivrim',
    label: 'Atletik Form',
    params: {
      waistCinched: 0.74,
      hipWidth: 0.66,
      gluteVolume: 0.72,
      gluteLift: 0.84,
      softFullness: 0.52,
      lumbarArch: 0.72,
    },
  },
];
