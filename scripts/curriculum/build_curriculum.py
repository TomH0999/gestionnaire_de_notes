import re, sys, json
sys.path.insert(0, ".")
from parse_mccc import parse
PARCOURS = {"RACDV": "A", "DACS": "B", "IAMSI": "D"}
UE_NAMES = {1: "Réaliser un développement d'application", 2: "Optimiser des applications", 3: "Administrer des systèmes informatiques",
            4: "Gérer des données de l'information", 5: "Conduire un projet", 6: "Travailler dans une équipe informatique"}
subjects = {}  # code -> {name, semester}
def subject(sem, parcours, label):
    l = re.sub(r"\s+", " ", label).strip()
    m = re.match(r"^(R\d\.(?:[A-D]\.)?\d{2})\s+(.*)$", l)
    if m:
        code, name = m.group(1), m.group(2)
    elif re.match(r"(?i)^stage", l):
        code, name = f"Stage S{sem}", f"Stage (semestre {sem})"
    elif re.match(r"(?i)^portfolio", l):
        code, name = f"Portfolio S{sem}", f"Portfolio (semestre {sem})"
    elif re.match(r"(?i)^sae", l):
        if sem in (1, 2):
            n = re.match(r"(?i)^SAE\s*\d\.(\d)\s*(.*)$", l)
            code, name = f"SAE {sem}.0{n.group(1)}", n.group(2)
        elif sem == 3:
            code, name = "SAE 3", "SAÉ du semestre 3"
        else:
            letter = PARCOURS[parcours]
            code = f"SAE {sem}.{letter}"
            name = re.sub(r"(?i)^SAE\s*[\d.]*\s*\.?\s*[A-D]?\s+", "", l).strip() or f"SAÉ du semestre {sem}"
            if name.lower() in ("sae", f"sae {sem}") or re.match(r"^\d", name): name = f"SAÉ du semestre {sem}"
    else:
        raise SystemExit(f"libellé inconnu S{sem} {parcours}: {label!r}")
    prev = subjects.get(code)
    if prev and prev["name"] != name and len(name) > len(prev["name"]):
        prev["name"] = name
    subjects.setdefault(code, {"code": code, "name": name, "semester": sem})
    return code

DEDUCED = {("RACDV", 4, 3, "A"): 60, ("DACS", 4, 4, "A"): 60, ("DACS", 4, 4, "B"): 40}
def build(path, parcours, sems):
    out = {}
    for (s, u), ue in sorted(parse(path).items()):
        if s not in sems: continue
        modules = []
        for mc, mod in ue["modules"].items():
            if not mod["items"]: continue
            kind = "A" if re.search(r"\dA\d?$", mc) or "A" in mc[-3:-1] else "B"
            kind = "A" if any(re.match(r"(?i)^(sae|stage|portfolio)", l) for l, _ in mod["items"].values()) else "B"
            coef = mod["coef"]
            if coef is None:
                coef = DEDUCED[(parcours, s, u, kind)]
            items = [[subject(s, parcours, l), c] for l, c in mod["items"].values()]
            modules.append({"coef": coef, "items": items, "deduced": mod["coef"] is None})
        modules.sort(key=lambda m: 0 if any(re.match(r"SAE|Stage|Portfolio", i[0]) for i in m["items"]) else 1)
        out[f"UE {s}.{u}"] = {"code": f"UE {s}.{u}", "competence": u, "name": UE_NAMES[u], "ects": ue["ects"] or 5, "modules": modules}
    return out

cur = {"source": "MCCC 2025-2026, IUT de Montpellier-Sète, site de Montpellier (formation initiale)", "semesters": {}}
s12 = build("25-26-BUT-1-INFO-M-600.txt", None, {1, 2})
cur["semesters"]["1"] = {"common": {k: v for k, v in s12.items() if k.startswith("UE 1.")}}
cur["semesters"]["2"] = {"common": {k: v for k, v in s12.items() if k.startswith("UE 2.")}}
cur["semesters"]["3"] = {"common": build("25-26-BUT-2-INFO-M-RACDV-600.txt", "RACDV", {3})}
for sem in (4, 5, 6):
    cur["semesters"][str(sem)] = {"parcours": {}}
for p, f2, f3 in [("RACDV", "25-26-BUT-2-INFO-M-RACDV-600.txt", "25-26-BUT-3-INFO-M-RACDV-600.txt"),
                  ("DACS", "25-26-BUT-2-INFO-M-DACS-600.txt", "25-26-BUT-3-INFO-M-DACS-600.txt"),
                  ("IAMSI", "25-26-BUT-2-INFO-M-IAMSI-600.txt", "25-26-BUT-3-INFO-M-IAMSI-600.txt")]:
    cur["semesters"]["4"]["parcours"][p] = build(f2, p, {4})
    s56 = build(f3, p, {5, 6})
    cur["semesters"]["5"]["parcours"][p] = {k: v for k, v in s56.items() if k.startswith("UE 5.")}
    cur["semesters"]["6"]["parcours"][p] = {k: v for k, v in s56.items() if k.startswith("UE 6.")}
cur["subjects"] = sorted(subjects.values(), key=lambda s: (s["semester"], 0 if s["code"].startswith("R") else 1, s["code"]))
json.dump(cur, open("curriculum.json", "w"), ensure_ascii=False, indent=1)
for s in cur["subjects"]: print(s["semester"], s["code"].ljust(13), s["name"])
