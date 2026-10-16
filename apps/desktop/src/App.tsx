import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Viewport,
  isWebGLAvailable,
  type CameraState,
  type StandardView,
} from "@studio3d/viewport";
import {
  GeometryClient,
  createGeometryWorker,
  faceOfTriangle,
  facePoints,
  outlineOfFace,
  trianglesInPlane,
  type Measurements,
  type MeshData,
} from "@studio3d/geometry";
import {
  PLATE_PLANE,
  hasErrors,
  newSketch,
  validateDocument,
  validateSketch,
  type Issue,
  type ProjectDocument,
  type SketchFeature,
} from "@studio3d/document";
import { DesignPanel } from "./DesignPanel";
import { SketchEditor, type SketchDraft } from "./SketchEditor";
import { sketchLines, sketchViewpoint } from "./sketch3d";
import { Icon } from "./Icon";
import { platform } from "./platform";
import { useProject } from "./useProject";

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
    for (const el of [
      hostRef.current,
      topbarRef.current,
      panelRef.current,
      statusRef.current,
    ])
      if (el) ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  // Geometry engine
  useEffect(() => {
    const client = new GeometryClient(createGeometryWorker, (msg) =>
      setNotice({ kind: "error", text: msg }),
    );
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
  const shownDoc = useMemo(
    () => (draft ? withDraft(doc, draft.feature, draft.isNew) : doc),
    [doc, draft],
  );

  // Rebuild real geometry whenever the document changes and its values are valid.
  const inputIssues = validateDocument(shownDoc);
  const inputOk = !hasErrors(inputIssues);
  useEffect(() => {
    const client = geometryRef.current;
    if (!inputOk) setBuilding(false);
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
  }, [shownDoc, engine, inputOk]);

  const issues = inputOk
    ? dedupe([...inputIssues, ...kernelIssues])
    : inputIssues;
  // Up to date only when the model on screen was built from exactly this document (not just "nothing is building yet").
  const shownCurrent =
    inputOk && !building && !hasErrors(kernelIssues) && built?.doc === shownDoc;
  const upToDate = shownCurrent && shownDoc === doc;

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

  const onHostPointerMove = (e: React.PointerEvent) => {
    if (!picking || e.buttons) return;
    const hit = faceAt(e.clientX, e.clientY);
    viewportRef.current?.setHighlight(
      hit?.outline ? new Float32Array(hit.points.flat()) : null,
    );
    setPickMessage(
      hit && !hit.outline
        ? "That face is curved. Pick a flat one."
        : "Click a flat face of the part to draw on it.",
    );
  };
  const onHostPointerUp = (e: React.PointerEvent) => {
    const down = pointerDown.current;
    pointerDown.current = null;
    if (
      !picking ||
      !down ||
      Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
    )
      return; // a drag orbits instead
    const hit = faceAt(e.clientX, e.clientY);
    if (!hit?.outline) return;
    const o = hit.outline;
    stopPicking();
    setSketchView("2d");
    setDraft({
      feature: newSketch(doc, o.plane, o.label, [], "add", 5),
      isNew: true,
      face: { triangles: o.triangles, width: o.width, height: o.height },
      area: [0, 0, o.width, o.height],
    });
  };

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

  const editSketch = useCallback(
    (id: string) => {
      const f = doc.features.find(
        (x): x is SketchFeature => x.id === id && x.type === "sketch",
      );
      if (!f) return;
      const mesh = meshRef.current;
      const triangles =
        f.surface !== "plate" && mesh ? trianglesInPlane(mesh, f.plane) : [];
      const xs = triangles.map((t) => t[0]);
      const ys = triangles.map((t) => t[1]);
      const face = triangles.length
        ? { triangles, width: Math.max(...xs), height: Math.max(...ys) }
        : null;
      stopPicking();
      setSketchView("2d");
      setDraft({
        feature: f,
        isNew: false,
        face,
        area: face ? [0, 0, face.width, face.height] : [-60, -60, 60, 60],
      });
    },
    [doc, stopPicking],
  );

  const finishSketch = useCallback(() => {
    if (!draft) return;
    const f = draft.feature;
    if (draft.isNew) project.addFeature(f);
    else
      project.updateFeature(f.id, {
        profiles: f.profiles,
        mode: f.mode,
        depth: f.depth,
      });
    setDraft(null);
  }, [draft, project]);

  // In the sketch's 3D view, show the outlines on the face and look at them from an angle.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    if (draft && sketchView === "3d")
      vp.setSketchLines(sketchLines(draft.feature));
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
        ...(inputOk
          ? kernelIssues.filter((i) => i.featureId === draft.feature.id)
          : []),
      ])
    : [];
  const draftIndex = draft
    ? shownDoc.features.findIndex((f) => f.id === draft.feature.id)
    : -1;

  const exportStl = useCallback(
    () =>
      run(async () => {
        const client = geometryRef.current;
        if (!client) return;
        const r = await client.rebuild(doc); // make sure the export matches exactly what's on screen
        if (r.status !== "built")
          throw new Error("Fix the highlighted values before exporting.");
        const data = await client.exportStl();
        const saved = await platform.exportStl(data, name);
        if (saved) setNotice({ kind: "info", text: `Exported ${saved.name}.` });
      }),
    [doc, name, run, setNotice],
  );

  // Keyboard: views, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, and Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+N
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (draft) return; // the sketch screen handles its own keys
      if (picking && e.key === "Escape") {
        stopPicking();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
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
      if (mod || e.altKey || e.target instanceof HTMLInputElement) return;
      const b = VIEW_BUTTONS.find((v) => v.key === e.key);
      if (b) viewportRef.current?.setView(b.view);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, draft, picking, stopPicking]);

  // Window title and close guard
  // The title is only set once the geometry engine has loaded, so it also tells (and CI checks) that the kernel started.
  useEffect(() => {
    if (engine === "starting") return;
    const suffix = engine === "failed" ? " (geometry engine unavailable)" : "";
    platform.setTitle(`${name}${dirty ? " •" : ""} — Studio 3D${suffix}`);
  }, [name, dirty, engine]);
  useEffect(() => platform.guardClose(() => dirtyRef.current), [dirtyRef]);

  const saveLabel = platform.capabilities.saveInPlace
    ? "Save"
    : "Download project";
  const saveStatus = dirty
    ? "Unsaved changes"
    : project.file
      ? "All changes saved"
      : "Not saved yet";

  return (
    <div
      className={`app${draft ? " sketching" : ""}${picking ? " picking" : ""}`}
    >
      <main
        className="viewport-host"
        ref={hostRef}
        onPointerDown={(e) =>
          (pointerDown.current = { x: e.clientX, y: e.clientY })
        }
        onPointerMove={onHostPointerMove}
        onPointerUp={onHostPointerUp}
        data-camera-view={camera?.view ?? ""}
        data-camera-position={camera ? camera.position.join(",") : ""}
        data-geometry={
          engine === "ready"
            ? shownCurrent
              ? "current"
              : building
                ? "building"
                : "stale"
            : engine
        }
      >
        {webglError && (
          <div className="notice glass" role="alert">
            <h2>3D view can't start</h2>
            <p>
              Your computer's graphics (WebGL 2) aren't available to the app.
              Updating your graphics driver usually fixes this. On Windows, also
              make sure Microsoft Edge WebView2 is installed.
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
        {notice && (
          <div
            className={`toast glass ${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            <Icon name={notice.kind === "error" ? "alert" : "check"} />
            <span>{notice.text}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
      </main>

      <header className="topbar" ref={topbarRef}>
        <div className="glass bar">
          <span className="brand">
            <span className="logo" aria-hidden="true" />
            Studio 3D
          </span>
          <span className="divider" aria-hidden="true" />
          <nav className="group" aria-label="File">
            <button
              type="button"
              onClick={() => void project.newProject()}
              disabled={busy}
              title="New project (Ctrl+N)"
            >
              <Icon name="new" />
              New
            </button>
            <button
              type="button"
              onClick={() => void project.openProject()}
              disabled={busy}
              title="Open a project (Ctrl+O)"
            >
              <Icon name="open" />
              Open…
            </button>
            <button
              type="button"
              onClick={() => void project.save(false)}
              disabled={busy}
              title={`${saveLabel} (Ctrl+S)`}
            >
              <Icon name="save" />
              {saveLabel}
            </button>
            {platform.capabilities.saveInPlace && (
              <button
                type="button"
                onClick={() => void project.save(true)}
                disabled={busy}
                title="Save as a new file (Ctrl+Shift+S)"
              >
                Save as…
              </button>
            )}
          </nav>
          <span className="divider" aria-hidden="true" />
          <nav className="group" aria-label="Edit">
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
        </nav>

        <button
          type="button"
          className="primary"
          onClick={() => void exportStl()}
          disabled={busy || !upToDate}
          title={
            upToDate
              ? "Export a mesh for your slicer"
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
        holes={project.holes}
        issues={issues}
        measurements={built?.measurements ?? null}
        builtDoc={built?.doc ?? null}
        stale={!upToDate && built !== null}
        onChange={project.updateFeature}
        onAdd={project.addFeature}
        onRemove={project.removeFeature}
        onSketchOnFace={startPicking}
        onSketchOnPlate={sketchOnPlate}
        onEditSketch={editSketch}
        picking={picking}
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
        <span
          data-testid="save-status"
          className={dirty ? "unsaved" : undefined}
        >
          <span className="dot" aria-hidden="true" />
          {name} · {saveStatus}
        </span>
        <span className="engine">
          {engine === "starting"
            ? "Starting geometry engine…"
            : engine === "failed"
              ? "Geometry engine unavailable"
              : building
                ? "Updating model…"
                : upToDate
                  ? "Model up to date"
                  : "Showing your last good design"}
        </span>
        <span className="hint">
          Drag to orbit · Right-drag to pan · Scroll to zoom · Keys 0–3 change
          view
        </span>
      </footer>
    </div>
  );
}

/** The design with a sketch that's being drawn: added at the end, or in place of the one being edited. */
function withDraft(
  doc: ProjectDocument,
  f: SketchFeature,
  isNew: boolean,
): ProjectDocument {
  return {
    ...doc,
    features: isNew
      ? [...doc.features, f]
      : doc.features.map((x) => (x.id === f.id ? f : x)),
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
