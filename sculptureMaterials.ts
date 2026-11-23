import * as THREE from 'three';
import { DrapeMode, MaterialPresetId } from '../types/sculpture';

export interface MaterialPresetConfig {
  id: MaterialPresetId;
  label: string;
  swatch: string;
  baseColor: string;
  subColor: string;
  sssColor: string;
  sssStrength: number;
  roughness: number;
  clearcoat: number;
  sheen: number;
  sheenColor: string;
  mode: number; // 0 = skin, 1 = marble, 2 = clay
}

export const MATERIAL_PRESETS: Record<MaterialPresetId, MaterialPresetConfig> = {
  'natural-skin': {
    id: 'natural-skin',
    label: 'Doğal Ten',
    swatch: '#d9a182',
    baseColor: '#d99e7e',
    subColor: '#c27b62',
    sssColor: '#e0533c',
    sssStrength: 0.42,
    roughness: 0.44,
    clearcoat: 0.14,
    sheen: 0.35,
    sheenColor: '#ffdcc8',
    mode: 0,
  },
  'caramel-skin': {
    id: 'caramel-skin',
    label: 'Bronz Ten',
    swatch: '#a86e4c',
    baseColor: '#a86c4b',
    subColor: '#824c34',
    sssColor: '#c9492e',
    sssStrength: 0.36,
    roughness: 0.38,
    clearcoat: 0.22,
    sheen: 0.30,
    sheenColor: '#f2b895',
    mode: 0,
  },
  'porcelain-skin': {
    id: 'porcelain-skin',
    label: 'Porselen Ten',
    swatch: '#ecc2af',
    baseColor: '#ecc0ac',
    subColor: '#d99888',
    sssColor: '#e85d52',
    sssStrength: 0.46,
    roughness: 0.45,
    clearcoat: 0.12,
    sheen: 0.38,
    sheenColor: '#ffe8df',
    mode: 0,
  },
  'carrara-marble': {
    id: 'carrara-marble',
    label: 'Carrara Mermeri',
    swatch: '#eae6df',
    baseColor: '#efece6',
    subColor: '#8f8b85',
    sssColor: '#f5e8d8',
    sssStrength: 0.16,
    roughness: 0.24,
    clearcoat: 0.28,
    sheen: 0.12,
    sheenColor: '#ffffff',
    mode: 1,
  },
  'sculptor-clay': {
    id: 'sculptor-clay',
    label: 'Heykel Kili',
    swatch: '#9c6852',
    baseColor: '#9c6650',
    subColor: '#754837',
    sssColor: '#b35b3e',
    sssStrength: 0.10,
    roughness: 0.58,
    clearcoat: 0.03,
    sheen: 0.10,
    sheenColor: '#d9a48f',
    mode: 2,
  },
};

export interface SculptureMaterialController {
  material: THREE.MeshPhysicalMaterial;
  wireMaterial: THREE.MeshBasicMaterial;
  applyPreset: (presetId: MaterialPresetId, drapeMode: DrapeMode, skinDew?: number) => void;
  setSkinDew: (skinDew: number) => void;
  setKeyLightDir: (dir: THREE.Vector3) => void;
  setReaction: (blush: number, touchPoint?: THREE.Vector3, touchFlash?: number) => void;
  dispose: () => void;
}

export function createSculptureMaterialController(options?: { isBaby?: boolean }): SculptureMaterialController {
  const isBaby = Boolean(options?.isBaby);
  const initial = MATERIAL_PRESETS['natural-skin'];
  let currentPresetId: MaterialPresetId = 'natural-skin';
  let currentDew = 0.38;

  const uniforms = {
    uBaseColor: { value: new THREE.Color(initial.baseColor) },
    uSubColor: { value: new THREE.Color(initial.subColor) },
    uSssColor: { value: new THREE.Color(initial.sssColor) },
    uSssStrength: { value: initial.sssStrength },
    uMode: { value: initial.mode },
    uDrapeMode: { value: 0.0 },
    uIsBaby: { value: isBaby ? 1.0 : 0.0 },
    uSkinDew: { value: currentDew },
    uKeyLightDir: { value: new THREE.Vector3(0.55, 0.58, 0.60).normalize() },
    uBlush: { value: 0.0 },
    uTouchPoint: { value: new THREE.Vector3(0, 0, 0) },
    uTouchFlash: { value: 0.0 },
  };

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffffff'),
    roughness: initial.roughness,
    metalness: 0.0,
    clearcoat: initial.clearcoat,
    clearcoatRoughness: 0.44,
    sheen: initial.sheen,
    sheenRoughness: 0.60,
    sheenColor: new THREE.Color(initial.sheenColor),
    ior: 1.42,
    envMapIntensity: 0.98,
  });

  material.customProgramCacheKey = () => 'atelier-sculpture-pbr-v6';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBaseColor = uniforms.uBaseColor;
    shader.uniforms.uSubColor = uniforms.uSubColor;
    shader.uniforms.uSssColor = uniforms.uSssColor;
    shader.uniforms.uSssStrength = uniforms.uSssStrength;
    shader.uniforms.uMode = uniforms.uMode;
    shader.uniforms.uDrapeMode = uniforms.uDrapeMode;
    shader.uniforms.uIsBaby = uniforms.uIsBaby;
    shader.uniforms.uSkinDew = uniforms.uSkinDew;
    shader.uniforms.uKeyLightDir = uniforms.uKeyLightDir;
    shader.uniforms.uBlush = uniforms.uBlush;
    shader.uniforms.uTouchPoint = uniforms.uTouchPoint;
    shader.uniforms.uTouchFlash = uniforms.uTouchFlash;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aAo;
        attribute vec3 aRestPos;
        varying float vAo;
        varying vec3 vRestPos;
        varying vec3 vNormalMat0;
        varying vec3 vNormalMat1;
        varying vec3 vNormalMat2;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vAo = aAo;
        vRestPos = aRestPos;
        vNormalMat0 = normalMatrix[0];
        vNormalMat1 = normalMatrix[1];
        vNormalMat2 = normalMatrix[2];`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uBaseColor;
        uniform vec3 uSubColor;
        uniform vec3 uSssColor;
        uniform float uSssStrength;
        uniform float uMode;
        uniform float uDrapeMode;
        uniform float uIsBaby;
        uniform float uSkinDew;
        uniform vec3 uKeyLightDir;
        uniform float uBlush;
        uniform vec3 uTouchPoint;
        uniform float uTouchFlash;

        varying float vAo;
        varying vec3 vRestPos;
        varying vec3 vNormalMat0;
        varying vec3 vNormalMat1;
        varying vec3 vNormalMat2;

        float hash31(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float noise3(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(
              mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
              mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x),
              f.y
            ),
            mix(
              mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
              mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x),
              f.y
            ),
            f.z
          );
        }

        float fbm3(vec3 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 3; i++) {
            v += a * noise3(p);
            p = p * 2.07 + vec3(13.1, 7.7, 5.3);
            a *= 0.5;
          }
          return v;
        }

        float poreRelief(vec3 p) {
          float scale = uIsBaby > 0.5 ? 2.2 : 1.0;
          float n1 = noise3(p * 64.0 * scale);
          float n2 = noise3(p * 136.0 * scale + 4.1);
          return (n1 * 0.58 + n2 * 0.42) - 0.5;
        }

        float computeHairMask(vec3 p) {
          if (uIsBaby > 0.5) return 0.0;
          float inHead = smoothstep(1.23, 1.29, p.y);
          float bunMask = smoothstep(0.108, 0.072, length((p - vec3(0.0, 1.332, 0.122)) * vec3(1.0, 0.96, 0.94)));
          float hairlineZ = -0.025 - 0.055 * smoothstep(1.37, 1.46, p.y) + 0.025 * smoothstep(0.05, 0.11, abs(p.x));
          float crownMask = inHead * smoothstep(hairlineZ - 0.015, hairlineZ + 0.025, p.z) * smoothstep(1.25, 1.33, p.y + p.z * 0.28);
          float topCap = smoothstep(1.425, 1.465, p.y);
          return clamp(max(bunMask, max(crownMask, topCap)), 0.0, 1.0);
        }

        // Procedural realistic almond eyes (sclera, hazel-amber iris fibers, pupil, upper lash & brow)
        void evalHumanEye(vec3 p, out float eyeMask, out vec3 eyeCol, out float browMask) {
          eyeMask = 0.0;
          eyeCol = vec3(0.0);
          browMask = 0.0;
          if (uIsBaby > 0.5 || p.y < 1.31 || p.z > -0.09) return;
          float ax = abs(p.x);
          vec2 eDelta = vec2(ax - 0.039, p.y - 1.353);
          // Gentle natural outward eye slant
          float slant = eDelta.x * 0.14;
          vec2 eu = vec2(eDelta.x, eDelta.y - slant);
          // Almond palpebral fissure
          float almondY = 0.0076 * max(0.0, 1.0 - pow(eu.x / 0.0165, 2.0));
          float eyeDist = abs(eu.y) - almondY;
          float inEye = smoothstep(0.0014, -0.0010, eyeDist) * smoothstep(0.0175, 0.0140, abs(eu.x));

          // Iris & pupil inside the almond opening
          float irisR = length(eu);
          float irisRing = smoothstep(0.0070, 0.0058, irisR);
          float angle = atan(eu.y, eu.x);
          float fiber = noise3(vec3(cos(angle) * 14.0, sin(angle) * 14.0, irisR * 260.0));
          vec3 irisCol = mix(vec3(0.24, 0.16, 0.09), vec3(0.46, 0.31, 0.15), 0.35 + 0.65 * fiber);
          float limbal = smoothstep(0.0050, 0.0068, irisR);
          irisCol = mix(irisCol, vec3(0.11, 0.08, 0.05), limbal * 0.72);
          float pupil = smoothstep(0.0033, 0.0023, irisR);
          irisCol = mix(irisCol, vec3(0.025, 0.022, 0.024), pupil);
          // Tiny crisp corneal catchlight
          float glint = smoothstep(0.0022, 0.0005, length(eu - vec2(-0.0022, 0.0022)));
          irisCol += vec3(0.75, 0.78, 0.82) * glint;

          vec3 scleraCol = vec3(0.93, 0.90, 0.88) * mix(0.76, 1.0, smoothstep(0.0165, 0.005, abs(eu.x)));
          // Upper lid cast shadow onto eyeball
          float topShade = smoothstep(0.001, 0.007, eu.y);
          vec3 ballCol = mix(scleraCol, irisCol, irisRing) * (1.0 - 0.24 * topShade);

          // Upper & subtle lower lash line
          float upperLash = smoothstep(0.0022, 0.0, abs(eu.y - almondY)) * smoothstep(0.0185, 0.013, abs(eu.x));
          float lowerLash = smoothstep(0.0014, 0.0, abs(eu.y + almondY)) * smoothstep(0.0155, 0.011, abs(eu.x)) * 0.45;
          float lash = clamp(upperLash + lowerLash, 0.0, 1.0);

          eyeMask = clamp(max(inEye, lash), 0.0, 1.0);
          eyeCol = mix(ballCol, vec3(0.075, 0.055, 0.048), lash);

          // Graceful arched eyebrows with hair micro-texture
          float browCenterY = 1.374 + 0.005 * sin(smoothstep(0.016, 0.060, ax) * 3.14159) - 0.004 * smoothstep(0.048, 0.064, ax);
          float bWidth = smoothstep(0.064, 0.046, ax) * smoothstep(0.014, 0.024, ax);
          float bThick = 0.0036 * mix(1.0, 0.48, smoothstep(0.028, 0.060, ax));
          float bRaw = smoothstep(bThick + 0.0015, bThick * 0.35, abs(p.y - browCenterY)) * bWidth;
          float bGrain = noise3(vec3(p.x * 260.0, p.y * 120.0, p.z * 80.0));
          browMask = clamp(bRaw * (0.55 + 0.45 * bGrain), 0.0, 1.0);
        }

        float computeDrapeMask(vec3 p) {
          if (uDrapeMode < 0.5 || uIsBaby > 0.5) return 0.0;
          float ax = abs(p.x);
          // Exclude poised outer arms/hands cleanly
          float torsoMask = smoothstep(0.42, 0.34, ax);
          float pelvisMask = smoothstep(0.51, 0.44, ax);

          // 1. Minimalist sculpted studio brief around hips & glutes
          float topWaist = 0.23 - 0.07 * smoothstep(0.0, 0.28, ax) + 0.05 * smoothstep(-0.08, 0.14, p.z);
          float inTop = smoothstep(topWaist + 0.006, topWaist - 0.006, p.y);
          float backCut = -0.22 + 0.14 * smoothstep(0.06, 0.24, ax);
          float frontCut = -0.26 + 0.17 * smoothstep(0.04, 0.24, ax);
          float botLine = mix(frontCut, backCut, smoothstep(-0.05, 0.10, p.z));
          float inBot = smoothstep(botLine - 0.006, botLine + 0.006, p.y);
          float brief = inTop * inBot * pelvisMask;

          // 2. Minimalist matching studio bandeau across chest/upper back
          float bandTop = smoothstep(0.835, 0.823, p.y);
          float bandBot = smoothstep(0.585, 0.597, p.y);
          float bandeau = bandTop * bandBot * torsoMask;

          return clamp(max(brief, bandeau), 0.0, 1.0);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float coordScale = uIsBaby > 0.5 ? 2.8 : 1.0;
        float macroVar = fbm3(vRestPos * 3.8 * coordScale);
        float microVar = noise3(vRestPos * 28.0 * coordScale);
        float drapeMask = computeDrapeMask(vRestPos);
        float hairMask = uMode < 0.5 ? computeHairMask(vRestPos) : 0.0;
        float eyeMask = 0.0;
        vec3 eyeCol = vec3(0.0);
        float browMask = 0.0;
        if (uMode < 0.5 && uIsBaby < 0.5) {
          evalHumanEye(vRestPos, eyeMask, eyeCol, browMask);
        }

        float blushAmount = 0.0;
        if (uIsBaby < 0.5) {
          float cheekDist = length((vRestPos - vec3(sign(vRestPos.x) * 0.056, 1.305, -0.095)) * vec3(1.0, 1.35, 1.1));
          float cheekBlush = smoothstep(0.092, 0.015, cheekDist);
          float earNapeBlush = smoothstep(0.95, 1.08, vRestPos.y) * smoothstep(1.32, 1.16, vRestPos.y) * smoothstep(0.16, 0.04, abs(vRestPos.x));
          float neckChestBlush = smoothstep(1.18, 0.96, vRestPos.y) * smoothstep(0.54, 0.86, vRestPos.y) * smoothstep(0.32, 0.14, abs(vRestPos.x));
          float touchFlush = smoothstep(0.32, 0.02, length(vRestPos - uTouchPoint)) * uTouchFlash;
          blushAmount = clamp(uBlush * (cheekBlush * 0.92 + earNapeBlush * 0.58 + neckChestBlush * 0.44) + touchFlush * 0.68, 0.0, 1.0);
        } else {
          // Soft rosy newborn cheek & warm skin flush
          float bCheekDist = length((vRestPos - vec3(sign(vRestPos.x) * 0.036, 0.214, -0.055)) * vec3(1.0, 1.25, 1.1));
          blushAmount = clamp(smoothstep(0.048, 0.008, bCheekDist) * 0.42 + uBlush * 0.28, 0.0, 1.0);
        }
        vec3 blushColor = vec3(0.88, 0.27, 0.27);

        if (uMode < 0.5) {
          vec3 skinCol = mix(uBaseColor, uSubColor, smoothstep(0.28, 0.78, macroVar) * 0.45);
          if (uIsBaby < 0.5) {
            float gluteWarmth = exp(-pow((vRestPos.y + 0.05) / 0.22, 2.0)) * smoothstep(0.02, 0.20, vRestPos.z);
            float kneeWarmth = exp(-pow((vRestPos.y + 0.80) / 0.09, 2.0)) * smoothstep(0.0, -0.08, vRestPos.z);
            skinCol = mix(skinCol, uSssColor * 0.92, 0.08 * smoothstep(0.4, 0.9, vAo) + 0.06 * (gluteWarmth + kneeWarmth));

            // Defined feminine lips with Cupid's bow & subtle central lip crease
            float axFace = abs(vRestPos.x);
            float lipCenterY = 1.258 + 0.0022 * cos(min(axFace / 0.026, 1.0) * 3.14159);
            float lipDist = length(vec3(vRestPos.x * 0.92, (vRestPos.y - lipCenterY) * 1.95, (vRestPos.z + 0.145) * 1.35));
            float lipMask = smoothstep(0.026, 0.011, lipDist) * smoothstep(-0.10, -0.135, vRestPos.z);
            float lipLine = smoothstep(0.0024, 0.0, abs(vRestPos.y - 1.257)) * smoothstep(0.022, 0.008, axFace);
            vec3 lipTone = mix(uSubColor, vec3(0.74, 0.32, 0.34), 0.72);
            skinCol = mix(skinCol, lipTone, lipMask * 0.78);
            skinCol *= 1.0 - 0.28 * lipLine * lipMask;

            // Subtle nostril shading & under-nose contour
            float nostril = smoothstep(0.0068, 0.0025, length((vec3(axFace, vRestPos.y, vRestPos.z) - vec3(0.0085, 1.309, -0.156)) * vec3(1.1, 1.4, 1.0)));
            skinCol *= 1.0 - 0.32 * nostril;

            // Tasteful artistic areola warmth on bust apex (when skin mode & undraped)
            float areolaDist = length((vec3(axFace, vRestPos.y, vRestPos.z) - vec3(0.135, 0.722, -0.312)) * vec3(1.0, 1.0, 0.65));
            float areolaMask = smoothstep(0.036, 0.018, areolaDist) * (1.0 - drapeMask);
            vec3 areolaTone = mix(uSubColor, vec3(0.68, 0.38, 0.34), 0.55);
            skinCol = mix(skinCol, areolaTone, areolaMask * 0.58);

            // Soft navel & delicate groin/pelvic warmth
            float navelAO = smoothstep(0.024, 0.005, length((vRestPos - vec3(0.0, 0.155, -0.249)) * vec3(1.1, 1.0, 0.6)));
            skinCol *= 1.0 - 0.24 * navelAO;
          } else {
            // Newborn soft warm skin, gentle closed sleeping lashes & rosy lips
            skinCol = mix(skinCol, uSssColor * 0.95, 0.14);
            float bAx = abs(vRestPos.x);
            float bLashCurve = 0.231 - 0.0025 * cos(clamp((bAx - 0.022) / 0.011, -1.0, 1.0) * 1.57);
            float bLash = smoothstep(0.0018, 0.0, abs(vRestPos.y - bLashCurve)) * smoothstep(0.013, 0.008, abs(bAx - 0.022)) * smoothstep(-0.068, -0.080, vRestPos.z);
            skinCol = mix(skinCol, vec3(0.18, 0.12, 0.10), bLash * 0.68);
            float bLip = smoothstep(0.014, 0.005, length((vRestPos - vec3(0.0, 0.206, -0.088)) * vec3(0.85, 1.8, 1.2)));
            skinCol = mix(skinCol, vec3(0.82, 0.44, 0.44), bLip * 0.55);
          }

          skinCol = mix(skinCol, blushColor, blushAmount * (1.0 - hairMask) * (1.0 - eyeMask) * 0.54);
          skinCol *= 0.965 + 0.06 * microVar;
          skinCol *= mix(0.66, 1.0, vAo);

          if (browMask > 0.001) {
            skinCol = mix(skinCol, vec3(0.14, 0.10, 0.08), browMask * 0.85);
          }
          if (eyeMask > 0.001) {
            skinCol = mix(skinCol, eyeCol, eyeMask);
          }

          if (hairMask > 0.001) {
            float strandVar = noise3(vec3(vRestPos.x * 95.0, vRestPos.y * 45.0, vRestPos.z * 95.0));
            vec3 hairBase = vec3(0.115, 0.082, 0.068) * (0.85 + 0.32 * strandVar);
            skinCol = mix(skinCol, hairBase, hairMask);
          }

          diffuseColor.rgb *= skinCol;
        } else if (uMode < 1.5) {
          float warp = fbm3(vRestPos * 4.2 * coordScale);
          float vein = abs(sin((vRestPos.x * 4.2 + vRestPos.y * 2.6 + vRestPos.z * 3.1) * coordScale + warp * 5.2));
          float veinLine = pow(1.0 - smoothstep(0.0, 0.28, vein), 2.4);
          vec3 marbleCol = mix(uBaseColor, uSubColor, veinLine * 0.55);
          marbleCol = mix(marbleCol, vec3(0.95, 0.62, 0.60), blushAmount * 0.26);
          marbleCol *= 0.96 + 0.04 * macroVar;
          marbleCol *= mix(0.76, 1.0, vAo);
          diffuseColor.rgb *= marbleCol;
        } else {
          float clayGrain = fbm3(vRestPos * 14.0 * coordScale);
          vec3 clayCol = mix(uBaseColor, uSubColor, (1.0 - vAo) * 0.55 + clayGrain * 0.14);
          clayCol = mix(clayCol, blushColor, blushAmount * 0.22);
          diffuseColor.rgb *= clayCol;
        }

        if (drapeMask > 0.001) {
          float weave = noise3(vRestPos * 140.0);
          vec3 fabricCol = vec3(0.085, 0.078, 0.088) * (0.94 + 0.12 * weave);
          diffuseColor.rgb = mix(diffuseColor.rgb, fabricCol, drapeMask);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float rScale = uIsBaby > 0.5 ? 2.5 : 1.0;
        float rMicro = noise3(vRestPos * 52.0 * rScale);
        float drapeR = computeDrapeMask(vRestPos);
        float hairR = uMode < 0.5 ? computeHairMask(vRestPos) : 0.0;
        float eyeR = 0.0;
        if (uMode < 0.5 && uIsBaby < 0.5) {
          vec3 _ec;
          float _bm;
          evalHumanEye(vRestPos, eyeR, _ec, _bm);
        }
        if (uMode < 0.5) {
          roughnessFactor = clamp(roughnessFactor + (rMicro - 0.5) * 0.09 - (1.0 - vAo) * 0.04 - (uSkinDew - 0.38) * 0.16, 0.20, 0.72);
          roughnessFactor = mix(roughnessFactor, 0.52, hairR);
          roughnessFactor = mix(roughnessFactor, 0.06, eyeR * 0.85);
        } else if (uMode < 1.5) {
          roughnessFactor = clamp(roughnessFactor + (rMicro - 0.5) * 0.06, 0.14, 0.42);
        } else {
          roughnessFactor = clamp(roughnessFactor + (rMicro - 0.5) * 0.08, 0.42, 0.78);
        }
        roughnessFactor = mix(roughnessFactor, 0.66, drapeR);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float eps = uIsBaby > 0.5 ? 0.0012 : 0.0025;
          float h0 = poreRelief(vRestPos);
          vec3 objGrad = vec3(
            poreRelief(vRestPos + vec3(eps, 0.0, 0.0)) - h0,
            poreRelief(vRestPos + vec3(0.0, eps, 0.0)) - h0,
            poreRelief(vRestPos + vec3(0.0, 0.0, eps)) - h0
          ) / eps;
          vec3 rawViewGrad = vNormalMat0 * objGrad.x + vNormalMat1 * objGrad.y + vNormalMat2 * objGrad.z;
          float gradLen = length(rawViewGrad);
          vec3 viewGrad = gradLen > 1e-4 ? rawViewGrad / gradLen : vec3(0.0);
          vec3 tangentBump = viewGrad - normal * dot(normal, viewGrad);
          float bumpAmp = uMode < 0.5 ? 0.030 : (uMode < 1.5 ? 0.008 : 0.024);
          if (uIsBaby > 0.5) bumpAmp *= 0.55;
          float drapeB = computeDrapeMask(vRestPos);
          float hairB = uMode < 0.5 ? computeHairMask(vRestPos) : 0.0;
          bumpAmp = mix(bumpAmp, 0.052, max(drapeB, hairB));
          normal = normalize(normal - tangentBump * bumpAmp);
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 viewLightDir = normalize((viewMatrix * vec4(uKeyLightDir, 0.0)).xyz);
          float ndotl = dot(geometryNormal, viewLightDir);
          float wrap = smoothstep(-0.55, 0.45, ndotl) * (1.0 - smoothstep(-0.05, 0.65, ndotl));
          float fresnel = pow(1.0 - clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0), 3.0);
          float drapeSss = computeDrapeMask(vRestPos);
          float hairSss = uMode < 0.5 ? computeHairMask(vRestPos) : 0.0;
          float sssAmt = uSssStrength * (1.0 - max(drapeSss, hairSss)) * mix(0.35, 1.0, vAo);
          reflectedLight.directDiffuse += uSssColor * wrap * sssAmt * 0.68;
          reflectedLight.indirectDiffuse += uSssColor * fresnel * sssAmt * 0.22;
          reflectedLight.indirectDiffuse *= mix(0.64, 1.0, vAo);
        }`,
      );
  };

  const wireMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#e5b88b'),
    wireframe: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });

  const syncClearcoat = () => {
    const cfg = MATERIAL_PRESETS[currentPresetId];
    if (cfg.mode === 0) {
      material.clearcoat = THREE.MathUtils.clamp(cfg.clearcoat + (currentDew - 0.38) * 0.42, 0.04, 0.55);
      material.clearcoatRoughness = THREE.MathUtils.clamp(0.46 - currentDew * 0.18, 0.22, 0.58);
    } else {
      material.clearcoat = cfg.clearcoat;
      material.clearcoatRoughness = 0.40;
    }
  };

  const applyPreset = (presetId: MaterialPresetId, drapeMode: DrapeMode, skinDew?: number) => {
    currentPresetId = presetId;
    if (typeof skinDew === 'number') {
      currentDew = skinDew;
      uniforms.uSkinDew.value = skinDew;
    }
    const cfg = MATERIAL_PRESETS[presetId];
    uniforms.uBaseColor.value.set(cfg.baseColor);
    uniforms.uSubColor.value.set(cfg.subColor);
    uniforms.uSssColor.value.set(cfg.sssColor);
    uniforms.uSssStrength.value = cfg.sssStrength;
    uniforms.uMode.value = cfg.mode;
    uniforms.uDrapeMode.value = !isBaby && drapeMode === 'studio-band' ? 1.0 : 0.0;

    material.roughness = cfg.roughness;
    material.sheen = cfg.sheen;
    material.sheenColor.set(cfg.sheenColor);
    syncClearcoat();
  };

  const setSkinDew = (skinDew: number) => {
    currentDew = skinDew;
    uniforms.uSkinDew.value = skinDew;
    syncClearcoat();
  };

  const setKeyLightDir = (dir: THREE.Vector3) => {
    uniforms.uKeyLightDir.value.copy(dir).normalize();
  };

  const setReaction = (blush: number, touchPoint?: THREE.Vector3, touchFlash?: number) => {
    uniforms.uBlush.value = blush;
    if (touchPoint) {
      uniforms.uTouchPoint.value.copy(touchPoint);
    }
    if (typeof touchFlash === 'number') {
      uniforms.uTouchFlash.value = touchFlash;
    }
  };

  const dispose = () => {
    material.dispose();
    wireMaterial.dispose();
  };

  return {
    material,
    wireMaterial,
    applyPreset,
    setSkinDew,
    setKeyLightDir,
    setReaction,
    dispose,
  };
}
