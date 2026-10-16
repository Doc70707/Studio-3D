import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { boundsRadius, placeCamera, type Bounds, type StandardView } from "./views";
import { dimensionLines, labelPoint, type Dimension } from "./dimensions";

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
  /** What the standard views frame: the part with room around it for its measurements, or the plate when empty. */
  private framed: Bounds | null = null;
  private partBounds: Bounds | null = null;
  private view: StandardView | "custom" = "iso";
  private frameRequested = false;
  private listeners = new Set<(s: CameraState) => void>();
  private model: THREE.Group | null = null;
  private surface: THREE.Mesh | null = null;
  private highlight: THREE.Mesh | null = null;
  private sketchLines: THREE.LineSegments | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private dimensionGroup: THREE.Group | null = null;
  private labels: { el: HTMLElement; at: THREE.Vector3 }[] = [];
  private readonly labelLayer: HTMLDivElement;
  private safeArea: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Vertical field of view and aspect of the uncovered area, used to fit standard views. */
  private fit = { fov: FOV, aspect: 1 };

  constructor(
    private readonly container: HTMLElement,
    options: ViewportOptions = {},
  ) {
    const w = options.plateWidth ?? 256;
    const d = options.plateDepth ?? 256;
    this.plateBounds = { min: [-w / 2, -d / 2, 0], max: [w / 2, d / 2, 0] };

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x000000, 0); // transparent: the page's background shows behind the scene
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute("data-testid", "viewport-canvas");
    container.appendChild(this.renderer.domElement);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "dimension-labels";
    container.appendChild(this.labelLayer);

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
    if (this.partBounds) this.framed = roomAround(this.partBounds);
    const p = placeCamera(view, this.framed ?? this.plateBounds, this.fit.fov, this.fit.aspect);
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
      this.surface = null;
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
        new THREE.MeshStandardMaterial({
          color: 0x6cb4ff,
          roughness: 0.45,
          metalness: 0.05,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      group.add(surface);
      this.surface = surface;
      const e = new THREE.BufferGeometry();
      e.setAttribute("position", new THREE.BufferAttribute(mesh.edges, 3));
      group.add(new THREE.LineSegments(e, new THREE.LineBasicMaterial({ color: 0x123a6b })));
      this.scene.add(group);
      this.model = group;
    }
    this.requestRender();
  }

  /**
   * Which triangle of the model is under a point of the window (in client pixels), or null.
   * Triangles are numbered in the order of the mesh's index list.
   */
  pickTriangle(clientX: number, clientY: number): number | null {
    if (!this.surface) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.surface, false)[0];
    return hit?.faceIndex ?? null;
  }

  /** Tints some triangles (corner positions, three per triangle) to show what the pointer is over. Null clears it. */
  setHighlight(positions: Float32Array | null): void {
    if (this.highlight) {
      this.scene.remove(this.highlight);
      disposeObject(this.highlight);
      this.highlight = null;
    }
    if (positions && positions.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      this.highlight = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          color: 0xffc94d,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      this.highlight.name = "highlight";
      this.highlight.renderOrder = 2;
      this.scene.add(this.highlight);
    }
    this.requestRender();
  }

  /** Draws a sketch's outlines (pairs of points) on top of everything. Null clears them. */
  setSketchLines(lines: Float32Array | null): void {
    if (this.sketchLines) {
      this.scene.remove(this.sketchLines);
      disposeObject(this.sketchLines);
      this.sketchLines = null;
    }
    if (lines && lines.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(lines, 3));
      this.sketchLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffc94d, depthTest: false }));
      this.sketchLines.name = "sketch";
      this.sketchLines.renderOrder = 3;
      this.scene.add(this.sketchLines);
    }
    this.requestRender();
  }

  /** The point on the model under a point of the window, or null. */
  pickPoint(clientX: number, clientY: number): [number, number, number] | null {
    if (!this.surface) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.surface, false)[0];
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  }

  /** Shows measurement lines with labels that always face the screen. Replaces the previous ones. */
  setDimensions(dimensions: Dimension[]): void {
    if (this.dimensionGroup) {
      this.scene.remove(this.dimensionGroup);
      disposeObject(this.dimensionGroup);
      this.dimensionGroup = null;
    }
    this.labelLayer.replaceChildren();
    this.labels = [];
    if (dimensions.length) {
      const group = new THREE.Group();
      group.name = "dimensions";
      for (const kind of ["part", "feature"] as const) {
        const pts = dimensions.filter((d) => d.kind === kind).flatMap(dimensionLines);
        if (!pts.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        const line = new THREE.LineSegments(
          g,
          new THREE.LineBasicMaterial({ color: kind === "part" ? 0xdfe6f5 : 0xffc94d, depthTest: false, transparent: true, opacity: 0.85 }),
        );
        line.renderOrder = 4;
        group.add(line);
      }
      this.scene.add(group);
      this.dimensionGroup = group;
      for (const d of dimensions) {
        const el = document.createElement("span");
        el.className = `dimension-label ${d.kind}`;
        el.dataset.testid = "dimension";
        el.textContent = d.text;
        this.labelLayer.appendChild(el);
        this.labels.push({ el, at: new THREE.Vector3(...labelPoint(d)) });
      }
    }
    this.requestRender();
  }

  /** Points the camera straight at a flat surface, with `up` pointing up on screen, framing `size` mm. */
  lookAt(
    target: [number, number, number],
    normal: [number, number, number],
    up: [number, number, number],
    size: number,
  ): void {
    const half = (this.fit.fov * Math.PI) / 360;
    const distance = (Math.max(size, 10) * 0.75) / Math.tan(half) / Math.min(1, this.fit.aspect);
    this.camera.up.set(...up);
    this.camera.position.set(
      target[0] + normal[0] * distance,
      target[1] + normal[1] * distance,
      target[2] + normal[2] * distance,
    );
    this.controls.target.set(...target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.view = "custom";
    this.requestRender();
  }

  /**
   * Tells the view how big the part is, so the standard views frame it rather than the whole plate.
   * While a standard view is showing, it reframes when the part no longer fits or has shrunk a lot,
   * but not on every small change, so the view doesn't jump while you type.
   */
  setPartBounds(bounds: Bounds | null): void {
    this.partBounds = bounds;
    if (this.view === "custom") return;
    const next = bounds ? roomAround(bounds) : null;
    const r = (b: Bounds | null) => (b ? boundsRadius(b) : 0);
    const fits =
      next &&
      this.framed &&
      next.min.every((v, i) => v >= this.framed!.min[i]!) &&
      next.max.every((v, i) => v <= this.framed!.max[i]!) &&
      r(next) > r(this.framed) * 0.5;
    if (!fits) this.setView(this.view);
  }

  /** Keeps the scene centred in the part of the view that floating panels don't cover. */
  setSafeArea(area: SafeArea): void {
    const same = (Object.keys(area) as (keyof SafeArea)[]).every(
      (k) => Math.round(area[k]) === Math.round(this.safeArea[k]),
    );
    if (same) return;
    this.safeArea = { ...area };
    this.resize();
    if (this.view !== "custom") this.setView(this.view);
  }

  getCameraState(): CameraState {
    const r = (n: number) => Math.round(n * 1000) / 1000 + 0; // "+ 0" turns -0 into 0
    const { x, y, z } = this.camera.position;
    const t = this.controls.target;
    return {
      view: this.view,
      position: [r(x), r(y), r(z)],
      target: [r(t.x), r(t.y), r(t.z)],
    };
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
    this.labelLayer.remove();
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
    this.fit = {
      fov: (2 * Math.atan(Math.tan(half) * (visH / fullH)) * 180) / Math.PI,
      aspect: visW / visH,
    };
    this.requestRender();
  }

  /** Moves each measurement label over the middle of its line on screen. */
  private placeLabels(): void {
    if (!this.labels.length) return;
    const { clientWidth: w, clientHeight: h } = this.container;
    const p = new THREE.Vector3();
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const { el, at } of this.labels) {
      p.copy(at).project(this.camera);
      const visible = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
      el.style.visibility = visible ? "visible" : "hidden";
      const lw = el.offsetWidth + 4;
      const lh = el.offsetHeight + 2;
      const x = ((p.x + 1) / 2) * w;
      let y = ((1 - p.y) / 2) * h;
      // Labels that would cover one already placed step down until they're clear, so every number stays readable.
      const hits = (yy: number) => placed.some((q) => Math.abs(q.x - x) < (q.w + lw) / 2 && Math.abs(q.y - yy) < (q.h + lh) / 2);
      for (let i = 0; i < 8 && hits(y); i++) y += lh;
      placed.push({ x, y, w: lw, h: lh });
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  // Render only when something changed, so an idle app uses no GPU.
  private requestRender(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
      const s = this.getCameraState();
      this.listeners.forEach((fn) => fn(s));
    });
  }
}

/** The part's box with space around it for measurement labels, never smaller than 60 mm across. */
function roomAround(b: Bounds): Bounds {
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const pad = Math.max(10, size * 0.3, (60 - size) / 2);
  return { min: [b.min[0] - pad, b.min[1] - pad, b.min[2]], max: [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad] };
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
    new THREE.MeshStandardMaterial({
      color: 0x1b2233,
      roughness: 0.9,
      transparent: true,
      opacity: 0.72,
    }),
  );
  surface.position.z = -0.01;
  group.add(surface);

  const minor: number[] = [];
  const major: number[] = [];
  const line = (arr: number[], x1: number, y1: number, x2: number, y2: number) => arr.push(x1, y1, 0, x2, y2, 0);
  for (let x = -width / 2; x <= width / 2 + 1e-9; x += 10)
    line(Math.abs(x % 50) < 1e-9 ? major : minor, x, -depth / 2, x, depth / 2);
  for (let y = -depth / 2; y <= depth / 2 + 1e-9; y += 10)
    line(Math.abs(y % 50) < 1e-9 ? major : minor, -width / 2, y, width / 2, y);

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
