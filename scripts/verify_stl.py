"""Independent STL check with trimesh (a separate, widely used mesh library).

Usage: python3 -I scripts/verify_stl.py test-output
Checks every *.stl against its *.expected.json: watertight, consistent winding,
exact overall size (to 0.001 mm) and volume within 0.5% of the exact CAD volume.
"""
import json
import pathlib
import sys

import numpy as np
import trimesh

folder = pathlib.Path(sys.argv[1])
files = sorted(folder.glob("*.stl"))
if not files:
    sys.exit(f"No STL files found in {folder}")

failed = 0
for stl in files:
    expected = json.loads(stl.with_name(stl.stem + ".expected.json").read_text())
    mesh = trimesh.load(stl, force="mesh")
    size = mesh.bounding_box.extents
    vol_err = abs(mesh.volume - expected["volume"]) / expected["volume"]
    ok = (
        mesh.is_watertight
        and mesh.is_winding_consistent
        and np.allclose(size, expected["size"], atol=1e-3)
        and vol_err < 0.005
    )
    failed += not ok
    print(
        f"{'PASS' if ok else 'FAIL'} {stl.name}: {len(mesh.faces)} triangles, watertight={mesh.is_watertight}, "
        f"winding={mesh.is_winding_consistent}, size={np.round(size, 4).tolist()} (expected {expected['size']}), "
        f"volume error={vol_err:.4%}"
    )
sys.exit(1 if failed else 0)
