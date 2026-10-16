import { useCallback, useEffect, useRef, useState } from "react";
import { Viewport, isWebGLAvailable, type CameraState, type StandardView } from "@studio3d/viewport";
import { GeometryClient, createGeometryWorker, type Measurements } from "@studio3d/geometry";
import { hasErrors, validateDocument, type Issue, type ProjectDocument } from "@studio3d/document";
import { DesignPanel } from "./DesignPanel";
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

  // Rebuild real geometry whenever the document changes and its values are valid.
  const inputIssues = validateDocument(doc);
  const inputOk = !hasErrors(inputIssues);
  useEffect(() => {
    const client = geometryRef.current;
    if (!inputOk) setBuilding(false);
    if (!client || engine !== "ready" || !inputOk) return;
    setBuilding(true);
    const timer = setTimeout(() => {
      client.rebuild(doc).then(
        (r) => {
          if (r.status === "superseded") return;
          setBuilding(false);
          if (r.status === "built") {
            viewportRef.current?.setModel(r.mesh);
            setBuilt({ doc, measurements: r.measurements });
            setKernelIssues(r.issues); // warnings found while building, e.g. a hole that cuts nothing
          } else {
            setKernelIssues(r.issues);
          }
        },
        () => setBuilding(false),
      );
    }, 80);
    return () => clearTimeout(timer);
  }, [doc, engine, inputOk]);

  const issues = inputOk ? dedupe([...inputIssues, ...kernelIssues]) : inputIssues;
  // Up to date only when the model on screen was built from exactly this document (not just "nothing is building yet").
  const upToDate = inputOk && !building && !hasErrors(kernelIssues) && built?.doc === doc;

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
  }, [project]);

  // Window title and close guard
  // The title is only set once the geometry engine has loaded, so it also tells (and CI checks) that the kernel started.
  useEffect(() => {
    if (engine === "starting") return;
    const suffix = engine === "failed" ? " (geometry engine unavailable)" : "";
    platform.setTitle(`${name}${dirty ? " •" : ""} — Studio 3D${suffix}`);
  }, [name, dirty, engine]);
  useEffect(() => platform.guardClose(() => dirtyRef.current), [dirtyRef]);

  const saveLabel = platform.capabilities.saveInPlace ? "Save" : "Download project";
  const saveStatus = dirty ? "Unsaved changes" : project.file ? "All changes saved" : "Not saved yet";

  return (
    <div className="app">
      <main
        className="viewport-host"
        ref={hostRef}
        data-camera-view={camera?.view ?? ""}
        data-camera-position={camera ? camera.position.join(",") : ""}
        data-geometry={engine === "ready" ? (upToDate ? "current" : building ? "building" : "stale") : engine}
      >
        {webglError && (
          <div className="notice glass" role="alert">
            <h2>3D view can't start</h2>
            <p>
              Your computer's graphics (WebGL 2) aren't available to the app. Updating your graphics driver usually fixes this. On
              Windows, also make sure Microsoft Edge WebView2 is installed.
            </p>
          </div>
        )}
        {engine === "failed" && (
          <div className="notice glass" role="alert">
            <h2>The geometry engine couldn't start</h2>
            <p>{engineError}</p>
          </div>
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
          <span className="brand">
            <span className="logo" aria-hidden="true" />
            Studio 3D
          </span>
          <span className="divider" aria-hidden="true" />
          <nav className="group" aria-label="File">
            <button type="button" onClick={() => void project.newProject()} disabled={busy} title="New project (Ctrl+N)">
              <Icon name="new" />
              New
            </button>
            <button type="button" onClick={() => void project.openProject()} disabled={busy} title="Open a project (Ctrl+O)">
              <Icon name="open" />
              Open…
            </button>
            <button type="button" onClick={() => void project.save(false)} disabled={busy} title={`${saveLabel} (Ctrl+S)`}>
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
          title={upToDate ? "Export a mesh for your slicer" : "Fix the highlighted values to export"}
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
      />

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
              : building
                ? "Updating model…"
                : upToDate
                  ? "Model up to date"
                  : "Showing your last good design"}
        </span>
        <span className="hint">Drag to orbit · Right-drag to pan · Scroll to zoom · Keys 0–3 change view</span>
      </footer>
    </div>
  );
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
