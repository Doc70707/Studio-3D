// Project state: the document (source of truth), where it's saved, and whether it has unsaved changes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canRedo,
  canUndo,
  emptyPreserved,
  holesOf,
  isCopyStep,
  isShape,
  DEFAULT_PRINTER,
  moveFeature as moved,
  newDocument,
  parseProject,
  parseRecovery,
  record,
  redo as redoStep,
  serializeProject,
  serializeRecovery,
  startHistory,
  undo as undoStep,
  type Feature,
  type Preserved,
  type PrintSetup,
  type ProjectDocument,
  type ReferenceImage,
  type RecoveryResult,
} from "@studio3d/document";
import { platform, type FileRef } from "./platform";

export const APP_INFO = { name: "Studio 3D", version: "0.29.0" };

/** How long after the last edit the unsaved work is backed up. */
export const BACKUP_DELAY_MS = 2000;

/** Unsaved work found from a session that ended without saving, waiting for the user to restore or discard it. */
export type RecoveryOffer = Extract<RecoveryResult, { ok: true }>;

/**
 * What the document holds, to tell when it has changed. A reference picture's image never changes once added, so
 * it is left out: stringifying megabytes of picture on every keystroke would slow typing down.
 */
const fingerprint = (doc: ProjectDocument) =>
  JSON.stringify(doc.references ? { ...doc, references: doc.references.map(({ src: _, ...r }) => r) } : doc);

export type Notice = { kind: "info" | "error"; text: string } | null;

/** "at 21:30" today, otherwise "on 16 Oct 2026, 21:30". */
export function whenSaved(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `at ${time}`;
  return `on ${d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}, ${time}`;
}

export function useProject() {
  const [history, setHistory] = useState(() => startHistory(newDocument()));
  const doc = history.present;
  const setDoc = useCallback((d: ProjectDocument) => setHistory(startHistory(d)), []);
  /** Applies an edit as an undoable step. Edits with the same key in quick succession merge into one step. */
  const edit = useCallback(
    (change: (d: ProjectDocument) => ProjectDocument, key: string | null) =>
      setHistory((h) => record(h, change(h.present), key, performance.now())),
    [],
  );
  const [file, setFile] = useState<FileRef | null>(null);
  const [savedPrint, setSavedPrint] = useState(() => fingerprint(doc));
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const preserved = useRef<Preserved>(emptyPreserved());

  const dirty = fingerprint(doc) !== savedPrint;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const holes = holesOf(doc);
  const name = file?.name.replace(/\.s3d$/i, "") ?? "Untitled";

  /** Changes some numbers (or the add/cut mode) of one shape or hole. Typing in one field is one undo step. */
  const updateFeature = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      edit(
        (d) => ({
          ...d,
          features: d.features.map((f) => (f.id === id ? ({ ...f, ...patch } as Feature) : f)),
        }),
        `${id}.${Object.keys(patch).join()}`,
      ),
    [edit],
  );

  /**
   * Adds a new shape before the holes and any hollow (so it is drilled and hollowed with the rest of the part),
   * or any other step (hole, sketch, hollow, fillet, pattern...) at the end.
   */
  const addFeature = useCallback(
    (feature: Feature) =>
      edit((d) => {
        if (!isShape(feature))
          return { ...d, features: [...d.features, feature] };
        const firstHole = d.features.findIndex((f) => f.type === "hole" || f.type === "hollow");
        const at = firstHole === -1 ? d.features.length : firstHole;
        return {
          ...d,
          features: [...d.features.slice(0, at), feature, ...d.features.slice(at)],
        };
      }, null),
    [edit],
  );

  const removeFeature = useCallback(
    // Patterns and mirrors of the removed step go with it (one undo brings them all back).
    (id: string) =>
      edit(
        (d) => ({ ...d, features: d.features.filter((f) => f.id !== id && !(isCopyStep(f) && f.source === id)) }),
        null,
      ),
    [edit],
  );

  /** Reference pictures: added, changed and removed like steps, with undo, but never built. */
  const addReference = useCallback(
    (r: ReferenceImage) => edit((d) => ({ ...d, references: [...(d.references ?? []), r] }), null),
    [edit],
  );
  /** Typing in a field merges into one undo step; `separate` makes the change its own step (a calibration). */
  const updateReference = useCallback(
    (id: string, patch: Partial<ReferenceImage>, separate = false) =>
      edit(
        (d) => ({ ...d, references: (d.references ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) }),
        separate ? null : `${id}.${Object.keys(patch).join()}`,
      ),
    [edit],
  );
  const removeReference = useCallback(
    (id: string) =>
      edit((d) => {
        const references = (d.references ?? []).filter((r) => r.id !== id);
        const { references: _, ...rest } = d;
        return references.length ? { ...rest, references } : rest;
      }, null),
    [edit],
  );

  /** Print Studio's printer. Saved with the project and undoable, but beside the design, so it never rebuilds. */
  const setPrinter = useCallback(
    (printer: string) => edit((d) => ({ ...d, print: { ...d.print, printer } }), null),
    [edit],
  );
  /** Changes print settings (not the printer). Each change is one undo step and never rebuilds the part. */
  const setPrintSettings = useCallback(
    (settings: Partial<Omit<PrintSetup, "printer">>) =>
      edit((d) => ({ ...d, print: { printer: d.print?.printer ?? DEFAULT_PRINTER, ...d.print, ...settings } }), null),
    [edit],
  );

  /** Moves one step by some millimetres. Each move is its own undo step. */
  const moveFeature = useCallback(
    (id: string, by: [number, number, number]) =>
      edit((d) => ({ ...d, features: d.features.map((f) => (f.id === id ? moved(f, by) : f)) }), null),
    [edit],
  );

  const undo = useCallback(() => setHistory(undoStep), []);
  const redo = useCallback(() => setHistory(redoStep), []);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      setNotice({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const okToDiscard = useCallback(
    async () => !dirtyRef.current || platform.confirmDiscard("You have unsaved changes. Discard them?"),
    [],
  );

  const newProject = useCallback(
    () =>
      run(async () => {
        if (!(await okToDiscard())) return;
        const d = newDocument();
        preserved.current = emptyPreserved();
        setDoc(d);
        setFile(null);
        setSavedPrint(fingerprint(d));
        setNotice(null);
      }),
    [okToDiscard, run],
  );

  const openProject = useCallback(
    () =>
      run(async () => {
        if (!(await okToDiscard())) return;
        const opened = await platform.openProject();
        if (!opened) return;
        const parsed = parseProject(opened.text);
        if (!parsed.ok) {
          setNotice({
            kind: "error",
            text: `Couldn't open ${opened.file.name}. ${parsed.error}`,
          });
          return;
        }
        preserved.current = parsed.preserved;
        setDoc(parsed.document);
        setFile(opened.file);
        setSavedPrint(fingerprint(parsed.document));
        setNotice(
          parsed.warnings.length
            ? { kind: "info", text: parsed.warnings.join(" ") }
            : { kind: "info", text: `Opened ${opened.file.name}.` },
        );
      }),
    [okToDiscard, run],
  );

  const save = useCallback(
    (as: boolean) =>
      run(async () => {
        const snapshot = doc;
        const text = serializeProject(snapshot, APP_INFO, preserved.current);
        const target = !as && platform.capabilities.saveInPlace ? (file ?? undefined) : undefined;
        const saved = await platform.saveProject(text, name, target);
        if (!saved) return;
        setFile(saved);
        setSavedPrint(fingerprint(snapshot));
        setNotice({
          kind: "info",
          text: platform.kind === "desktop" ? `Saved ${saved.name}.` : `Downloaded ${saved.name}.`,
        });
      }),
    [doc, file, name, run],
  );

  // Crash recovery. While unsaved work exists, a copy of it is kept outside the user's file, a moment after each
  // edit. On the next start, a copy left behind means the app closed without saving: the user can restore it.
  // Backups wait while that offer is open, so new edits never overwrite work the user hasn't decided about.
  const [recovery, setRecovery] = useState<"checking" | "offered" | "ready">("checking");
  const [offer, setOffer] = useState<RecoveryOffer | null>(null);
  /** The document the backup copy currently holds, so the status bar can say the work is safe. */
  const [backedUpDoc, setBackedUpDoc] = useState<ProjectDocument | null>(null);
  const hasBackup = useRef(false);
  const warnedBackup = useRef(false);
  // Backup writes and removals run one at a time, in order, so a late write can't land after a removal.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(op, op);
    queue.current = next.catch(() => {});
    return next;
  }, []);
  const forgetBackup = useCallback(() => {
    hasBackup.current = false;
    setBackedUpDoc(null);
    return enqueue(() => platform.recovery.clear());
  }, [enqueue]);

  useEffect(() => {
    let cancelled = false;
    platform.recovery.read().then(
      (text) => {
        if (cancelled) return;
        if (text === null) return setRecovery("ready");
        const found = parseRecovery(text);
        if (found.ok) {
          setOffer(found);
          return setRecovery("offered");
        }
        void enqueue(() => platform.recovery.clear()).catch(() => {});
        setNotice({ kind: "error", text: `${found.error} It has been removed.` });
        setRecovery("ready");
      },
      () => !cancelled && setRecovery("ready"), // no backup folder: the app works, just without recovery
    );
    return () => {
      cancelled = true;
    };
  }, [enqueue]);

  useEffect(() => {
    if (recovery !== "ready") return;
    if (!dirty) {
      if (hasBackup.current) void forgetBackup().catch(() => {});
      return;
    }
    const timer = setTimeout(() => {
      const text = serializeRecovery({
        savedAt: new Date().toISOString(),
        file,
        project: serializeProject(doc, APP_INFO, preserved.current),
      });
      enqueue(() => platform.recovery.write(text)).then(
        () => {
          hasBackup.current = true;
          setBackedUpDoc(doc);
        },
        (e: unknown) => {
          if (warnedBackup.current) return;
          warnedBackup.current = true;
          const why = e instanceof Error ? e.message : String(e);
          setNotice({ kind: "error", text: `Your unsaved work couldn't be backed up (${why}). Save often to keep it safe.` });
        },
      );
    }, BACKUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [recovery, dirty, doc, file, enqueue, forgetBackup]);

  /** Brings back the unsaved work from the last session. It stays unsaved until the user saves it. */
  const restoreBackup = useCallback(
    () =>
      run(async () => {
        if (!offer || !(await okToDiscard())) return;
        preserved.current = offer.parsed.preserved;
        setDoc(offer.parsed.document);
        setFile(offer.snapshot.file);
        setSavedPrint(""); // never matches a document, so the work shows as unsaved
        hasBackup.current = true; // the copy is still there until this work is saved or backed up again
        setOffer(null);
        setRecovery("ready");
        setNotice({
          kind: "info",
          text: [
            `Restored your unsaved work from ${whenSaved(offer.snapshot.savedAt)}. Save it to keep it.`,
            ...offer.parsed.warnings,
          ].join(" "),
        });
      }),
    [offer, okToDiscard, run],
  );

  /** Throws away the unsaved work from the last session. */
  const discardBackup = useCallback(
    () =>
      run(async () => {
        await forgetBackup();
        setOffer(null);
        setRecovery("ready");
      }),
    [forgetBackup, run],
  );

  const backedUp = dirty && backedUpDoc === doc;

  /**
   * For "close without saving": that work is deliberately thrown away, so its backup goes too. A backup from an
   * earlier crash the user hasn't decided about yet is kept for next time.
   */
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  const discardOnClose = useCallback(
    async () => (recoveryRef.current === "offered" ? undefined : forgetBackup()),
    [forgetBackup],
  );

  const undoable = canUndo(history);
  const redoable = canRedo(history);
  return useMemo(
    () => ({
      doc,
      holes,
      file,
      name,
      dirty,
      dirtyRef,
      notice,
      setNotice,
      busy,
      run,
      updateFeature,
      addFeature,
      removeFeature,
      moveFeature,
      addReference,
      updateReference,
      removeReference,
      setPrinter,
      setPrintSettings,
      undo,
      redo,
      canUndo: undoable,
      canRedo: redoable,
      newProject,
      openProject,
      save,
      recoveryOffer: offer,
      restoreBackup,
      discardBackup,
      discardOnClose,
      backedUp,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      doc,
      file,
      name,
      dirty,
      notice,
      busy,
      run,
      updateFeature,
      addFeature,
      removeFeature,
      moveFeature,
      addReference,
      updateReference,
      removeReference,
      setPrinter,
      setPrintSettings,
      undo,
      redo,
      undoable,
      redoable,
      newProject,
      openProject,
      save,
      offer,
      restoreBackup,
      discardBackup,
      discardOnClose,
      backedUp,
    ],
  );
}
