// Holes placed while sketching on a face. They are drawn with the sketch, shown in the 3D preview straight away, and
// become ordinary hole steps when the sketch is done, so threads, counterbores and depth can be set on them later.
import {
  boxSideFace,
  boxSideOf,
  canFollow,
  measuredFrom,
  newHole,
  type BoxFeature,
  type HoleFace,
  type HoleFeature,
  type ProjectDocument,
  type SketchFeature,
  type SketchPlane,
} from "@studio3d/document";

/** A hole on the face being sketched on: its centre in sketch coordinates (from the face's bottom-left corner). */
export interface DraftHole {
  id: string;
  u: number;
  v: number;
  diameter: number;
}

const close = (a: readonly number[], b: readonly number[]) => a.every((x, i) => Math.abs(x - b[i]!) < 1e-3);

/**
 * The face the holes go in, measured from its left and bottom edges like the sketch. On a whole side of a box the
 * holes follow the box when it is resized or moved; on any other face they stay where the face was.
 */
export function faceForHoles(
  doc: ProjectDocument,
  face: { plane: SketchPlane; label: string; width: number; height: number },
  owner: string | undefined,
): HoleFace {
  const box = doc.features.find((f): f is BoxFeature => f.id === owner && f.type === "box");
  const side = boxSideOf(face.plane.normal);
  if (box && side && canFollow(box, side)) {
    const own = boxSideFace(box, side);
    // Only when the picked face is that whole side, so the sketch's positions mean the same on both.
    if (close(own.plane.origin, face.plane.origin) && close(own.plane.xDir, face.plane.xDir))
      return { ...own, on: { shape: box.id, side }, across: "left", up: "bottom" };
  }
  const { plane, label, width, height } = face;
  return { plane, surface: label, width, height, across: "left", up: "bottom" };
}

/** The holes as hole steps (through the part), named on from the holes already in the project. */
export function holeSteps(
  doc: ProjectDocument,
  face: HoleFace,
  holes: DraftHole[],
  sketch?: SketchFeature,
): HoleFeature[] {
  let named: ProjectDocument = sketch ? { ...doc, features: [...doc.features, sketch] } : doc;
  return holes.map((h) => {
    const hole: HoleFeature = {
      ...newHole(named),
      id: h.id,
      face,
      ...measuredFrom(face, [h.u, h.v], "left", "bottom"),
      diameter: h.diameter,
    };
    named = { ...named, features: [...named.features, hole] };
    return hole;
  });
}
