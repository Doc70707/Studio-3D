// A 3MF file (3MF Core Specification 1.4, https://github.com/3MFConsortium/spec_core) made from the exact STL that
// Print Studio checked: one object with the part's name, in millimetres, placed by its build item. The package is a
// plain ZIP with stored (uncompressed) entries, which the Open Packaging Conventions allow; it needs no library.

export interface ThreeMfOptions {
  /** The object's name, shown in the slicer's object list. */
  name: string;
  /** Moves the part from Studio 3D's plate (centred on the origin) to the printer's (origin at its front-left corner). */
  offset: [number, number, number];
  /** The application that wrote it, recorded in the file's metadata. */
  application: string;
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
  "</Types>\n";
const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Target="/3D/3dmodel.model" Id="rel0" ' +
  'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
  "</Relationships>\n";

const xmlText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/** A float32 coordinate written with enough digits to read back to the same float. */
const num = (v: number) => String(Number(v.toPrecision(9)) + 0);

/** The model part of the package: shared corners, triangles, the named object and where it goes. */
export function threeMfModel(stl: ArrayBuffer, options: ThreeMfOptions): string {
  const view = new DataView(stl);
  const n = view.getUint32(80, true);
  const index = new Map<string, number>();
  const vertices: string[] = [];
  const triangles: string[] = [];
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    const ids: number[] = [];
    for (let v = 0; v < 3; v++) {
      const p = [0, 4, 8].map((d) => view.getFloat32(o + v * 12 + d, true));
      const key = p.join(",");
      let id = index.get(key);
      if (id === undefined) {
        id = vertices.length;
        index.set(key, id);
        vertices.push(`<vertex x="${num(p[0]!)}" y="${num(p[1]!)}" z="${num(p[2]!)}"/>`);
      }
      ids.push(id);
    }
    // A triangle whose corners meet carries no surface, and the spec doesn't allow it.
    if (ids[0] !== ids[1] && ids[1] !== ids[2] && ids[0] !== ids[2])
      triangles.push(`<triangle v1="${ids[0]}" v2="${ids[1]}" v3="${ids[2]}"/>`);
  }
  const [x, y, z] = options.offset.map(num);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
    `<metadata name="Application">${xmlText(options.application)}</metadata>\n` +
    `<metadata name="Title">${xmlText(options.name)}</metadata>\n` +
    `<resources><object id="1" name="${xmlText(options.name)}" type="model"><mesh>\n` +
    `<vertices>\n${vertices.join("\n")}\n</vertices>\n` +
    `<triangles>\n${triangles.join("\n")}\n</triangles>\n` +
    "</mesh></object></resources>\n" +
    `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 ${x} ${y} ${z}"/></build>\n` +
    "</model>\n"
  );
}

/** The whole .3mf file. */
export function stlTo3mf(stl: ArrayBuffer, options: ThreeMfOptions): Uint8Array {
  return zipStored([
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", RELS],
    ["3D/3dmodel.model", threeMfModel(stl, options)],
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive of stored entries (no compression), as described in PKWARE's APPNOTE. */
export function zipStored(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const header = (size: number) => {
      const b = new Uint8Array(size);
      return { b, v: new DataView(b.buffer) };
    };
    // Local file header
    const l = header(30);
    l.v.setUint32(0, 0x04034b50, true);
    l.v.setUint16(4, 20, true); // version needed: 2.0
    l.v.setUint16(6, 0x0800, true); // names are UTF-8
    l.v.setUint16(8, 0, true); // stored
    l.v.setUint16(10, 0, true); // time
    l.v.setUint16(12, 0x21, true); // date: 1980-01-01
    l.v.setUint32(14, crc, true);
    l.v.setUint32(18, data.length, true);
    l.v.setUint32(22, data.length, true);
    l.v.setUint16(26, nameBytes.length, true);
    l.v.setUint16(28, 0, true);
    local.push(l.b, nameBytes, data);
    // Central directory entry
    const c = header(46);
    c.v.setUint32(0, 0x02014b50, true);
    c.v.setUint16(4, 20, true);
    c.v.setUint16(6, 20, true);
    c.v.setUint16(8, 0x0800, true);
    c.v.setUint16(10, 0, true);
    c.v.setUint16(12, 0, true);
    c.v.setUint16(14, 0x21, true);
    c.v.setUint32(16, crc, true);
    c.v.setUint32(20, data.length, true);
    c.v.setUint32(24, data.length, true);
    c.v.setUint16(28, nameBytes.length, true);
    c.v.setUint32(42, offset, true);
    central.push(c.b, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
