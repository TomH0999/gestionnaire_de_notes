import re, sys, json
NUM = r"(\d+(?:,\d+)?)"
def num(s): return float(s.replace(",", "."))
def parse(path):
    lines = open(path, encoding="utf8").read().splitlines()
    ues = {}
    cur_ue = cur_mod = None
    for i, line in enumerate(lines):
        m = re.match(r"^X\s+(TA\w+|LW\w+)\s+(UE|MODU|CC|STAG|PRJ)\s*(.*)$", line.rstrip())
        if not m:
            continue
        code, kind, rest = m.groups()
        if code.startswith(("TAX", "LW")):
            continue
        if kind == "UE":
            mm = re.search(r"U(\d)(\d)\d?$", code)
            key = (int(mm.group(1)), int(mm.group(2)))
            nums = re.findall(r"\s" + NUM + r"\s+" + NUM + r"\s+CCI", " " + rest)
            label = re.split(r"\s{2,}", rest.strip())[0]
            if label in ("X",) or re.match(r"^\d", label): label = ""
            ue = ues.setdefault(key, {"code": code, "ects": num(nums[0][0]) if nums else None, "label": label, "modules": {}})
            cur_ue, cur_mod = ue, None
            continue
        if cur_ue is None:
            continue
        if kind == "MODU":
            mm = re.search(r"\s" + NUM + r"\s+CCI", " " + rest)
            cur_mod = cur_ue["modules"].setdefault(code, {"coef": num(mm.group(1)) if mm else None, "items": {}})
            if cur_mod["coef"] is None and mm:
                cur_mod["coef"] = num(mm.group(1))
            continue
        if kind != "CC" or cur_mod is None:
            continue
        mm = re.match(r"(.*?)\s{2,}(?:X\s+)?" + NUM + r"?\s*CCI", rest)
        label = (mm.group(1) if mm else rest).strip()
        coef = mm.group(2) if mm else None
        if label in ("", "X"):
            parts = []
            for j in (i - 1, i + 1):
                t = re.split(r"\s{2,}", lines[j].strip())[0]
                if t and not re.match(r"^(\d|0h|2 à|TD|X)", t):
                    parts.append(t)
            label = " ".join(parts)
        label = re.sub(r"\s+X$", "", label).strip()
        if coef is None:
            continue
        cur_mod["items"].setdefault(code, [label, num(coef)])
    return ues

if __name__ == "__main__":
    for path in sys.argv[1:]:
        print("=====", path)
        for (s, u), v in sorted(parse(path).items()):
            print(f"S{s} UE{s}.{u} [{v['code']}] ects={v['ects']} {v['label']}")
            for mc, mod in v["modules"].items():
                tot = sum(c for _, c in mod["items"].values())
                flag = "" if mod["coef"] == tot else f"   <-- somme éléments = {tot:g}"
                print(f"   {mc:10} module {mod['coef']}{flag}")
                for code, (l, c) in mod["items"].items():
                    print(f"       {code:10} {c:6g}  {l}")
