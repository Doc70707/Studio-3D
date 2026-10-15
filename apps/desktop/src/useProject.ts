// Project state: the document (source of truth), where it's saved, and whether it has unsaved changes.
import { useCallback, useMemo, useRef, useState } from "react";
import {
  emptyPreserved,
  newDocument,
  parseProject,
  serializeProject,
  type BoxFeature,
  type Preserved,
  type ProjectDocument,
} from "@studio3d/document";
import { platform, type FileRef } from "./platform";

export const APP_INFO = { name: "Studio 3D", version: "0.2.0" };

const fingerprint = (doc: ProjectDocument) => JSON.stringify(doc);

export type Notice = { kind: "info" | "error"; text: string } | null;

export function useProject() {
  const [doc, setDoc] = useState<ProjectDocument>(newDocument);
  const [file, setFile] = useState<FileRef | null>(null);
  const [savedPrint, setSavedPrint] = useState(() => fingerprint(doc));
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const preserved = useRef<Preserved>(emptyPreserved());

  const dirty = fingerprint(doc) !== savedPrint;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const box = doc.features[0]!;
  const name = file?.name.replace(/\.s3d$/i, "") ?? "Untitled";

  const updateBox = useCallback((patch: Partial<BoxFeature>) => {
    setDoc((d) => ({ ...d, features: d.features.map((f, i) => (i === 0 ? { ...f, ...patch } : f)) }));
  }, []);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e) });
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
          setNotice({ kind: "error", text: `Couldn't open ${opened.file.name}. ${parsed.error}` });
          return;
        }
        preserved.current = parsed.preserved;
        setDoc(parsed.document);
        setFile(opened.file);
        setSavedPrint(fingerprint(parsed.document));
        setNotice(parsed.warnings.length ? { kind: "info", text: parsed.warnings.join(" ") } : { kind: "info", text: `Opened ${opened.file.name}.` });
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
        setNotice({ kind: "info", text: platform.kind === "desktop" ? `Saved ${saved.name}.` : `Downloaded ${saved.name}.` });
      }),
    [doc, file, name, run],
  );

  return useMemo(
    () => ({ doc, box, file, name, dirty, dirtyRef, notice, setNotice, busy, run, updateBox, newProject, openProject, save }),
    [doc, box, file, name, dirty, notice, busy, run, updateBox, newProject, openProject, save],
  );
}
