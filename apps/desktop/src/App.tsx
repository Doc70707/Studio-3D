import { useCallback, useEffect, useRef, useState } from "react";
import { Viewport, isWebGLAvailable, type CameraState, type StandardView } from "@studio3d/viewport";
import { GeometryClient, createGeometryWorker, type Measurements } from "@studio3d/geometry";
import { hasErrors, validateBox, type BoxFeature, type Issue } from "@studio3d/document";
import { BoxPanel } from "./BoxPanel";
import { platform } from "./platform";
import { useProject } from "./useProject";

const VIEW_BUTTONS: { view: StandardView; label: string; key: string }[] = [
  { view: "iso", label: "3D", key: "0" },
  { view: "top", label: "Top", key: "1" },
  { view: "front", label: "Front", key: "2" },
  { view: "right", label: "Right", key: "3" },
];

type Engine = "starting" | "ready" | "failed";
type Built = { box: BoxFeature; measurements: Measurements };

export function App() {
  const project = useProject();
  const { doc, box, dirty, dirtyRef, name, notice, setNotice, busy, run } = project;

  const hostRef = useRef<HTMLDivElement>(null);
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
  const inputIssues = validateBox(box);
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
            setBuilt({ box: doc.features[0]!, measurements: r.measurements });
            setKernelIssues([]);
          } else {
            setKernelIssues(r.issues);
          }
        },
        () => setBuilding(false),
      );
    }, 80);
    return () => clearTimeout(timer);
  }, [doc, engine, inputOk]);

  const issues = inputOk ? [...inputIssues, ...kernelIssues] : inputIssues;
  const upToDate = inputOk && !building && kernelIssues.length === 0 && built !== null;

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

  // Keyboard: views, and Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+N
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
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
      <header className="topbar">
        <span className="brand">Studio 3D</span>
        <nav className="group" aria-label="File">
          <button type="button" onClick={() => void project.newProject()} disabled={busy} title="New project (Ctrl+N)">
            New
          </button>
          <button type="button" onClick={() => void project.openProject()} disabled={busy} title="Open a project (Ctrl+O)">
            Open…
          </button>
          <button type="button" onClick={() => void project.save(false)} disabled={busy} title={`${saveLabel} (Ctrl+S)`}>
            {saveLabel}
          </button>
          {platform.capabilities.saveInPlace && (
            <button type="button" onClick={() => void project.save(true)} disabled={busy} title="Save as a new file (Ctrl+Shift+S)">
              Save as…
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => void exportStl()}
            disabled={busy || !upToDate}
            title={upToDate ? "Export a mesh for your slicer" : "Fix the highlighted values to export"}
          >
            Export STL
          </button>
        </nav>
        <nav className="group" aria-label="Camera views">
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
      </header>

      <div className="workspace">
        <BoxPanel
          box={box}
          issues={issues}
          measurements={built?.measurements ?? null}
          builtBox={built?.box ?? null}
          onChange={project.updateBox}
          stale={!upToDate && built !== null}
        />
        <main
          className="viewport-host"
          ref={hostRef}
          data-camera-view={camera?.view ?? ""}
          data-camera-position={camera ? camera.position.join(",") : ""}
          data-geometry={engine === "ready" ? (upToDate ? "current" : building ? "building" : "stale") : engine}
        >
          {webglError && (
            <div className="notice" role="alert">
              <h2>3D view can't start</h2>
              <p>
                Your computer's graphics (WebGL 2) aren't available to the app. Updating your graphics driver usually fixes
                this. On Windows, also make sure Microsoft Edge WebView2 is installed.
              </p>
            </div>
          )}
          {engine === "failed" && (
            <div className="notice" role="alert">
              <h2>The geometry engine couldn't start</h2>
              <p>{engineError}</p>
            </div>
          )}
          {notice && (
            <div className={`toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
              <span>{notice.text}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span data-testid="save-status">
          {name} · {saveStatus}
        </span>
        <span className="muted">
          {engine === "starting" ? "Starting geometry engine…" : engine === "failed" ? "Geometry engine unavailable" : building ? "Updating model…" : "Model up to date"}
          {" · "}Drag to orbit · Right-drag to pan · Scroll to zoom · Keys 0–3 change view
        </span>
      </footer>
    </div>
  );
}
