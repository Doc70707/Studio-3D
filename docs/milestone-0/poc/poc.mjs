// Milestone 0 kernel smoke test: OCCT (via replicad's WebAssembly build) running in Node.
// Proves: exact box, parameter change + rebuild, real boolean cut, save/reopen, STL + STEP export.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import opencascade from "replicad-opencascadejs";
import { setOC, makeBaseBox, makeCylinder, measureVolume, deserializeShape } from "replicad";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("replicad-opencascadejs/wasm");
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`); };
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

let t = performance.now();
const OC = await opencascade({ locateFile: () => wasmPath });
setOC(OC);
console.log(`kernel init ${(performance.now() - t).toFixed(0)} ms`);

// A tiny versioned "document": parameters only; geometry is always rebuilt from them.
const doc = { format: "studio-poc", version: 1, units: "mm",
  features: [{ id: "box1", type: "openBox", width: 60, depth: 40, height: 30, wall: 2 },
             { id: "hole1", type: "holeThroughSide", target: "box1", diameter: 8, z: 15 }] };

function build(d) {
  const box = d.features.find(f => f.type === "openBox");
  const hole = d.features.find(f => f.type === "holeThroughSide");
  // Solid block, then hollow it out with the top face removed (real OCCT thick-solid op).
  let s = makeBaseBox(box.width, box.depth, box.height)
    .shell(box.wall, f => f.inPlane("XY", box.height));
  if (hole) {
    // Cylinder along X through both side walls, then a real boolean subtraction.
    const cyl = makeCylinder(hole.diameter / 2, box.width + 20, [-(box.width / 2 + 10), 0, hole.z], [1, 0, 0]);
    s = s.cut(cyl);
  }
  return s;
}

// Analytic volumes for the checks.
const openBoxVol = ({ width: w, depth: d, height: h, wall: t }) => w * d * h - (w - 2 * t) * (d - 2 * t) * (h - t);

// 1. Exact box
const plain = makeBaseBox(60, 40, 30);
check("exact solid box volume", close(measureVolume(plain), 72000), `${measureVolume(plain)} mm³ (expected 72000)`);
const bb = plain.boundingBox;
check("exact box bounds", close(bb.width, 60) && close(bb.height, 40) && close(bb.depth, 30), `${bb.width} x ${bb.height} x ${bb.depth}`);

// 2. Hollow open box (no hole) vs analytic
const shellOnly = { ...doc, features: [doc.features[0]] };
const v0 = measureVolume(build(shellOnly));
check("open box (shell) volume", close(v0, openBoxVol(doc.features[0]), 1e-4), `${v0.toFixed(4)} vs ${openBoxVol(doc.features[0])}`);

// 3. Boolean cut removes material: two walls * pi r^2 * wall
t = performance.now();
const part = build(doc);
const buildMs = performance.now() - t;
const vCut = measureVolume(part);
const expectedCut = openBoxVol(doc.features[0]) - 2 * Math.PI * 4 * 4 * 2;
check("boolean cut volume", close(vCut, expectedCut, 1e-4), `${vCut.toFixed(4)} vs ${expectedCut.toFixed(4)} (rebuild ${buildMs.toFixed(0)} ms)`);

// 4. Parameter change + rebuild
const doc2 = structuredClone(doc); doc2.features[0].width = 80;
const v2 = measureVolume(build(doc2));
const exp2 = openBoxVol(doc2.features[0]) - 2 * Math.PI * 16 * 2;
check("width 60→80 rebuild", close(v2, exp2, 1e-4) && close(build(doc2).boundingBox.width, 80), `${v2.toFixed(4)} vs ${exp2.toFixed(4)}`);

// 5. Save and reopen: parameters (the source of truth) and an exact B-rep cache
writeFileSync(out + "project.json", JSON.stringify(doc2, null, 2));
writeFileSync(out + "part.brep", build(doc2).serialize());
const reopened = JSON.parse(readFileSync(out + "project.json", "utf8"));
const vRe = measureVolume(build(reopened));
check("save/reopen parameters → same geometry", close(vRe, v2, 1e-9), `${vRe.toFixed(4)}`);
const fromBrep = deserializeShape(readFileSync(out + "part.brep", "utf8"));
check("save/reopen exact B-rep", close(measureVolume(fromBrep), v2, 1e-9), `${measureVolume(fromBrep).toFixed(4)}`);

// 6. Export
const finalPart = build(doc2);
const stl = Buffer.from(await finalPart.blobSTL({ binary: true, tolerance: 0.01, angularTolerance: 0.1 }).arrayBuffer());
writeFileSync(out + "part.stl", stl);
const step = Buffer.from(await finalPart.blobSTEP().arrayBuffer());
writeFileSync(out + "part.step", step);
check("STL written", stl.length > 84, `${stl.length} bytes, ${stl.readUInt32LE(80)} triangles`);
check("STEP written", step.toString("utf8", 0, 13) === "ISO-10303-21;", `${step.length} bytes`);

// 7. Failure handling. Finding: for wall >= half the depth, OCCT does NOT throw; it silently
// returns the un-hollowed solid. So the app needs its own guard: validate inputs, then check the
// result actually changed the way the feature promised, and keep the last valid model otherwise.
const raw = (() => { const bad = structuredClone(doc2); bad.features[0].wall = 50; return measureVolume(build(bad)); })();
check("kernel behaviour on wall=50 recorded", true, `kernel returned volume ${raw} (solid box = ${80*40*30}), no error`);
function guardedBuild(d, previous) {
  const b = d.features.find(f => f.type === "openBox");
  const errors = [];
  if (!(b.wall > 0)) errors.push("Wall thickness must be more than 0 mm.");
  if (b.wall * 2 >= Math.min(b.width, b.depth)) errors.push(`Walls of ${b.wall} mm would fill the whole box. Use less than ${Math.min(b.width, b.depth) / 2} mm.`);
  if (b.wall >= b.height) errors.push(`The floor (${b.wall} mm) can't be as thick as the box is tall.`);
  if (errors.length) return { model: previous, errors };
  try {
    const s = build(d);
    if (!(measureVolume(s) < b.width * b.depth * b.height)) return { model: previous, errors: ["Hollowing failed; kept your last good model."] };
    return { model: s, errors: [] };
  } catch (e) { return { model: previous, errors: ["The geometry operation failed; kept your last good model."] }; }
}
const bad = structuredClone(doc2); bad.features[0].wall = 50;
const g = guardedBuild(bad, finalPart);
check("guard rejects wall=50 with a plain message, keeps last valid model", g.errors.length > 0 && g.model === finalPart, g.errors[0]);

writeFileSync(out + "expected.json", JSON.stringify({ volume: v2, bbox: [80, 40, 30] }));
const failedCount = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} checks passed`);
process.exit(failedCount ? 1 : 0);
