import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  boundsCenter,
  boundsRadius,
  fitDistance,
  orthoHalfHeight,
  perspectiveDistance,
  placeCamera,
  type Bounds,
  type Projection,
  type StandardView,
} from "./views";
import { dimensionLines, labelPoint, type Dimension } from "./dimensions";
import { blendPose, prefersReducedMotion, settled, springProgress, type Pose } from "./glide";

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

/** Spacing of the plate's grid lines, in mm. */
interface PlateGrid {
  minor: number;
  major: number;
}
const MM_GRID: PlateGrid = { minor: 10, major: 50 };
const INCH_GRID: PlateGrid = { minor: 12.7, major: 50.8 };

/** Part edges are drawn a little see-through, so they define the shape without outlining it like a cartoon. */
const EDGE_OPACITY = 0.6;

/** Pixels along each edge of the view that floating panels cover. The scene is centred and fitted in the rest. */
/** The colours of the part and the build plate, so they can follow the app's theme and the user's choice. */
export interface ViewportColors {
  part: number;
  /** The part's edge lines: darker than the part on a light part, lighter on a dark one. */
  edge: number;
  plate: number;
  gridMinor: number;
  gridMajor: number;
  /** The part's measurement lines: light on a dark background, dark on a light one. */
  dimension?: number;
}

/**
 * What lies around the part while designing: a build plate of a chosen size, or none, so the part floats on a plain
 * background with only a grid, as in AutoCAD's model space. The grid can be hidden either way (F7).
 */
export interface Surroundings {
  plate: boolean;
  grid: boolean;
}

/** Without a plate, the grid reaches this far each way from the middle (mm), fading towards its edge. */
export const MODEL_SPACE_REACH = 1000;
/** With no part, the standard views frame at most this much of a big plate (mm), so the start isn't a speck. */
const HOME_AREA = 300;

export const DEFAULT_VIEWPORT_COLORS: ViewportColors = {
  part: 0x6cb4ff,
  edge: 0x123a6b,
  plate: 0x1b2233,
  gridMinor: 0x2f3a52,
  gridMajor: 0x4a5878,
};

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CameraState {
  view: StandardView | "custom";
  projection: Projection;
  position: [number, number, number];
  target: [number, number, number];
  /** The orthographic camera's zoom (scrolling changes this instead of moving the camera); 1 in perspective. */
  zoom: number;
}

const FOV = 45;

export type Axis = "x" | "y" | "z";

/** A move in progress or finished, in mm along x (left/right), y (front/back) and z (up). */
export interface MoveEvent {
  phase: "move" | "end";
  by: [number, number, number];
}

const AXIS_DIRS: Record<Axis, [number, number, number]> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXIS_COLORS: Record<Axis, number> = { x: 0xf0605a, y: 0x5fd068, z: 0x5b9cff };
/** How long the move arrows look on screen, in pixels. */
const GIZMO_PIXELS = 90;

/** A reference picture to show: where its corners are and how see-through it is. */
export interface ReferencePicture {
  id: string;
  /** The picture (a data: URL). */
  src: string;
  corners: [number, number, number][];
  opacity: number;
  onTop: boolean;
}

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
  private readonly perspectiveCamera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20000);
  private readonly orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40000);
  /** The camera in use: perspective or orthographic. Both sit in the same place and look at the same point. */
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private plateBounds: Bounds;
  private plate: THREE.Group;
  /** What the standard views frame: the part with room around it for its measurements, or the plate when empty. */
  private framed: Bounds | null = null;
  private partBounds: Bounds | null = null;
  private view: StandardView | "custom" = "iso";
  private frameRequested = false;
  private grid: PlateGrid = MM_GRID;
  /** The part's soft shadow on the plate. */
  private shadow: THREE.Mesh | null = null;
  /** The camera's glide to a new view, while one is running. */
  private glideFrame = 0;
  private gliding = false;
  private glideGoal: Pose | null = null;
  /** Set once the view is on screen: the first view is placed, not glided to. */
  private ready = false;
  private listeners = new Set<(s: CameraState) => void>();
  private model: THREE.Group | null = null;
  private surface: THREE.Mesh | null = null;
  private highlight: THREE.Mesh | null = null;
  private hover: THREE.Mesh | null = null;
  /** The selected piece (and the face clicked on it), which moves with the arrows while they are dragged. */
  private selection: THREE.Group | null = null;
  private gizmo: THREE.Group | null = null;
  private gizmoAt = new THREE.Vector3();
  private drag: {
    axis: Axis;
    pointerId: number;
    start: number;
    by: [number, number, number];
  } | null = null;
  private moveListeners = new Set<(e: MoveEvent) => void>();
  private sketchLines: THREE.LineSegments | null = null;
  private threadMarks: THREE.LineSegments | null = null;
  private edgePicks: THREE.Group | null = null;
  private layers: THREE.Group | null = null;
  private references: THREE.Group | null = null;
  /** Pictures already loaded, by id, so changing a picture's place or see-through doesn't load it again. */
  private textures = new Map<string, { src: string; texture: THREE.Texture }>();
  private readonly raycaster = new THREE.Raycaster();
  private dimensionGroup: THREE.Group | null = null;
  private colors: ViewportColors = DEFAULT_VIEWPORT_COLORS;
  private plateSize: { width: number; depth: number; volume?: { height: number; fits: boolean } } = {
    width: 0,
    depth: 0,
  };
  private surroundings: Surroundings = { plate: true, grid: true };
  /** How far the camera is from what it looks at; grid lines fade out a few times further away than that. */
  private readonly gridFocus = { value: 1e9 };
  private labels: { el: HTMLElement; at: THREE.Vector3 }[] = [];
  private readonly labelLayer: HTMLDivElement;
  private safeArea: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Where the open area is gliding to, while it is. */
  private safeAreaGoal: SafeArea | null = null;
  private areaFrame = 0;
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
    this.orthoCamera.up.set(0, 0, 1);

    // A soft studio: a room's light reflected in the part, a key light from above, and a dim fill from the other side
    // so no face goes black. Neutral tone mapping keeps the part's colour true to the filament picked.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(120, -180, 400);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
    fill.position.set(-300, 250, 150);
    this.scene.add(fill);
    this.plateSize = { width: w, depth: d };
    this.plate = this.buildSurroundings();
    this.scene.add(this.plate);

    // Dragging a move arrow comes before orbiting: registered first, on the capture phase, so the orbit never sees it.
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => this.onGizmoDown(e), { capture: true });
    canvas.addEventListener("pointermove", (e) => this.onGizmoMove(e), { capture: true });
    canvas.addEventListener("pointerup", (e) => this.onGizmoUp(e), { capture: true });
    canvas.addEventListener("pointercancel", (e) => this.onGizmoUp(e, true), { capture: true });

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    // Mouse like AutoCAD and Civil 3D: hold the wheel to pan, Shift + wheel to orbit, scroll to zoom at the pointer.
    // Left-drag still orbits and right-drag still pans. (OrbitControls orbits when Shift is held with a pan button.)
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.controls.zoomToCursor = true;
    // Pressing the wheel would otherwise start the browser's auto-scroll; a double-click of the wheel fits the part.
    // Double-clicking the wheel fits everything on screen (as in AutoCAD). The browser counts the clicks, using the
    // system's double-click speed.
    canvas.addEventListener("auxclick", (e) => {
      if (e.button === 1 && e.detail === 2) this.zoomExtents();
    });
    canvas.addEventListener("pointerdown", (e) => e.button === 1 && e.preventDefault()); // no autoscroll
    this.controls.addEventListener("change", () => {
      if (!this.gliding) this.view = "custom";
      this.requestRender();
    });
    // Grabbing the view mid-glide stops the glide where it is, so the camera follows the mouse at once.
    this.controls.addEventListener("start", () => {
      this.stopGlide();
      this.view = "custom";
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.setView("iso");
    this.ready = true;
  }

  setView(view: StandardView): void {
    if (this.partBounds) this.framed = roomAround(this.partBounds);
    const p = placeCamera(view, this.framed ?? this.plateBounds, this.fit.fov, this.fit.aspect);
    this.moveCamera({
      position: new THREE.Vector3(...p.position),
      target: new THREE.Vector3(...p.target),
      up: new THREE.Vector3(...p.up),
    });
    this.view = view;
  }

  /**
   * Moves the camera to a new pose: a short glide that turns, slides and zooms together, or a jump when the person's
   * system asks for less motion or the view isn't on screen yet.
   */
  private moveCamera(to: Pose): void {
    this.stopGlide();
    const from: Pose = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      up: this.camera.up.clone(),
    };
    const far = from.position.distanceTo(to.position) + from.target.distanceTo(to.target) + from.up.distanceTo(to.up);
    if (!this.ready || prefersReducedMotion() || far < 1e-6) return this.poseCamera(to);
    const start = performance.now();
    this.gliding = true;
    this.glideGoal = to;
    this.container.dataset.cameraGliding = "true";
    const step = (now: number) => {
      const k = springProgress((now - start) / 1000);
      if (settled(k)) {
        this.poseCamera(to);
        this.stopGlide();
        return;
      }
      this.poseCamera(blendPose(from, to, k));
      this.glideFrame = requestAnimationFrame(step);
    };
    this.glideFrame = requestAnimationFrame(step);
  }

  private poseCamera(p: Pose): void {
    this.camera.up.copy(p.up);
    this.camera.position.copy(p.position);
    this.controls.target.copy(p.target);
    this.camera.lookAt(this.controls.target);
    this.frameOrtho();
    this.controls.update();
    this.requestRender();
  }

  private stopGlide(): void {
    if (this.glideFrame) cancelAnimationFrame(this.glideFrame);
    this.glideFrame = 0;
    this.gliding = false;
    this.glideGoal = null;
    delete this.container.dataset.cameraGliding;
  }

  /** Puts the camera where a running glide is heading, at once (before switching projection, say). */
  private finishGlide(): void {
    const goal = this.glideGoal;
    if (!goal) return;
    const view = this.view;
    this.poseCamera(goal);
    this.stopGlide();
    this.view = view;
  }

  get projection(): Projection {
    return this.camera === this.orthoCamera ? "orthographic" : "perspective";
  }

  /**
   * Switches between perspective and a true orthographic projection (parallel lines stay parallel). The camera keeps
   * its place, direction and target, and the part stays the same size on screen.
   */
  setProjection(projection: Projection): void {
    if (projection === this.projection) return;
    this.finishGlide();
    const from = this.camera;
    const target = this.controls.target;
    const to = projection === "orthographic" ? this.orthoCamera : this.perspectiveCamera;
    to.up.copy(from.up);
    if (from instanceof THREE.OrthographicCamera) {
      // Move back to the distance at which perspective shows what the zoomed orthographic view shows.
      const d = perspectiveDistance(from.top, from.zoom, this.fullFov());
      const dir = from.position.clone().sub(target).normalize();
      to.position.copy(target).addScaledVector(dir, d);
    } else to.position.copy(from.position);
    to.lookAt(target);
    this.camera = to;
    this.controls.object = to;
    this.frameOrtho();
    this.resize();
    const view = this.view; // the camera hasn't turned, so a standard view stays that view
    this.controls.update();
    this.view = view;
    this.requestRender();
  }

  /**
   * Sizes the orthographic camera to show, at the target, what perspective shows from the camera's distance, with
   * zoom back at 1. Called whenever the camera is placed (standard views, fit, looking at a face).
   */
  private frameOrtho(): void {
    if (this.camera !== this.orthoCamera) return;
    const half = orthoHalfHeight(this.camera.position.distanceTo(this.controls.target), this.fullFov());
    this.orthoCamera.zoom = 1;
    this.orthoCamera.top = half;
    this.orthoCamera.bottom = -half;
    this.applyAspect();
  }

  /** The vertical field of view of the whole (virtual) frame, which includes the parts panels cover. */
  private fullFov(): number {
    return FOV;
  }

  /** Shows a model, replacing the previous one. Pass null to clear. */
  setModel(mesh: DisplayMesh | null): void {
    if (this.model) {
      ((this.shadow?.material as THREE.MeshBasicMaterial | undefined)?.map as THREE.Texture | null)?.dispose();
      this.scene.remove(this.model);
      disposeObject(this.model);
      this.model = null;
      this.surface = null;
      this.shadow = null;
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
        // Satin plastic, like a good print: soft highlights and a faint sheen from the room.
        new THREE.MeshPhysicalMaterial({
          color: this.colors.part,
          roughness: 0.5,
          metalness: 0,
          clearcoat: 0.25,
          clearcoatRoughness: 0.45,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      group.add(surface);
      this.surface = surface;
      const e = new THREE.BufferGeometry();
      e.setAttribute("position", new THREE.BufferAttribute(mesh.edges, 3));
      group.add(
        new THREE.LineSegments(
          e,
          new THREE.LineBasicMaterial({ color: this.colors.edge, transparent: true, opacity: EDGE_OPACITY }),
        ),
      );
      group.visible = !this.layers;
      this.scene.add(group);
      this.model = group;
      this.shadow = contactShadow(mesh.positions, mesh.indices);
      if (this.shadow) group.add(this.shadow);
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

  /** Lightly tints the piece under the pointer (triangle corners, three per triangle). Null clears it. */
  setHover(positions: Float32Array | null): void {
    if (this.hover) {
      this.scene.remove(this.hover);
      disposeObject(this.hover);
      this.hover = null;
    }
    if (positions && positions.length) {
      this.hover = overlay(positions, 0xffffff, 0.16);
      this.hover.name = "hover";
      this.scene.add(this.hover);
    }
    this.requestRender();
  }

  /** Shows the selected piece, and more strongly the face that was clicked on it. Null clears it. */
  setSelection(selection: { piece: Float32Array; face: Float32Array | null } | null): void {
    if (this.selection) {
      this.scene.remove(this.selection);
      disposeObject(this.selection);
      this.selection = null;
    }
    if (selection && selection.piece.length) {
      const group = new THREE.Group();
      group.name = "selection";
      group.add(overlay(selection.piece, 0xffc94d, 0.38));
      if (selection.face?.length) group.add(overlay(selection.face, 0xffc94d, 0.4));
      this.scene.add(group);
      this.selection = group;
    }
    this.requestRender();
  }

  /** Shows move arrows at a point, one per axis given. Null or no axes hides them. */
  setGizmo(gizmo: { at: [number, number, number]; axes: Axis[] } | null): void {
    if (this.drag) this.drag = null;
    if (this.gizmo) {
      this.scene.remove(this.gizmo);
      disposeObject(this.gizmo);
      this.gizmo = null;
    }
    if (gizmo && gizmo.axes.length) {
      this.gizmoAt.set(...gizmo.at);
      this.gizmo = buildGizmo(gizmo.axes);
      this.gizmo.position.copy(this.gizmoAt);
      this.scene.add(this.gizmo);
    }
    this.requestRender();
  }

  /** Called while a move arrow is dragged and once when it is let go. */
  onMove(fn: (e: MoveEvent) => void): () => void {
    this.moveListeners.add(fn);
    return () => this.moveListeners.delete(fn);
  }

  /** True while a move arrow is being dragged. */
  get moving(): boolean {
    return this.drag !== null;
  }

  private ray(clientX: number, clientY: number): THREE.Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  /** Which move arrow is under a point of the window. */
  private gizmoAxisAt(clientX: number, clientY: number): Axis | null {
    if (!this.gizmo) return null;
    this.ray(clientX, clientY);
    const handles = this.gizmo.children.filter((c) => c.userData.handle);
    const hit = this.raycaster.intersectObjects(handles, false)[0];
    return (hit?.object.userData.axis as Axis | undefined) ?? null;
  }

  /** How far along an axis through the gizmo the pointer is, or null when looking straight down that axis. */
  private alongAxis(axis: Axis, clientX: number, clientY: number): number | null {
    const ray = this.ray(clientX, clientY);
    const dir = new THREE.Vector3(...AXIS_DIRS[axis]);
    const w = this.gizmoAt.clone().sub(ray.origin);
    const b = dir.dot(ray.direction);
    const denom = 1 - b * b;
    if (denom < 1e-4) return null;
    return (b * ray.direction.dot(w) - dir.dot(w)) / denom;
  }

  private onGizmoDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const axis = this.gizmoAxisAt(e.clientX, e.clientY);
    if (!axis) return;
    const start = this.alongAxis(axis, e.clientX, e.clientY);
    if (start === null) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.drag = { axis, pointerId: e.pointerId, start, by: [0, 0, 0] };
  }

  private onGizmoMove(e: PointerEvent): void {
    if (!this.drag) {
      if (!e.buttons) this.renderer.domElement.style.cursor = this.gizmoAxisAt(e.clientX, e.clientY) ? "grab" : "";
      return;
    }
    if (e.pointerId !== this.drag.pointerId) return;
    e.stopImmediatePropagation();
    const t = this.alongAxis(this.drag.axis, e.clientX, e.clientY);
    if (t === null) return;
    // Whole millimetres, or tenths while Shift is held.
    const step = e.shiftKey ? 0.1 : 1;
    const d = Math.round((t - this.drag.start) / step) * step;
    const by = AXIS_DIRS[this.drag.axis].map((v) => Math.round(v * d * 10) / 10 + 0) as [number, number, number];
    this.drag.by = by;
    const offset = new THREE.Vector3(...by);
    this.selection?.position.copy(offset);
    this.gizmo?.position.copy(this.gizmoAt).add(offset);
    this.renderer.domElement.style.cursor = "grabbing";
    this.requestRender();
    this.moveListeners.forEach((fn) => fn({ phase: "move", by }));
  }

  private onGizmoUp(e: PointerEvent, cancelled = false): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    e.stopImmediatePropagation();
    const by: [number, number, number] = cancelled ? [0, 0, 0] : this.drag.by;
    this.drag = null;
    this.renderer.domElement.style.cursor = "";
    if (this.renderer.domElement.hasPointerCapture(e.pointerId))
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    if (cancelled) {
      this.selection?.position.set(0, 0, 0);
      this.gizmo?.position.copy(this.gizmoAt);
      this.requestRender();
    }
    this.moveListeners.forEach((fn) => fn({ phase: "end", by }));
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

  /**
   * Shows edges picked for a fillet or chamfer (line pairs, x, y, z), drawn over the part, and the edge under the
   * pointer that a click would pick, fainter. Null clears either.
   */
  setEdgePicks(picked: Float32Array | null, hover: Float32Array | null = null): void {
    if (this.edgePicks) {
      this.scene.remove(this.edgePicks);
      disposeObject(this.edgePicks);
      this.edgePicks = null;
    }
    const group = new THREE.Group();
    group.name = "edge-picks";
    const add = (lines: Float32Array | null, name: string, opacity: number) => {
      if (!lines?.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(lines, 3));
      const l = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: 0xffc94d, depthTest: false, transparent: true, opacity }),
      );
      l.name = name;
      l.renderOrder = 4;
      group.add(l);
    };
    add(hover, "edge-hover", 0.55);
    add(picked, "edge-picked", 1);
    if (group.children.length) {
      this.edgePicks = group;
      this.scene.add(group);
    }
    this.requestRender();
  }

  /**
   * Marks cosmetic threads (line pairs, x, y, z): dashed circles at the thread's full size where it starts and ends,
   * seen through the part like hidden lines in a drawing. Null clears them.
   */
  setThreadMarks(lines: Float32Array | null): void {
    if (this.threadMarks) {
      this.scene.remove(this.threadMarks);
      disposeObject(this.threadMarks);
      this.threadMarks = null;
    }
    if (lines && lines.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(lines, 3));
      const marks = new THREE.LineSegments(
        g,
        new THREE.LineDashedMaterial({
          color: 0xffc94d,
          dashSize: 0.8,
          gapSize: 0.6,
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        }),
      );
      marks.computeLineDistances();
      marks.name = "thread-marks";
      marks.renderOrder = 3;
      this.threadMarks = marks;
      this.scene.add(marks);
    }
    this.requestRender();
  }

  /**
   * Shows the part's sliced layers in its place, as outlines (x, y, z line pairs): the layers below the current one
   * faint, and the current one's walls bright, its infill lines (`infill`) orange, over its filled area (`fill`: its
   * outlines, x, y pairs, counter-clockwise outsides and clockwise holes, at height z). Null shows the part again.
   */
  setLayers(
    layers: {
      below: Float32Array;
      current: Float32Array;
      infill?: Float32Array;
      fill?: { z: number; loops: Float64Array[] };
    } | null,
  ): void {
    if (this.layers) {
      this.scene.remove(this.layers);
      disposeObject(this.layers);
      this.layers = null;
    }
    if (layers) {
      const group = new THREE.Group();
      group.name = "layers";
      const lines = (positions: Float32Array, color: number, opacity: number) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
        return new THREE.LineSegments(g, m);
      };
      if (layers.below.length) group.add(lines(layers.below, 0x6cb4ff, 0.35));
      if (layers.current.length) group.add(lines(layers.current, 0xffc94d, 1));
      if (layers.infill?.length) group.add(lines(layers.infill, 0xff9a5c, 1));
      if (layers.fill) {
        const fill = new THREE.Mesh(
          layerFill(layers.fill.loops),
          new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
        );
        fill.position.z = layers.fill.z;
        group.add(fill);
      }
      this.scene.add(group);
      this.layers = group;
    }
    if (this.model) this.model.visible = !this.layers;
    this.requestRender();
  }

  /**
   * Shows reference pictures: each a flat picture with the given corners (bottom-left, bottom-right, top-right,
   * top-left). They are only shown, never picked or measured. `onTop` draws one over the part instead of behind it.
   */
  setReferences(pictures: ReferencePicture[]): void {
    if (this.references) {
      this.scene.remove(this.references);
      disposeObject(this.references);
      this.references = null;
    }
    const keep = new Set(pictures.map((p) => p.id));
    for (const [id, t] of this.textures)
      if (!keep.has(id)) {
        t.texture.dispose();
        this.textures.delete(id);
      }
    if (!pictures.length) return this.requestRender();
    const group = new THREE.Group();
    group.name = "references";
    for (const p of pictures) {
      let cached = this.textures.get(p.id);
      if (!cached || cached.src !== p.src) {
        cached?.texture.dispose();
        const texture = new THREE.TextureLoader().load(p.src, () => this.requestRender());
        texture.colorSpace = THREE.SRGBColorSpace;
        cached = { src: p.src, texture };
        this.textures.set(p.id, cached);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p.corners.flat()), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const mesh = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          map: cached.texture,
          transparent: true,
          opacity: p.opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: !p.onTop,
          // Lying on the plate, it is drawn just above the plate's own surface.
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -4,
        }),
      );
      mesh.name = `reference:${p.id}`;
      mesh.renderOrder = p.onTop ? 4 : 1;
      group.add(mesh);
    }
    this.references = group;
    this.scene.add(group);
    this.requestRender();
  }

  /** The point on the model under a point of the window, or null. */
  pickPoint(clientX: number, clientY: number): [number, number, number] | null {
    if (!this.surface) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.surface, false)[0];
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  }

  /** Where a point of the model is in the window (client pixels) and how deep, or null when behind the camera. */
  toClient(p: [number, number, number]): [number, number, number] | null {
    const v = new THREE.Vector3(...p).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    // The third number is the depth: smaller is nearer the eye.
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height, v.z];
  }

  /** The point on the plate (height 0) under a point of the window, or null when looking away from it. */
  pickPlate(clientX: number, clientY: number): [number, number, number] | null {
    const hit = this.ray(clientX, clientY).intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
      new THREE.Vector3(),
    );
    return hit ? [hit.x, hit.y, 0] : null;
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
          new THREE.LineBasicMaterial({
            color: kind === "part" ? (this.colors.dimension ?? 0xdfe6f5) : 0xffc94d,
            depthTest: false,
            transparent: true,
            opacity: 0.85,
          }),
        );
        line.renderOrder = 4;
        line.name = `${kind}-dimensions`;
        group.add(line);
      }
      this.scene.add(group);
      this.dimensionGroup = group;
      for (const d of dimensions) {
        const el = document.createElement("span");
        el.className = `dimension-label ${d.kind}`;
        el.dataset.testid = "dimension";
        el.textContent = d.text;
        el.style.visibility = "hidden"; // until the next frame puts it in its place
        this.labelLayer.appendChild(el);
        this.labels.push({ el, at: new THREE.Vector3(...labelPoint(d)) });
      }
    }
    this.requestRender();
  }

  /** Fits the whole part (or the plate, when there is none) in view, looking from the same direction as now. */
  zoomExtents(): void {
    if (this.view !== "custom") return this.setView(this.view);
    if (this.partBounds) this.framed = roomAround(this.partBounds);
    const bounds = this.framed ?? this.plateBounds;
    const target = boundsCenter(bounds);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const d = fitDistance(boundsRadius(bounds), this.fit.fov, this.fit.aspect);
    this.moveCamera({
      position: new THREE.Vector3(target[0] + dir.x * d, target[1] + dir.y * d, target[2] + dir.z * d),
      target: new THREE.Vector3(...target),
      up: this.camera.up.clone(),
    });
    this.view = "custom";
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
    this.moveCamera({
      position: new THREE.Vector3(
        target[0] + normal[0] * distance,
        target[1] + normal[1] * distance,
        target[2] + normal[2] * distance,
      ),
      target: new THREE.Vector3(...target),
      up: new THREE.Vector3(...up),
    });
    this.view = "custom";
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

  /** Recolours the part and the plate in place; nothing is rebuilt and the camera stays put. */
  setColors(colors: ViewportColors): void {
    this.colors = colors;
    this.model?.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial)
        o.material.color.set(colors.part);
      if (o instanceof THREE.LineSegments && o.material instanceof THREE.LineBasicMaterial)
        o.material.color.set(colors.edge);
    });
    const sizes = this.dimensionGroup?.getObjectByName("part-dimensions");
    if (sizes instanceof THREE.LineSegments && sizes.material instanceof THREE.LineBasicMaterial)
      sizes.material.color.set(colors.dimension ?? 0xdfe6f5);
    const { width, depth, volume } = this.plateSize;
    if (width > 0) this.setPlate(width, depth, volume);
    else this.requestRender();
  }

  /**
   * Swaps the build plate for one of this size, centred on the origin. With a height, the printer's whole build
   * volume is outlined too: in the accent colour when the part fits, red when it doesn't. The camera stays put.
   */
  setPlate(width: number, depth: number, volume?: { height: number; fits: boolean }): void {
    this.scene.remove(this.plate);
    disposeObject(this.plate);
    this.plateSize = { width, depth, volume };
    this.plate = this.buildSurroundings();
    this.scene.add(this.plate);
    // A printer's plate is framed whole; a big design plate only around its middle, where a new part starts.
    const [hw, hd] = volume ? [width / 2, depth / 2] : [Math.min(width, HOME_AREA) / 2, Math.min(depth, HOME_AREA) / 2];
    this.plateBounds = { min: [-hw, -hd, 0], max: [hw, hd, volume?.height ?? 0] };
    this.requestRender();
  }

  /** Shows or hides the build plate and its grid. A printer's plate (with its build volume) always shows. */
  setSurroundings(s: Surroundings): void {
    if (s.plate === this.surroundings.plate && s.grid === this.surroundings.grid) return;
    this.surroundings = s;
    const { width, depth, volume } = this.plateSize;
    if (width > 0) this.setPlate(width, depth, volume);
  }

  /** What is drawn around the part now: "plate", or "model space" (no plate), and whether the grid shows. */
  get surroundingsShown(): { plate: boolean; grid: boolean } {
    return { plate: !!this.plateSize.volume || this.surroundings.plate, grid: this.surroundings.grid };
  }

  private buildSurroundings(): THREE.Group {
    const { width, depth, volume } = this.plateSize;
    const { plate, grid } = this.surroundingsShown;
    const group = plate
      ? buildPlate(width, depth, this.colors, this.grid, this.gridFocus, grid)
      : buildPlate(MODEL_SPACE_REACH * 2, MODEL_SPACE_REACH * 2, this.colors, this.grid, this.gridFocus, grid, false);
    if (volume) group.add(buildVolume(width, depth, volume.height, volume.fits));
    return group;
  }

  /** Squares on the plate: 10 mm (heavier every 50), or half inches (heavier every 2 inches). */
  setGridUnits(units: "mm" | "in"): void {
    const grid = units === "in" ? INCH_GRID : MM_GRID;
    if (grid === this.grid) return;
    this.grid = grid;
    const { width, depth, volume } = this.plateSize;
    if (width > 0) this.setPlate(width, depth, volume);
  }

  /**
   * Keeps the scene centred in the part of the view that floating panels don't cover. With `slide`, the scene glides
   * over to the new centre (a panel opening beside it), starting from wherever it is now, so it can be reversed.
   */
  setSafeArea(area: SafeArea, slide = false): void {
    const goal = this.safeAreaGoal ?? this.safeArea;
    const same = (Object.keys(area) as (keyof SafeArea)[]).every((k) => Math.round(area[k]) === Math.round(goal[k]));
    if (same) return;
    if (this.areaFrame) cancelAnimationFrame(this.areaFrame);
    this.areaFrame = 0;
    this.safeAreaGoal = null;
    const settle = () => {
      this.safeArea = { ...area };
      this.safeAreaGoal = null;
      delete this.container.dataset.areaSliding;
      this.resize();
      if (this.view !== "custom") this.setView(this.view);
    };
    if (!slide || !this.ready || prefersReducedMotion()) return settle();
    const from = { ...this.safeArea };
    const start = performance.now();
    this.safeAreaGoal = { ...area };
    this.container.dataset.areaSliding = "true";
    const step = (now: number) => {
      const k = springProgress((now - start) / 1000);
      if (settled(k)) {
        this.areaFrame = 0;
        return settle();
      }
      const at = (key: keyof SafeArea) => from[key] + (area[key] - from[key]) * k;
      this.safeArea = { top: at("top"), right: at("right"), bottom: at("bottom"), left: at("left") };
      this.resize();
      this.areaFrame = requestAnimationFrame(step);
    };
    this.areaFrame = requestAnimationFrame(step);
  }

  getCameraState(): CameraState {
    const r = (n: number) => Math.round(n * 1000) / 1000 + 0; // "+ 0" turns -0 into 0
    const { x, y, z } = this.camera.position;
    const t = this.controls.target;
    return {
      view: this.view,
      projection: this.projection,
      position: [r(x), r(y), r(z)],
      target: [r(t.x), r(t.y), r(t.z)],
      zoom: r(this.camera.zoom),
    };
  }

  onCameraChange(fn: (s: CameraState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    this.stopGlide();
    if (this.areaFrame) cancelAnimationFrame(this.areaFrame);
    this.textures.forEach((t) => t.texture.dispose());
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
    this.frameAspect = fullW / fullH;
    for (const camera of [this.perspectiveCamera, this.orthoCamera]) {
      if (dx === 0 && dy === 0) camera.clearViewOffset();
      else camera.setViewOffset(fullW, fullH, dx < 0 ? -dx : 0, dy < 0 ? -dy : 0, w, h);
    }
    this.applyAspect();
    const half = (FOV * Math.PI) / 360;
    this.fit = {
      fov: (2 * Math.atan(Math.tan(half) * (visH / fullH)) * 180) / Math.PI,
      aspect: visW / visH,
    };
    this.requestRender();
  }

  /** Width over height of the whole (virtual) frame, for both cameras. */
  private frameAspect = 1;

  private applyAspect(): void {
    this.perspectiveCamera.aspect = this.frameAspect;
    this.perspectiveCamera.updateProjectionMatrix();
    const half = this.orthoCamera.top;
    this.orthoCamera.left = -half * this.frameAspect;
    this.orthoCamera.right = half * this.frameAspect;
    this.orthoCamera.updateProjectionMatrix();
  }

  /** Keeps the move arrows the same size on screen however far away they are. */
  private sizeGizmo(): void {
    if (!this.gizmo) return;
    const h = this.container.clientHeight || 1;
    const view = this.camera.view?.enabled ? this.camera.view : null;
    const shown = view ? view.height / view.fullHeight : 1; // the part of the camera's frame on screen
    const worldHeight =
      this.camera instanceof THREE.OrthographicCamera
        ? ((this.camera.top - this.camera.bottom) / this.camera.zoom) * shown
        : 2 *
          this.camera.position.distanceTo(this.gizmo.position) *
          Math.tan((this.camera.fov * Math.PI) / 360) *
          shown;
    this.gizmo.scale.setScalar((GIZMO_PIXELS * worldHeight) / h);
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
      // A label that would cover one already placed moves a little way to the nearest clear spot beside its line.
      // When there's none close by, it is left out for now (the number is in Properties), rather than piling
      // labels up far from what they measure; turning or zooming the view brings it back.
      const hits = (xx: number, yy: number) =>
        placed.some((q) => Math.abs(q.x - xx) < (q.w + lw) / 2 && Math.abs(q.y - yy) < (q.h + lh) / 2);
      let spot: [number, number] | null = hits(x, y) ? null : [x, y];
      for (const [dx, dy] of NUDGES) {
        if (spot) break;
        if (!hits(x + dx * lw, y + dy * lh)) spot = [x + dx * lw, y + dy * lh];
      }
      // A label under the bars or palettes would sit on their text: it waits until the view brings it back out.
      const a = this.safeArea;
      const open = (sx: number, sy: number) =>
        sx - lw / 2 >= a.left && sx + lw / 2 <= w - a.right && sy - lh / 2 >= a.top && sy + lh / 2 <= h - a.bottom;
      if (!spot || !visible || !open(spot[0], spot[1])) {
        el.style.visibility = "hidden";
        continue;
      }
      placed.push({ x: spot[0], y: spot[1], w: lw, h: lh });
      el.style.transform = `translate(${spot[0]}px, ${spot[1]}px) translate(-50%, -50%)`;
    }
  }

  // Render only when something changed, so an idle app uses no GPU.
  private requestRender(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.sizeGizmo();
      this.gridFocus.value =
        this.camera instanceof THREE.PerspectiveCamera ? this.camera.position.distanceTo(this.controls.target) : 1e9;
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
      const s = this.getCameraState();
      this.listeners.forEach((fn) => fn(s));
    });
  }
}

/** Where a crowded label may move, in label heights and widths: just above or below first, then to the sides. */
const NUDGES: [number, number][] = [
  [0, -1],
  [0, 1],
  [0.6, 0],
  [-0.6, 0],
  [0.6, -1],
  [-0.6, -1],
  [0.6, 1],
  [-0.6, 1],
  [0, -2],
  [0, 2],
];

/** The part's box with space around it for measurement labels, never smaller than 60 mm across. */
function roomAround(b: Bounds): Bounds {
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const pad = Math.max(10, size * 0.3, (60 - size) / 2);
  return { min: [b.min[0] - pad, b.min[1] - pad, b.min[2]], max: [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad] };
}

/** A see-through tint drawn over some triangles of the part. */
function overlay(positions: Float32Array, color: number, opacity: number): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * Move arrows one unit long (scaled to a fixed size on screen), drawn over everything. Each arrow has a thicker
 * invisible handle around it so it is easy to grab.
 */
function buildGizmo(axes: Axis[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "gizmo";
  const up = new THREE.Vector3(0, 1, 0);
  for (const axis of axes) {
    const dir = new THREE.Vector3(...AXIS_DIRS[axis]);
    const turn = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const solid = (geometry: THREE.BufferGeometry, along: number, visible = true) => {
      const m = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: AXIS_COLORS[axis],
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: visible ? 1 : 0,
        }),
      );
      m.quaternion.copy(turn);
      m.position.copy(dir).multiplyScalar(along);
      m.renderOrder = 10;
      m.userData.axis = axis;
      return m;
    };
    group.add(solid(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8), 0.4));
    group.add(solid(new THREE.ConeGeometry(0.08, 0.22, 16), 0.89));
    const handle = solid(new THREE.CylinderGeometry(0.11, 0.11, 1.0, 8), 0.5, false);
    handle.userData.handle = true;
    group.add(handle);
  }
  return group;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}

/** The outline of a printer's build volume: a box of thin lines from the plate up to the most it can print. */
function buildVolume(width: number, depth: number, height: number, fits: boolean): THREE.LineSegments {
  const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(width, depth, height));
  box.translate(0, 0, height / 2);
  const lines = new THREE.LineSegments(
    box,
    new THREE.LineBasicMaterial({ color: fits ? 0x5ea8ff : 0xff6b6b, transparent: true, opacity: fits ? 0.45 : 0.85 }),
  );
  lines.name = "build-volume";
  return lines;
}

/**
 * Build plate: a flat surface with 10 mm and 50 mm grid lines and X/Y axis lines through the origin. Without its
 * surface it is model space's grid: the lines and axes only, over the plain background.
 */
function buildPlate(
  width: number,
  depth: number,
  colors: ViewportColors,
  grid: PlateGrid,
  focus: { value: number },
  showGrid = true,
  withSurface = true,
): THREE.Group {
  const group = new THREE.Group();
  group.name = withSurface ? "build-plate" : "model-space";
  // Long lines are drawn in pieces so they can fade towards the edge; a big grid in fewer, longer pieces.
  const piece = Math.max(10, (width + depth) / 100);

  // The plate has softly rounded corners, like a real print bed.
  if (withSurface) {
    const surface = new THREE.Mesh(
      roundedPlate(width, depth, Math.min(width, depth) * 0.04),
      new THREE.MeshStandardMaterial({
        color: colors.plate,
        roughness: 0.9,
        transparent: true,
        opacity: 0.72,
      }),
    );
    surface.position.z = -0.01;
    group.add(surface);
  }

  // Grid lines fade out towards the plate's edge, so the plate reads as a surface, not a cage.
  const minor: number[] = [];
  const major: number[] = [];
  const hw = width / 2;
  const hd = depth / 2;
  const fade = (x: number, y: number) => gridFade(Math.max(Math.abs(x) / hw, Math.abs(y) / hd));
  const line = (arr: number[], x1: number, y1: number, x2: number, y2: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / piece));
    for (let i = 0; i < n; i++) {
      const [ax, ay] = [x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n];
      const [bx, by] = [x1 + ((x2 - x1) * (i + 1)) / n, y1 + ((y2 - y1) * (i + 1)) / n];
      arr.push(ax, ay, fade(ax, ay), bx, by, fade(bx, by));
    }
  };
  // Lines out from the centre both ways, so the centre lines are always on the grid whatever the plate's size.
  const isMajor = (v: number) => Math.abs(v / grid.major - Math.round(v / grid.major)) < 1e-6;
  const xs = new Set<number>();
  const ys = new Set<number>();
  if (showGrid) {
    for (let v = 0; v <= hw + 1e-9; v += grid.minor) [v, -v].forEach((x) => xs.add(x + 0));
    for (let v = 0; v <= hd + 1e-9; v += grid.minor) [v, -v].forEach((y) => ys.add(y + 0));
  }
  xs.forEach((x) => line(isMajor(x) ? major : minor, x, -hd, x, hd));
  ys.forEach((y) => line(isMajor(y) ? major : minor, -hw, y, hw, y));

  /**
   * Lines from points stored as x, y, alpha: drawn on the plate, each point as clear as its alpha. Seen in perspective,
   * they also fade between `near` and `far` times the camera's distance from what it looks at, so a big grid melts
   * into the distance instead of crowding into a moiré at the horizon.
   */
  const lines = (pts: number[], color: number, z: number, near: number, far: number) => {
    const c = new THREE.Color(color);
    const pos: number[] = [];
    const rgba: number[] = [];
    for (let i = 0; i < pts.length; i += 3) {
      pos.push(pts[i]!, pts[i + 1]!, z);
      rgba.push(c.r, c.g, c.b, pts[i + 2]!);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("rgba", new THREE.Float32BufferAttribute(rgba, 4));
    return new THREE.LineSegments(
      g,
      new THREE.ShaderMaterial({
        uniforms: { focus, near: { value: near }, far: { value: far } },
        vertexShader: `
          attribute vec4 rgba;
          varying vec4 vRgba;
          varying float vDepth;
          void main() {
            vRgba = rgba;
            vec4 at = modelViewMatrix * vec4(position, 1.0);
            vDepth = -at.z;
            gl_Position = projectionMatrix * at;
          }`,
        fragmentShader: `
          uniform float focus;
          uniform float near;
          uniform float far;
          varying vec4 vRgba;
          varying float vDepth;
          void main() {
            float away = 1.0 - smoothstep(focus * near, focus * far, vDepth);
            gl_FragColor = vec4(vRgba.rgb, vRgba.a * away);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
  };
  group.add(lines(minor, colors.gridMinor, 0, 1.1, 2.2));
  group.add(lines(major, colors.gridMajor, 0, 2, 4.5));
  const axis: number[] = [];
  line(axis, -hw, 0, hw, 0);
  group.add(lines(axis, 0xd9534f, 0.02, 4, 10)); // X axis, red
  const yAxis: number[] = [];
  line(yAxis, 0, -hd, 0, hd);
  group.add(lines(yAxis, 0x5cb85c, 0.02, 4, 10)); // Y axis, green
  return group;
}

/**
 * A soft shadow under the part, as if lit by a bright overcast sky: the part seen from above, blurred, darkest where
 * the part touches the plate. Drawn on a 2D canvas from the triangles, so it costs nothing per frame.
 */
function contactShadow(positions: Float32Array, indices: Uint32Array): THREE.Mesh | null {
  if (typeof document === "undefined" || indices.length === 0) return null;
  let [x0, y0, x1, y1, z0] = [Infinity, Infinity, -Infinity, -Infinity, Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    x0 = Math.min(x0, positions[i]!);
    x1 = Math.max(x1, positions[i]!);
    y0 = Math.min(y0, positions[i + 1]!);
    y1 = Math.max(y1, positions[i + 1]!);
    z0 = Math.min(z0, positions[i + 2]!);
  }
  const margin = Math.max(x1 - x0, y1 - y0) * 0.25 + 6;
  [x0, y0, x1, y1] = [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
  const size = 256;
  const k = size / Math.max(x1 - x0, y1 - y0);
  const [w, h] = [Math.ceil((x1 - x0) * k), Math.ceil((y1 - y0) * k)];
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [w, h];
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const fill = (near: number | null) => {
    ctx.beginPath();
    for (let i = 0; i < indices.length; i += 3) {
      const t = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
      if (near !== null && t.some((v) => positions[v * 3 + 2]! > z0 + near)) continue;
      t.forEach((v, j) => {
        const px = (positions[v * 3]! - x0) * k;
        const py = (y1 - positions[v * 3 + 1]!) * k;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
    ctx.fill();
  };
  ctx.fillStyle = "#000";
  // A wide, light shadow of the whole part, then a tight, darker one where it sits on the plate.
  ctx.globalAlpha = 0.38;
  ctx.filter = `blur(${Math.round(size * 0.05)}px)`;
  fill(null);
  ctx.globalAlpha = 0.6;
  ctx.filter = `blur(${Math.round(size * 0.012)}px)`;
  fill(0.5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0, y1 - y0),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
  );
  plane.name = "part-shadow";
  plane.position.set((x0 + x1) / 2, (y0 + y1) / 2, Math.min(z0, 0) - 0.004);
  plane.renderOrder = 1; // over the plate, which is see-through too
  return plane;
}

/** How clear a grid line is at a share of the way to the plate's edge (0 at the centre, 1 at the edge). */
export function gridFade(r: number): number {
  const t = Math.min(Math.max((r - 0.55) / 0.45, 0), 1);
  return 1 - t * t * (3 - 2 * t) * 0.85;
}

/** A flat rectangle with rounded corners, centred on the origin. */
function roundedPlate(width: number, depth: number, radius: number): THREE.ShapeGeometry {
  const [w, d, r] = [width / 2, depth / 2, Math.min(radius, width / 2, depth / 2)];
  const s = new THREE.Shape();
  s.moveTo(-w + r, -d);
  s.lineTo(w - r, -d);
  s.quadraticCurveTo(w, -d, w, -d + r);
  s.lineTo(w, d - r);
  s.quadraticCurveTo(w, d, w - r, d);
  s.lineTo(-w + r, d);
  s.quadraticCurveTo(-w, d, -w, d - r);
  s.lineTo(-w, -d + r);
  s.quadraticCurveTo(-w, -d, -w + r, -d);
  return new THREE.ShapeGeometry(s, 6);
}

/** A layer's material as flat triangles: each outside outline with the holes that lie inside it. */
function layerFill(loops: Float64Array[]): THREE.BufferGeometry {
  const area = (l: Float64Array) => {
    let a = 0;
    for (let i = 0, n = l.length / 2, j = n - 1; i < n; j = i++)
      a += l[2 * j]! * l[2 * i + 1]! - l[2 * i]! * l[2 * j + 1]!;
    return a / 2;
  };
  const inside = (x: number, y: number, l: Float64Array) => {
    let c = false;
    for (let i = 0, n = l.length / 2, j = n - 1; i < n; j = i++) {
      const [xi, yi, xj, yj] = [l[2 * i]!, l[2 * i + 1]!, l[2 * j]!, l[2 * j + 1]!];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const path = (l: Float64Array) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < l.length; i += 2) pts.push(new THREE.Vector2(l[i]!, l[i + 1]!));
    return pts;
  };
  // Smallest outsides first, so a hole goes to the innermost outside around it (an island inside a hole).
  const outsides = loops.filter((l) => area(l) > 0).sort((a, b) => area(a) - area(b));
  const shapes = outsides.map((l) => new THREE.Shape(path(l)));
  for (const hole of loops.filter((l) => area(l) < 0)) {
    const k = outsides.findIndex((o) => inside(hole[0]!, hole[1]!, o));
    if (k >= 0) shapes[k]!.holes.push(new THREE.Path(path(hole)));
  }
  return new THREE.ShapeGeometry(shapes);
}
