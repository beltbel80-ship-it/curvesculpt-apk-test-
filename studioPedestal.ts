import * as THREE from 'three';

export interface StudioStage {
  pedestalGroup: THREE.Group;
  floorMesh: THREE.Mesh;
  dispose: () => void;
}

function createRadialShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 12, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(0, 0, 0, 0.76)');
  grad.addColorStop(0.45, 'rgba(0, 0, 0, 0.36)');
  grad.addColorStop(0.78, 'rgba(0, 0, 0, 0.08)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createFloorPoolTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 16, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(232, 198, 168, 0.26)');
  grad.addColorStop(0.45, 'rgba(210, 170, 138, 0.11)');
  grad.addColorStop(0.82, 'rgba(180, 140, 115, 0.02)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Full-figure gallery plinth positioned so the figure's soles (y = -1.44)
 * rest flush on the top satin-obsidian deck.
 */
export function createStudioStage(maxAnisotropy: number): StudioStage {
  const pedestalGroup = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];

  // 1. Stepped Basalt / Dark Travertine Plinth Base (y = -1.66 to -1.46)
  const plinthPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.84, 0.0),
    new THREE.Vector2(0.84, 0.052),
    new THREE.Vector2(0.79, 0.082),
    new THREE.Vector2(0.71, 0.092),
    new THREE.Vector2(0.68, 0.175),
    new THREE.Vector2(0.62, 0.20),
    new THREE.Vector2(0.0, 0.20),
  ];
  const plinthGeo = new THREE.LatheGeometry(plinthPoints, 84);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#232025'),
    roughness: 0.80,
    metalness: 0.08,
  });
  const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
  plinthMesh.position.y = -1.66;
  plinthMesh.castShadow = true;
  plinthMesh.receiveShadow = true;
  pedestalGroup.add(plinthMesh);
  disposables.push(plinthGeo, plinthMat);

  // 2. Brushed Champagne-Brass Turntable Bezel Collar
  const brassPoints = [
    new THREE.Vector2(0.55, 0.20),
    new THREE.Vector2(0.63, 0.20),
    new THREE.Vector2(0.63, 0.222),
    new THREE.Vector2(0.60, 0.232),
    new THREE.Vector2(0.54, 0.232),
    new THREE.Vector2(0.54, 0.20),
  ];
  const brassGeo = new THREE.LatheGeometry(brassPoints, 84);
  const brassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#c8a477'),
    roughness: 0.24,
    metalness: 0.92,
    anisotropy: 0.78,
  });
  const brassMesh = new THREE.Mesh(brassGeo, brassMat);
  brassMesh.position.y = -1.66;
  brassMesh.castShadow = true;
  brassMesh.receiveShadow = true;
  pedestalGroup.add(brassMesh);
  disposables.push(brassGeo, brassMat);

  // 3. Satin Obsidian Top Deck (top surface at y = -1.438, supporting feet at -1.44)
  const deckGeo = new THREE.CylinderGeometry(0.54, 0.54, 0.025, 72);
  const deckMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#161418'),
    roughness: 0.42,
    metalness: 0.22,
  });
  const deckMesh = new THREE.Mesh(deckGeo, deckMat);
  deckMesh.position.y = -1.45;
  deckMesh.receiveShadow = true;
  pedestalGroup.add(deckMesh);
  disposables.push(deckGeo, deckMat);

  // 4. Subtle Brushed Brass Inner Footplate Ring Accent
  const inlayGeo = new THREE.RingGeometry(0.45, 0.464, 72);
  const inlayMesh = new THREE.Mesh(inlayGeo, brassMat);
  inlayMesh.rotation.x = -Math.PI / 2;
  inlayMesh.position.y = -1.436;
  pedestalGroup.add(inlayMesh);
  disposables.push(inlayGeo);

  // 5. Contact Shadow Plane directly beneath plinth
  const shadowTex = createRadialShadowTexture();
  shadowTex.anisotropy = maxAnisotropy;
  const contactGeo = new THREE.PlaneGeometry(2.75, 2.75);
  const contactMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.88,
  });
  const contactMesh = new THREE.Mesh(contactGeo, contactMat);
  contactMesh.rotation.x = -Math.PI / 2;
  contactMesh.position.y = -1.655;
  pedestalGroup.add(contactMesh);
  disposables.push(shadowTex, contactGeo, contactMat);

  // 6. Subtle Gallery Floor Light Pool around plinth
  const poolTex = createFloorPoolTexture();
  poolTex.anisotropy = maxAnisotropy;
  const poolGeo = new THREE.PlaneGeometry(6.8, 6.8);
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  });
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.rotation.x = -Math.PI / 2;
  poolMesh.position.y = -1.658;
  pedestalGroup.add(poolMesh);
  disposables.push(poolTex, poolGeo, poolMat);

  // Studio Matte Floor Plane (y = -1.66)
  const floorGeo = new THREE.CircleGeometry(18, 64);
  const floorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#141216'),
    roughness: 0.92,
    metalness: 0.04,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -1.66;
  floorMesh.receiveShadow = true;
  disposables.push(floorGeo, floorMat);

  return {
    pedestalGroup,
    floorMesh,
    dispose: () => {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
