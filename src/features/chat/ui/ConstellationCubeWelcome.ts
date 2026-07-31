/Users/chenyan/.zprofile:1: no such file or directory: /opt/homebrew/bin/brew
/Users/chenyan/.zprofile:2: no such file or directory: /opt/homebrew/bin/brew
/Users/chenyan/.zprofile:3: no such file or directory: /opt/homebrew/bin/brew
import { PerspectiveCamera } from 'three/src/cameras/PerspectiveCamera.js';
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  NormalBlending,
  SRGBColorSpace,
} from 'three/src/constants.js';
import { Float32BufferAttribute } from 'three/src/core/BufferAttribute.js';
import { BufferGeometry } from 'three/src/core/BufferGeometry.js';
import type { Object3D } from 'three/src/core/Object3D.js';
import { LineBasicMaterial } from 'three/src/materials/LineBasicMaterial.js';
import type { Material } from 'three/src/materials/Material.js';
import { PointsMaterial } from 'three/src/materials/PointsMaterial.js';
import { SpriteMaterial } from 'three/src/materials/SpriteMaterial.js';
import { Euler } from 'three/src/math/Euler.js';
import { Quaternion } from 'three/src/math/Quaternion.js';
import { Vector3 } from 'three/src/math/Vector3.js';
import { Group } from 'three/src/objects/Group.js';
import { LineLoop } from 'three/src/objects/LineLoop.js';
import { LineSegments } from 'three/src/objects/LineSegments.js';
import { Points } from 'three/src/objects/Points.js';
import { Sprite } from 'three/src/objects/Sprite.js';
import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import { Scene } from 'three/src/scenes/Scene.js';
import { CanvasTexture } from 'three/src/textures/CanvasTexture.js';
import type { Texture } from 'three/src/textures/Texture.js';

import { getObsidianTheme, observeObsidianTheme } from './obsidianTheme';

export class ConstellationCubeWelcome {
  private wrapper: HTMLElement;
  private canvas: HTMLCanvasElement;
  private readonly ownerDocument: Document;
  private readonly ownerWindow: Window;
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: PerspectiveCamera;
  private cubeGroup: Group;
  private glowSprite: Sprite;
  private edges!: LineSegments;
  private orbits: { line: LineLoop; nightMaterial: LineBasicMaterial; dayMaterial: LineBasicMaterial }[] = [];
  private blocks: {
    group: Group;
    coord: Vector3;
    dots: Points;
    star: Points | null;
  }[] = [];

  private dotMatNight!: PointsMaterial;
  private dotMatDay!: PointsMaterial;
  private starMatNight!: PointsMaterial;
  private starMatDay!: PointsMaterial;
  private edgeMatNight!: LineBasicMaterial;
  private edgeMatDay!: LineBasicMaterial;

  private currentDotMat!: PointsMaterial;
  private currentStarMat!: PointsMaterial;

  private queue: { axis: number; layer: number; dir: number; duration: number }[] = [];
  private activeTwist: {
    axis: number;
    layer: number;
    dir: number;
    duration: number;
    pivot: Group;
    selected: { group: Group; coord: Vector3 }[];
    startedAt: number;
  } | null = null;

  private isDragging = false;
  private lastX = 0;
  private lastY = 0;
  private velocityX = 0;
  private velocityY = 0;

  private animFrameId: number | null = null;
  private lastDemoTime = 0;
  private isLightMode = false;
  private cleanupEvents: (() => void)[] = [];
  private isDestroyed = false;
  private isPaused = false;

  constructor(parentEl: HTMLElement) {
    this.wrapper = parentEl.createDiv({ cls: 'claudian-plus-welcome-cube-wrapper' });
    this.ownerDocument = this.wrapper.ownerDocument;
    this.ownerWindow = this.ownerDocument.defaultView ?? window;
    this.canvas = this.wrapper.createEl('canvas', { cls: 'claudian-plus-welcome-cube-canvas' });

    this.isLightMode = getObsidianTheme(this.ownerDocument) === 'light';

    // Initialize Three.js Engine
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(this.ownerWindow.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.isLightMode ? 0.95 : 1.08;

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0, 8.8);

    this.cubeGroup = new Group();
    const TILT_X = -0.46;
    const TILT_Y = 0.35;
    const TILT_Z = 0.14;
    this.cubeGroup.rotation.set(TILT_X, TILT_Y, TILT_Z);
    this.scene.add(this.cubeGroup);

    this.setupMaterials();
    this.buildCube();
    this.buildEdgesAndOrbits();

    // Center Glow Sprite
    const glowTex = this.createRadialTexture([
      [0, 'rgba(151,184,255,0.22)'],
      [0.32, 'rgba(114,148,245,0.09)'],
      [1, 'rgba(80,110,210,0)'],
    ]);
    this.glowSprite = new Sprite(
      new SpriteMaterial({
        map: glowTex,
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
      })
    );
    this.glowSprite.scale.set(7.5, 7.5, 1);
    this.glowSprite.renderOrder = -1;
    this.glowSprite.visible = !this.isLightMode;
    this.cubeGroup.add(this.glowSprite);

    this.cleanupEvents.push(observeObsidianTheme(this.ownerDocument, (theme) => {
      this.applyTheme(theme === 'light');
    }));
    this.setupEvents();
    this.onResize();
    this.animate(this.ownerWindow.performance.now());
  }

  private dotTexture(glow: boolean): CanvasTexture {
    // Clone the mounted canvas so the texture always belongs to the same
    // document (including Obsidian pop-out windows) without adding DOM nodes.
    const c = this.canvas.cloneNode(false) as HTMLCanvasElement;
    c.width = c.height = 96;
    const ctx = c.getContext('2d');
    if (!ctx) return new CanvasTexture(c);

    const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    if (glow) {
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.24, 'rgba(255,255,255,1)');
      g.addColorStop(0.48, 'rgba(220,232,255,0.58)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      g.addColorStop(0, 'rgba(40,45,55,1)');
      g.addColorStop(0.52, 'rgba(40,45,55,1)');
      g.addColorStop(0.76, 'rgba(40,45,55,0.3)');
      g.addColorStop(1, 'rgba(40,45,55,0)');
    }

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }

  private setupMaterials(): void {
    const texGlow = this.dotTexture(true);
    const texHard = this.dotTexture(false);

    this.dotMatNight = new PointsMaterial({
      size: 0.061,
      map: texGlow,
      transparent: true,
      alphaTest: 0.035,
      color: 0xf7f9ff,
      sizeAttenuation: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.dotMatDay = new PointsMaterial({
      size: 0.052,
      map: texHard,
      transparent: true,
      alphaTest: 0.04,
      color: 0x242833,
      sizeAttenuation: true,
      blending: NormalBlending,
      depthWrite: true,
    });

    this.starMatNight = new PointsMaterial({
      size: 0.21,
      map: texGlow,
      transparent: true,
      alphaTest: 0.035,
      color: 0xc9dcff,
      sizeAttenuation: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.starMatDay = new PointsMaterial({
      size: 0.15,
      map: texHard,
      transparent: true,
      alphaTest: 0.04,
      color: 0x27375f,
      sizeAttenuation: true,
      blending: NormalBlending,
      depthWrite: true,
    });

    this.addDepthFade(this.dotMatNight, 6.1, 13.2, 0.16);
    this.addDepthFade(this.dotMatDay, 6.1, 13.2, 0.1);
    this.addDepthFade(this.starMatNight, 6.1, 13.2, 0.28);
    this.addDepthFade(this.starMatDay, 6.1, 13.2, 0.2);

    this.currentDotMat = this.isLightMode ? this.dotMatDay : this.dotMatNight;
    this.currentStarMat = this.isLightMode ? this.starMatDay : this.starMatNight;
  }

  private applyTheme(isLightMode: boolean): void {
    if (this.isDestroyed || this.isLightMode === isLightMode) return;
    this.isLightMode = isLightMode;
    this.currentDotMat = isLightMode ? this.dotMatDay : this.dotMatNight;
    this.currentStarMat = isLightMode ? this.starMatDay : this.starMatNight;

    for (const block of this.blocks) {
      block.dots.material = this.currentDotMat;
      if (block.star) block.star.material = this.currentStarMat;
    }
    this.edges.material = isLightMode ? this.edgeMatDay : this.edgeMatNight;
    for (const orbit of this.orbits) {
      orbit.line.material = isLightMode ? orbit.dayMaterial : orbit.nightMaterial;
    }
    this.glowSprite.visible = !isLightMode;
    this.renderer.toneMappingExposure = isLightMode ? 0.95 : 1.08;

    if (this.isPaused) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private addDepthFade(material: PointsMaterial, near: number, far: number, minAlpha: number): void {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vDepthFade;')
        .replace('#include <fog_vertex>', `#include <fog_vertex>\nvDepthFade = mix(${minAlpha.toFixed(2)}, 1.0, 1.0 - smoothstep(${near.toFixed(1)}, ${far.toFixed(1)}, -mvPosition.z));`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDepthFade;')
        .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vDepthFade;\n#include <alphatest_fragment>');
    };
  }

  private blockDots(cx: number, cy: number, cz: number): BufferGeometry {
    const positions: number[] = [];
    const offsets: number[] = [];
    const GRID = 6;
    const HALF = 0.5;

    for (let i = 0; i < GRID; i++) {
      offsets.push((i / (GRID - 1) - 0.5) * 0.6);
    }

    const faces: [number, number, number][] = [];
    if (cx === 1) faces.push([1, 0, 0]);
    if (cx === -1) faces.push([-1, 0, 0]);
    if (cy === 1) faces.push([0, 1, 0]);
    if (cy === -1) faces.push([0, -1, 0]);
    if (cz === 1) faces.push([0, 0, 1]);
    if (cz === -1) faces.push([0, 0, -1]);

    for (const [dx, dy, dz] of faces) {
      for (const u of offsets) {
        for (const v of offsets) {
          let x: number, y: number, z: number;
          if (dx !== 0) {
            x = dx * HALF; y = u; z = v;
          } else if (dy !== 0) {
            x = u; y = dy * HALF; z = v;
          } else {
            x = u; y = v; z = dz * HALF;
          }
          positions.push(x, y, z);
        }
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return geometry;
  }

  private buildCube(): void {
    const GAP = 1.1;
    const HALF = 0.5;

    for (const block of this.blocks) {
      this.cubeGroup.remove(block.group);
    }
    this.blocks.length = 0;

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;

          const group = new Group();
          group.position.set(x * GAP, y * GAP, z * GAP);

          const dots = new Points(this.blockDots(x, y, z), this.currentDotMat);
          group.add(dots);

          let star: Points | null = null;
          if (x !== 0 && y !== 0 && z !== 0) {
            const geometry = new BufferGeometry();
            geometry.setAttribute('position', new Float32BufferAttribute([x * HALF, y * HALF, z * HALF], 3));
            star = new Points(geometry, this.currentStarMat);
            group.add(star);
          }

          this.cubeGroup.add(group);
          this.blocks.push({ group, coord: new Vector3(x, y, z), dots, star });
        }
      }
    }
  }

  private buildEdgesAndOrbits(): void {
    const GAP = 1.1;
    const HALF = 0.5;
    const C = HALF + GAP;
    const edgeVertices: number[] = [];

    for (const a of [-C, C]) {
      for (const b of [-C, C]) {
        edgeVertices.push(a, b, -C, a, b, C);
        edgeVertices.push(a, -C, b, a, C, b);
        edgeVertices.push(-C, a, b, C, a, b);
      }
    }

    const edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute('position', new Float32BufferAttribute(edgeVertices, 3));
    this.edgeMatNight = new LineBasicMaterial({ color: 0x9eb8ff, transparent: true, opacity: 0.27 });
    this.edgeMatDay = new LineBasicMaterial({ color: 0x33456f, transparent: true, opacity: 0.17 });
    this.edges = new LineSegments(edgeGeometry, this.isLightMode ? this.edgeMatDay : this.edgeMatNight);
    this.cubeGroup.add(this.edges);

    this.orbits = [
      this.createOrbit(3.55, 0.1, 1.18, 0.12),
      this.createOrbit(4.0, 0.055, 0.9, 1.15),
    ];
  }

  private createOrbit(radius: number, opacity: number, tiltX: number, tiltY: number) {
    const points: Vector3[] = [];
    const segments = 180;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
    }

    const geometry = new BufferGeometry().setFromPoints(points);
    const nightMaterial = new LineBasicMaterial({ color: 0x6c86ce, transparent: true, opacity });
    const dayMaterial = new LineBasicMaterial({ color: 0x526281, transparent: true, opacity: opacity * 0.7 });
    const line = new LineLoop(geometry, this.isLightMode ? dayMaterial : nightMaterial);
    line.rotation.set(tiltX, tiltY, 0);
    this.scene.add(line);
    return { line, nightMaterial, dayMaterial };
  }

  private createRadialTexture(stops: [number, string][]): CanvasTexture {
    const c = this.canvas.cloneNode(false) as HTMLCanvasElement;
    c.width = c.height = 512;
    const ctx = c.getContext('2d')!;
    const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    for (const [pos, color] of stops) gradient.addColorStop(pos, color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }

  private enqueueTwist(axis: number, layer: number, dir: number, duration = 430): void {
    this.queue.push({ axis, layer, dir, duration });
  }

  private startTwist(twist: { axis: number; layer: number; dir: number; duration: number }): void {
    const pivot = new Group();
    this.cubeGroup.add(pivot);
    const selected = this.blocks.filter((block) => Math.round(block.coord.getComponent(twist.axis)) === twist.layer);
    selected.forEach((block) => pivot.attach(block.group));
    this.activeTwist = { ...twist, pivot, selected, startedAt: this.ownerWindow.performance.now() };
  }

  private finishTwist(): void {
    if (!this.activeTwist) return;
    const { pivot, selected, axis, dir } = this.activeTwist;
    const AXIS_VEC = [
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ];

    pivot.updateMatrixWorld(true);

    selected.forEach((block) => {
      this.cubeGroup.attach(block.group);
      block.coord.applyAxisAngle(AXIS_VEC[axis], (dir * Math.PI) / 2);
      block.coord.set(Math.round(block.coord.x), Math.round(block.coord.y), Math.round(block.coord.z));
    });

    this.cubeGroup.remove(pivot);
    this.activeTwist = null;
  }

  private randomTwist(duration = 430): void {
    const randomInt = (max: number) => Math.floor(Math.random() * max);
    this.enqueueTwist(randomInt(3), randomInt(3) - 1, Math.random() < 0.5 ? 1 : -1, duration);
  }

  private setupEvents(): void {
    const onPointerDown = (event: PointerEvent) => {
      this.isDragging = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.velocityX = 0;
      this.velocityY = 0;
      this.canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!this.isDragging) return;
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.velocityX = dx * 0.0055;
      this.velocityY = dy * 0.0055;

      const quaternion = new Quaternion().setFromEuler(
        new Euler(dy * 0.0055, dx * 0.0055, 0, 'XYZ')
      );
      this.cubeGroup.quaternion.premultiply(quaternion);
    };

    const stopDragging = (event?: PointerEvent) => {
      this.isDragging = false;
      if (event?.pointerId !== undefined && this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    };

    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerup', stopDragging);
    this.canvas.addEventListener('pointercancel', stopDragging);

    const resizeObserver = new ResizeObserver(() => this.onResize());
    resizeObserver.observe(this.wrapper);

    this.cleanupEvents.push(() => {
      this.canvas.removeEventListener('pointerdown', onPointerDown);
      this.canvas.removeEventListener('pointermove', onPointerMove);
      this.canvas.removeEventListener('pointerup', stopDragging);
      this.canvas.removeEventListener('pointercancel', stopDragging);
      resizeObserver.disconnect();
    });
  }

  private onResize(): void {
    const width = this.wrapper.clientWidth || 200;
    const height = this.wrapper.clientHeight || 200;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  private animate(now: number): void {
    if (this.isDestroyed || this.isPaused) return;
    this.animFrameId = this.ownerWindow.requestAnimationFrame((t) => this.animate(t));

    const AXIS_VEC = [
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ];

    this.orbits[0].line.rotation.z = now * 0.000045;
    this.orbits[1].line.rotation.z = -now * 0.000032;

    if (!this.activeTwist && this.queue.length) {
      this.startTwist(this.queue.shift()!);
    }

    if (this.activeTwist) {
      const t = Math.min(1, (now - this.activeTwist.startedAt) / this.activeTwist.duration);
      this.activeTwist.pivot.setRotationFromAxisAngle(
        AXIS_VEC[this.activeTwist.axis],
        (this.activeTwist.dir * Math.PI) / 2 * this.easeInOutCubic(t)
      );
      if (t >= 1) this.finishTwist();
    }

    if (!this.activeTwist && this.queue.length < 2 && now - this.lastDemoTime > 2800) {
      this.lastDemoTime = now;
      this.randomTwist(470);
    }

    if (!this.isDragging) {
      this.cubeGroup.rotation.y += 0.0022;
      this.cubeGroup.rotation.x += this.velocityY * 0.018;
      this.cubeGroup.rotation.y += this.velocityX * 0.018;
      this.velocityX *= 0.94;
      this.velocityY *= 0.94;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Stops GPU work while preserving the welcome visual for a later revisit. */
  pause(): void {
    if (this.isDestroyed || this.isPaused) return;
    this.isPaused = true;
    if (this.animFrameId !== null) {
      this.ownerWindow.cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  resume(): void {
    if (this.isDestroyed || !this.isPaused) return;
    this.isPaused = false;
    this.animate(this.ownerWindow.performance.now());
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    if (this.animFrameId !== null) {
      this.ownerWindow.cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    for (const cleanup of this.cleanupEvents) {
      cleanup();
    }
    this.cleanupEvents = [];
    this.disposeSceneResources();
    this.renderer.dispose();
    this.wrapper.remove();
  }

  /** Releases scene-owned GPU allocations before disposing the renderer. */
  private disposeSceneResources(): void {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    const textures = new Set<Texture>();

    this.scene.traverse((object) => {
      const renderable = object as Object3D & {
        geometry?: BufferGeometry;
        material?: Material | Material[];
      };
      if (renderable.geometry) {
        geometries.add(renderable.geometry);
      }
      for (const material of Array.isArray(renderable.material)
        ? renderable.material
        : (renderable.material ? [renderable.material] : [])) {
        materials.add(material);
      }
    });

    for (const material of materials) {
      const map = (material as Material & { map?: Texture }).map;
      if (map) textures.add(map);
      material.dispose();
    }
    for (const geometry of geometries) {
      geometry.dispose();
    }
    for (const texture of textures) {
      texture.dispose();
    }
    this.scene.clear();
  }
}
