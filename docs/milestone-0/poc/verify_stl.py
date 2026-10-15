import json, sys, trimesh, numpy as np
from stl import mesh as npstl
exp = json.load(open(sys.argv[2]))
m = trimesh.load(sys.argv[1])
ext = m.bounding_box.extents
print("trimesh: triangles", len(m.faces), "watertight", m.is_watertight, "winding_consistent", m.is_winding_consistent,
      "volume %.3f" % m.volume, "extents", np.round(ext, 4).tolist(), "euler", m.euler_number)
v, _, _ = npstl.Mesh.from_file(sys.argv[1]).get_mass_properties()
print("numpy-stl: volume %.3f" % v)
print("kernel exact volume %.3f; tessellation error %.3f%%" % (exp["volume"], 100*abs(m.volume-exp["volume"])/exp["volume"]))
ok = m.is_watertight and m.is_winding_consistent and np.allclose(sorted(ext), sorted(exp["bbox"]), atol=1e-3) and abs(m.volume-exp["volume"])/exp["volume"] < 0.005
print("RESULT", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
