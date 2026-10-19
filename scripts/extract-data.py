"""Extract the calculator catalog from read-only X4 CAT/DAT archives."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path


OFFICIAL_DLC = (
    "ego_dlc_split", "ego_dlc_terran", "ego_dlc_boron", "ego_dlc_mini_01",
    "ego_dlc_mini_02", "ego_dlc_pirate", "ego_dlc_timelines",
)
MODULE_KINDS = {"production": "production", "habitation": "habitat",
                "storage": "storage", "dockarea": "dock", "pier": "pier",
                "buildmodule": "shipyard"}


class Archive:
    def __init__(self, cat: Path):
        self.dat = cat.with_suffix(".dat")
        self.entries = {}
        offset = 0
        for line in cat.read_text(encoding="utf-8-sig").splitlines():
            fields = line.rsplit(" ", 3)
            if len(fields) != 4:
                raise ValueError(f"Invalid CAT entry in {cat}: {line}")
            path, size, _, digest = fields
            size = int(size)
            self.entries[path.lower()] = (offset, size, digest)
            offset += size
        if offset != self.dat.stat().st_size:
            raise ValueError(f"CAT/DAT length mismatch: {cat}")

    def read(self, path: str) -> bytes | None:
        item = self.entries.get(path.lower())
        if item is None:
            return None
        offset, size, digest = item
        with self.dat.open("rb") as source:
            source.seek(offset)
            data = source.read(size)
        if hashlib.md5(data).hexdigest() != digest:
            raise ValueError(f"CAT digest mismatch: {self.dat}:{path}")
        return data


def archives(root: Path):
    layers = [("base", root)] + [(name, root / "extensions" / name) for name in OFFICIAL_DLC]
    for name, directory in layers:
        if not directory.is_dir():
            raise FileNotFoundError(directory)
        for cat in sorted(directory.glob("*.cat")):
            if "_sig" not in cat.stem:
                yield name, Archive(cat)


def select(root: ET.Element, selector: str) -> list[ET.Element]:
    if not selector.startswith(f"/{root.tag}"):
        return []
    suffix = selector[len(root.tag) + 1:]
    if not suffix:
        return [root]
    if not suffix.startswith("/"):
        return []
    return root.findall("." + suffix)


def merge(base: ET.Element, patch: ET.Element, misses: list[str], source: str):
    if patch.tag != "diff":
        return patch
    for op in patch:
        selector = op.get("sel", "")
        attr = None
        if "/@" in selector:
            selector, attr = selector.rsplit("/@", 1)
        targets = select(base, selector)
        if not targets:
            misses.append(f"{source}: {op.tag} {op.get('sel')}")
            continue
        if attr:
            for target in targets:
                if op.tag in ("add", "replace"):
                    target.set(attr, op.text or "")
                elif op.tag == "remove":
                    target.attrib.pop(attr, None)
            continue
        if op.tag == "add":
            position = op.get("pos", "")
            for target in targets:
                if position in ("before", "after"):
                    parent = next((node for node in base.iter() if target in node), None)
                    if parent is None:
                        raise ValueError(f"Cannot place {op.tag}: {source} {selector}")
                    index = list(parent).index(target) + (position == "after")
                    for child in op:
                        parent.insert(index, copy.deepcopy(child))
                        index += 1
                else:
                    for child in op:
                        target.append(copy.deepcopy(child))
        elif op.tag in ("replace", "remove"):
            for target in targets:
                parent = next((node for node in base.iter() if target in node), None)
                if parent is None:
                    raise ValueError(f"Cannot replace root: {source} {selector}")
                index = list(parent).index(target)
                parent.remove(target)
                if op.tag == "replace":
                    for child in op:
                        parent.insert(index, copy.deepcopy(child))
                        index += 1
        else:
            raise ValueError(f"Unsupported diff operation: {op.tag} in {source}")
    return base


def load_layered(layers, path: str, misses: list[str]) -> ET.Element | None:
    document = None
    for layer, archive in layers:
        data = archive.read(path)
        if data is not None:
            xml = ET.fromstring(data)
            document = xml if document is None else merge(document, xml, misses, f"{layer}:{path}")
    return document


def numbers(element: ET.Element | None, attribute: str, default: float = 0) -> float:
    return float(element.get(attribute, default)) if element is not None else default


def quantity_map(parent: ET.Element | None) -> dict[str, float]:
    if parent is None:
        return {}
    return {item.get("ware"): numbers(item, "amount") for item in parent.findall("ware")}


def game_text(layers, misses, languages):
    texts = {}
    for language in languages:
        path = f"t/0001-l{language}.xml"
        document = load_layered(layers, path, misses)
        if document is None:
            continue
        for page in document.findall("page"):
            for item in page.findall("t"):
                texts[(page.get("id"), item.get("id"))] = "".join(item.itertext()).strip()
    return texts


def russian_text(layers, misses):
    return game_text(layers, misses, ("044", "007"))


def english_text(layers, misses):
    return game_text(layers, misses, ("044",))


TEXT_REF = re.compile(r"\{(\d+),(\d+)\}")


def translate(reference: str | None, texts: dict) -> str | None:
    if not reference:
        return None
    text = reference
    for _ in range(4):
        updated = TEXT_REF.sub(lambda m: texts.get((m[1], m[2]), m[0]), text)
        if updated == text:
            break
        text = updated
    if TEXT_REF.search(text):
        return None
    return re.sub(r"\s+", " ", re.sub(r"\([^)]*\)", "", text)).strip()


def gather(args):
    layers = list(archives(args.game))
    misses = []
    wares_doc = load_layered(layers, "libraries/wares.xml", misses)
    if wares_doc is None:
        raise ValueError("Missing libraries/wares.xml")
    texts = russian_text(layers, misses)
    texts_en = english_text(layers, misses)
    wares_by_id = {ware.get("id"): ware for ware in wares_doc.findall("ware")}
    module_wares = [ware for ware in wares_by_id.values()
                    if "module" in ware.get("tags", "").split()
                    and not {"noplayerblueprint", "noblueprint", "missiononly"}.intersection(ware.get("tags", "").split())
                    and ware.find("component") is not None]
    macro_paths = {}
    for _, archive in layers:
        for path in archive.entries:
            if path.startswith("assets/structures/") and path.endswith("_macro.xml"):
                macro_paths[path.rsplit("/", 1)[-1][:-4]] = path
    output_wares = {}
    modules = []
    unavailable = []
    for module_ware in module_wares:
        macro_name = module_ware.find("component").get("ref")
        path = macro_paths.get(macro_name)
        if not path:
            unavailable.append(macro_name)
            continue
        doc = load_layered(layers, path, misses)
        if doc is None:
            unavailable.append(macro_name)
            continue
        macro = next((m for m in doc.findall("macro") if m.get("name") == macro_name), None)
        if macro is None or macro.get("class") not in MODULE_KINDS:
            continue
        props = macro.find("properties")
        if props is None:
            continue
        identification = props.find("identification")
        workforce = props.find("workforce")
        cargo = props.find("cargo")
        race = (workforce.get("race") if workforce is not None else None) or (
            identification.get("makerrace") if identification is not None else None) or (
            {"arg": "argon", "par": "paranid", "tel": "teladi", "spl": "split",
             "ter": "terran", "bor": "boron"}.get(macro_name.split("_")[1]))
        build_method = next((p for p in module_ware.findall("production")
                             if p.get("method") == (race or "default")), None)
        if build_method is None:
            build_method = next((p for p in module_ware.findall("production")
                                 if p.get("method") == "default"), None)
        if build_method is None:
            build_method = module_ware.find("production")
        build = quantity_map(build_method.find("primary") if build_method is not None else None)
        module = {
            "id": module_ware.get("id"),
            "name": translate(module_ware.get("name"), texts),
            "nameEn": translate(module_ware.get("name"), texts_en),
            "race": race or "universal",
            "kind": MODULE_KINDS[macro.get("class")],
            "workforce": int(numbers(workforce, "max")),
            "capacity": int(numbers(workforce, "capacity") if macro.get("class") == "habitation"
                            else numbers(cargo, "max") if macro.get("class") == "storage" else 0),
            "buildMaterials": build,
            "recipes": [],
        }
        if module["kind"] == "storage":
            module["storageType"] = cargo.get("tags") if cargo is not None else None
        if module["kind"] == "shipyard":
            builder = props.find("builder")
            ship_classes = builder.get("classes") if builder is not None else None
            module["shipyardType"] = "fabrication" if ship_classes else "maintenance"
            if not ship_classes:
                equipment = props.find("equip")
                ship_classes = equipment.get("classes") if equipment is not None else None
            module["shipSizes"] = sorted({item.removeprefix("ship_").upper()
                                          for item in (ship_classes or "").split()})
        if module["kind"] == "production":
            production = props.find("production")
            if production is None:
                continue
            for queued in production.findall("queue/item") or production.findall("queue"):
                ware_id = queued.get("ware")
                ware = wares_by_id.get(ware_id)
                if ware is None:
                    raise ValueError(f"Unknown output {ware_id} on {macro_name}")
                method_id = queued.get("method", "default")
                recipe = next((p for p in ware.findall("production") if p.get("method") == method_id), None)
                if recipe is None:
                    recipe = next((p for p in ware.findall("production") if p.get("method") == "default"), None)
                if recipe is None:
                    raise ValueError(f"Missing recipe {ware_id}:{method_id} on {macro_name}")
                effects = {e.get("type"): e for e in recipe.findall("effects/effect")}
                module["recipes"].append({
                    "id": f"{module['id']}#{method_id}#{ware_id}",
                    "method": method_id,
                    "cycleSeconds": numbers(recipe, "time"),
                    "inputs": quantity_map(recipe.find("primary")),
                    "outputs": {ware_id: numbers(recipe, "amount")},
                    "workforceBonus": numbers(effects.get("work"), "product"),
                    "sunlightScaled": "sunlight" in effects,
                })
        if module["kind"] == "production" and not module["recipes"]:
            continue
        modules.append(module)
        for ware_id in set(build) | {i for recipe in module["recipes"]
                                      for i in recipe["inputs"] | recipe["outputs"]}:
            if ware_id not in wares_by_id:
                raise ValueError(f"Unknown ware {ware_id} on {module['id']}")
            output_wares[ware_id] = wares_by_id[ware_id]
    work_methods = {"default": "argon", "paranid": "paranid", "teladi": "teladi",
                    "split": "split", "terran": "terran", "boron": "boron"}
    workforce_consumption = {}
    workforce_idle_consumption = {}
    for ware_name, destination in (("workunit_busy", workforce_consumption),
                                   ("workunit_idle", workforce_idle_consumption)):
        unit = wares_by_id[ware_name]
        for production in unit.findall("production"):
            race = work_methods.get(production.get("method"))
            if race is None:
                continue
            factor = 3600 / numbers(production, "time") / numbers(production, "amount")
            destination[race] = {ware_id: round(qty * factor, 6)
                                 for ware_id, qty in quantity_map(production.find("primary")).items()}
            for ware_id in destination[race]:
                output_wares[ware_id] = wares_by_id[ware_id]
    wares = []
    for ware_id, ware in sorted(output_wares.items()):
        price = ware.find("price")
        wares.append({
            "id": ware_id,
            "name": translate(ware.get("name"), texts),
            "nameEn": translate(ware.get("name"), texts_en),
            "priceMin": numbers(price, "min"),
            "priceAverage": numbers(price, "average"),
            "priceMax": numbers(price, "max"),
            "storage": ware.get("transport", "container"),
            "volume": numbers(ware, "volume"),
        })
    result = {
        "version": "9.0",
        "source": "X4 Foundations installed base game and seven official DLC CAT/DAT archives",
        "fingerprint": hashlib.sha256("".join(layer + hashlib.sha256(a.dat.with_suffix(".cat").read_bytes()).hexdigest()
                         for layer, a in layers).encode()).hexdigest()[:16],
        "wares": wares,
        "modules": sorted(modules, key=lambda m: (m["kind"], m["name"] or "")),
        "rawWares": sorted({w for module in modules for recipe in module["recipes"]
                            for w in recipe["inputs"]} -
                           {w for module in modules for recipe in module["recipes"]
                            for w in recipe["outputs"]}),
        "workforceConsumption": workforce_consumption,
        "workforceIdleConsumption": workforce_idle_consumption,
    }
    return result, misses, unavailable


def validate(result, misses, unavailable):
    if misses or unavailable:
        raise ValueError(f"Unresolved source data: patches={len(misses)}, macros={len(unavailable)}")
    wares = {ware["id"]: ware for ware in result["wares"]}
    modules = result["modules"]
    recipes = [recipe for module in modules for recipe in module["recipes"]]
    if len(wares) != len(result["wares"]) or len({m["id"] for m in modules}) != len(modules):
        raise ValueError("Duplicate ware or module IDs")
    if len({r["id"] for r in recipes}) != len(recipes):
        raise ValueError("Duplicate recipe IDs")
    for ware in wares.values():
        if not ware["name"] or not re.search(r"[А-Яа-яЁё]", ware["name"]):
            raise ValueError(f"Missing Russian ware name: {ware['id']}")
        if not ware["nameEn"] or not re.search(r"[A-Za-z]", ware["nameEn"]):
            raise ValueError(f"Missing English ware name: {ware['id']}")
        prices = [ware[k] for k in ("priceMin", "priceAverage", "priceMax")]
        if not all(math.isfinite(p) and p >= 0 for p in prices) or prices != sorted(prices):
            raise ValueError(f"Invalid prices: {ware['id']}")
    for module in modules:
        if not module["name"] or not re.search(r"[А-Яа-яЁё]", module["name"]):
            raise ValueError(f"Missing Russian module name: {module['id']}")
        if not module["nameEn"] or not re.search(r"[A-Za-z]", module["nameEn"]):
            raise ValueError(f"Missing English module name: {module['id']}")
        if module["kind"] == "production" and not module["recipes"]:
            raise ValueError(f"Production module without recipe: {module['id']}")
        if module["kind"] == "habitat" and module["capacity"] <= 0:
            raise ValueError(f"Habitat without capacity: {module['id']}")
        if module["kind"] == "storage" and (module["capacity"] <= 0 or not module["storageType"]):
            raise ValueError(f"Storage without cargo capacity/type: {module['id']}")
        if module["kind"] in ("storage", "dock", "pier", "shipyard") and module["recipes"]:
            raise ValueError(f"Infrastructure with recipe: {module['id']}")
        if module["kind"] == "shipyard" and not module["shipSizes"]:
            raise ValueError(f"Ship bay without supported ship sizes: {module['id']}")
        if not module["buildMaterials"]:
            raise ValueError(f"Module without build materials: {module['id']}")
        for recipe in module["recipes"]:
            if recipe["cycleSeconds"] <= 0 or not recipe["outputs"]:
                raise ValueError(f"Invalid recipe: {recipe['id']}")
        for items in [module["buildMaterials"]] + [r["inputs"] for r in module["recipes"]] + [r["outputs"] for r in module["recipes"]]:
            for ware_id, amount in items.items():
                if ware_id not in wares or not math.isfinite(amount) or amount < 0:
                    raise ValueError(f"Invalid ware quantity: {module['id']} {ware_id}")
        if sum(wares[w]["priceAverage"] * qty for w, qty in module["buildMaterials"].items()) <= 0:
            raise ValueError(f"Invalid construction sum: {module['id']}")
    known = {"module_gen_prod_energycells_01", "module_gen_prod_hullparts_01",
             "module_gen_prod_claytronics_01", "module_ter_prod_computronicsubstrate_01",
             "module_bor_prod_bofu_01", "module_arg_prod_foodrations_01",
             "module_arg_stor_container_s_01", "module_arg_dock_m_01",
             "module_arg_pier_l_01", "module_ter_stor_solid_l_01",
             "module_bor_pier_l_01"}
    if not known.issubset({m["id"] for m in modules}):
        raise ValueError("Known base, Terran, or Boron modules missing")
    if result["workforceConsumption"]["argon"] != {"foodrations": 2.25, "medicalsupplies": 1.35}:
        raise ValueError("Argon workforce demand mismatch")
    for race, demand in result["workforceConsumption"].items():
        if "medicalsupplies" not in demand or any(w not in wares or q < 0 for w, q in demand.items()):
            raise ValueError(f"Invalid workforce demand: {race}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", type=Path)
    args = parser.parse_args()
    if not args.output and not args.check:
        parser.error("Specify --output or --check")
    result, misses, unavailable = gather(args)
    validate(result, misses, unavailable)
    serialized = "globalThis.X4_DATA = " + json.dumps(result, ensure_ascii=False, separators=(",", ":")) + ";\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    if args.check and args.check.read_text(encoding="utf-8") != serialized:
        raise ValueError(f"Generated data is out of date: {args.check}")
    print(f"wares={len(result['wares'])} modules={len(result['modules'])} recipes={sum(len(m['recipes']) for m in result['modules'])}")
    print(f"unresolved_patches={len(misses)} unavailable_macros={len(unavailable)}")


if __name__ == "__main__":
    main()
