"""Independent STL and 3MF check with trimesh (a separate, widely used mesh library).

Usage: python3 -I scripts/verify_stl.py test-output
Checks every *.stl and *.3mf against its *.expected.json: watertight, consistent winding,
exact overall size (to 0.001 mm) and volume within 0.5% of the exact CAD volume.
A 3MF must also say millimetres, carry the expected object name, and put the part
where expected on the printer's plate (its lowest corner, to 0.001 mm).
"""
import json
import pathlib
import sys
import zipfile
import xml.etree.ElementTree as ET

import numpy as np
import trimesh

folder = pathlib.Path(sys.argv[1])
files = sorted(folder.glob("*.stl")) + sorted(folder.glob("*.3mf"))
if not any(f.suffix == ".stl" for f in files):
    sys.exit(f"No STL files found in {folder}")
CORE = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"

failed = 0
for stl in files:
    expected = json.loads(stl.with_name(stl.name.removesuffix(".stl") + ".expected.json").read_text())
    mesh = trimesh.load(stl, force="mesh")
    extra = ""
    if stl.suffix == ".3mf":
        model = ET.fromstring(zipfile.ZipFile(stl).read("3D/3dmodel.model"))
        names = [o.get("name") for o in model.iter(f"{CORE}object")]
        lowest = mesh.bounds[0]
        placed = (
            model.get("unit") == "millimeter"
            and names == [expected["name"]]
            and np.allclose(lowest, expected["min"], atol=1e-3)
        )
        extra = f", unit={model.get('unit')}, names={names}, lowest corner={np.round(lowest, 4).tolist()}"
    size = mesh.bounding_box.extents
    vol_err = abs(mesh.volume - expected["volume"]) / expected["volume"]
    ok = (
        mesh.is_watertight
        and mesh.is_winding_consistent
        and np.allclose(size, expected["size"], atol=1e-3)
        and vol_err < 0.005
        and (stl.suffix != ".3mf" or placed)
    )
    failed += not ok
    print(
        f"{'PASS' if ok else 'FAIL'} {stl.name}: {len(mesh.faces)} triangles, watertight={mesh.is_watertight}, "
        f"winding={mesh.is_winding_consistent}, size={np.round(size, 4).tolist()} (expected {expected['size']}), "
        f"volume error={vol_err:.4%}{extra}"
    )
sys.exit(1 if failed else 0)
