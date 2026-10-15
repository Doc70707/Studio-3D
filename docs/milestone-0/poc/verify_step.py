import sys, json
from OCP.STEPControl import STEPControl_Reader
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.BRepCheck import BRepCheck_Analyzer

r = STEPControl_Reader(); assert r.ReadFile(sys.argv[1]) == 1; r.TransferRoots(); s = r.OneShape()
p = GProp_GProps(); BRepGProp.VolumeProperties_s(s, p)
exp = json.load(open(sys.argv[2]))
print("native OCCT", "", "valid", BRepCheck_Analyzer(s).IsValid(), "volume %.4f" % p.Mass(), "expected %.4f" % exp["volume"])
print("RESULT", "PASS" if BRepCheck_Analyzer(s).IsValid() and abs(p.Mass()-exp["volume"]) < 1e-3 else "FAIL")
