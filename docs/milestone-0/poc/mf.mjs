import Module from "manifold-3d";
import { readFileSync } from "node:fs";
const wasm = await Module(); wasm.setup();
const buf = readFileSync("out/part.stl"); const n = buf.readUInt32LE(80);
const pos = []; const key = new Map(); const tri = new Uint32Array(n*3);
for (let i=0;i<n;i++) for (let j=0;j<3;j++){ const o=84+i*50+12+j*12; const p=[buf.readFloatLE(o),buf.readFloatLE(o+4),buf.readFloatLE(o+8)]; const k=p.join(","); if(!key.has(k)){key.set(k,pos.length/3);pos.push(...p);} tri[i*3+j]=key.get(k); }
const mesh = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(pos), triVerts: tri });
mesh.merge();
const m = new wasm.Manifold(mesh);
console.log("manifold status", m.status(), "volume", m.volume().toFixed(3), "genus", m.genus());
const cut = m.subtract(wasm.Manifold.cube([10,10,10], true));
console.log("mesh boolean on imported STL: volume", cut.volume().toFixed(3));
