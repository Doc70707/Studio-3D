// A small STL reader and checker, written independently of the kernel, used by tests.
// "Watertight" here means every edge is shared by exactly two triangles, in opposite directions.

export interface StlReport {
  triangles: number;
  watertight: boolean;
  consistentWinding: boolean;
  volume: number;
  min: [number, number, number];
  max: [number, number, number];
}

export function checkBinaryStl(buf: ArrayBuffer): StlReport {
  const view = new DataView(buf);
  if (buf.byteLength < 84) throw new Error("STL too short");
  const n = view.getUint32(80, true);
  if (buf.byteLength !== 84 + n * 50) throw new Error(`STL size mismatch: header says ${n} triangles`);

  // Corners within 1e-8 mm are the same corner (as in trimesh), so surfaces meeting at a seam must really join.
  const q = (v: number) => Math.round(v * 1e8) + 0;
  const key = (x: number, y: number, z: number) => `${q(x)},${q(y)},${q(z)}`;
  const ids = new Map<string, number>();
  const id = (x: number, y: number, z: number) => {
    const k = key(x, y, z);
    let v = ids.get(k);
    if (v === undefined) ids.set(k, (v = ids.size));
    return v;
  };
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const directed = new Map<string, number>();
  let volume = 0;

  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    const p: number[][] = [];
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(o + v * 12, true);
      const y = view.getFloat32(o + v * 12 + 4, true);
      const z = view.getFloat32(o + v * 12 + 8, true);
      p.push([x, y, z]);
      min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
      max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
    }
    const [a, b, c] = p as [number[], number[], number[]];
    // Signed volume of the tetrahedron with the origin (divergence theorem).
    volume += (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) / 6;
    const vi = p.map((q) => id(q[0]!, q[1]!, q[2]!));
    for (let e = 0; e < 3; e++) {
      const k = `${vi[e]}>${vi[(e + 1) % 3]}`;
      directed.set(k, (directed.get(k) ?? 0) + 1);
    }
  }

  let watertight = true;
  let consistentWinding = true;
  for (const [k, count] of directed) {
    const [from, to] = k.split(">");
    const reverse = directed.get(`${to}>${from}`) ?? 0;
    if (count !== 1) consistentWinding = false;
    if (count + reverse !== 2) watertight = false;
  }
  return { triangles: n, watertight, consistentWinding, volume, min, max };
}
