import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Viewport,
  isWebGLAvailable,
  partDimensions,
  setDimensionFormat,
  type CameraState,
  type Projection,
  type StandardView,
} from "@studio3d/viewport";
import {
  GeometryClient,
  createGeometryWorker,
  faceOfTriangle,
  facePoints,
  facesOf,
  outlineOfFace,
  pointsOfFaces,
  trianglesInPlane,
  checkBinaryStl,
  stlTo3mf,
  SlicerClient,
  createSlicerWorker,
  type Measurements,
  type PrintJobResult,
  type SlicedPart,
  type SlicerSettings,
  type EdgeInfo,
  type MeshData,
  type StlReport,
} from "@studio3d/geometry";
import {
  threadSettingsFor,
  withThread,
  type ThreadSettings,
  PLATE_PLANE,
  SHAPES,
  boxSideFace,
  measuredFrom,
  toSketch,
  turnStep,
  moveStep,
  scaleStep,
  copyStep,
  isCopyable,
  isShape,
  isSolidStep,
  type Change,
  type Feature,
  boxSideOf,
  canFollow,
  hasErrors,
  isHollow,
  movableAxes,
  newHole,
  newEdgeStep,
  PICK_TOLERANCE,
  newHollow,
  newMirror,
  newPattern,
  newRevolve,
  newShape,
  newSketch,
  validateDocument,
  validateSketch,
  type BoxFeature,
  type FaceOutline,
  type HoleFace,
  type HoleFeature,
  type Issue,
  type ProjectDocument,
  newReference,
  referenceCorners,
  validateReference,
  type SketchFeature,
  printChecks,
  printerById,
  DEFAULT_LAYER_HEIGHT,
  DEFAULT_WALLS,
  DEFAULT_INFILL,
  LINE_WIDTH,
  getDisplayUnits,
  lengthNumber,
  lengthText,
} from "@studio3d/document";
import { CalibrateDialog, choosePicture, readPicture } from "./ReferencePanel";
import { SHAPE_ORDER, copySource, placeNew, useDesignPanel } from "./DesignPanel";
import { Palette } from "./Palette";
import { SettingsWindow, type SettingsCategory } from "./SettingsWindow";
import { ViewNav } from "./ViewNav";
import { applyAppearance, readAppearance, viewportColors, writeAppearance, type Appearance } from "./appearance";
import { Ribbon, type RibbonTab } from "./Ribbon";
import {
  DEFAULT_WORKSPACE,
  readWorkspace,
  sideOf,
  writeWorkspace,
  type PaletteId,
  type PaletteLayout,
  type Workspace,
} from "./workspace";
import { MenuBar, type Menu } from "./MenuBar";
import { allows, interactionMode } from "./interaction";
import { SketchEditor, type SketchDraft } from "./SketchEditor";
import { faceForHoles, holeSteps } from "./faceHoles";
import { ThreadDialog } from "./ThreadDialog";
import { cosmeticThreadLines } from "./cosmeticThreads";
import { ContextMenu, snapShape, type MenuCommand, type SnapChoice } from "./ContextMenu";
import { toggleSnap, useSnaps } from "./snapSettings";
import { SKETCH_ONLY, SNAPS_3D, describeEdge, distance, edgeAt, findSnap3, type Snap3, type Vec3 } from "./snap3d";
import { SNAP_KINDS, SNAP_LABELS, type SnapKind } from "./precision";
import { sketchLines, sketchViewpoint } from "./sketch3d";
import { featureDimensions } from "./guides";
import { setUnits, toggleUnits, useUnits } from "./unitsSetting";
import { UnitsSwitch } from "./UnitsSwitch";
import { Icon } from "./Icon";
import { CommandLine, type CommandLineHandle, type CommandPrompt } from "./CommandLine";
import { Blurry, BlurryButton } from "./Blurry";
import type { HelperContext } from "./helperAI";
import type { HelperChange } from "./helperTools";
import { indexCommands, type Command } from "./commands";
import { type Tool as SketchTool } from "./SketchEditor";
import { platform, type MeshFormat, type SlicerProgram } from "./platform";
import { PrintPanel, duration, type LayerPreview, type PrintState, type SliceSummary } from "./PrintPanel";
import { escapeLeaves, focusPanelAfterSelection, type FocusPanel } from "./screen";
import { APP_INFO, useProject, whenSaved } from "./useProject";

/** Views on the view bar and in the View menu. Shift with a number key looks from the opposite side. */
const VIEW_BUTTONS: { view: StandardView; label: string; key: string; shift?: boolean; bar?: boolean }[] = [
  { view: "iso", label: "3D", key: "0", bar: true },
  { view: "top", label: "Top", key: "1", bar: true },
  { view: "front", label: "Front", key: "2", bar: true },
  { view: "right", label: "Right", key: "3", bar: true },
  { view: "bottom", label: "Bottom", key: "1", shift: true },
  { view: "back", label: "Back", key: "2", shift: true },
  { view: "left", label: "Left", key: "3", shift: true },
];
const viewShortcut = (b: (typeof VIEW_BUTTONS)[number]) => (b.shift ? `Shift+${b.key}` : b.key);
/** Switches between perspective and orthographic (parallel) projection. */
const PROJECTION_KEY = "5";

type Engine = "starting" | "ready" | "failed";
/** The last model the engine built, and the exact document it was built from. */
type Built = { doc: ProjectDocument; measurements: Measurements };

export function App() {
  const project = useProject();
  const { doc, dirty, dirtyRef, name, notice, setNotice, busy, run } = project;

  const hostRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const ribbonRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const geometryRef = useRef<GeometryClient | null>(null);
  const [camera, setCamera] = useState<CameraState | null>(null);
  const projection: Projection = camera?.projection ?? "perspective";
  const toggleProjection = useCallback(() => {
    const vp = viewportRef.current;
    vp?.setProjection(vp.projection === "orthographic" ? "perspective" : "orthographic");
  }, []);
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
  /** What a picked face is for: a sketch (undefined), a new hole (null), or moving that hole onto it (its id). */
  const [holeTarget, setHoleTarget] = useState<string | null | undefined>(undefined);
  const pickPrompt =
    holeTarget === undefined
      ? "Click a flat face of the part to draw on it."
      : holeTarget === null
        ? "Click on the part where the hole goes; snaps find centres and edges. Enter puts it in the middle, Esc cancels."
        : "Click a flat face of the part to move the hole onto it. It goes in the middle; then set its distances.";
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
  /** The workspace: Design (build the part) or Print Studio (check it and get it ready for a printer). */
  const [workspace, setWorkspace] = useState<"design" | "print">("design");
  const printing = workspace === "print";
  /** The Thread dialog: the hole being threaded and the settings being tried (previewed in the 3D view). */
  const [threadEdit, setThreadEdit] = useState<{ id: string; settings: ThreadSettings } | null>(null);
  /** Measure (D): the first and second points, each on a snap or on the part or plate. */
  const [measure, setMeasure] = useState<{ a: Vec3 | null; b: Vec3 | null } | null>(null);
  /** Where the pointer would put the next measuring point, shown as a live line from the first. */
  const [measureCursor, setMeasureCursor] = useState<Vec3 | null>(null);
  const [snaps, setSnaps] = useSnaps();
  const units = useUnits();
  /** A snap picked from the right-click menu for the next point only (AutoCAD's snap override). */
  const [snapOnce, setSnapOnce] = useState<SnapKind | null>(null);
  /** The snap the pointer is on, drawn at its place in the 3D view. */
  const [snapMark, setSnapMark] = useState<{ snap: Snap3; x: number; y: number } | null>(null);
  /** The right-click menu, where it opened (window pixels). */
  const [menu3d, setMenu3d] = useState<{ x: number; y: number } | null>(null);
  const closeMenu3d = useCallback(() => setMenu3d(null), []);
  const cancelThread = useCallback(() => setThreadEdit(null), []);
  const rightDown = useRef<{ x: number; y: number } | null>(null);
  const mode = interactionMode({
    sketching: !!draft,
    picking,
    moving: moveBy !== null,
    printing,
    measuring: measure !== null,
  });
  const hovered = useRef<string | null>(null);
  /** Edges clicked in the 3D view (their middles), for a fillet or chamfer on just those. */
  const [edgePicks, setEdgePicks] = useState<Vec3[]>([]);
  /** The edge under the pointer, that a click would pick. */
  const hoverEdge = useRef<number | null>(null);
  const commandLine = useRef<CommandLineHandle>(null);
  const commandBox = useRef<HTMLDivElement>(null);
  /** A value the last typed command asks for (a fillet's radius), and the command waiting for its new step. */
  const [commandPrompt, setCommandPrompt] = useState<CommandPrompt | null>(null);
  /** Blurry's panel is open. */
  const [helperOpen, setHelperOpen] = useState(false);
  const [helperBusy, setHelperBusy] = useState(false);
  /** What Blurry with Claude sees and does, kept current on every render (his answers outlive a render). */
  const helperNow = useRef<{ context: HelperContext; apply: (c: HelperChange) => void } | null>(null);
  const helperContext = useCallback(() => helperNow.current!.context, []);
  const helperApply = useCallback((c: HelperChange) => helperNow.current!.apply(c), []);
  const waitingStep = useRef<{ title: string; count: number } | null>(null);
  /** The last values typed for MOVE, ROTATE and SCALE: Enter on an empty line uses them again, as AutoCAD does. */
  const lastMove = useRef<[number, number, number]>([0, 0, 0]);
  const lastTurn = useRef(0);
  const lastScale = useRef(1);
  /** Help > Keyboard and mouse / About. */
  const [dialog, setDialog] = useState<"shortcuts" | "about" | null>(null);
  /** The reference picture being calibrated, if any. */
  const [calibrating, setCalibrating] = useState<string | null>(null);
  /** Full screen (the window covers the screen) and Focus canvas (most panels step aside): independent screen modes. */
  const [fullScreen, setFullScreen] = useState(false);
  const [focus, setFocus] = useState(false);
  /** Whether the side panel is open outside Focus canvas, and inside it. */
  const [panelOpen, setPanelOpen] = useState(true);
  const [focusPanel, setFocusPanel] = useState<FocusPanel>("closed");
  const panelShown = focus ? focusPanel !== "closed" : panelOpen;
  /** How the user has arranged the workspace: kept on this computer, like a CAD program's workspace. */
  const [layout, setLayout] = useState<Workspace>(readWorkspace);
  /** Theme, accent and part colour: kept on this computer. The page's colours were set before the first paint. */
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  /** The Settings window, open at a category, or closed. */
  const [settingsAt, setSettingsAt] = useState<SettingsCategory | null>(null);
  const settingsOpen = settingsAt !== null;
  /** The ribbon's tab names sit in the top bar, so the ribbon is one row shorter. */
  const [ribbonTabsHost, setRibbonTabsHost] = useState<HTMLElement | null>(null);
  const changeAppearance = useCallback((a: Appearance) => {
    applyAppearance(a);
    writeAppearance(a);
    setAppearance(a);
  }, []);
  const arrange = useCallback((change: (w: Workspace) => Workspace) => {
    setLayout((w) => {
      const next = change(w);
      writeWorkspace(next);
      return next;
    });
  }, []);
  const layoutPalette = useCallback(
    (id: PaletteId, patch: Partial<PaletteLayout>) => arrange((w) => ({ ...w, [id]: { ...w[id], ...patch } })),
    [arrange],
  );
  const togglePalette = useCallback(
    (id: PaletteId) =>
      arrange((w) => ({ ...w, [id]: { ...w[id], shown: !(w[id].shown && !w[id].collapsed), collapsed: false } })),
    [arrange],
  );
  const togglePanel = useCallback(() => {
    if (focus) setFocusPanel((p) => (p === "closed" ? "open" : "closed"));
    else setPanelOpen((v) => !v);
  }, [focus]);
  const toggleCommandLine = useCallback(() => {
    setCommandPrompt(null);
    arrange((w) => ({ ...w, commandLine: !w.commandLine }));
  }, [arrange]);
  const toggleFocus = useCallback(() => {
    setFocus((f) => !f);
    setFocusPanel("closed");
  }, []);
  const toggleFullScreen = useCallback(() => {
    platform.fullScreen.set(!fullScreen).catch((e: Error) => {
      setNotice({ kind: "error", text: `Couldn't change full screen: ${e.message ?? e}` });
    });
  }, [fullScreen, setNotice]);
  useEffect(() => platform.fullScreen.onChange(setFullScreen), []);
  const pickedId = selection?.id ?? null;
  // In Focus canvas the panel comes up when a piece is selected, so its sizes can be typed, and goes when let go.
  useEffect(() => {
    if (focus) setFocusPanel((p) => focusPanelAfterSelection(p, pickedId !== null));
  }, [focus, pickedId]);

  // Viewport
  useEffect(() => {
    if (!hostRef.current) return;
    if (!isWebGLAvailable()) {
      setWebglError(true);
      return;
    }
    const vp = new Viewport(hostRef.current);
    vp.setColors(viewportColors(readAppearance()));
    viewportRef.current = vp;
    const off = vp.onCameraChange(setCamera);
    return () => {
      off();
      vp.dispose();
      viewportRef.current = null;
    };
  }, []);

  // The 3D view fills the window and the bars and palettes sit over its edges, so keep the scene centred in the space
  // they leave open.
  const [safeArea, setSafeArea] = useState("");
  // Blurry's open panel takes a column on the right, as a palette would, so the part moves over and stays in view.
  const helperPanel = useRef<HTMLElement>(null);
  const helperShown = helperOpen && !draft && !focus;
  const helperRoomWas = useRef(0);
  useEffect(() => {
    const update = () => {
      const vp = viewportRef.current;
      const host = hostRef.current;
      if (!vp || !host) return;
      const h = host.getBoundingClientRect();
      // Something put away has no size, and covers nothing.
      const rect = (el: HTMLElement | null) => {
        const r = el?.getBoundingClientRect();
        return r && r.width > 0 && r.height > 0 ? r : undefined;
      };
      const top = Math.max(0, ...[topbarRef.current, ribbonRef.current].map((el) => (rect(el)?.bottom ?? 0) - h.top));
      const left = rect(leftRef.current);
      const right = rect(rightRef.current);
      const status = rect(statusRef.current);
      const command = rect(commandBox.current);
      const paletteRight = right ? h.right - right.left : 0;
      // Its layout width, not its drawn box, which is still growing while it opens.
      const helperRoom = helperShown && helperPanel.current ? helperPanel.current.offsetWidth + 16 : 0;
      // Settings sits over the right palette; the part moves out from under it, so each change can be seen on it.
      const settings = settingsOpen ? host.ownerDocument.querySelector<HTMLElement>(".settings") : null;
      const settingsRoom = settings ? settings.offsetWidth + 28 : 0;
      const area = {
        top,
        left: left ? left.right - h.left : 0,
        bottom: Math.max(status ? h.bottom - status.top : 0, command ? h.bottom - command.top : 0),
        right: Math.max(paletteRight + helperRoom, settingsRoom),
      };
      // The part glides over when Blurry or Settings opens or closes, rather than jumping.
      const room = helperRoom + settingsRoom;
      vp.setSafeArea(area, room !== helperRoomWas.current);
      helperRoomWas.current = room;
      // The status bar's own room too: the command line sits just above it.
      const statusRoom = status ? h.bottom - status.top : 0;
      setSafeArea([area.top, area.left, area.bottom, area.right, statusRoom, paletteRight].map(Math.round).join(","));
    };
    const ro = new ResizeObserver(update);
    for (const el of [hostRef.current, topbarRef.current, ribbonRef.current, leftRef.current, rightRef.current])
      if (el) ro.observe(el);
    if (statusRef.current) ro.observe(statusRef.current);
    if (commandBox.current) ro.observe(commandBox.current);
    if (helperPanel.current) ro.observe(helperPanel.current);
    update();
    return () => ro.disconnect();
  }, [printing, layout, panelShown, focus, draft, helperShown, settingsOpen]);

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
  // Only the steps are built: reference pictures are left out, so moving or fading one doesn't rebuild the part.
  const modelDoc = useMemo<ProjectDocument>(
    () => ({ units: doc.units, features: doc.features }),
    [doc.units, doc.features],
  );
  const shownDoc = useMemo(() => {
    const threaded = threadEdit
      ? {
          ...modelDoc,
          features: modelDoc.features.map((f) =>
            f.id === threadEdit.id && f.type === "hole" ? withThread(f, threadEdit.settings) : f,
          ),
        }
      : modelDoc;
    return draft ? withDraft(threaded, draft) : threaded;
  }, [modelDoc, draft, threadEdit]);

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
  const upToDate = shownCurrent && shownDoc === modelDoc;
  const exportable = upToDate && !empty;

  // Print Studio checks the exact STL that would go to a slicer, made from the design as it is now.
  const printer = printerById(doc.print?.printer);
  const [printFile, setPrintFile] = useState<
    { doc: ProjectDocument; report: StlReport; stl: ArrayBuffer } | { doc: ProjectDocument; error: string } | null
  >(null);
  useEffect(() => {
    const client = geometryRef.current;
    if (!printing || !exportable || !built || !client || printFile?.doc === built.doc) return;
    let live = true;
    const from = built.doc;
    client.exportStl().then(
      (data) => live && setPrintFile({ doc: from, report: checkBinaryStl(data), stl: data }),
      (e: Error) => live && setPrintFile({ doc: from, error: `The file couldn't be made: ${e.message}` }),
    );
    return () => {
      live = false;
    };
  }, [printing, exportable, built, printFile]);
  const printState: PrintState = empty
    ? { kind: "blocked", reason: "There's nothing to print yet. Add a shape in Design first." }
    : !inputOk || hasErrors(kernelIssues)
      ? { kind: "blocked", reason: "Fix the highlighted values in Design first, then come back to check the part." }
      : !upToDate || !built || printFile?.doc !== built.doc
        ? { kind: "checking" }
        : "error" in printFile
          ? { kind: "failed", reason: printFile.error }
          : {
              kind: "checked",
              checks: printChecks({ ...printFile.report, bodies: built.measurements.solids }, printer),
              size: [0, 1, 2].map((i) => printFile.report.max[i]! - printFile.report.min[i]!) as [
                number,
                number,
                number,
              ],
              volume: built.measurements.volume,
            };
  const fitsPrinter = !(
    printState.kind === "checked" && printState.checks.some((c) => c.id === "fits" && c.status === "error")
  );
  // Layers: Studio 3D's own slicer cuts the checked file, in its own worker, while previewing.
  const slicerSettings: SlicerSettings = useMemo(
    () => ({
      layerHeight: doc.print?.layerHeight ?? DEFAULT_LAYER_HEIGHT,
      walls: doc.print?.walls ?? DEFAULT_WALLS,
      lineWidth: LINE_WIDTH,
      infillDensity: doc.print?.infill ?? DEFAULT_INFILL,
    }),
    [doc.print?.layerHeight, doc.print?.walls, doc.print?.infill],
  );
  const [layerView, setLayerView] = useState(false);
  const [layerAt, setLayerAt] = useState<number | null>(null);
  const checkedStl = printState.kind === "checked" && printFile && "stl" in printFile ? printFile.stl : null;
  const slicerRef = useRef<SlicerClient | null>(null);
  useEffect(() => {
    const client = new SlicerClient(createSlicerWorker);
    slicerRef.current = client;
    return () => client.dispose();
  }, []);
  const [slice, setSlice] = useState<{
    stl: ArrayBuffer;
    settings: SlicerSettings;
    result: { part: SlicedPart } | { error: string };
  } | null>(null);
  const wanted = printing && layerView && checkedStl ? { stl: checkedStl, settings: slicerSettings } : null;
  const sliceCurrent = !!wanted && slice?.stl === wanted.stl && slice.settings === wanted.settings;
  useEffect(() => {
    if (!wanted || sliceCurrent || !slicerRef.current) return;
    const { stl, settings } = wanted;
    slicerRef.current.slice(stl, settings).then(
      (part) => setSlice({ stl, settings, result: { part } }),
      (e: Error) => e.message !== "superseded" && setSlice({ stl, settings, result: { error: e.message } }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted?.stl, wanted?.settings, sliceCurrent]);
  const sliced = sliceCurrent && "part" in slice!.result ? slice!.result.part : null;
  const layerCount = sliced?.layers.length ?? 0;
  const layer = sliced ? Math.min(layerAt ?? layerCount - 1, layerCount - 1) : -1;
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    if (!sliced || layer < 0) return vp.setLayers(null);
    const shown = sliced.layers[layer]!;
    vp.setLayers({
      below: layerLines(sliced.layers.slice(0, layer).map((l) => ({ z: l.z, loops: l.loops }))),
      current: layerLines(shown.walls.map((loops) => ({ z: shown.z, loops }))),
      infill: fillLines3d(shown.z, shown.solidLines, shown.sparseLines),
      fill: { z: shown.z, loops: shown.loops },
    });
  }, [sliced, layer]);
  // A new slice (another part or setting) starts at the top layer again.
  useEffect(() => setLayerAt(null), [checkedStl, slicerSettings]);
  useEffect(() => {
    if (!printing) setLayerView(false);
  }, [printing]);
  const layerPreview: LayerPreview | null = !wanted
    ? null
    : !sliceCurrent
      ? { status: "slicing" }
      : "error" in slice!.result
        ? { status: "failed", error: slice!.result.error }
        : {
            status: "sliced",
            count: layerCount,
            index: layer,
            layer: sliced!.layers[layer] ?? null,
            openEnds: sliced!.openEnds,
            thinLayers: sliced!.thinLayers,
          };

  // G-code: written and read back in the slicer's worker as soon as the part is sliced, so the print's time and
  // filament show straight away; it is saved only when that check passed.
  const cantWrite = !fitsPrinter
    ? "The part doesn't fit this printer."
    : sliced && sliced.openEnds > 0
      ? "The part's surface has gaps, so its layers can't be trusted."
      : null;
  const gcodeBlocked =
    printer.maker === "Bambu Lab"
      ? "Bambu printers take G-code packed in Bambu's own 3MF, which Studio 3D can't write yet. Use Open in Bambu " +
        "Studio for now."
      : cantWrite;
  const [gcodeJob, setGcodeJob] = useState<{
    part: SlicedPart;
    printer: string;
    result: PrintJobResult | { error: string };
  } | null>(null);
  const jobCurrent = !!sliced && gcodeJob?.part === sliced && gcodeJob.printer === printer.id;
  useEffect(() => {
    const client = slicerRef.current;
    if (!sliced || cantWrite || jobCurrent || !client) return;
    const [part, id] = [sliced, printer.id];
    client
      .gcode(part, {
        printerName: `${printer.maker} ${printer.name}`,
        volume: printer.volume,
        maxNozzleTemp: printer.maxNozzleTemp,
        maxBedTemp: printer.maxBedTemp,
        application: `${APP_INFO.name} ${APP_INFO.version}`,
      })
      .then(
        (result) => setGcodeJob({ part, printer: id, result }),
        // Superseded: a setting changed and the part is being sliced again.
        (e: Error) => e.message !== "superseded" && setGcodeJob({ part, printer: id, result: { error: e.message } }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliced, cantWrite, jobCurrent, printer.id]);
  const job = jobCurrent ? gcodeJob!.result : null;
  const sliceSummary: SliceSummary | null =
    !sliced || cantWrite
      ? null
      : !job
        ? { status: "writing" }
        : "error" in job
          ? { status: "failed", problem: job.error }
          : !job.report.ok
            ? { status: "failed", problem: job.report.problems[0] ?? "" }
            : {
                status: "ready",
                layers: job.report.layers,
                height: sliced.layers[sliced.layers.length - 1]?.top ?? 0,
                filament: job.report.filament,
                grams: job.grams,
                seconds: job.report.seconds,
              };
  const exportGcode = useCallback(
    () =>
      run(async () => {
        if (!job || "error" in job || gcodeBlocked) return;
        const { report } = job;
        if (!report.ok) {
          setNotice({
            kind: "error",
            text: `The G-code didn't pass its check, so it wasn't saved. ${report.problems[0]}`,
          });
          return;
        }
        const saved = await platform.exportMesh(new TextEncoder().encode(job.gcode), name, "gcode");
        if (saved)
          setNotice({
            kind: "info",
            text:
              `Exported ${saved.name}. Checked: ${report.layers} layers, ${(report.filament / 1000).toFixed(2)} m of ` +
              `PLA (about ${Math.round(job.grams)} g), every line inside the part and the printer. ` +
              "Not yet tried on a real printer, so watch the first layer.",
          });
      }),
    [job, gcodeBlocked, name, run, setNotice],
  );

  // The plate under the part: the printer's own, with its build volume outlined, in Print Studio.
  useEffect(() => {
    const v = printer.volume;
    if (printing) viewportRef.current?.setPlate(v[0], v[1], { height: v[2], fits: fitsPrinter });
    else viewportRef.current?.setPlate(appearance.plateSize, appearance.plateSize);
  }, [printing, printer, fitsPrinter, appearance.plateSize]);
  const openPrintStudio = useCallback(() => {
    setSelection(null);
    setPicking(false);
    setWorkspace("print");
  }, []);

  // Sketching: pick a face, draw, then add the sketch to the design.
  const startPicking = useCallback(() => {
    setHoleTarget(undefined);
    setPicking(true);
    setPickMessage("Click a flat face of the part to draw on it.");
  }, []);
  /** A new hole (null) goes where the part is clicked; an existing hole (its id) moves to the middle of a face. */
  const startHolePicking = useCallback((id: string | null) => {
    setHoleTarget(id);
    setPicking(true);
    setPickMessage(
      id === null
        ? "Click on the part where the hole goes; snaps find centres and edges. Enter puts it in the middle, Esc cancels."
        : "Click a flat face of the part to move the hole onto it. It goes in the middle; then set its distances.",
    );
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

  /**
   * Where a measuring point goes for the pointer: a snap on the part's own edges and faces if one is near (or the snap
   * picked for this point), else the point on the part, else the point on the plate.
   */
  const snapAt = (x: number, y: number, from: Vec3 | null, only: SnapKind | null = snapOnce, strict = false) => {
    const vp = viewportRef.current;
    const mesh = meshRef.current;
    if (!vp) return { point: null, snap: null };
    const hit = vp.pickPoint(x, y);
    const plate = hit ? null : vp.pickPlate(x, y);
    const model = mesh ? { edges: mesh.edgeInfo, faces: mesh.faceInfo } : { edges: [], faces: [] };
    const base = {
      pointer: [x, y] as [number, number],
      toScreen: (p: Vec3) => vp.toClient(p),
      from,
      plate,
      gridStep: vp.gridStep(),
    };
    const forced = only ? findSnap3(model, { ...base, radius: 40, kinds: [only] }) : null;
    if (strict) return { point: forced?.point ?? null, snap: forced };
    // F3 turns the object snaps off; the grid snap stays as it is set.
    const kinds = SNAPS_3D.filter((k) => snaps.kinds.includes(k) && (snaps.on || k === "grid"));
    const snap = forced ?? (kinds.length ? findSnap3(model, { ...base, radius: 12, kinds }) : null);
    return { point: snap?.point ?? hit ?? plate, snap };
  };

  /**
   * The part's edge under the pointer (within 8 px), leaving out edges hidden behind the part; `pickable` leaves out
   * the seams of round faces too, which are drawn but are no corner to round off.
   */
  const edgeUnder = (x: number, y: number, pickable = false): number | null => {
    const vp = viewportRef.current;
    const mesh = meshRef.current;
    if (!vp || !mesh) return null;
    const eye = vp.getCameraState().position;
    const visible = (p: Vec3) => {
      const s = vp.toClient(p);
      const hit = s && vp.pickPoint(s[0], s[1]);
      const far = distance(eye, p);
      return !hit || distance(eye, hit) >= far - Math.max(0.2, far * 0.002);
    };
    const edges = pickable ? mesh.edgeInfo.map((e) => (e.seam ? { ...e, points: [] } : e)) : mesh.edgeInfo;
    return edgeAt({ edges, faces: [] }, { pointer: [x, y], toScreen: (p) => vp.toClient(p), radius: 8, visible });
  };

  /** Picks the edge for a fillet or chamfer, or lets go of it when it is already picked. */
  const pickEdge = (edge: number) => {
    const m = meshRef.current?.edgeInfo[edge]?.middle;
    if (!m) return;
    setSelection(null);
    setEdgePicks((ps) =>
      ps.some((p) => distance(p, m) < PICK_TOLERANCE)
        ? ps.filter((p) => distance(p, m) >= PICK_TOLERANCE)
        : [...ps, [m[0], m[1], m[2]]],
    );
  };
  const showHoverEdge = (edge: number | null) => {
    if (hoverEdge.current === edge) return;
    hoverEdge.current = edge;
    // Said on the view too (set directly, as it changes with every move), for tests and tools to find edges by.
    const e = edge !== null ? meshRef.current?.edgeInfo[edge] : undefined;
    if (e)
      hostRef.current?.setAttribute("data-edge-hover", e.middle.map((v) => Math.round(v * 1000) / 1000 + 0).join(","));
    else hostRef.current?.removeAttribute("data-edge-hover");
    drawEdgePicks();
  };
  /** Draws the picked edges, and the one a click would pick. */
  const drawEdgePicks = (picks = edgePicks) => {
    const vp = viewportRef.current;
    const mesh = meshRef.current;
    if (!vp) return;
    const lines = (es: EdgeInfo[]) =>
      es.length
        ? new Float32Array(es.flatMap((e) => e.points.slice(1).flatMap((p, i) => [...e.points[i]!, ...p])))
        : null;
    const picked = mesh ? picks.map((p) => mesh.edgeInfo.find((e) => distance(e.middle, p) < PICK_TOLERANCE)) : [];
    const hover = hoverEdge.current !== null ? mesh?.edgeInfo[hoverEdge.current] : undefined;
    vp.setEdgePicks(
      lines(picked.filter((e): e is EdgeInfo => !!e)),
      lines(hover && !picked.includes(hover) ? [hover] : []),
    );
  };

  /** What is under the pointer, for the right-click menu's title and commands. */
  const underPointer = (x: number, y: number) => {
    const mesh = meshRef.current;
    const edge = edgeUnder(x, y);
    const hit = faceAt(x, y);
    const info = hit && mesh ? mesh.faceInfo[hit.face] : undefined;
    // A circle edge at the mouth of a hole belongs to the hole's wall: the same radius, centred on its axis.
    const rim = edge !== null && mesh ? holeWallOfRim(mesh, edge) : -1;
    const wall = rim >= 0 ? rim : info?.kind === "cylinder" && info.inside ? hit!.face : -1;
    const ownerFace = wall >= 0 ? wall : hit?.face;
    const owner =
      mesh && ownerFace !== undefined ? doc.features.find((f) => f.id === mesh.owners[ownerFace]) : undefined;
    const of = owner ? ` of ${owner.name}` : "";
    const title =
      edge !== null && mesh
        ? `${describeEdge(mesh.edgeInfo[edge]!)}${of}`
        : info?.kind === "plane"
          ? `Flat face${of}`
          : info?.kind === "cylinder"
            ? info.inside
              ? `Inside of a hole, Ø${lengthText(2 * info.radius!)}${of}`
              : `Round face${of}`
            : hit
              ? `Curved face${of}`
              : "Empty space";
    return { title, hit, owner, holeWall: wall >= 0 };
  };

  /** Opens the Thread dialog on a hole step. */
  const openThread = (id: string) => {
    const h = doc.features.find((f): f is HoleFeature => f.id === id && f.type === "hole");
    if (!h) return;
    stopMeasure();
    setSelection({ id, face: null });
    setThreadEdit({ id, settings: threadSettingsFor(h) });
  };
  const applyThread = () => {
    const h = doc.features.find((f): f is HoleFeature => f.id === threadEdit?.id && f.type === "hole");
    if (!h || !threadEdit) return;
    const next = withThread(h, threadEdit.settings);
    // Settings the thread replaces (a clearance size, a head) are cleared; one undo step takes it all back.
    const cleared = {
      clearance: undefined,
      head: undefined,
      threadDepth: undefined,
      simplified: undefined,
      hand: undefined,
    };
    project.updateFeature(h.id, { ...cleared, ...next });
    setThreadEdit(null);
  };

  const startMeasure = (a: Vec3 | null = null) => {
    setSelection(null);
    hoverPiece(null);
    setMeasure({ a, b: null });
    setMeasureCursor(null);
  };
  const stopMeasure = () => {
    setMeasure(null);
    setMeasureCursor(null);
    setSnapOnce(null);
    setSnapMark(null);
  };

  /** Shows the snap the pointer is on, placed relative to the 3D view. */
  const markSnap = (snap: Snap3 | null) => {
    const vp = viewportRef.current;
    const host = hostRef.current;
    const at = snap && vp ? vp.toClient(snap.point) : null;
    if (!snap || !at || !host) return setSnapMark(null);
    const r = host.getBoundingClientRect();
    setSnapMark({ snap, x: at[0] - r.left, y: at[1] - r.top });
  };

  const hoverPiece = (id: string | null) => {
    if (hovered.current === id) return;
    hovered.current = id;
    const mesh = meshRef.current;
    viewportRef.current?.setHover(id && mesh ? pointsOfFaces(mesh, facesOf(mesh, id)) : null);
  };

  const onHostPointerMove = (e: React.PointerEvent) => {
    if (mode === "measure") {
      if (e.buttons || viewportRef.current?.moving || !(e.target instanceof HTMLCanvasElement)) return;
      const where = snapAt(e.clientX, e.clientY, measure?.a && !measure.b ? measure.a : null);
      markSnap(where.snap);
      setMeasureCursor(where.point);
      showPointer(where.point);
      return;
    }
    if (!allows(mode, "pick-face")) {
      const still = !e.buttons && !viewportRef.current?.moving;
      showPointer(still ? (viewportRef.current?.pickPoint(e.clientX, e.clientY) ?? null) : null);
      const edge = still && allows(mode, "select") ? edgeUnder(e.clientX, e.clientY, true) : null;
      showHoverEdge(edge);
      const over = still && edge === null && allows(mode, "hover") ? ownerAt(e.clientX, e.clientY) : null;
      hoverPiece(over && over.id !== selection?.id ? over.id : null);
      return;
    }
    if (e.buttons) return;
    const hit = faceAt(e.clientX, e.clientY);
    viewportRef.current?.setHighlight(hit?.outline ? new Float32Array(hit.points.flat()) : null);
    if (holeTarget === null) {
      // Placing a new hole: object snaps (a face's centre, an edge's middle) show where it will go, as in Measure.
      const where = hit?.outline ? snapAt(e.clientX, e.clientY, null) : { point: null, snap: null };
      markSnap(where.snap);
      showPointer(where.point);
    }
    setPickMessage(hit && !hit.outline ? "That face is curved. Pick a flat one." : pickPrompt);
  };
  const onHostPointerUp = (e: React.PointerEvent) => {
    const right = rightDown.current;
    rightDown.current = null;
    // A right click that doesn't drag opens the menu; a right drag still pans.
    if (e.button === 2 && right && Math.hypot(e.clientX - right.x, e.clientY - right.y) <= 4) {
      if ((mode === "model" || mode === "measure") && e.target instanceof HTMLCanvasElement)
        setMenu3d({ x: e.clientX, y: e.clientY });
      return;
    }
    const down = pointerDown.current;
    pointerDown.current = null;
    if (mode === "measure") {
      if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      if (!(e.target instanceof HTMLCanvasElement)) return;
      const from = measure?.a && !measure.b ? measure.a : null;
      const { point } = snapAt(e.clientX, e.clientY, from);
      setSnapOnce(null);
      if (!point) return;
      setMeasure(!measure?.a || measure.b ? { a: point, b: null } : { a: measure.a, b: point });
      return;
    }
    if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return; // a drag orbits
    if (!(e.target instanceof HTMLCanvasElement)) return; // a click on a floating panel, not the part
    if (allows(mode, "select")) {
      // A click on an edge picks it (more clicks pick more, for one fillet or chamfer on all of them); a click
      // elsewhere picks the piece under the pointer, and a click on empty space lets go.
      const edge = edgeUnder(e.clientX, e.clientY, true);
      hoverPiece(null);
      if (edge !== null) return pickEdge(edge);
      setEdgePicks([]);
      const hit = ownerAt(e.clientX, e.clientY);
      setSelection(hit ? { id: hit.id, face: hit.face } : null);
      return;
    }
    if (!allows(mode, "pick-face")) return;
    const hit = faceAt(e.clientX, e.clientY);
    if (!hit?.outline) return;
    if (holeTarget === undefined) sketchOnFace(hit.outline, meshRef.current?.owners[hit.face]);
    else
      holeOnFace(
        hit.outline,
        meshRef.current?.owners[hit.face],
        holeTarget === null ? snapAt(e.clientX, e.clientY, null) : undefined,
      );
  };

  /**
   * Puts a hole in the middle of a picked face, square to it. On a side of a box the hole follows the box when it
   * is resized or moved; on any other face it stays where the face was.
   */
  const holeOnFace = (o: FaceOutline, owner: string | undefined, pick?: { point: Vec3 | null; snap: unknown }) => {
    stopPicking();
    markSnap(null);
    const at = pick?.point ?? undefined;
    // Where no snap caught the pointer, the spot is rounded to a tidy size: 0.5 mm, or 1/32" in inches.
    const step = units === "in" ? 25.4 / 32 : 0.5;
    const tidy = (n: number) => (pick?.snap ? n : Math.round(n / step) * step + 0);
    // A face that looks straight up: an ordinary hole, drilled down from the top at the spot clicked.
    if (at && !holeTarget && o.plane.normal[2] > 0.999)
      return addAndSelect(newHole(doc, { x: tidy(at[0]), y: tidy(at[1]) }));
    const box = doc.features.find((f): f is BoxFeature => f.id === owner && f.type === "box");
    const side = boxSideOf(o.plane.normal, box?.rotation);
    const face: HoleFace =
      box && side && canFollow(box, side)
        ? { ...boxSideFace(box, side), on: { shape: box.id, side }, across: "centre", up: "centre" }
        : { plane: o.plane, surface: o.label, width: o.width, height: o.height, across: "centre", up: "centre" };
    if (holeTarget) return project.updateFeature(holeTarget, { face, x: 0, y: 0 });
    const spot = at ? measuredFrom(face, toSketch(face.plane, at), face.across, face.up) : { x: 0, y: 0 };
    addAndSelect({ ...newHole(doc), face, x: tidy(spot.x), y: tidy(spot.y) });
  };

  const sketchOnFace = (o: FaceOutline, owner?: string) => {
    stopPicking();
    setSketchView("2d");
    setDraft({
      feature: newSketch(doc, o.plane, o.label, [], "add", 5),
      isNew: true,
      face: { triangles: o.triangles, width: o.width, height: o.height },
      area: [0, 0, o.width, o.height],
      holeFace: faceForHoles(doc, o, owner),
      holes: [],
    });
  };

  /** Where the pointer is on the part, written in the status bar (updated directly: it changes on every move). */
  const showPointer = (p: [number, number, number] | null) => {
    const el = pointerReadout.current;
    if (!el) return;
    const inches = getDisplayUnits() === "in";
    const n = (v: number) => lengthNumber(v).toFixed(inches ? 3 : 1);
    el.textContent = p
      ? `Pointer on the part: left/right ${n(p[0])} · front/back ${n(p[1])} · height ${n(p[2])} ${getDisplayUnits()}`
      : "";
    el.parentElement?.classList.toggle("showing-pointer", !!p);
  };

  useEffect(() => viewportRef.current?.setColors(viewportColors(appearance)), [appearance]);
  useEffect(
    () => viewportRef.current?.setSurroundings({ plate: appearance.plate, grid: appearance.grid }),
    [appearance.plate, appearance.grid],
  );
  const togglePlate = useCallback(
    () => changeAppearance({ ...appearance, plate: !appearance.plate }),
    [appearance, changeAppearance],
  );
  const toggleGrid = useCallback(
    () => changeAppearance({ ...appearance, grid: !appearance.grid }),
    [appearance, changeAppearance],
  );
  useEffect(() => viewportRef.current?.setGridUnits(units), [units]);

  // Picked edges: drawn over the part. After a change to the part, an edge that is no longer there is let go.
  useEffect(() => {
    const mesh = meshRef.current;
    const kept = mesh ? edgePicks.filter((p) => mesh.edgeInfo.some((e) => distance(e.middle, p) < PICK_TOLERANCE)) : [];
    if (kept.length !== edgePicks.length) return setEdgePicks(kept);
    hoverEdge.current = null;
    drawEdgePicks(draft || printing ? [] : edgePicks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgePicks, built, draft, printing]);

  // A command typed in the command line that adds a step asks for its main size there, as AutoCAD's FILLET asks
  // for the radius; Enter keeps the size it starts with.
  useEffect(() => {
    const w = waitingStep.current;
    if (!w || doc.features.length <= w.count) return;
    waitingStep.current = null;
    const f = doc.features[doc.features.length - 1]!;
    const ask = (label: string, value: number, key: "size" | "diameter" | "wall") =>
      setCommandPrompt({ label, value, apply: (v: number) => project.updateFeature(f.id, { [key]: v }) });
    if (f.type === "fillet") ask("Fillet radius", f.size, "size");
    else if (f.type === "chamfer") ask("Chamfer size", f.size, "size");
    else if (f.type === "hole" && !f.thread && !f.clearance) ask("Hole diameter", f.diameter, "diameter");
    else if (f.type === "hollow") ask("Wall thickness", f.wall, "wall");
  }, [doc, project]);

  // Measurement lines and labels in the 3D view.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    if (measure?.a) {
      const to = measure.b ?? measureCursor;
      const d = to ? distance(measure.a, to) : 0;
      return vp.setDimensions(
        to && d > 1e-6 ? [{ from: measure.a, to, offset: [0, 0, 0], text: `${mmText(d)}`, kind: "feature" }] : [],
      );
    }
    const m = built?.measurements;
    if (!showSizes || !m || draft) return vp.setDimensions([]);
    const focused = built.doc.features.find((f) => f.id === focusId);
    // With a piece picked, its own sizes show without the part's overall ones (those stay in Properties), so the
    // labels don't crowd each other.
    // Print Studio is about the whole part on its plate: only its overall size.
    const own = focused && !printing ? featureDimensions(focused, m, built.doc) : [];
    vp.setDimensions(own.length ? own : partDimensions(m.min, m.max));
  }, [built, showSizes, focusId, draft, printing, measure, measureCursor, units]);

  // Cosmetic threads: dashed circles at the thread's full size where it starts and ends.
  useEffect(() => {
    const vp = viewportRef.current;
    const m = built?.measurements;
    if (!vp) return;
    const lines = m && !draft && !printing ? cosmeticThreadLines(built.doc, m) : [];
    vp.setThreadMarks(lines.length ? new Float32Array(lines) : null);
  }, [built, draft, printing]);

  // The selected piece: tinted, with move arrows in its middle. Redrawn with each new model.
  const selected = selection ? doc.features.find((f) => f.id === selection.id) : undefined;
  const selectedPicture = selection ? doc.references?.find((r) => r.id === selection.id) : undefined;
  useEffect(() => {
    if (selection && !selected && !selectedPicture) setSelection(null); // removed, or undone away
  }, [selection, selected, selectedPicture]);
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

  /** Starts a sketch on the plate, with a drawing tool picked (the command line's REC, CIRCLE, PLINE, POLYGON). */
  const plateSketch = useCallback(
    (tool?: SketchTool) => {
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
        tool,
      });
    },
    [built, doc, stopPicking],
  );
  const sketchOnPlate = useCallback(() => plateSketch(), [plateSketch]);

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
    const holes = draftHoles(doc, draft);
    if (draft.isNew && holes.length) {
      // The sketch and its holes go in together, so one undo takes them all back. Holes alone need no sketch.
      const sketch = f.profiles.length ? [f] : [];
      project.addSteps([...sketch, ...holes]);
      setSelection({ id: (sketch[0] ?? holes[0]!).id, face: null });
    } else if (draft.isNew) {
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
  }, [draft, project, doc]);

  // In the sketch's 3D view, show the outlines on the face and look at them from an angle.
  // Reference pictures that are switched on and have sensible settings are shown in the 3D view.
  const shownPictures = useMemo(
    () => (doc.references ?? []).filter((r) => r.visible && !hasErrors(validateReference(r))),
    [doc.references],
  );
  useEffect(() => {
    viewportRef.current?.setReferences(
      shownPictures.map((r) => ({
        id: r.id,
        src: r.src,
        corners: referenceCorners(r),
        opacity: r.opacity,
        onTop: r.onTop,
      })),
    );
  }, [shownPictures, engine]);
  const addPicture = useCallback(async () => {
    const file = await choosePicture();
    if (!file) return;
    try {
      const { src, pixels, name } = await readPicture(file);
      const picture = newReference(src, pixels, name);
      project.addReference(picture);
      setSelection({ id: picture.id, face: null });
      setCalibrating(picture.id);
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  }, [project, setNotice]);

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

  const draftHoleIds = new Set((draft?.holes ?? []).map((h) => h.id));
  const draftIssues = draft
    ? dedupe([
        // A sketch with only holes in it is fine: the holes are added without it.
        ...(draftHoleIds.size && !draft.feature.profiles.length ? [] : validateSketch(draft.feature)),
        ...inputIssues.filter((i) => i.featureId && draftHoleIds.has(i.featureId)),
        ...(inputOk
          ? kernelIssues.filter((i) => i.featureId === draft.feature.id || draftHoleIds.has(i.featureId ?? ""))
          : []),
      ])
    : [];
  const draftIndex = draft ? shownDoc.features.findIndex((f) => f.id === draft.feature.id) : -1;

  /** The part as a file for a slicer, made from exactly what's on screen. */
  const meshFile = useCallback(
    async (format: MeshFormat) => {
      const client = geometryRef.current;
      if (!client) throw new Error("The geometry engine isn't ready yet.");
      const r = await client.rebuild(doc); // make sure the export matches exactly what's on screen
      if (r.status !== "built") throw new Error("Fix the highlighted values before exporting.");
      const stl = await client.exportStl();
      if (format === "stl") return new Uint8Array(stl);
      // Studio 3D's plate is centred on the origin; a printer's starts at its front-left corner.
      const v = printerById(doc.print?.printer).volume;
      return stlTo3mf(stl, {
        name,
        offset: [v[0] / 2, v[1] / 2, 0],
        application: `${APP_INFO.name} ${APP_INFO.version}`,
      });
    },
    [doc, name],
  );
  const exportMesh = useCallback(
    (format: MeshFormat) =>
      run(async () => {
        const saved = await platform.exportMesh(await meshFile(format), name, format);
        if (saved) setNotice({ kind: "info", text: `Exported ${saved.name}.` });
      }),
    [meshFile, name, run, setNotice],
  );
  const exportStl = useCallback(() => exportMesh("stl"), [exportMesh]);
  const openInSlicer = useCallback(
    (slicer: SlicerProgram) =>
      run(async () => {
        if (!platform.slicers) return;
        const file = await platform.slicers.open(slicer, await meshFile("3mf"), name, "3mf");
        const shown = file.split(/[\\/]/).pop();
        setNotice({
          kind: "info",
          text: `Opened ${shown} in ${slicer.name}. Pick your printer, filament and settings there.`,
        });
      }),
    [meshFile, name, run, setNotice],
  );

  // Keyboard: views, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, and Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+N
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F11 works everywhere, sketching and typing included: it only changes how much of the screen the app has.
      if (e.key === "F11" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleFullScreen();
        return;
      }
      // Ctrl+9 shows and hides the command line, as in AutoCAD: everywhere, sketching included.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.code === "Digit9" || e.code === "Numpad9")) {
        e.preventDefault();
        toggleCommandLine();
        return;
      }
      // Ctrl+, opens Settings, as in most desktop apps.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault();
        setSettingsAt((c) => (c ? null : "appearance"));
        return;
      }
      if (mode === "pick-face" && e.key === "Escape") {
        stopPicking();
        markSnap(null);
        waitingStep.current = null;
        return;
      }
      // Placing a new hole: Enter (or Space, as in AutoCAD) puts it in the middle of the part.
      if (mode === "pick-face" && holeTarget === null && (e.key === "Enter" || e.key === " ")) {
        if (e.target instanceof HTMLInputElement) return;
        e.preventDefault();
        stopPicking();
        markSnap(null);
        addAndSelect(newHole(doc, where));
        return;
      }
      // Esc lets go of a snap picked for the next point first, then leaves Measure.
      if (mode === "measure" && e.key === "Escape") {
        if (snapOnce) setSnapOnce(null);
        else stopMeasure();
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
      // Ctrl+0 is AutoCAD's Clean Screen; here it is Focus canvas. Ctrl+B shows or hides the side panel.
      if (mod && !e.shiftKey && !e.altKey && (e.code === "Digit0" || e.code === "Numpad0")) {
        e.preventDefault();
        toggleFocus();
        return;
      }
      // Ctrl+K opens Blurry, the helper (and closes him).
      if (mod && !e.shiftKey && !e.altKey && key === "k") {
        e.preventDefault();
        setHelperOpen((o) => !o);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === "b") {
        e.preventDefault();
        togglePanel();
        return;
      }
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement;
      if (mod || e.altKey || typing) return;
      // Number keys by their place on the keyboard, so Shift+1 is still "1" whatever the layout prints on it.
      const digit = /^Digit(\d)$/.exec(e.code)?.[1];
      const b = VIEW_BUTTONS.find((v) => v.key === digit && !!v.shift === e.shiftKey);
      if (b) {
        viewportRef.current?.setView(b.view);
        return;
      }
      if (digit === PROJECTION_KEY && !e.shiftKey) {
        toggleProjection();
        return;
      }
      if (edgePicks.length && e.key === "Escape") {
        setEdgePicks([]);
        return;
      }
      // With the command line on, letters typed over the view go to it, as in AutoCAD (M and D are typed as
      // commands too: M Enter shows sizes, D Enter measures). In Print Studio, measuring and picking a face too.
      if (layout.commandLine && mode !== "move" && !draft && /^[a-z]$/i.test(e.key)) {
        e.preventDefault();
        commandLine.current?.focus(e.key);
        return;
      }
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
      // F3 turns object snaps off and on, as in AutoCAD; D measures (AutoCAD's DIST).
      if (e.key === "F3" && (mode === "model" || mode === "measure")) {
        e.preventDefault();
        setSnaps({ ...snaps, on: !snaps.on });
        return;
      }
      // F7 shows or hides the grid, as in AutoCAD.
      if (e.key === "F7" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleGrid();
        return;
      }
      if (key === "d" && mode === "model" && !e.shiftKey) {
        startMeasure();
        return;
      }
      // With nothing else for Escape to do, it leaves full screen, then Focus canvas (dialogs handle their own).
      if (e.key === "Escape" && !dialog && !calibrating && !e.shiftKey) {
        const leave = escapeLeaves({ fullScreen, focus });
        if (leave === "full-screen") toggleFullScreen();
        else if (leave === "focus") toggleFocus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    project,
    mode,
    snaps,
    snapOnce,
    stopPicking,
    selection,
    selected,
    doc,
    toggleProjection,
    toggleFullScreen,
    toggleFocus,
    togglePanel,
    dialog,
    calibrating,
    fullScreen,
    focus,
    edgePicks,
    layout.commandLine,
    draft,
    toggleCommandLine,
    holeTarget,
    built,
    toggleGrid,
  ]);

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
  const calibratingPicture = doc.references?.find((r) => r.id === calibrating);

  // The menu bar: every command in one place, with its shortcut. Items are greyed out (with the reason) when they
  // can't run right now, never hidden, so the menus always look the same.
  const noView = webglError ? "The 3D view isn't available" : undefined;
  /** Adds a step; a fillet or chamfer on the picked edges uses the picks up. */
  const addStep = (f: Parameters<typeof project.addFeature>[0]) => {
    project.addFeature(f);
    if ((f.type === "fillet" || f.type === "chamfer") && f.edges === "picked") setEdgePicks([]);
  };
  const addAndSelect = (f: Parameters<typeof project.addFeature>[0]) => {
    addStep(f);
    setSelection({ id: f.id, face: null });
  };
  const where = placeNew(built?.measurements ?? null);
  /** HOLE: click on the part where it goes (with nothing built yet, it goes in the middle). */
  const addHole = () => (built ? startHolePicking(null) : addAndSelect(newHole(doc, where)));
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
        { label: "Prepare to print…", onSelect: openPrintStudio },
        {
          label: "Export STL…",
          onSelect: () => void exportStl(),
          disabled: busy || !exportable,
          reason: empty ? "Add a shape to export" : "Fix the highlighted values to export",
        },
        {
          label: "Export 3MF…",
          onSelect: () => void exportMesh("3mf"),
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
          shortcut: viewShortcut(b),
          onSelect: () => viewportRef.current?.setView(b.view),
          disabled: webglError,
          reason: noView,
        })),
        "separator" as const,
        {
          label: "Orthographic (no perspective)",
          shortcut: PROJECTION_KEY,
          checked: projection === "orthographic",
          onSelect: toggleProjection,
          disabled: webglError,
          reason: noView,
        },
        {
          label: "Fit all",
          shortcut: "Wheel double-click",
          onSelect: () => viewportRef.current?.zoomExtents(),
          disabled: webglError,
          reason: noView,
        },
        { label: "Show sizes", shortcut: "M", checked: showSizes, onSelect: () => setShowSizes((v) => !v) },
        { label: "Sizes in inches", checked: units === "in", onSelect: toggleUnits },
        {
          label: "Measure distance",
          shortcut: "D",
          checked: measure !== null,
          onSelect: () => (measure ? stopMeasure() : startMeasure()),
          disabled: webglError || printing || !!draft,
          reason: noView ?? "Measure works on the design",
        },
        {
          label: "Object snaps",
          shortcut: "F3",
          checked: snaps.on,
          onSelect: () => setSnaps({ ...snaps, on: !snaps.on }),
        },
        "separator" as const,
        {
          label: "Build plate",
          checked: appearance.plate,
          onSelect: togglePlate,
          disabled: printing,
          reason: "Print Studio always shows your printer's plate",
        },
        { label: "Grid", shortcut: "F7", checked: appearance.grid, onSelect: toggleGrid },
        { label: "Background colour…", onSelect: () => setSettingsAt("view") },
        "separator" as const,
        { label: "Palettes", shortcut: "Ctrl+B", checked: panelShown, onSelect: togglePanel },
        {
          label: "Browser",
          checked: layout.browser.shown && !layout.browser.collapsed,
          onSelect: () => togglePalette("browser"),
        },
        {
          label: "Properties",
          checked: layout.properties.shown && !layout.properties.collapsed,
          onSelect: () => togglePalette("properties"),
        },
        {
          label: "Minimise ribbon",
          checked: layout.ribbonMinimized,
          onSelect: () => arrange((w) => ({ ...w, ribbonMinimized: !w.ribbonMinimized })),
        },
        { label: "Command line", shortcut: "Ctrl+9", checked: layout.commandLine, onSelect: toggleCommandLine },
        { label: "Reset workspace", onSelect: () => arrange(() => DEFAULT_WORKSPACE) },
        { label: "Settings…", shortcut: "Ctrl+,", onSelect: () => setSettingsAt("appearance") },
        "separator" as const,
        { label: "Focus canvas", shortcut: "Ctrl+0", checked: focus, onSelect: toggleFocus },
        { label: "Full screen", shortcut: "F11", checked: fullScreen, onSelect: toggleFullScreen },
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
        { label: "Hole", onSelect: addHole },
        {
          label: "Hole on a face…",
          onSelect: () => startHolePicking(null),
          disabled: !built,
          reason: "Add a shape first, then pick one of its faces",
        },
        "separator" as const,
        {
          label: "Sketch on a face",
          onSelect: startPicking,
          disabled: !built,
          reason: "Add a shape first, then pick one of its faces",
        },
        { label: "Sketch on the plate", onSelect: sketchOnPlate },
        { label: "Revolve (spin an outline)", onSelect: startRevolve },
        "separator" as const,
        { label: "Reference picture…", onSelect: () => void addPicture() },
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
          onSelect: () => addAndSelect(newEdgeStep(doc, "fillet", edgePicks)),
          disabled: !built,
          reason: "Add a shape first",
        },
        {
          label: "Chamfer (bevel edges)",
          onSelect: () => addAndSelect(newEdgeStep(doc, "chamfer", edgePicks)),
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

  // The screen buttons sit at the right of the status bar, where AutoCAD keeps Clean Screen; in Focus canvas, where
  // the status bar is put away, they move up beside the camera views.
  const screenModes = (
    <nav className={`bar screen-modes${focus ? " glass" : ""}`} aria-label="Screen">
      <button
        type="button"
        className="icon-only"
        aria-label="Palettes"
        aria-pressed={panelShown}
        title={`${panelShown ? "Hide" : "Show"} the palettes (Ctrl+B)`}
        onClick={togglePanel}
      >
        <Icon name="sidePanel" />
      </button>
      <button
        type="button"
        className={focus ? "exit" : "icon-only"}
        aria-label={focus ? "Exit focus canvas" : "Focus canvas"}
        aria-pressed={focus}
        title={
          focus
            ? "Bring the panels back (Ctrl+0 or Esc)"
            : "Focus canvas: put the panels away to give the part the room (Ctrl+0)"
        }
        onClick={toggleFocus}
      >
        <Icon name="focus" />
        {focus && "Exit focus"}
      </button>
      <button
        type="button"
        className={fullScreen ? "exit" : "icon-only"}
        aria-label={fullScreen ? "Exit full screen" : "Full screen"}
        aria-pressed={fullScreen}
        title={fullScreen ? "Leave full screen (F11 or Esc)" : "Full screen: use the whole screen (F11)"}
        onClick={toggleFullScreen}
      >
        <Icon name={fullScreen ? "exitFullScreen" : "fullScreen"} />
        {fullScreen && "Exit full screen"}
      </button>
    </nav>
  );

  const design = useDesignPanel({
    doc,
    issues,
    measurements: built?.measurements ?? null,
    builtDoc: built?.doc ?? null,
    stale: !upToDate && built !== null,
    onChange: project.updateFeature,
    onAdd: addStep,
    onRemove: project.removeFeature,
    onSketchOnFace: startPicking,
    onPickHoleFace: startHolePicking,
    onThreadHole: openThread,
    onSketchOnPlate: sketchOnPlate,
    onRevolve: startRevolve,
    onEditSketch: editSketch,
    picking,
    onFocus: setFocusId,
    selected: selection?.id ?? null,
    onSelect: (id) => setSelection((s) => (id === null ? null : s?.id === id ? s : { id, face: null })),
    onChangeReference: (id, patch) => project.updateReference(id, patch),
    onRemoveReference: project.removeReference,
    onCalibrate: setCalibrating,
    edgePicks,
  });
  /** The palette on one side of the window: Print Studio's settings, or the Browser or Properties. */
  const docked = (side: "left" | "right") => {
    if (printing)
      return side === "left" ? (
        <Palette
          title="Print Studio"
          icon="printer"
          side="left"
          layout={{ ...layout.properties, shown: true }}
          onLayout={(patch) => layoutPalette("properties", patch)}
        >
          <PrintPanel
            printer={printer}
            state={printState}
            busy={busy}
            onPrinter={project.setPrinter}
            settings={slicerSettings}
            onSettings={project.setPrintSettings}
            layers={layerPreview}
            summary={sliceSummary}
            onLayerView={setLayerView}
            onLayer={setLayerAt}
            onExport={(format) => void exportMesh(format)}
            gcodeBlocked={gcodeBlocked}
            onExportGcode={() => void exportGcode()}
            onOpenInSlicer={(slicer) => void openInSlicer(slicer)}
            onBackToDesign={() => setWorkspace("design")}
          />
        </Palette>
      ) : null;
    const id: PaletteId = sideOf(layout, "browser") === side ? "browser" : "properties";
    if (!layout[id].shown) return null;
    return (
      <Palette
        title={id === "browser" ? "Browser" : "Properties"}
        icon={id === "browser" ? "tree" : "properties"}
        side={side}
        layout={layout[id]}
        onLayout={(patch) => layoutPalette(id, patch)}
      >
        {id === "browser" ? design.browser : design.properties}
      </Palette>
    );
  };
  /** The 3D view's right-click menu: snaps that have something to snap to here, and commands for what is here. */
  const contextMenu3d = (() => {
    const vp = viewportRef.current;
    const host = hostRef.current;
    if (!menu3d || !vp || !host) return null;
    const { x, y } = menu3d;
    const under = underPointer(x, y);
    const from = measure?.a && !measure.b ? measure.a : null;
    // Snaps that only mean something in a sketch (crossings, tangents, single points) aren't listed here at all.
    const snapsHere: SnapChoice[] = SNAP_KINDS.filter((kind) => !SKETCH_ONLY.includes(kind)).map((kind) => {
      if (kind === "perpendicular" && !from)
        return { kind, unavailable: "Works from the first point of a measurement" };
      const found = snapAt(x, y, from, kind, true).snap;
      return { kind, unavailable: found ? null : `No ${SNAP_LABELS[kind].toLowerCase()} near here` };
    });
    const flat = under.hit?.outline;
    const commands: MenuCommand[] = [
      measure
        ? { label: "Stop measuring", shortcut: "Esc", run: stopMeasure }
        : { label: "Measure from here", shortcut: "D", run: () => startMeasure(snapAt(x, y, null).point) },
      ...(under.owner && !measure
        ? [
            {
              label: `Select ${under.owner.name}`,
              run: () => setSelection({ id: under.owner!.id, face: under.hit!.face }),
            },
          ]
        : []),
      ...(under.holeWall && !measure
        ? [
            under.owner?.type === "hole"
              ? { label: `Thread ${under.owner.name}…`, run: () => openThread(under.owner!.id) }
              : {
                  label: "Thread this hole…",
                  disabled: "Holes made with the Hole tool can be threaded; this one was cut another way",
                  run: () => {},
                },
          ]
        : []),
      ...(flat && !measure
        ? [
            {
              label: "Sketch on this face",
              run: () => sketchOnFace(flat, meshRef.current?.owners[under.hit!.face]),
            },
          ]
        : []),
      { label: "Snapping on", shortcut: "F3", checked: snaps.on, run: () => setSnaps({ ...snaps, on: !snaps.on }) },
      { label: "Show sizes", shortcut: "M", checked: showSizes, run: () => setShowSizes((v) => !v) },
      { label: "Fit all", run: () => vp.zoomExtents() },
    ];
    return (
      <ContextMenu
        at={menu3d}
        bounds={host.getBoundingClientRect()}
        title={under.title}
        snaps={snapsHere}
        kept={snaps.on ? snaps.kinds : []}
        snapping={snaps.on}
        once={snapOnce}
        onOnce={(kind) => {
          setSnapOnce(kind);
          if (!measure) startMeasure();
        }}
        onKeep={(kind) => (snaps.on ? toggleSnap(kind) : setSnaps({ on: true, kinds: [kind] }))}
        commands={commands}
        onClose={closeMenu3d}
      />
    );
  })();
  const threadHole = doc.features.find((f): f is HoleFeature => f.id === threadEdit?.id && f.type === "hole");
  const partHeight = built ? built.measurements.max[2] - built.measurements.min[2] : 0;
  const measured = measure?.a && measure.b ? measure : null;
  const measureBar = measure && (
    <div className="measure-bar glass" role="status" data-testid="measure-bar">
      <Icon name="ruler" />
      {measured ? (
        <span data-testid="measure-result">
          <strong>{mmText(distance(measured.a!, measured.b!))}</strong>
          {" · "}left/right {mmText(Math.abs(measured.b![0] - measured.a![0]))} · front/back{" "}
          {mmText(Math.abs(measured.b![1] - measured.a![1]))} · up {mmText(Math.abs(measured.b![2] - measured.a![2]))}
        </span>
      ) : (
        <span>
          {snapOnce ? `Next point snaps to ${SNAP_LABELS[snapOnce]}. ` : ""}
          {measure.a ? "Click the second point." : "Click the first point. Right-click for snaps."}
        </span>
      )}
      <button type="button" onClick={stopMeasure}>
        Done
      </button>
    </div>
  );

  const ribbonShown = !focus && !draft;
  const viewTab: RibbonTab = {
    id: "view",
    label: "View",
    groups: [
      {
        label: "Inspect",
        items: [
          {
            icon: "ruler",
            label: "Measure",
            name: "Measure distance",
            title: "Measure between two points, snapping to edges, corners and centres (D). Right-click for snaps.",
            pressed: measure !== null,
            onClick: () => (measure ? stopMeasure() : startMeasure()),
          },
        ],
      },
      {
        label: "Palettes",
        items: [
          {
            icon: "tree",
            label: "Browser",
            name: "Show Browser",
            title: "Show or hide the Browser: the part's steps",
            pressed: layout.browser.shown && !layout.browser.collapsed,
            onClick: () => togglePalette("browser"),
          },
          {
            icon: "properties",
            label: "Properties",
            name: "Show Properties",
            title: "Show or hide Properties: the sizes of the step being worked on",
            pressed: layout.properties.shown && !layout.properties.collapsed,
            onClick: () => togglePalette("properties"),
          },
          {
            icon: "swap",
            label: "Swap sides",
            title: "Swap the Browser and Properties to the other sides of the window",
            onClick: () => arrange((w) => ({ ...w, browserSide: w.browserSide === "left" ? "right" : "left" })),
          },
        ],
      },
      {
        label: "Style",
        items: [
          {
            icon: "sidePanel",
            label: "Docked",
            title: "Docked: solid palettes against the window's edges",
            pressed: layout.style === "docked",
            onClick: () => arrange((w) => ({ ...w, style: "docked" })),
          },
          {
            icon: "floating",
            label: "Floating",
            title: "Floating: frosted-glass palettes over the 3D view",
            pressed: layout.style === "floating",
            onClick: () => arrange((w) => ({ ...w, style: "floating" })),
          },
        ],
      },
      {
        label: "Scene",
        items: [
          {
            icon: "plate",
            label: "Plate",
            name: "Build plate",
            title:
              "Show or hide the build plate (PLATE). Off, the part floats on a plain background, as in model space.",
            pressed: appearance.plate,
            onClick: togglePlate,
          },
          {
            icon: "grid",
            label: "Grid",
            title: "Show or hide the grid (F7)",
            pressed: appearance.grid,
            onClick: toggleGrid,
          },
          {
            icon: "background",
            label: "Background",
            name: "Background colour",
            title: "The colour behind the part: the theme's, black, model space grey, white or any colour",
            onClick: () => setSettingsAt("view"),
          },
        ],
      },
      {
        label: "Workspace",
        items: [
          {
            icon: "reset",
            label: "Reset",
            name: "Reset workspace",
            title: "Put the ribbon and palettes back as they started",
            onClick: () => arrange(() => DEFAULT_WORKSPACE),
          },
          {
            icon: "settings",
            label: "Settings",
            name: "Settings",
            title: "Theme and colours, the 3D view and grid, units, snaps and the workspace (Ctrl+,)",
            pressed: settingsOpen,
            onClick: () => setSettingsAt((c) => (c ? null : "appearance")),
          },
        ],
      },
    ],
  };
  // Print Studio has one palette of its own, so only the style and reset apply there.
  const printTab: RibbonTab = {
    id: "print",
    label: "Print",
    groups: [
      {
        label: "Slice",
        items: [
          {
            icon: "layers",
            label: layerView ? "Show part" : "Slice",
            name: layerView ? "Show the part again" : "Slice the part",
            title: layerView ? "Back to the part from its layers" : "Cut the part into its printed layers",
            onClick: () => setLayerView((v) => !v),
            pressed: layerView,
            disabled: !layerView && printState.kind !== "checked",
            reason: "the checks need to finish first",
            size: "large",
          },
          {
            icon: "export",
            label: "G-code",
            name: "Export G-code",
            title: "Save the checked G-code for your printer",
            onClick: () => void exportGcode(),
            disabled: !job || "error" in job || !!gcodeBlocked || busy,
            reason: gcodeBlocked ?? "slice the part first",
            size: "large",
          },
        ],
      },
      // The job at a glance beside its buttons, so the row says what will be printed and, once sliced, what it takes.
      {
        label: "Job",
        items: [],
        info: (
          <>
            <strong>
              {printer.maker} {printer.name}
            </strong>
            <span>
              {slicerSettings.layerHeight.toFixed(2)} mm layers · {slicerSettings.walls} walls ·{" "}
              {Math.round(slicerSettings.infillDensity * 100)}% infill
            </span>
          </>
        ),
      },
      {
        label: "Result",
        items: [],
        info:
          sliceSummary?.status === "ready" ? (
            <>
              <strong>{duration(sliceSummary.seconds)}</strong>
              <span>
                {Math.round(sliceSummary.grams)} g · {(sliceSummary.filament / 1000).toFixed(2)} m PLA ·{" "}
                {sliceSummary.layers} layers
              </span>
            </>
          ) : (
            <>
              <strong>{sliceSummary?.status === "writing" ? "Working out the print…" : "Not sliced yet"}</strong>
              <span>
                {sliceSummary?.status === "failed"
                  ? "The toolpaths didn't pass their check"
                  : "Slice to see time and filament"}
              </span>
            </>
          ),
      },
    ],
  };
  const ribbonTabs: RibbonTab[] = printing
    ? [printTab, { ...viewTab, groups: viewTab.groups.filter((g) => g.label !== "Palettes") }]
    : [{ id: "home", label: "Home", groups: design.ribbon }, viewTab];

  /**
   * AutoCAD's editing commands on the picked piece: MOVE, COPY, ROTATE and SCALE ask for their value at the command
   * line; SUBTRACT and UNION make a shape or sketch cut away or add material. OFFSET is a sketch command.
   */
  const editCommands = () => {
    const f = selected && isCopyable(selected) ? selected : null;
    const pickFirst = (name: string) => `Click a shape, hole or sketch first, then type ${name}`;
    const change = (on: Feature, c: Change) => ("reason" in c ? c.reason : void project.updateFeature(on.id, c.patch));
    const why = (c: Change | null) => (c && "reason" in c ? c.reason : null);
    const moveIt = (on: Feature, label: string) =>
      setCommandPrompt({
        kind: "move",
        label,
        value: lastMove.current,
        apply: (v) => {
          lastMove.current = v;
          return change(on, moveStep(on, v));
        },
      });
    const turnWhy = f ? why(turnStep(f, 90)) : pickFirst("ROTATE");
    const scaleWhy = f ? why(scaleStep(f, 2)) : pickFirst("SCALE");
    const solid = f && (isShape(f) || f.type === "sketch") ? f : null;
    const first = doc.features.find(isSolidStep)?.id === solid?.id;
    return [
      {
        title: "Move",
        where: ["Properties › Position"],
        run: () => f && moveIt(f, `Move ${f.name} by x,y,z`),
        disabled: !f || !!why(moveStep(f, [0, 0, 0])),
        reason: f ? (why(moveStep(f, [0, 0, 0])) ?? undefined) : pickFirst("MOVE"),
      },
      {
        title: "Copy",
        where: [],
        run: () => {
          if (!f) return;
          const copy = copyStep(doc, f);
          if ("reason" in copy) return;
          addAndSelect(copy);
          moveIt(copy, `Move ${copy.name} by x,y,z`);
        },
        disabled: !f,
        reason: pickFirst("COPY"),
      },
      {
        title: "Rotate",
        where: f?.type === "box" ? ["Properties › Turn"] : [],
        run: () =>
          f &&
          setCommandPrompt({
            kind: "angle",
            label: `Turn ${f.name} by (anticlockwise)`,
            value: lastTurn.current,
            apply: (v) => {
              lastTurn.current = v;
              return change(f, turnStep(f, v));
            },
          }),
        disabled: !!turnWhy,
        reason: turnWhy ?? undefined,
      },
      {
        title: "Scale",
        where: [],
        run: () =>
          f &&
          setCommandPrompt({
            kind: "factor",
            label: `Scale ${f.name} by`,
            value: lastScale.current,
            apply: (v) => {
              lastScale.current = v;
              return change(f, scaleStep(f, v));
            },
          }),
        disabled: !!scaleWhy,
        reason: scaleWhy ?? undefined,
      },
      {
        title: "Offset",
        where: [],
        run: () => {},
        disabled: true,
        reason: "Offset works on a sketch's outlines: open the sketch (Edit in Properties), click a shape, type O",
      },
      {
        title: "Cut away",
        where: ["Properties › Cut away"],
        run: () => solid && project.updateFeature(solid.id, { mode: "cut" }),
        disabled: !solid || first,
        reason: solid ? "The first shape is what the others add to or cut from" : "Click a shape or sketch first",
      },
      {
        title: "Add material",
        where: ["Properties › Add material"],
        run: () => solid && project.updateFeature(solid.id, { mode: "add" }),
        disabled: !solid,
        reason: "Click a shape or sketch first",
      },
    ];
  };
  // The command line knows every menu and ribbon command, and the sketch tools, which start a sketch on the plate.
  // It works the same in Print Studio: a design command typed there goes back to Design and runs (BOX adds a box).
  const sketchTools: [string, SketchTool][] = [
    ["Rectangle", "rectangle"],
    ["Circle", "circle"],
    ["Outline", "polygon"],
    ["Polygon", "regular"],
  ];
  const homeTab: RibbonTab = { id: "home", label: "Home", groups: design.ribbon };
  const commands = indexCommands(menus, printing ? [...ribbonTabs, homeTab] : ribbonTabs, [
    ...sketchTools.map(([title, tool]) => ({ title, where: ["Home › Sketch"], run: () => plateSketch(tool) })),
    ...editCommands(),
  ]).map((c) =>
    printing && c.where.some((w) => w === "Create" || w === "Modify" || w.startsWith("Home ›"))
      ? {
          ...c,
          run: () => {
            setWorkspace("design");
            c.run();
          },
        }
      : c,
  );
  /** What the command line can still do while sketching: the screen, the units, and hiding itself. */
  const sketchingCommands = commands.filter((c) =>
    ["Full screen", "Sizes in inches", "Command line"].includes(c.title),
  );
  // Blurry with Claude reads the app as it is at each step of an answer, and makes changes as ordinary steps.
  helperNow.current = {
    context: {
      doc,
      units,
      picked: edgePicks,
      selected: selected?.name ?? null,
      commands: commands.filter((c) => !c.disabled).map((c) => c.title),
    },
    apply: (change) => {
      if (change.kind === "add") addAndSelect(change.feature);
      else if (change.kind === "update") project.updateFeature(change.id, change.patch);
      else if (change.kind === "remove") project.removeFeature(change.id);
      else commands.find((c) => c.title === change.title && !c.disabled)?.run();
    },
  };
  /** After a typed command, the size it asks for (see the effect that sets the prompt). */
  const onCommandRan = (c: Command) => {
    setCommandPrompt(null);
    waitingStep.current = ["Fillet", "Chamfer", "Hole", "Hollow out"].includes(c.title)
      ? { title: c.title, count: doc.features.length }
      : null;
  };
  const picks = edgePicks.length;
  const commandHint = picks
    ? `${picks} edge${picks === 1 ? "" : "s"} picked: type FILLET or CHAMFER`
    : selected
      ? `${selected.name} picked: type a command, like ERASE or MIRROR`
      : "Type a command: BOX, HOLE, FILLET, REC, or what you want to do";

  return (
    <div
      className={[
        "app",
        draft && "sketching",
        threadEdit && "threading",
        picking && "picking",
        focus && "focus",
        fullScreen && "full-screen",
        !panelShown && "panel-hidden",
        `style-${layout.style}`,
      ]
        .filter(Boolean)
        .join(" ")}
      data-mode={mode}
      style={safeAreaStyle(safeArea)}
    >
      <main
        className="viewport-host"
        ref={hostRef}
        onPointerDown={(e) => {
          if (e.button === 2) rightDown.current = { x: e.clientX, y: e.clientY };
          else pointerDown.current = { x: e.clientX, y: e.clientY };
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerMove={onHostPointerMove}
        onPointerUp={onHostPointerUp}
        data-camera-view={camera?.view ?? ""}
        data-camera-projection={camera?.projection ?? ""}
        data-camera-zoom={camera?.zoom ?? ""}
        data-camera-position={camera ? camera.position.join(",") : ""}
        data-camera-target={camera ? camera.target.join(",") : ""}
        data-references={shownPictures.length}
        data-edge-picks={edgePicks.map((p) => p.map((v) => Math.round(v * 1000) / 1000 + 0).join(",")).join(" ")}
        data-plate={printing ? printer.volume.join(",") : `${appearance.plateSize},${appearance.plateSize}`}
        data-surroundings={printing || appearance.plate ? "plate" : "model-space"}
        data-grid={appearance.grid ? "on" : "off"}
        data-safe-area={safeArea}
        data-layers={sliced ? `${layer + 1}/${layerCount}` : layerPreview ? layerPreview.status : undefined}
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
        {measureBar}
        {snapMark && (mode === "measure" || mode === "pick-face") && (
          <svg
            className="snap-overlay"
            data-testid="snap3d"
            data-snap={snapMark.snap.kind}
            data-point={snapMark.snap.point.map((v) => Math.round(v * 1000) / 1000 + 0).join(",")}
            style={{ left: snapMark.x - 10, top: snapMark.y - 10 }}
            width="20"
            height="20"
            viewBox="-10 -10 20 20"
            aria-hidden="true"
          >
            {snapShape(snapMark.snap.kind, 0, 0, 6)}
          </svg>
        )}
        {snapMark && (mode === "measure" || mode === "pick-face") && (
          <span className="snap-overlay-label" style={{ left: snapMark.x + 12, top: snapMark.y - 26 }}>
            {SNAP_LABELS[snapMark.snap.kind]}
          </span>
        )}
        {contextMenu3d}
        {threadEdit && threadHole && (
          <ThreadDialog
            hole={threadHole}
            settings={threadEdit.settings}
            partHeight={partHeight}
            onChange={(settings) => setThreadEdit({ ...threadEdit, settings })}
            onApply={applyThread}
            onCancel={cancelThread}
          />
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
        {picks > 0 && !draft && !picking && mode === "model" && (
          <div className="selection-bar edge-bar glass" role="status" aria-label="Picked edges" data-testid="edge-bar">
            <Icon name="edge" />
            <span className="selection-name">
              <strong>
                {picks} edge{picks === 1 ? "" : "s"} picked
              </strong>
            </span>
            <span className="selection-help">Click more edges, or one again to let it go</span>
            <button type="button" onClick={() => addAndSelect(newEdgeStep(doc, "fillet", edgePicks))}>
              <Icon name="fillet" />
              Fillet
            </button>
            <button type="button" onClick={() => addAndSelect(newEdgeStep(doc, "chamfer", edgePicks))}>
              <Icon name="chamfer" />
              Chamfer
            </button>
            <button
              type="button"
              className="icon-only"
              aria-label="Let go of the edges"
              title="Let go of the edges (Esc)"
              onClick={() => setEdgePicks([])}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        <Blurry
          commands={commands}
          open={helperOpen}
          onOpen={setHelperOpen}
          hidden={!!draft || focus}
          context={helperContext}
          apply={helperApply}
          onBusy={setHelperBusy}
          panelRef={helperPanel}
        />
        {layout.commandLine && !draft && (
          <div className="command-dock" ref={commandBox}>
            <CommandLine
              ref={commandLine}
              commands={commands}
              prompt={commandPrompt}
              onPromptDone={() => setCommandPrompt(null)}
              onRan={onCommandRan}
              placeholder={commandHint}
              onClose={toggleCommandLine}
            />
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
          <span className="brand" aria-label={APP_INFO.name}>
            <span className="logo" aria-hidden="true" />
            <span className="brand-name">{APP_INFO.name}</span>
          </span>
          <nav className="segmented workspaces" aria-label="Workspace">
            <button
              type="button"
              aria-pressed={!printing}
              title="Design: build and change the part"
              onClick={() => setWorkspace("design")}
            >
              Design
            </button>
            <button
              type="button"
              aria-pressed={printing}
              title="Prepare to print: check the part on your printer's plate, then export it"
              onClick={openPrintStudio}
            >
              Print Studio
            </button>
          </nav>
          <span className="divider" aria-hidden="true" />
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

        <span className="ribbon-tabs-host" ref={setRibbonTabsHost} hidden={!ribbonShown} />

        <div className="glass bar topbar-end">
          <button
            type="button"
            className="appearance-button"
            data-opens="settings"
            aria-label="Settings"
            aria-pressed={settingsOpen}
            title="Settings: theme and colours, the 3D view, units, snaps and the workspace (Ctrl+,)"
            onClick={() => setSettingsAt((c) => (c ? null : "appearance"))}
          >
            <Icon name="settings" />
            <span className="label">Settings</span>
          </button>
        </div>

        {focus && screenModes}
      </header>

      <ViewNav
        camera={camera}
        views={VIEW_BUTTONS.filter((b) => b.bar)}
        ortho={projection === "orthographic"}
        sizes={showSizes}
        disabled={webglError}
        projectionKey={PROJECTION_KEY}
        onView={(view) => viewportRef.current?.setView(view)}
        onOrtho={toggleProjection}
        onSizes={() => setShowSizes((v) => !v)}
      />

      {ribbonShown && (
        <Ribbon
          ref={ribbonRef}
          tabs={ribbonTabs}
          minimized={layout.ribbonMinimized}
          tabsHost={ribbonTabsHost}
          onMinimized={(ribbonMinimized) => arrange((w) => ({ ...w, ribbonMinimized }))}
        />
      )}

      <div className="dock dock-left" ref={leftRef}>
        {panelShown && docked("left")}
      </div>
      <div className="dock dock-right" ref={rightRef}>
        {panelShown && docked("right")}
      </div>

      {draft && (
        <SketchEditor
          draft={draft}
          issues={draftIssues}
          canCut={draft.feature.surface !== "plate" && draftIndex > 0}
          view={sketchView}
          onView={setSketchView}
          onChange={(feature) => setDraft((d) => (d ? { ...d, feature } : d))}
          onHoles={(holes) => setDraft((d) => (d ? { ...d, holes } : d))}
          onDone={finishSketch}
          onCancel={() => setDraft(null)}
          references={doc.references}
          commandLine={layout.commandLine ? { commands: sketchingCommands, onClose: toggleCommandLine } : null}
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
            {printing ? "Your part on the printer's plate" : "Click a piece to select it"}
            <span className="hint-keys" title="Help › Keyboard and mouse lists every control">
              Wheel-drag pans · Shift+wheel-drag orbits · Scroll zooms
            </span>
          </span>
        </span>
        {!draft && !focus && <BlurryButton open={helperOpen} busy={helperBusy} onOpen={setHelperOpen} />}
        <button
          type="button"
          className="statusbar-toggle"
          aria-label="Command line"
          aria-pressed={layout.commandLine}
          title={`${layout.commandLine ? "Hide" : "Show"} the command line, to type commands by name (Ctrl+9)`}
          onClick={toggleCommandLine}
        >
          <Icon name="command" />
          <span className="toggle-label">Command line</span>
        </button>
        <UnitsSwitch />
        {!focus && screenModes}
      </footer>

      {settingsAt && (
        <SettingsWindow
          value={{ appearance, units, workspace: layout, snaps }}
          category={settingsAt}
          onCategory={setSettingsAt}
          onAppearance={changeAppearance}
          onUnits={setUnits}
          onWorkspace={(w) => arrange(() => w)}
          onSnaps={setSnaps}
          shortcuts={SHORTCUTS}
          onClose={() => setSettingsAt(null)}
        />
      )}
      {dialog && <HelpDialog kind={dialog} onClose={() => setDialog(null)} />}
      {calibratingPicture && (
        <CalibrateDialog
          reference={calibratingPicture}
          onClose={() => setCalibrating(null)}
          onApply={(scale) => {
            project.updateReference(calibratingPicture.id, { scale, calibrated: true }, true);
            setCalibrating(null);
          }}
        />
      )}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Orbit", "Shift + wheel-drag, or left-drag"],
  ["Pan", "Wheel-drag, or right-drag"],
  ["Zoom", "Scroll (zooms where the pointer is)"],
  ["Fit everything on screen", "Double-click the wheel"],
  ["3D / Top / Front / Right view", "0 / 1 / 2 / 3"],
  ["Bottom / Back / Left view", "Shift+1 / Shift+2 / Shift+3"],
  ["Orthographic on or off", "5"],
  ["Show or hide sizes", "M"],
  ["Select a piece", "Click it"],
  ["Pick edges for a fillet or chamfer", "Click each edge (again to let it go); Esc lets go of them all"],
  ["Command line on or off", "Ctrl+9; then type a command (FILLET, F, REC…), Enter runs it, Enter again repeats it"],
  ["Move the selected piece", "Drag its arrows, or arrow keys (Shift = 10 mm), Page Up / Page Down"],
  ["Delete the selected piece", "Delete"],
  ["Undo / Redo", "Ctrl+Z / Ctrl+Y"],
  ["New / Open / Save / Save as", "Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S"],
  ["Menus", "Alt, or Alt + the menu's first letter"],
  ["Full screen on or off", "F11 (Esc also leaves it)"],
  ["Focus canvas (put the panels away)", "Ctrl+0 (Esc also leaves it)"],
  ["Show or hide the palettes", "Ctrl+B"],
  ["Sketch: Select / Rectangle / Circle / Outline", "V / R / C / L"],
  ["Sketch: type a size while drawing", "Type the number, Tab to the next box, Enter"],
  ["Sketch: close an outline", "Enter, or click its first corner"],
  ["Sketch: type a corner as a point", "x,y from the origin · @dx,dy or @length<angle from the last corner"],
  ["Sketch: ortho lock / angle steps", "F8 (hold Shift to flip it) / Angles on the sketch bar"],
  ["Sketch: snaps (end, middle, centre, crossing, square to)", "On near the pointer; hold Alt to ignore them"],
  ["Sketch: slide the drawing (it never turns)", "Wheel-drag or right-drag; double-click the wheel to fit"],
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
/** Fill lines (x1 y1 x2 y2 each) as line pairs at height z for the viewport. */
function fillLines3d(z: number, ...sets: Float64Array[]): Float32Array {
  const out = new Float32Array(sets.reduce((n, l) => n + (l.length / 4) * 6, 0));
  let o = 0;
  for (const l of sets)
    for (let i = 0; i < l.length; i += 4) {
      out.set([l[i]!, l[i + 1]!, z, l[i + 2]!, l[i + 3]!, z], o);
      o += 6;
    }
  return out;
}

/** Outlines as line pairs for the viewport, each at its layer's cut height. */
function layerLines(layers: { z: number; loops: Float64Array[] }[]): Float32Array {
  let n = 0;
  for (const l of layers) for (const loop of l.loops) n += loop.length * 3;
  const out = new Float32Array(n);
  let o = 0;
  for (const l of layers)
    for (const loop of l.loops) {
      const k = loop.length / 2;
      for (let i = 0; i < k; i++) {
        const j = (i + 1) % k;
        out.set([loop[2 * i]!, loop[2 * i + 1]!, l.z, loop[2 * j]!, loop[2 * j + 1]!, l.z], o);
        o += 6;
      }
    }
  return out;
}

/** The holes placed while sketching on a face, as the hole steps they will become. */
function draftHoles(doc: ProjectDocument, d: SketchDraft): HoleFeature[] {
  if (!d.holeFace || !d.holes?.length) return [];
  return holeSteps(doc, d.holeFace, d.holes, d.isNew && d.feature.profiles.length ? d.feature : undefined);
}

/** The design with the sketch being drawn in it, and its holes, so the 3D view shows them as they are drawn. */
function withDraft(doc: ProjectDocument, d: SketchDraft): ProjectDocument {
  const f = d.feature;
  const holes = draftHoles(doc, d);
  // A new sketch with only holes in it is left out, like it will be when it's done.
  const sketch = d.isNew && holes.length && !f.profiles.length ? [] : d.isNew ? [f] : [];
  const features = d.isNew ? doc.features : doc.features.map((x) => (x.id === f.id ? f : x));
  return { ...doc, features: [...features, ...sketch, ...holes] };
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

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${lengthText(Math.abs(n))}`;

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
            ? "Drag an arrow to move"
            : "Edit it in the panel"}
      </span>
      {props.onSketch && (
        <button type="button" onClick={props.onSketch}>
          <Icon name="pencil" />
          Sketch on this face
        </button>
      )}
      <button type="button" onClick={props.onRemove} disabled={!props.canRemove} title="Remove it (Delete key)">
        <Icon name="trash" />
        Remove
      </button>
      <button type="button" className="icon-only" aria-label="Deselect" title="Deselect (Esc)" onClick={props.onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}

/** The open part of the 3D view as CSS variables, so bars that float over it sit below the ribbon, between palettes. */
function safeAreaStyle(area: string): CSSProperties | undefined {
  const [top, left, bottom, right, status, palette] = area.split(",").map(Number);
  if (top === undefined || left === undefined || right === undefined || Number.isNaN(top)) return undefined;
  return {
    "--safe-top": `${top}px`,
    "--safe-left": `${left}px`,
    "--safe-bottom": `${bottom ?? 0}px`,
    "--safe-right": `${right}px`,
    "--status-room": `${status ?? 0}px`,
    // The right palette alone, without Blurry's panel: where his panel sits.
    "--palette-right": `${palette ?? right}px`,
  } as CSSProperties;
}

const mmText = (n: number) => lengthText(n);

// Sizes drawn on the part follow the units picked, like every other size.
setDimensionFormat(mmText);

/** The hole wall (an inside cylinder face) whose mouth a circle edge is, or -1. */
function holeWallOfRim(mesh: MeshData, edge: number): number {
  const e = mesh.edgeInfo[edge]!;
  if (e.kind !== "circle" || !e.centre || !e.radius) return -1;
  return mesh.faceInfo.findIndex((f) => {
    if (f.kind !== "cylinder" || !f.inside || !f.axis || Math.abs(f.radius! - e.radius!) > 1e-6) return false;
    const { point: p, direction: d } = f.axis;
    const v = [0, 1, 2].map((i) => e.centre![i]! - p[i]!);
    const t = v[0]! * d[0] + v[1]! * d[1] + v[2]! * d[2];
    return Math.hypot(...v.map((x, i) => x - t * d[i]!)) < 1e-6;
  });
}
