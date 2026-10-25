"""Independent G-code check, written separately from Studio 3D's own reader (packages/geometry/src/gcodeCheck.ts).

Usage: python3 -I scripts/verify_gcode.py test-output
Reads every *.gcode as a printer would and checks it against its *.gcode.expected.json:
millimetres and absolute positions, homing and heating before printing, every move inside
the build volume, every line of plastic inside the part's footprint, one height per layer,
the plastic laid down within 3% of the part's CAD volume (for a part with sparse infill,
between half and all of it), and the heaters off at the end.
The prime line (along the front, at the first layer) is left out of the footprint and volume.
"""
import json
import math
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
files = sorted(folder.glob("*.gcode"))
if not files:
    sys.exit(f"No G-code files found in {folder}")

failed = 0
for path in files:
    exp = json.loads(path.with_name(path.name + ".expected.json").read_text())
    vx, vy, vz = exp["volume"]
    fx0, fy0, fx1, fy1 = exp["footprint"]
    errors = []
    pos = {"X": 0.0, "Y": 0.0, "Z": 0.0, "E": 0.0}
    mm = homed = hot = False
    absolute = True
    heaters_off_after = -1
    last_print = -1
    first_z = None
    zs = set()
    filament = 0.0
    for n, raw in enumerate(path.read_text().splitlines()):
        line = raw.split(";")[0].strip()
        if not line:
            continue
        cmd, *words = line.split()
        args = {w[0]: float(w[1:]) for w in words}
        if cmd == "G21":
            mm = True
        elif cmd == "G91":
            absolute = False
        elif cmd == "G28":
            homed = True
        elif cmd == "G92":
            pos["E"] = args.get("E", pos["E"])
        elif cmd in ("M104", "M109", "M140", "M190"):
            t = args.get("S", 0)
            if cmd in ("M104", "M109") and t > exp["maxNozzleTemp"]:
                errors.append(f"nozzle {t} C on line {n + 1}")
            if cmd == "M109" and t > 0:
                hot = True
            if t == 0:
                heaters_off_after = n
        elif cmd in ("G0", "G1"):
            if not (mm and homed and absolute):
                errors.append(f"move before mm/homing/absolute on line {n + 1}")
            new = {k: args.get(k, pos[k]) for k in pos}
            for axis, limit in (("X", vx), ("Y", vy), ("Z", vz)):
                if not -1e-6 <= new[axis] <= limit + 1e-6:
                    errors.append(f"{axis}={new[axis]} outside the printer on line {n + 1}")
            de = new["E"] - pos["E"]
            moved = math.hypot(new["X"] - pos["X"], new["Y"] - pos["Y"])
            if de > 0 and moved > 0:
                if not hot:
                    errors.append(f"printing before the nozzle is hot, line {n + 1}")
                last_print = n
                if first_z is None:
                    first_z = new["Z"]
                prime = new["Z"] == first_z and pos["Y"] == new["Y"] == exp["primeY"]
                if not prime:
                    filament += de
                    zs.add(round(new["Z"], 3))
                    for p in (pos, new):
                        if not (fx0 - 1e-3 <= p["X"] <= fx1 + 1e-3 and fy0 - 1e-3 <= p["Y"] <= fy1 + 1e-3):
                            errors.append(f"plastic outside the part's footprint on line {n + 1}")
                            break
            pos = new
    plastic = filament * math.pi * (exp["filamentDiameter"] / 2) ** 2
    vol_err = abs(plastic - exp["partVolume"]) / exp["partVolume"]
    if exp.get("sparse"):
        # Sparse infill: less plastic than the solid part, but at least the walls and skins.
        if not 0.5 * exp["partVolume"] <= plastic <= 1.03 * exp["partVolume"]:
            errors.append(f"plastic {plastic:.1f} mm3 for a part of {exp['partVolume']} mm3")
    elif vol_err > 0.03:
        errors.append(f"plastic {plastic:.1f} mm3 vs part {exp['partVolume']} mm3")
    if len(zs) != exp["layers"]:
        errors.append(f"{len(zs)} layer heights, expected {exp['layers']}")
    if heaters_off_after < last_print:
        errors.append("heaters not turned off at the end")
    failed += bool(errors)
    print(
        f"{'FAIL' if errors else 'PASS'} {path.name}: {len(zs)} layers, plastic {plastic:.1f} mm3 "
        f"(part {exp['partVolume']} mm3, error {vol_err:.2%}){'; ' + '; '.join(errors[:5]) if errors else ''}"
    )
sys.exit(1 if failed else 0)
