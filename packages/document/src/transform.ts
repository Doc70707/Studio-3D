// AutoCAD's MOVE, COPY, ROTATE and SCALE on one step of the design: each works out the change to that step, or
// says in plain words why it can't be done to it.
import { SIZE_FIELDS, isShape, newId, nextName, type Feature, type ProjectDocument } from "./model";
import { add3, profileBounds, type Point2, type Profile, type Vec3 } from "./sketch";

/** A change to a step, or why there isn't one. */
export type Change = { patch: Partial<Feature> } | { reason: string };

const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const turnPoint = ([x, y]: Point2, [cx, cy]: Point2, deg: number): Point2 => {
  const a = (deg * Math.PI) / 180;
  const [dx, dy] = [x - cx, y - cy];
  return [tidy(cx + dx * Math.cos(a) - dy * Math.sin(a)), tidy(cy + dx * Math.sin(a) + dy * Math.cos(a))];
};

/** The middle of all the outlines' bounds together. */
function middleOf(profiles: Profile[]): Point2 {
  const b = profiles.map(profileBounds);
  const x0 = Math.min(...b.map((r) => r[0]));
  const y0 = Math.min(...b.map((r) => r[1]));
  const x1 = Math.max(...b.map((r) => r[2]));
  const y1 = Math.max(...b.map((r) => r[3]));
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** Outlines turned about a point: a rectangle stays a rectangle at quarter turns, else becomes a 4-corner outline. */
export function turnProfiles(profiles: Profile[], deg: number, about: Point2 = middleOf(profiles)): Profile[] {
  const quarter = Math.abs(deg / 90 - Math.round(deg / 90)) < 1e-9;
  return profiles.map((p): Profile => {
    if (p.kind === "circle") {
      const [x, y] = turnPoint([p.x, p.y], about, deg);
      return { ...p, x, y };
    }
    if (p.kind === "polygon") return { ...p, points: p.points.map((q) => turnPoint(q, about, deg)) };
    const centre = turnPoint([p.x + p.width / 2, p.y + p.height / 2], about, deg);
    if (quarter) {
      const odd = Math.abs(Math.round(deg / 90)) % 2 === 1;
      const [w, h] = odd ? [p.height, p.width] : [p.width, p.height];
      return { ...p, x: tidy(centre[0] - w / 2), y: tidy(centre[1] - h / 2), width: w, height: h };
    }
    const corners: Point2[] = [
      [p.x, p.y],
      [p.x + p.width, p.y],
      [p.x + p.width, p.y + p.height],
      [p.x, p.y + p.height],
    ];
    return { kind: "polygon", points: corners.map((q) => turnPoint(q, about, deg)) };
  });
}

/** Outlines grown or shrunk about a point. */
function scaleProfiles(profiles: Profile[], k: number, about: Point2 = middleOf(profiles)): Profile[] {
  const at = ([x, y]: Point2): Point2 => [tidy(about[0] + (x - about[0]) * k), tidy(about[1] + (y - about[1]) * k)];
  return profiles.map((p): Profile => {
    if (p.kind === "polygon") return { ...p, points: p.points.map(at) };
    if (p.kind === "circle") {
      const [x, y] = at([p.x, p.y]);
      return { ...p, x, y, diameter: tidy(p.diameter * k) };
    }
    const [x, y] = at([p.x, p.y]);
    return { ...p, x, y, width: tidy(p.width * k), height: tidy(p.height * k) };
  });
}

/**
 * Turns a step about the upright line through its middle, anticlockwise seen from above for a positive angle (as
 * AutoCAD's ROTATE). A box keeps the turn as its rotation; a sketch's outlines turn in the face they're drawn on.
 */
export function turnStep(f: Feature, deg: number): Change {
  if (!Number.isFinite(deg)) return { reason: "The angle needs to be a number of degrees, like 90 or -45" };
  if (f.type === "box") {
    const r = tidy(((((f.rotation ?? 0) + deg) % 360) + 360) % 360);
    return { patch: { rotation: r === 360 ? 0 : r } };
  }
  if (f.type === "sketch") {
    if (f.revolve !== undefined) return { reason: `${f.name} spins round its line; turning it isn't possible` };
    if (!f.profiles.length) return { reason: `${f.name} has nothing drawn in it yet` };
    return { patch: { profiles: turnProfiles(f.profiles, deg) } };
  }
  if (isShape(f) || f.type === "hole") return { reason: `${f.name} is round, so it looks the same turned` };
  return { reason: `${f.name} isn't a shape, hole or sketch` };
}

/** Moves a step by a distance in x, y and z (mm). */
export function moveStep(f: Feature, [dx, dy, dz]: Vec3): Change {
  if (isShape(f)) return { patch: { x: tidy(f.x + dx), y: tidy(f.y + dy), z: tidy(f.z + dz) } };
  if (f.type === "hole") {
    if (f.face) return { reason: `${f.name} is on a face: change its distances in Properties` };
    return { patch: { x: tidy(f.x + dx), y: tidy(f.y + dy) } };
  }
  if (f.type === "sketch") {
    const origin = add3(f.plane.origin, [dx, dy, dz]).map(tidy) as Vec3;
    return { patch: { plane: { ...f.plane, origin } } };
  }
  return { reason: `${f.name} isn't a shape, hole or sketch` };
}

/** Grows or shrinks a step by a factor about its middle. */
export function scaleStep(f: Feature, k: number): Change {
  if (!(k > 0) || !Number.isFinite(k)) return { reason: "The scale needs to be a number above 0, like 2 or 0.5" };
  if (isShape(f)) {
    if (f.type === "cylinder" && f.thread) return { reason: `${f.name}'s size comes from its thread` };
    const patch: Record<string, number> = {};
    for (const key of SIZE_FIELDS[f.type]) patch[key] = tidy((f as unknown as Record<string, number>)[key]! * k);
    return { patch: patch as Partial<Feature> };
  }
  if (f.type === "hole") {
    if (f.thread || f.clearance) return { reason: `${f.name}'s size comes from its screw size` };
    return { patch: { diameter: tidy(f.diameter * k) } };
  }
  if (f.type === "sketch") {
    if (!f.profiles.length) return { reason: `${f.name} has nothing drawn in it yet` };
    // A revolve grows about its spin line, so it stays a whole part.
    const about: Point2 | undefined = f.revolve !== undefined ? [0, 0] : undefined;
    const depth = f.revolve === undefined && f.depth > 0 ? { depth: tidy(f.depth * k) } : {};
    return { patch: { profiles: scaleProfiles(f.profiles, k, about), ...depth } };
  }
  return { reason: `${f.name} isn't a shape, hole or sketch` };
}

/** A copy of a step, with a new name; it sits on top of the original until it is moved. */
export function copyStep(doc: ProjectDocument, f: Feature): Feature | { reason: string } {
  if (!isShape(f) && f.type !== "hole" && f.type !== "sketch")
    return { reason: `${f.name} isn't a shape, hole or sketch` };
  const base = f.name.replace(/\s+\d+$/, "") || "Copy";
  return { ...structuredClone(f), id: newId(), name: nextName(doc, base) };
}
