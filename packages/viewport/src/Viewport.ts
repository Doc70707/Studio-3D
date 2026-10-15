import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { placeCamera, type Bounds, type StandardView } from "./views";

export interface ViewportOptions {
  /** Build plate size in millimetres. */
  plateWidth?: number;
  plateDepth?: number;
}

/** Triangles and edge lines to display. Plain arrays, so the viewport needs no geometry code. */
export interface DisplayMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
}

/** Pixels along each edge of the view that floating panels cover. The scene is centred and fitted in the rest. */
export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CameraState {
  view: StandardView | "custom";
  position: [number, number, number];
  target: [number, number, number];
}

const FOV = 45;

/** True when this browser/webview can create a WebGL2 context. */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
}

/**
 * The 3D view: scene, camera, orbit/pan/zoom and standard views.
 * It only displays things. Geometry changes never happen here.
 */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20000);
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private plateBounds: Bounds;
  private view: StandardView | "custom" = "iso";
  private frameRequested = false;
  private listeners = new Set<(s: CameraState) => void>();
  private model: THREE.Group | null = null;
  private safeArea: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Vertical field of view and aspect of the uncovered area, used to fit standard views. */
  private fit = { fov: FOV, aspect: 1 };

  constructor(private readonly container: HTMLElement, options: ViewportOptions = {}) {
    const w = options.plateWidth ?? 256;
    const d = options.plateDepth ?? 256;
    this.plateBounds = { min: [-w / 2, -d / 2, 0], max: [w / 2, d / 2, 0] };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0); // transparent: the page's background shows behind the scene
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute("data-testid", "viewport-canvas");
    container.appendChild(this.renderer.domElement);

    this.camera.up.set(0, 0, 1);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(200, -300, 400);
    this.scene.add(sun);
    this.scene.add(buildPlate(w, d));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener("change", () => {
      this.view = "custom";
      this.requestRender();
    });
    this.controls.addEventListener("start", () => (this.view = "custom"));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.setView("iso");
  }

  setView(view: StandardView): void {
    const p = placeCamera(view, this.plateBounds, this.fit.fov, this.fit.aspect);
    this.camera.up.set(...p.up);
    this.camera.position.set(...p.position);
    this.controls.target.set(...p.target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.view = view;
    this.requestRender();
  }

  /** Shows a model, replacing the previous one. Pass null to clear. */
  setModel(mesh: DisplayMesh | null): void {
    if (this.model) {
      this.scene.remove(this.model);
      disposeObject(this.model);
      this.model = null;
    }
    if (mesh) {
      const group = new THREE.Group();
      group.name = "model";
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
      g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      const surface = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({ color: 0x6cb4ff, roughness: 0.45, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
      );
      group.add(surface);
      const e = new THREE.BufferGeometry();
      e.setAttribute("position", new THREE.BufferAttribute(mesh.edges, 3));
      group.add(new THREE.LineSegments(e, new THREE.LineBasicMaterial({ color: 0x123a6b })));
      this.scene.add(group);
      this.model = group;
    }
    this.requestRender();
  }

  /** Keeps the scene centred in the part of the view that floating panels don't cover. */
  setSafeArea(area: SafeArea): void {
    const same = (Object.keys(area) as (keyof SafeArea)[]).every((k) => Math.round(area[k]) === Math.round(this.safeArea[k]));
    if (same) return;
    this.safeArea = { ...area };
    this.resize();
    if (this.view !== "custom") this.setView(this.view);
  }

  getCameraState(): CameraState {
    const r = (n: number) => Math.round(n * 1000) / 1000 + 0; // "+ 0" turns -0 into 0
    const { x, y, z } = this.camera.position;
    const t = this.controls.target;
    return { view: this.view, position: [r(x), r(y), r(z)], target: [r(t.x), r(t.y), r(t.z)] };
  }

  onCameraChange(fn: (s: CameraState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    // Render a larger virtual frame whose centre is the centre of the uncovered area.
    const { top, right, bottom, left } = this.safeArea;
    const visW = Math.max(w - left - right, w * 0.3);
    const visH = Math.max(h - top - bottom, h * 0.3);
    const dx = left - right;
    const dy = top - bottom;
    const fullW = w + Math.abs(dx);
    const fullH = h + Math.abs(dy);
    this.camera.aspect = fullW / fullH;
    if (dx === 0 && dy === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(fullW, fullH, dx < 0 ? -dx : 0, dy < 0 ? -dy : 0, w, h);
    this.camera.updateProjectionMatrix();
    const half = (FOV * Math.PI) / 360;
    this.fit = { fov: (2 * Math.atan(Math.tan(half) * (visH / fullH)) * 180) / Math.PI, aspect: visW / visH };
    this.requestRender();
  }

  // Render only when something changed, so an idle app uses no GPU.
  private requestRender(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.renderer.render(this.scene, this.camera);
      const s = this.getCameraState();
      this.listeners.forEach((fn) => fn(s));
    });
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}

/** Build plate: a flat surface with 10 mm and 50 mm grid lines and X/Y axis lines through the origin. */
function buildPlate(width: number, depth: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "build-plate";

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: 0x1b2233, roughness: 0.9, transparent: true, opacity: 0.72 }),
  );
  surface.position.z = -0.01;
  group.add(surface);

  const minor: number[] = [];
  const major: number[] = [];
  const line = (arr: number[], x1: number, y1: number, x2: number, y2: number) => arr.push(x1, y1, 0, x2, y2, 0);
  for (let x = -width / 2; x <= width / 2 + 1e-9; x += 10) line(Math.abs(x % 50) < 1e-9 ? major : minor, x, -depth / 2, x, depth / 2);
  for (let y = -depth / 2; y <= depth / 2 + 1e-9; y += 10) line(Math.abs(y % 50) < 1e-9 ? major : minor, -width / 2, y, width / 2, y);

  const lines = (pts: number[], color: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
  };
  group.add(lines(minor, 0x2f3a52));
  group.add(lines(major, 0x4a5878));
  group.add(lines([-width / 2, 0, 0.02, width / 2, 0, 0.02], 0xd9534f)); // X axis, red
  group.add(lines([0, -depth / 2, 0.02, 0, depth / 2, 0.02], 0x5cb85c)); // Y axis, green
  return group;
}
