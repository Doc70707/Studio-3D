import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Viewport, isWebGLAvailable, partDimensions, type CameraState, type StandardView } from "@studio3d/viewport";
import {
  GeometryClient,
  createGeometryWorker,
  faceOfTriangle,
  facePoints,
  facesOf,
  outlineOfFace,
  pointsOfFaces,
  trianglesInPlane,
  type Measurements,
  type MeshData,
} from "@studio3d/geometry";
import {
  PLATE_PLANE,
  SHAPES,
  hasErrors,
  isHollow,
  movableAxes,
  newHole,
  newEdgeStep,
  newHollow,
  newMirror,
  newPattern,
  newRevolve,
  newShape,
  newSketch,
  validateDocument,
  validateSketch,
  type FaceOutline,
  type Issue,
  type ProjectDocument,
  type SketchFeature,
} from "@studio3d/document";
import { DesignPanel, SHAPE_ORDER, copySource, placeNew } from "./DesignPanel";
import { MenuBar, type Menu } from "./MenuBar";
import { allows, interactionMode } from "./interaction";
import { SketchEditor, type SketchDraft } from "./SketchEditor";
import { sketchLines, sketchViewpoint } from "./sketch3d";
import { featureDimensions } from "./guides";
import { Icon } from "./Icon";
import { platform } from "./platform";
import { APP_INFO, useProject, whenSaved } from "./useProject";

const VIEW_BUTTONS: { view: StandardView; label: string; key: string }[] = [
  { view: "iso", label: "3D", key: "0" },
  { view: "top", label: "Top", key: "1" },
  { view: "front", label: "Front", key: "2" },
  { view: "right", label: "Right", key: "3" },
];

type Engine = "starting" | "ready" | "failed";
/** The last model the engine built, and the exact document it was built from. */
type Built = { doc: ProjectDocument; measurements: Measurements };

export function App() {
  const project = useProject();
  const { doc, dirty, dirtyRef, name, notice, setNotice, busy, run } = project;

  const hostRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const geometryRef = useRef<GeometryClient | null>(null);
  const [camera, setCamera] = useState<CameraState | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [engine, setEngine] = useState<Engine>("starting");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [kernelIssues, setKernelIssues] = useState<Issue[]>([]);
  const [built, setBuilt] = useState<Built | null>(null);
  const [building, setBuilding] = useState(false);
  /** The last mesh shown, so a click can be matched to a face. */
  const meshRef = useRef<MeshData | null>(null);
  /** Waiting for a click on a face to sketch on. */
  const [picking, setPicking] = useState(false);
  const [pickMessage, setPickMessage] = useState<string | null>(null);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  /** The sketch being drawn, if any. Its preview is built live, but it only joins the design on Done. */
  const [draft, setDraft] = useState<SketchDraft | null>(null);
  const [sketchView, setSketchView] = useState<"2d" | "3d">("2d");
  /** Measurements in the 3D view: the part's overall size, plus where the selected shape or hole sits. */
  const [showSizes, setShowSizes] = useState(true);
  const [focusId, setFocusId] = useState<string | null>(null);
  const pointerReadout = useRef<HTMLSpanElement>(null);
  /** The piece of the part picked by clicking it (or its card), and which of its faces was clicked. */
  const [selection, setSelection] = useState<{ id: string; face: number | null } | null>(null);
  /** How far the selected piece has been dragged so far, while its move arrows are held. */
  const [moveBy, setMoveBy] = useState<[number, number, number] | null>(null);
  const mode = interactionMode({ sketching: !!draft, picking, moving: moveBy !== null });
  const hovered = useRef<string | null>(null);
  /** Help > Keyboard and mouse / About. */
  const [dialog, setDialog] = useState<"shortcuts" | "about" | null>(null);

  // Viewport
  useEffect(() => {
    if (!hostRef.current) return;
    if (!isWebGLAvailable()) {
      setWebglError(true);
      return;
    }
    const vp = new Viewport(hostRef.current);
    viewportRef.current = vp;
    const off = vp.onCameraChange(setCamera);
    return () => {
      off();
      vp.dispose();
      viewportRef.current = null;
    };
  }, []);

  // The 3D view fills the window and the panels float over it, so keep the scene centred in the open space.
  useEffect(() => {
    const update = () => {
      const vp = viewportRef.current;
      const host = hostRef.current;
      if (!vp || !host) return;
      const h = host.getBoundingClientRect();
      const top = topbarRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      const status = statusRef.current?.getBoundingClientRect();
      vp.setSafeArea({
        top: top ? top.bottom - h.top : 0,
        left: panel ? panel.right - h.left : 0,
        bottom: status ? h.bottom - status.top : 0,
        right: 0,
      });
    };
    const ro = new ResizeObserver(update);
    for (const el of [hostRef.current, topbarRef.current, panelRef.current, statusRef.current]) if (el) ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  // Geometry engine
  useEffect(() => {
    const client = new GeometryClient(createGeometryWorker, (msg) => setNotice({ kind: "error", text: msg }));
    geometryRef.current = client;
    client.ready().then(
      () => setEngine("ready"),
      (e: Error) => {
        setEngine("failed");
        setEngineError(e.message);
      },
    );
    return () => {
      client.dispose();
      geometryRef.current = null;
    };
  }, [setNotice]);

  // While a sketch is being drawn, the 3D view previews the design with it included.
  const shownDoc = useMemo(() => (draft ? withDraft(doc, draft.feature, draft.isNew) : doc), [doc, draft]);

  // Rebuild real geometry whenever the document changes and its values are valid.
  const inputIssues = validateDocument(shownDoc);
  const inputOk = !hasErrors(inputIssues);
  const empty = shownDoc.features.length === 0;
  useEffect(() => {
    const client = geometryRef.current;
    if (!inputOk) setBuilding(false);
    if (empty) {
      // Every shape was removed: an empty plate, with nothing to build or export.
      setBuilding(false);
      setKernelIssues([]);
      setBuilt(null);
      meshRef.current = null;
      viewportRef.current?.setModel(null);
      viewportRef.current?.setPartBounds(null);
      return;
    }
    if (!client || engine !== "ready" || !inputOk) return;
    setBuilding(true);
    const timer = setTimeout(() => {
      client.rebuild(shownDoc).then(
        (r) => {
          if (r.status === "superseded") return;
          setBuilding(false);
          if (r.status === "built") {
            meshRef.current = r.mesh;
            viewportRef.current?.setModel(r.mesh);
            viewportRef.current?.setPartBounds({ min: r.measurements.min, max: r.measurements.max });
            setBuilt({ doc: shownDoc, measurements: r.measurements });
            setKernelIssues(r.issues); // warnings found while building, e.g. a hole that cuts nothing
          } else {
            setKernelIssues(r.issues);
          }
        },
        () => setBuilding(false),
      );
    }, 80);
    return () => clearTimeout(timer);
  }, [shownDoc, engine, inputOk, empty]);

  const issues = inputOk ? dedupe([...inputIssues, ...kernelIssues]) : inputIssues;
  // Up to date only when the model on screen was built from exactly this document (not just "nothing is building yet").
  const shownCurrent = inputOk && !building && !hasErrors(kernelIssues) && built?.doc === shownDoc;
  const upToDate = shownCurrent && shownDoc === doc;
  const exportable = upToDate && !empty;

  // Sketching: pick a face, draw, then add the sketch to the design.
  const startPicking = useCallback(() => {
    setPicking(true);
    setPickMessage("Click a flat face of the part to draw on it.");
  }, []);
  const stopPicking = useCallback(() => {
    setPicking(false);
    setPickMessage(null);
    viewportRef.current?.setHighlight(null);
  }, []);

  /** The flat face under the pointer, or a reason there isn't one. */
  const faceAt = (x: number, y: number) => {
    const vp = viewportRef.current;
    const mesh = meshRef.current;
    if (!vp || !mesh) return null;
    const tri = vp.pickTriangle(x, y);
    if (tri === null) return null;
    const face = faceOfTriangle(mesh, tri);
    if (face < 0) return null;
    return {
      face,
      outline: outlineOfFace(mesh, face),
      points: facePoints(mesh, face),
    };
  };

  /** The design step that made the face under the pointer, if the face is known. */
  const ownerAt = (x: number, y: number) => {
    const hit = faceAt(x, y);
    const id = hit && meshRef.current?.owners[hit.face];
    return hit && id ? { ...hit, id } : null;
  };

  const hoverPiece = (id: string | null) => {
    if (hovered.current === id) return;
    hovered.current = id;
    const mesh = meshRef.current;
    viewportRef.current?.setHover(id && mesh ? pointsOfFaces(mesh, facesOf(mesh, id)) : null);
  };

  const onHostPointerMove = (e: React.PointerEvent) => {
    if (!allows(mode, "pick-face")) {
      const still = !e.buttons && !viewportRef.current?.moving;
      showPointer(still ? (viewportRef.current?.pickPoint(e.clientX, e.clientY) ?? null) : null);
      const over = still && allows(mode, "hover") ? ownerAt(e.clientX, e.clientY) : null;
      hoverPiece(over && over.id !== selection?.id ? over.id : null);
      return;
    }
    if (e.buttons) return;
    const hit = faceAt(e.clientX, e.clientY);
    viewportRef.current?.setHighlight(hit?.outline ? new Float32Array(hit.points.flat()) : null);
    setPickMessage(
      hit && !hit.outline ? "That face is curved. Pick a flat one." : "Click a flat face of the part to draw on it.",
    );
  };
  const onHostPointerUp = (e: React.PointerEvent) => {
    const down = pointerDown.current;
    pointerDown.current = null;
    if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return; // a drag orbits
    if (!(e.target instanceof HTMLCanvasElement)) return; // a click on a floating panel, not the part
    if (allows(mode, "select")) {
      // A click picks the piece under the pointer; a click on empty space lets go of it.
      const hit = ownerAt(e.clientX, e.clientY);
      setSelection(hit ? { id: hit.id, face: hit.face } : null);
      hoverPiece(null);
      return;
    }
    if (!allows(mode, "pick-face")) return;
    const hit = faceAt(e.clientX, e.clientY);
    if (!hit?.outline) return;
    sketchOnFace(hit.outline);
  };

  const sketchOnFace = (o: FaceOutline) => {
    stopPicking();
    setSketchView("2d");
    setDraft({
      feature: newSketch(doc, o.plane, o.label, [], "add", 5),
      isNew: true,
      face: { triangles: o.triangles, width: o.width, height: o.height },
      area: [0, 0, o.width, o.height],
    });
  };

  /** Where the pointer is on the part, written in the status bar (updated directly: it changes on every move). */
  const showPointer = (p: [number, number, number] | null) => {
    const el = pointerReadout.current;
    if (!el) return;
    const n = (v: number) => (Math.round(v * 10) / 10 + 0).toFixed(1);
    el.textContent = p
      ? `Pointer on the part: left/right ${n(p[0])} · front/back ${n(p[1])} · height ${n(p[2])} mm`
      : "";
    el.parentElement?.classList.toggle("showing-pointer", !!p);
  };

  // Measurement lines and labels in the 3D view.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const m = built?.measurements;
    if (!showSizes || !m || draft) return vp.setDimensions([]);
    const focused = built.doc.features.find((f) => f.id === focusId);
    vp.setDimensions([...partDimensions(m.min, m.max), ...(focused ? featureDimensions(focused, m) : [])]);
  }, [built, showSizes, focusId, draft]);

  // The selected piece: tinted, with move arrows in its middle. Redrawn with each new model.
  const selected = selection ? doc.features.find((f) => f.id === selection.id) : undefined;
  useEffect(() => {
    if (selection && !selected) setSelection(null); // removed, or undone away
  }, [selection, selected]);
  useEffect(() => {
    const vp = viewportRef.current;
    const mesh = meshRef.current;
    if (!vp) return;
    const faces = selection && mesh && !draft && !picking ? facesOf(mesh, selection.id) : [];
    if (!faces.length || !selected) {
      vp.setSelection(null);
      vp.setGizmo(null);
      return;
    }
    const piece = pointsOfFaces(mesh!, faces);
    const face = selection!.face !== null && faces.includes(selection!.face) ? selection!.face : null;
    vp.setSelection({ piece, face: face === null ? null : pointsOfFaces(mesh!, [face]) });
    vp.setGizmo({ at: middleOf(piece), axes: movableAxes(selected) });
    // The selected step's own values don't change where its faces are until the model is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, kernelIssues, selection, selected?.id, selected?.type, draft, picking]);

  // Dragging a move arrow moves the piece when it is let go: one undo step per move.
  const selectedId = selection?.id;
  const moveFeature = project.moveFeature;
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !selectedId) return;
    return vp.onMove(({ phase, by }) => {
      if (phase === "move") return setMoveBy(by);
      setMoveBy(null);
      if (by.some((v) => v !== 0)) moveFeature(selectedId, by);
    });
  }, [selectedId, moveFeature]);

  const sketchOnPlate = useCallback(() => {
    const m = built?.measurements;
    const area: [number, number, number, number] = m
      ? [
          Math.min(m.min[0], -20) - 20,
          Math.min(m.min[1], -20) - 20,
          Math.max(m.max[0], 20) + 20,
          Math.max(m.max[1], 20) + 20,
        ]
      : [-60, -60, 60, 60];
    stopPicking();
    setSketchView("2d");
    setDraft({
      feature: newSketch(doc, PLATE_PLANE, "plate", [], "add", 10),
      isNew: true,
      face: null,
      area,
    });
  }, [built, doc, stopPicking]);

  /** A revolve is drawn on the upright plane through the plate's centre, as half of the part's outline. */
  const startRevolve = useCallback(() => {
    stopPicking();
    setSketchView("2d");
    setDraft({ feature: newRevolve(doc), isNew: true, face: null, area: [-10, -5, 50, 45] });
  }, [doc, stopPicking]);

  const editSketch = useCallback(
    (id: string) => {
      const f = doc.features.find((x): x is SketchFeature => x.id === id && x.type === "sketch");
      if (!f) return;
      const mesh = meshRef.current;
      const onPart = f.surface !== "plate" && f.revolve === undefined;
      const triangles = onPart && mesh ? trianglesInPlane(mesh, f.plane) : [];
      const xs = triangles.map((t) => t[0]);
      const ys = triangles.map((t) => t[1]);
      const face = triangles.length ? { triangles, width: Math.max(...xs), height: Math.max(...ys) } : null;
      stopPicking();
      setSketchView("2d");
      setDraft({
        feature: f,
        isNew: false,
        face,
        area: face ? [0, 0, face.width, face.height] : f.revolve !== undefined ? [-10, -5, 50, 45] : [-60, -60, 60, 60],
      });
    },
    [doc, stopPicking],
  );

  const finishSketch = useCallback(() => {
    if (!draft) return;
    const f = draft.feature;
    if (draft.isNew) {
      project.addFeature(f);
      setSelection({ id: f.id, face: null }); // its settings show in the panel, ready to change
    } else
      project.updateFeature(f.id, {
        profiles: f.profiles,
        mode: f.mode,
        depth: f.depth,
        ...(f.revolve !== undefined && { revolve: f.revolve }),
      });
    setDraft(null);
  }, [draft, project]);

  // In the sketch's 3D view, show the outlines on the face and look at them from an angle.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    if (draft && sketchView === "3d") vp.setSketchLines(sketchLines(draft.feature));
    else vp.setSketchLines(null);
  }, [draft, sketchView]);
  useEffect(() => {
    if (!draft || sketchView !== "3d") return;
    const v = sketchViewpoint(draft);
    viewportRef.current?.lookAt(v.target, v.direction, [0, 0, 1], v.size);
    // Only when switching to 3D, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketchView, draft?.feature.id]);

  const draftIssues = draft
    ? dedupe([
        ...validateSketch(draft.feature),
        ...(inputOk ? kernelIssues.filter((i) => i.featureId === draft.feature.id) : []),
      ])
    : [];
  const draftIndex = draft ? shownDoc.features.findIndex((f) => f.id === draft.feature.id) : -1;

  const exportStl = useCallback(
    () =>
      run(async () => {
        const client = geometryRef.current;
        if (!client) return;
        const r = await client.rebuild(doc); // make sure the export matches exactly what's on screen
        if (r.status !== "built") throw new Error("Fix the highlighted values before exporting.");
        const data = await client.exportStl();
        const saved = await platform.exportStl(data, name);
        if (saved) setNotice({ kind: "info", text: `Exported ${saved.name}.` });
      }),
    [doc, name, run, setNotice],
  );

  // Keyboard: views, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, and Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+N
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === "pick-face" && e.key === "Escape") {
        stopPicking();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !allows(mode, "file-keys")) return; // the sketch screen has its own undo
      if (!mod && !allows(mode, "view-keys")) return;
      // The app's undo replaces the text box's own undo, so one Ctrl+Z always means one design step.
      if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        project.redo();
        return;
      }
      if (mod && key === "z") {
        e.preventDefault();
        project.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void project.save(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void project.openProject();
        return;
      }
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void project.newProject();
        return;
      }
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement;
      if (mod || e.altKey || typing) return;
      if (selection && selected && allows(mode, "edit-keys")) {
        if (e.key === "Escape") {
          setSelection(null);
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && canRemove(doc, selected.id)) {
          e.preventDefault();
          project.removeFeature(selected.id);
          return;
        }
        // Arrow keys nudge the piece 1 mm (10 mm with Shift); Page Up / Page Down lift and lower it.
        const step = e.shiftKey ? 10 : 1;
        const nudge: Record<string, [number, number, number]> = {
          ArrowLeft: [-step, 0, 0],
          ArrowRight: [step, 0, 0],
          ArrowUp: [0, step, 0],
          ArrowDown: [0, -step, 0],
          PageUp: [0, 0, step],
          PageDown: [0, 0, -step],
        };
        const by = nudge[e.key];
        const axes = movableAxes(selected);
        if (by && by.some((v, i) => v !== 0 && axes.includes((["x", "y", "z"] as const)[i]!))) {
          e.preventDefault();
          project.moveFeature(selected.id, by);
          return;
        }
      }
      if (key === "m") {
        setShowSizes((v) => !v);
        return;
      }
      const b = VIEW_BUTTONS.find((v) => v.key === e.key);
      if (b) viewportRef.current?.setView(b.view);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, mode, stopPicking, selection, selected, doc]);

  // Window title and close guard
  // The title is only set once the geometry engine has loaded, so it also tells (and CI checks) that the kernel started.
  useEffect(() => {
    if (engine === "starting") return;
    const suffix = engine === "failed" ? " (geometry engine unavailable)" : "";
    platform.setTitle(`${name}${dirty ? " •" : ""} — Studio 3D${suffix}`);
  }, [name, dirty, engine]);
  const { discardOnClose } = project;
  useEffect(() => platform.guardClose(() => dirtyRef.current, discardOnClose), [dirtyRef, discardOnClose]);

  /** "top face", "curved face": what the clicked face is, in words. */
  const faceName = (face: number) => outlineOfFace(meshRef.current!, face)?.label ?? "curved face";
  /** Starts a sketch on the clicked face when it is flat; undefined when it isn't (or none was clicked). */
  const sketchFace = (face: number | null) => {
    const o = face !== null && meshRef.current ? outlineOfFace(meshRef.current, face) : null;
    return o ? () => sketchOnFace(o) : undefined;
  };

  const saveLabel = platform.capabilities.saveInPlace ? "Save" : "Download project";
  const saveStatus = dirty
    ? project.backedUp
      ? "Unsaved changes (backed up)"
      : "Unsaved changes"
    : project.file
      ? "All changes saved"
      : "Not saved yet";
  const offer = project.recoveryOffer;

  // The menu bar: every command in one place, with its shortcut. Items are greyed out (with the reason) when they
  // can't run right now, never hidden, so the menus always look the same.
  const noView = webglError ? "The 3D view isn't available" : undefined;
  const addAndSelect = (f: Parameters<typeof project.addFeature>[0]) => {
    project.addFeature(f);
    setSelection({ id: f.id, face: null });
  };
  const where = placeNew(built?.measurements ?? null);
  const hasHollow = doc.features.some(isHollow);
  /** What Modify > Pattern / Mirror copies: the selected piece, or the last one that can be copied. */
  const copyFrom = copySource(doc, selection?.id ?? null);
  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New", shortcut: "Ctrl+N", onSelect: () => void project.newProject(), disabled: busy },
        { label: "Open…", shortcut: "Ctrl+O", onSelect: () => void project.openProject(), disabled: busy },
        { label: saveLabel, shortcut: "Ctrl+S", onSelect: () => void project.save(false), disabled: busy },
        ...(platform.capabilities.saveInPlace
          ? [{ label: "Save as…", shortcut: "Ctrl+Shift+S", onSelect: () => void project.save(true), disabled: busy }]
          : []),
        "separator",
        {
          label: "Export STL…",
          onSelect: () => void exportStl(),
          disabled: busy || !exportable,
          reason: empty ? "Add a shape to export" : "Fix the highlighted values to export",
        },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", onSelect: project.undo, disabled: !project.canUndo },
        { label: "Redo", shortcut: "Ctrl+Y", onSelect: project.redo, disabled: !project.canRedo },
        "separator",
        {
          label: "Delete",
          shortcut: "Del",
          onSelect: () => selected && project.removeFeature(selected.id),
          disabled: !selected,
          reason: "Select a piece first",
        },
        { label: "Deselect", shortcut: "Esc", onSelect: () => setSelection(null), disabled: !selection },
      ],
    },
    {
      label: "View",
      items: [
        ...VIEW_BUTTONS.map((b) => ({
          label: b.view === "iso" ? "3D view" : `${b.label} view`,
          shortcut: b.key,
          onSelect: () => viewportRef.current?.setView(b.view),
          disabled: webglError,
          reason: noView,
        })),
        "separator" as const,
        {
          label: "Fit all",
          shortcut: "Wheel double-click",
          onSelect: () => viewportRef.current?.zoomExtents(),
          disabled: webglError,
          reason: noView,
        },
        { label: "Show sizes", shortcut: "M", checked: showSizes, onSelect: () => setShowSizes((v) => !v) },
      ],
    },
    {
      label: "Create",
      items: [
        ...SHAPE_ORDER.map((type) => ({
          label: SHAPES[type].label,
          onSelect: () => addAndSelect(newShape(doc, type, where)),
        })),
        "separator" as const,
        { label: "Hole", onSelect: () => addAndSelect(newHole(doc, where)) },
        "separator" as const,
        {
          label: "Sketch on a face",
          onSelect: startPicking,
          disabled: !built,
          reason: "Add a shape first, then pick one of its faces",
        },
        { label: "Sketch on the plate", onSelect: sketchOnPlate },
        { label: "Revolve (spin an outline)", onSelect: startRevolve },
      ],
    },
    {
      label: "Modify",
      items: [
        {
          label: "Hollow out",
          onSelect: () => addAndSelect(newHollow(doc)),
          disabled: hasHollow,
          reason: "The part is already hollowed; change its walls in the panel",
        },
        "separator",
        {
          label: "Fillet (round edges)",
          onSelect: () => addAndSelect(newEdgeStep(doc, "fillet")),
          disabled: !built,
          reason: "Add a shape first",
        },
        {
          label: "Chamfer (bevel edges)",
          onSelect: () => addAndSelect(newEdgeStep(doc, "chamfer")),
          disabled: !built,
          reason: "Add a shape first",
        },
        "separator",
        {
          label: copyFrom ? `Pattern ${copyFrom.name}` : "Pattern",
          onSelect: () => copyFrom && addAndSelect(newPattern(doc, copyFrom.id, where)),
          disabled: !copyFrom,
          reason: "Add a shape, hole or sketch first",
        },
        {
          label: copyFrom ? `Mirror ${copyFrom.name}` : "Mirror",
          onSelect: () => copyFrom && addAndSelect(newMirror(doc, copyFrom.id, where.x)),
          disabled: !copyFrom,
          reason: "Add a shape, hole or sketch first",
        },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Keyboard and mouse", onSelect: () => setDialog("shortcuts") },
        { label: `About ${APP_INFO.name}`, onSelect: () => setDialog("about") },
      ],
    },
  ];

  return (
    <div className={`app${draft ? " sketching" : ""}${picking ? " picking" : ""}`} data-mode={mode}>
      <main
        className="viewport-host"
        ref={hostRef}
        onPointerDown={(e) => (pointerDown.current = { x: e.clientX, y: e.clientY })}
        onPointerMove={onHostPointerMove}
        onPointerUp={onHostPointerUp}
        data-camera-view={camera?.view ?? ""}
        data-camera-position={camera ? camera.position.join(",") : ""}
        data-camera-target={camera ? camera.target.join(",") : ""}
        data-geometry={
          engine === "ready" ? (empty ? "empty" : shownCurrent ? "current" : building ? "building" : "stale") : engine
        }
      >
        {webglError && (
          <div className="notice glass" role="alert">
            <h2>3D view can't start</h2>
            <p>
              Your computer's graphics (WebGL 2) aren't available to the app. Updating your graphics driver usually
              fixes this. On Windows, also make sure Microsoft Edge WebView2 is installed.
            </p>
          </div>
        )}
        {engine === "failed" && (
          <div className="notice glass" role="alert">
            <h2>The geometry engine couldn't start</h2>
            <p>{engineError}</p>
          </div>
        )}
        {picking && (
          <div className="pick-hint glass" role="status">
            <Icon name="face" />
            <span>{pickMessage}</span>
            <button type="button" onClick={stopPicking}>
              Cancel
            </button>
          </div>
        )}
        {selection && selected && !draft && !picking && (
          <SelectionBar
            name={selected.name}
            face={selection.face !== null && meshRef.current ? faceName(selection.face) : null}
            moving={moveBy}
            canMove={movableAxes(selected).length > 0}
            canRemove={canRemove(doc, selected.id)}
            onSketch={sketchFace(selection.face)}
            onRemove={() => project.removeFeature(selected.id)}
            onClose={() => setSelection(null)}
          />
        )}
        {offer && !draft && (
          <section
            className="recovery glass"
            role="alertdialog"
            aria-labelledby="recovery-title"
            data-testid="recovery"
          >
            <Icon name="alert" />
            <div>
              <h2 id="recovery-title">Restore your unsaved work?</h2>
              <p>
                Studio 3D closed before {offer.snapshot.file ? offer.snapshot.file.name : "your design"} was saved. A
                backup from {whenSaved(offer.snapshot.savedAt)} is ready to restore.
              </p>
              <p className="muted">New changes aren't backed up until you choose.</p>
            </div>
            <div className="actions">
              <button type="button" className="restore" onClick={() => void project.restoreBackup()}>
                Restore
              </button>
              <button type="button" onClick={() => void project.discardBackup()}>
                Discard
              </button>
            </div>
          </section>
        )}
        {notice && (
          <div className={`toast glass ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
            <Icon name={notice.kind === "error" ? "alert" : "check"} />
            <span>{notice.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <Icon name="close" />
            </button>
          </div>
        )}
      </main>

      <header className="topbar" ref={topbarRef}>
        <div className="glass bar">
          <span className="brand" title={`${APP_INFO.name} ${APP_INFO.version}`}>
            <span className="logo" aria-hidden="true" />
            <span className="visually-hidden">{APP_INFO.name}</span>
          </span>
          <MenuBar menus={menus} />
          <span className="divider" aria-hidden="true" />
          <nav className="group" aria-label="Quick access">
            <button
              type="button"
              className="icon-only"
              aria-label="New"
              title="New project (Ctrl+N)"
              onClick={() => void project.newProject()}
              disabled={busy}
            >
              <Icon name="new" />
            </button>
            <button
              type="button"
              className="icon-only"
              aria-label="Open…"
              title="Open a project (Ctrl+O)"
              onClick={() => void project.openProject()}
              disabled={busy}
            >
              <Icon name="open" />
            </button>
            <button
              type="button"
              className="icon-only"
              aria-label={saveLabel}
              title={`${saveLabel} (Ctrl+S)`}
              onClick={() => void project.save(false)}
              disabled={busy}
            >
              <Icon name="save" />
            </button>
            <span className="divider" aria-hidden="true" />
            <button
              type="button"
              className="icon-only"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              onClick={project.undo}
              disabled={!project.canUndo}
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className="icon-only"
              aria-label="Redo"
              title="Redo (Ctrl+Y)"
              onClick={project.redo}
              disabled={!project.canRedo}
            >
              <Icon name="redo" />
            </button>
          </nav>
        </div>

        <nav className="glass bar segmented" aria-label="Camera views">
          {VIEW_BUTTONS.map((b) => (
            <button
              key={b.view}
              type="button"
              aria-pressed={camera?.view === b.view}
              title={`${b.label} view (key ${b.key})`}
              onClick={() => viewportRef.current?.setView(b.view)}
              disabled={webglError}
            >
              {b.label}
            </button>
          ))}
          <span className="divider" aria-hidden="true" />
          <button
            type="button"
            aria-pressed={showSizes}
            title="Show sizes in the 3D view (M)"
            onClick={() => setShowSizes((v) => !v)}
            disabled={webglError}
          >
            <Icon name="ruler" />
            Sizes
          </button>
        </nav>

        <button
          type="button"
          className="primary"
          onClick={() => void exportStl()}
          disabled={busy || !exportable}
          title={
            exportable
              ? "Export a mesh for your slicer"
              : empty
                ? "Add a shape to export"
                : "Fix the highlighted values to export"
          }
        >
          <Icon name="export" />
          Export STL
        </button>
      </header>

      <DesignPanel
        ref={panelRef}
        doc={doc}
        issues={issues}
        measurements={built?.measurements ?? null}
        builtDoc={built?.doc ?? null}
        stale={!upToDate && built !== null}
        onChange={project.updateFeature}
        onAdd={project.addFeature}
        onRemove={project.removeFeature}
        onSketchOnFace={startPicking}
        onSketchOnPlate={sketchOnPlate}
        onRevolve={startRevolve}
        onEditSketch={editSketch}
        picking={picking}
        onFocus={setFocusId}
        selected={selection?.id ?? null}
        onSelect={(id) => setSelection((s) => (id === null ? null : s?.id === id ? s : { id, face: null }))}
      />

      {draft && (
        <SketchEditor
          draft={draft}
          issues={draftIssues}
          canCut={draft.feature.surface !== "plate" && draftIndex > 0}
          view={sketchView}
          onView={setSketchView}
          onChange={(feature) => setDraft((d) => (d ? { ...d, feature } : d))}
          onDone={finishSketch}
          onCancel={() => setDraft(null)}
        />
      )}

      <footer className="statusbar glass" ref={statusRef}>
        <span data-testid="save-status" className={dirty ? "unsaved" : undefined}>
          <span className="dot" aria-hidden="true" />
          {name} · {saveStatus}
        </span>
        <span className="engine">
          {engine === "starting"
            ? "Starting geometry engine…"
            : engine === "failed"
              ? "Geometry engine unavailable"
              : empty
                ? "Empty plate: add a shape to start"
                : building
                ? "Updating model…"
                : upToDate
                  ? "Model up to date"
                  : "Showing your last good design"}
        </span>
        <span className="hint">
          <span className="pointer-readout" ref={pointerReadout} data-testid="pointer-readout" />
          <span className="hint-text">
            Click to select · Wheel-drag to pan · Shift+wheel-drag to orbit · Scroll to zoom · Help › Keyboard and
            mouse lists the rest
          </span>
        </span>
      </footer>

      {dialog && <HelpDialog kind={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Orbit", "Shift + wheel-drag, or left-drag"],
  ["Pan", "Wheel-drag, or right-drag"],
  ["Zoom", "Scroll (zooms where the pointer is)"],
  ["Fit everything on screen", "Double-click the wheel"],
  ["3D / Top / Front / Right view", "0 / 1 / 2 / 3"],
  ["Show or hide sizes", "M"],
  ["Select a piece", "Click it"],
  ["Move the selected piece", "Drag its arrows, or arrow keys (Shift = 10 mm), Page Up / Page Down"],
  ["Delete the selected piece", "Delete"],
  ["Undo / Redo", "Ctrl+Z / Ctrl+Y"],
  ["New / Open / Save / Save as", "Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S"],
  ["Menus", "Alt, or Alt + the menu's first letter"],
  ["Sketch: Select / Rectangle / Circle / Outline", "V / R / C / L"],
  ["Sketch: type a size while drawing", "Type the number, Tab to the next box, Enter"],
  ["Sketch: close an outline", "Enter, or click its first corner"],
];

/** Help > Keyboard and mouse, and Help > About. */
function HelpDialog({ kind, onClose }: { kind: "shortcuts" | "about"; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const title = kind === "shortcuts" ? "Keyboard and mouse" : `About ${APP_INFO.name}`;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog glass" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <h2>{title}</h2>
        {kind === "shortcuts" ? (
          <table className="shortcuts">
            <tbody>
              {SHORTCUTS.map(([what, how]) => (
                <tr key={what}>
                  <th scope="row">{what}</th>
                  <td>{how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <p>Version {APP_INFO.version}</p>
            <p className="muted">
              Design parts for 3D printing. Geometry by Open CASCADE Technology through replicad; the notices that come
              with the app list every open-source licence.
            </p>
          </>
        )}
        <div className="actions">
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** The design with a sketch that's being drawn: added at the end, or in place of the one being edited. */
function withDraft(doc: ProjectDocument, f: SketchFeature, isNew: boolean): ProjectDocument {
  return {
    ...doc,
    features: isNew ? [...doc.features, f] : doc.features.map((x) => (x.id === f.id ? f : x)),
  };
}

/** The kernel repeats the input checks it ran; show each message once. */
function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.featureId}|${i.field}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Any step can be removed, the original shape and the last one included (that leaves an empty plate). */
function canRemove(doc: ProjectDocument, id: string): boolean {
  return doc.features.some((x) => x.id === id);
}

/** The middle of the box around some points (x, y, z triples). */
function middleOf(points: Float32Array): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, points[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, points[i]!);
  }
  return [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2) as [number, number, number];
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.round(Math.abs(n) * 10) / 10} mm`;

/** What is selected, how far it is being moved, and what can be done with it. */
function SelectionBar(props: {
  name: string;
  face: string | null;
  moving: [number, number, number] | null;
  canMove: boolean;
  canRemove: boolean;
  onSketch?: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const m = props.moving;
  const axis = m ? m.findIndex((v) => v !== 0) : -1;
  return (
    <div className="selection-bar glass" role="status" aria-label="Selected piece" data-testid="selection-bar">
      <span className="selection-name">
        <strong>{props.name}</strong>
        {props.face && <span className="selection-face"> · {props.face}</span>}
      </span>
      <span className="selection-help">
        {m
          ? axis < 0
            ? "Moving…"
            : `Moving ${["left/right", "front/back", "up/down"][axis]} ${signed(m[axis]!)}`
          : props.canMove
            ? "Drag an arrow or press the arrow keys to move it"
            : "Edit it in the panel"}
      </span>
      {props.onSketch && (
        <button type="button" onClick={props.onSketch}>
          <Icon name="pencil" />
          Sketch on this face
        </button>
      )}
      <button
        type="button"
        onClick={props.onRemove}
        disabled={!props.canRemove}
        title="Remove it (Delete key)"
      >
        <Icon name="trash" />
        Remove
      </button>
      <button type="button" className="icon-only" aria-label="Deselect" title="Deselect (Esc)" onClick={props.onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
