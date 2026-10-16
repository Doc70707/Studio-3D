// Project state: the document (source of truth), where it's saved, and whether it has unsaved changes.
import { useCallback, useMemo, useRef, useState } from "react";
import {
  canRedo,
  canUndo,
  emptyPreserved,
  holesOf,
  newDocument,
  parseProject,
  record,
  redo as redoStep,
  serializeProject,
  startHistory,
  undo as undoStep,
  type Feature,
  type Preserved,
  type ProjectDocument,
} from "@studio3d/document";
import { platform, type FileRef } from "./platform";

export const APP_INFO = { name: "Studio 3D", version: "0.5.0" };

const fingerprint = (doc: ProjectDocument) => JSON.stringify(doc);

export type Notice = { kind: "info" | "error"; text: string } | null;

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

  /** Adds a new shape before the holes (holes are drilled after shapes), or a hole or sketch at the end. */
  const addFeature = useCallback(
    (feature: Feature) =>
      edit((d) => {
        if (feature.type === "hole" || feature.type === "sketch") return { ...d, features: [...d.features, feature] };
        const firstHole = d.features.findIndex((f) => f.type === "hole");
        const at = firstHole === -1 ? d.features.length : firstHole;
        return {
          ...d,
          features: [...d.features.slice(0, at), feature, ...d.features.slice(at)],
        };
      }, null),
    [edit],
  );

  const removeFeature = useCallback(
    (id: string) => edit((d) => ({ ...d, features: d.features.filter((f) => f.id !== id) }), null),
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
      undo,
      redo,
      canUndo: undoable,
      canRedo: redoable,
      newProject,
      openProject,
      save,
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
      undo,
      redo,
      undoable,
      redoable,
      newProject,
      openProject,
      save,
    ],
  );
}
