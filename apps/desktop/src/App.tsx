import { useEffect, useRef, useState } from "react";
import { Viewport, isWebGLAvailable, type CameraState, type StandardView } from "@studio3d/viewport";

const VIEW_BUTTONS: { view: StandardView; label: string; key: string }[] = [
  { view: "iso", label: "3D", key: "0" },
  { view: "top", label: "Top", key: "1" },
  { view: "front", label: "Front", key: "2" },
  { view: "right", label: "Right", key: "3" },
];

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const [camera, setCamera] = useState<CameraState | null>(null);
  const [webglError, setWebglError] = useState(false);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return;
      const b = VIEW_BUTTONS.find((v) => v.key === e.key);
      if (b) viewportRef.current?.setView(b.view);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Studio 3D</span>
        <nav className="view-group" aria-label="Camera views">
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

      <main className="viewport-host" ref={hostRef} data-camera-view={camera?.view ?? ""}
        data-camera-position={camera ? camera.position.join(",") : ""}
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
      </main>

      <footer className="statusbar">
        <span>Left-drag to orbit · Right-drag or Shift-drag to pan · Scroll to zoom · Keys 0–3 change view</span>
        <span className="muted">Build plate 256 × 256 mm · Modeling tools are not built yet (next milestone)</span>
      </footer>
    </div>
  );
}
