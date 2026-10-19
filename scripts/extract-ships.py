"""Generate the offline ship and equipment catalog from X4 CAT/DAT data."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import runpy
from collections import defaultdict
from pathlib import Path


STATION_EXTRACTOR = runpy.run_path(str(Path(__file__).with_name("extract-data.py")))
archives = STATION_EXTRACTOR["archives"]
load_layered = STATION_EXTRACTOR["load_layered"]
russian_text = STATION_EXTRACTOR["russian_text"]
english_text = STATION_EXTRACTOR["english_text"]
quantity_map = STATION_EXTRACTOR["quantity_map"]

EXCLUDED = {"noplayerblueprint", "noblueprint", "noplayerbuild", "missiononly",
            "onlyownerbuild", "deprecated"}
EQUIPMENT_GROUPS = {"engines": "engine", "shields": "shield", "weapons": "weapon",
                    "turrets": "turret", "missiles": "ammo", "thrusters": "thruster"}
SIZES = {"small": "s", "medium": "m", "large": "l", "extralarge": "xl"}
MOUNT_CLASSES = {"engine", "shield", "weapon", "turret"}
SIZE_TAGS = {"small", "medium", "large", "extralarge"}
SPECIAL_TAGS = {"advanced", "standard", "combat", "missile", "mining", "highpower",
                "venture", "boron", "xenon"}
IGNORED_MOUNT_TAGS = {"component", "hittable", "unhittable", "platformcollision",
                      "symmetry", "symmetry_left", "symmetry_right"}
SPACED_TEXT_REF = re.compile(r"\{\s*(\d+)\s*,\s*(\d+)\s*\}")
TEXT_REF = re.compile(r"\{(\d+),(\d+)\}")


def normalize_text_refs(value):
    return SPACED_TEXT_REF.sub(r"{\1,\2}", value or "")


def ship_translate(reference, texts):
    if not reference:
        return None
    name = normalize_text_refs(reference)
    for _ in range(8):
        updated = TEXT_REF.sub(lambda match: texts.get((match[1], match[2]), match[0]), name)
        if updated == name:
            break
        name = updated
    if TEXT_REF.search(name):
        return None
    clean = []
    depth = 0
    i = 0
    while i < len(name):
        char = name[i]
        if char == "\\" and i + 1 < len(name) and name[i + 1] in "()":
            if depth == 0:
                clean.append(name[i + 1])
            i += 2
            continue
        if char == "(":
            depth += 1
        elif char == ")" and depth:
            depth -= 1
        elif depth == 0:
            clean.append(char)
        i += 1
    return re.sub(r"\s+", " ", "".join(clean)).strip()


def numeric(value):
    if value is None:
        return None
    try:
        number = float(value)
    except ValueError:
        return value
    if not math.isfinite(number):
        raise ValueError(f"Nonfinite game value: {value}")
    return int(number) if number.is_integer() else number


def attributes(element):
    return {key: numeric(value) for key, value in element.attrib.items()} if element is not None else {}


def blueprint_options(ware):
    options = []
    for production in ware.findall("production"):
        if "noplayerbuild" in production.get("tags", "").split():
            continue
        materials = quantity_map(production.find("primary"))
        if materials:
            options.append({"method": production.get("method", "default"),
                            "materials": materials,
                            "time": numeric(production.get("time"))})
    return options


def price_fields(ware):
    price = ware.find("price")
    if price is None:
        raise ValueError(f"Missing price for {ware.get('id')}")
    return {"priceMin": numeric(price.get("min")),
            "priceAverage": numeric(price.get("average")),
            "priceMax": numeric(price.get("max"))}


def path_index(layers):
    macro_paths = {}
    component_paths = {}
    for _, archive in layers:
        for path in archive.entries:
            if not path.startswith("assets/") or not path.endswith(".xml"):
                continue
            name = path.rsplit("/", 1)[-1][:-4]
            if "/macros/" in path:
                macro_paths[name] = path
            else:
                component_paths[name] = path
    return macro_paths, component_paths


class GameFiles:
    def __init__(self, root):
        self.layers = list(archives(root))
        self.misses = []
        self.macro_paths, self.component_paths = path_index(self.layers)
        self.cache = {}

    def document(self, path):
        if path not in self.cache:
            self.cache[path] = load_layered(self.layers, path, self.misses)
        return self.cache[path]

    def macro(self, name):
        path = self.macro_paths.get(name)
        if not path:
            return None
        document = self.document(path)
        return next((node for node in document.findall("macro") if node.get("name") == name), None)

    def component(self, name):
        path = self.component_paths.get(name)
        if not path:
            return None
        document = self.document(path)
        return next((node for node in document.findall("component") if node.get("name") == name), None)


def tags(node):
    return sorted(set(node.get("tags", "").split())) if node is not None else []


def mount_tags(component, kind):
    if component is None:
        return []
    wanted = "turret" if kind == "turret" else "weapon" if kind in ("weapon", "missilelauncher") else kind
    if kind == "missilelauncher" and any("turret" in tags(c) and "component" in tags(c)
                                          for c in component.findall("connections/connection")):
        wanted = "turret"
    candidates = [c for c in component.findall("connections/connection")
                  if "component" in tags(c) and wanted in tags(c)]
    return tags(candidates[0]) if candidates else []


def equipment_kind(ware, macro):
    ware_tags = set(ware.get("tags", "").split())
    if "mine" in ware_tags:
        return None
    if ware.get("group") == "thrusters" or "thruster" in ware_tags:
        return "thruster"
    if "missilelauncher" in ware_tags:
        return "missilelauncher"
    cls = macro.get("class")
    direct = {"engine": "engine", "shieldgenerator": "shield", "weapon": "weapon",
              "turret": "turret", "missileturret": "missilelauncher", "missile": "ammo",
              "thruster": "thruster"}.get(cls)
    if direct:
        return direct
    group = ware.get("group")
    if group in EQUIPMENT_GROUPS:
        return EQUIPMENT_GROUPS[group]
    return None


def stats_for(macro, files):
    props = macro.find("properties")
    fields = ("thrust", "boost", "travel", "recharge", "heat", "ammunition", "reload",
              "damage", "areadamage", "bullet", "missile", "explosiondamage", "physics", "thruster")
    stats = {field: attributes(props.find(field)) for field in fields if props.find(field) is not None}
    for field in ("areadamage",):
        node = props.find(field)
        if node is not None and node.find("multiplier") is not None:
            stats[field]["multiplier"] = attributes(node.find("multiplier"))
    bullet_ref = props.find("bullet")
    if bullet_ref is not None and bullet_ref.get("class"):
        projectile = files.macro(bullet_ref.get("class"))
        if projectile is None:
            raise ValueError(f"Unknown projectile {bullet_ref.get('class')} on {macro.get('name')}")
        projectile_props = projectile.find("properties")
        stats["projectile"] = {"id": projectile.get("name"), "class": projectile.get("class")}
        for field in fields:
            if projectile_props.find(field) is not None:
                stats["projectile"][field] = attributes(projectile_props.find(field))
                nested = projectile_props.find(field).find("multiplier")
                if nested is not None:
                    stats["projectile"][field]["multiplier"] = attributes(nested)
    if macro.get("class") in ("weapon", "turret", "missileturret", "missile"):
        stats["burstDps"] = None
        stats["derivedStatsStatus"] = "not-computed-from-raw-game-properties"
    return stats


def slot_groups(component):
    groups = {}
    for connection in component.findall("connections/connection"):
        connection_tags = tags(connection)
        kind = next((tag for tag in ("engine", "shield", "weapon", "turret")
                     if tag in connection_tags), None)
        if kind is None or "component" in connection_tags:
            continue
        group = (connection.get("group") or "").strip()
        key = (group or connection.get("name"), kind, tuple(connection_tags))
        if key not in groups:
            groups[key] = {"id": f"{kind}:{key[0]}", "group": group or None,
                           "type": kind, "tags": connection_tags, "count": 0,
                           "connectionNames": [], "compatibleEquipmentIds": []}
        groups[key]["count"] += 1
        groups[key]["connectionNames"].append(connection.get("name"))
    return list(groups.values())


def compatible(slot, item):
    slot_tags = set(slot["tags"])
    mount = set(item["mountTags"])
    if not mount or slot["type"] != ("turret" if item["kind"] == "missilelauncher" and "turret" in mount
                                      else "weapon" if item["kind"] == "missilelauncher" else item["kind"]):
        return False
    sizes = mount & SIZE_TAGS
    if sizes and not sizes & slot_tags:
        return False
    for tag in mount - MOUNT_CLASSES - SIZE_TAGS - IGNORED_MOUNT_TAGS:
        if tag == "standard" and "advanced" in slot_tags:
            continue
        if tag not in slot_tags:
            return False
    return True


def extract(root):
    files = GameFiles(root)
    wares_doc = files.document("libraries/wares.xml")
    texts = {key: normalize_text_refs(value) for key, value in russian_text(files.layers, files.misses).items()}
    texts_en = {key: normalize_text_refs(value) for key, value in english_text(files.layers, files.misses).items()}
    all_wares = {ware.get("id"): ware for ware in wares_doc.findall("ware")}
    ships = []
    equipment = []
    material_wares = set()
    skipped = defaultdict(int)
    for ware in all_wares.values():
        tag_set = set(ware.get("tags", "").split())
        if EXCLUDED & tag_set or ware.find("component") is None:
            continue
        transport = ware.get("transport")
        if transport not in ("ship", "equipment"):
            continue
        macro_name = ware.find("component").get("ref")
        macro = files.macro(macro_name)
        if macro is None:
            skipped[f"missing-macro:{transport}"] += 1
            continue
        props = macro.find("properties")
        if props is None:
            skipped[f"missing-properties:{transport}"] += 1
            continue
        build_options = blueprint_options(ware)
        if not build_options:
            continue
        identification = props.find("identification")
        prices = price_fields(ware)
        common = {"id": ware.get("id"),
                  "name": ship_translate(ware.get("name"), texts),
                  "nameEn": ship_translate(ware.get("name"), texts_en),
                  "race": identification.get("makerrace", "universal") if identification is not None else "universal",
                  **prices, "priceAnomaly": not (prices["priceMin"] <= prices["priceAverage"] <= prices["priceMax"]),
                  "buildOptions": build_options}
        if transport == "ship":
            if not macro.get("class", "").startswith("ship_"):
                skipped["unexpected-ship-class"] += 1
                continue
            component_name = macro.find("component").get("ref")
            component = files.component(component_name)
            if component is None:
                skipped["missing-ship-component"] += 1
                continue
            cargo = {"capacity": 0, "type": None}
            for connection in macro.findall("connections/connection"):
                nested = connection.find("macro")
                if nested is None:
                    continue
                storage_macro = files.macro(nested.get("ref"))
                if storage_macro is not None and storage_macro.get("class") == "storage":
                    cargo_node = storage_macro.find("properties/cargo")
                    if cargo_node is not None:
                        cargo = {"capacity": numeric(cargo_node.get("max")),
                                 "type": cargo_node.get("tags")}
                        break
            physics = props.find("physics")
            ship = {**common, "size": macro.get("class").removeprefix("ship_"),
                    "type": props.find("ship").get("type") if props.find("ship") is not None else None,
                    "hull": numeric(props.find("hull").get("max")) if props.find("hull") is not None else None,
                    "cargo": cargo, "mass": numeric(physics.get("mass")) if physics is not None else None,
                    "drag": attributes(physics.find("drag")) if physics is not None else {},
                    "inertia": attributes(physics.find("inertia")) if physics is not None else {},
                    "accFactors": attributes(physics.find("accfactors")) if physics is not None else {},
                    "thrusterTags": tags(props.find("thruster")),
                    "missileCapacity": numeric(props.find("storage").get("missile")) if props.find("storage") is not None else None,
                    "slotGroups": slot_groups(component)}
            if ship["thrusterTags"]:
                ship["slotGroups"].append({"id": "thruster:virtual", "group": "virtual:thruster",
                                           "type": "thruster", "tags": ["thruster", *ship["thrusterTags"]],
                                           "count": 1, "connectionNames": ["macro:thruster"],
                                           "compatibleEquipmentIds": []})
            ships.append(ship)
            for option in build_options:
                material_wares.update(option["materials"])
        else:
            kind = equipment_kind(ware, macro)
            if kind not in {"engine", "shield", "weapon", "turret", "missilelauncher", "ammo", "thruster"}:
                continue
            component_ref = macro.find("component")
            component = files.component(component_ref.get("ref")) if component_ref is not None else None
            mount = mount_tags(component, kind) if kind != "ammo" else []
            size = next((SIZES[tag] for tag in mount if tag in SIZES), None)
            equipment.append({**common, "kind": kind, "size": size,
                              "mountTags": mount, "stats": stats_for(macro, files)})
            for option in build_options:
                material_wares.update(option["materials"])
    for ship in ships:
        for slot in ship["slotGroups"]:
            slot["compatibleEquipmentIds"] = [item["id"] for item in equipment if compatible(slot, item)]
            slot["compatibilityStatus"] = ("matched" if slot["compatibleEquipmentIds"]
                                           else "no-player-buildable-equipment-match")
    ammunition = [item for item in equipment if item["kind"] == "ammo"]
    for item in equipment:
        if item["kind"] == "missilelauncher":
            accepted = set(item["stats"].get("ammunition", {}).get("tags", "").split())
            item["compatibleAmmoIds"] = [round_item["id"] for round_item in ammunition
                                         if accepted.intersection(round_item["stats"].get("missile", {}).get("tags", "").split())]
    wares = []
    for id in sorted(material_wares):
        ware = all_wares.get(id)
        if ware is None:
            raise ValueError(f"Unknown build ware {id}")
        wares.append({"id": id, "name": ship_translate(ware.get("name"), texts),
                      "nameEn": ship_translate(ware.get("name"), texts_en), **price_fields(ware)})
    result = {"version": "9.0", "source": "X4 Foundations installed base game and seven official DLC CAT/DAT archives",
              "fingerprint": hashlib.sha256("".join(layer + hashlib.sha256(a.dat.with_suffix(".cat").read_bytes()).hexdigest()
                             for layer, a in files.layers).encode()).hexdigest()[:16],
              "compatibilityMethod": "connection class/size/subtype tags; standard equipment accepted by advanced slots",
              "priceAnomalies": sorted([item["id"] for item in ships + equipment if item["priceAnomaly"]]),
              "wares": wares, "ships": sorted(ships, key=lambda s: (s["size"], s["name"] or "", s["id"])),
              "equipment": sorted(equipment, key=lambda e: (e["kind"], e["name"] or "", e["id"]))}
    return result, files.misses, skipped


def validate(data, misses, skipped):
    if misses or skipped:
        raise ValueError(f"Unresolved game records: diff={len(misses)} skipped={dict(skipped)}")
    ware_ids = {ware["id"] for ware in data["wares"]}
    for category in ("ships", "equipment", "wares"):
        records = data[category]
        if len({r["id"] for r in records}) != len(records):
            raise ValueError(f"Duplicate IDs in {category}")
        for record in records:
            if not record["name"] or not re.search(r"[А-Яа-яЁё]", record["name"]):
                raise ValueError(f"Missing Russian name: {record['id']}")
            if not record["nameEn"] or not re.search(r"[A-Za-z]", record["nameEn"]):
                raise ValueError(f"Missing English name: {record['id']}")
            if record["name"].startswith(")") or "\\" in record["name"]:
                raise ValueError(f"Malformed Russian name: {record['id']}")
            prices = [record[k] for k in ("priceMin", "priceAverage", "priceMax")]
            if not all(isinstance(p, (int, float)) and math.isfinite(p) and p >= 0 for p in prices):
                raise ValueError(f"Invalid prices: {record['id']}")
            for option in record.get("buildOptions", []):
                if not option["materials"] or option["time"] <= 0:
                    raise ValueError(f"Invalid build option: {record['id']}")
                if any(w not in ware_ids or q <= 0 for w, q in option["materials"].items()):
                    raise ValueError(f"Invalid build materials: {record['id']}")
    equipment_ids = {e["id"] for e in data["equipment"]}
    ammo_ids = {e["id"] for e in data["equipment"] if e["kind"] == "ammo"}
    for ship in data["ships"]:
        if not ship["hull"] or not ship["mass"] or not ship["drag"] or not ship["slotGroups"]:
            raise ValueError(f"Missing ship physics: {ship['id']}")
        if len({slot["id"] for slot in ship["slotGroups"]}) != len(ship["slotGroups"]):
            raise ValueError(f"Duplicate ship slot group: {ship['id']}")
        thruster_slots = [slot for slot in ship["slotGroups"] if slot["type"] == "thruster"]
        if len(thruster_slots) != 1 or not thruster_slots[0]["compatibleEquipmentIds"]:
            raise ValueError(f"Missing compatible thruster choice: {ship['id']}")
        for slot in ship["slotGroups"]:
            if slot["count"] != len(slot["connectionNames"]) or not set(slot["compatibleEquipmentIds"]) <= equipment_ids:
                raise ValueError(f"Invalid slot group: {ship['id']} {slot['id']}")
    for item in data["equipment"]:
        if item["kind"] == "missilelauncher":
            if not item["compatibleAmmoIds"] or not set(item["compatibleAmmoIds"]) <= ammo_ids:
                raise ValueError(f"Invalid launcher ammunition: {item['id']}")
    known = {"ship_tel_m_bomber_01_a", "ship_par_m_corvette_01_a"}
    if not known <= {s["id"] for s in data["ships"]}:
        raise ValueError("Osprey or Nemesis missing")
    for family in ("beam", "laser", "flak", "missile"):
        if not any(family in e["id"] for e in data["equipment"]):
            raise ValueError(f"Missing {family} equipment")
    examples = {item["id"]: item for item in data["equipment"]}
    for id in ("weapon_gen_s_laser_01_mk1", "weapon_gen_s_beam_01_mk1", "turret_arg_m_flak_01_mk1"):
        if not examples[id]["stats"].get("projectile"):
            raise ValueError(f"Missing projectile facts: {id}")
    if not examples["turret_arg_m_flak_01_mk1"]["stats"]["projectile"].get("areadamage"):
        raise ValueError("Missing flak area damage")
    if not examples["weapon_gen_s_laser_01_mk1"]["stats"].get("heat"):
        raise ValueError("Missing pulse heat")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", type=Path)
    args = parser.parse_args()
    if not args.output and not args.check:
        parser.error("Specify --output or --check")
    data, misses, skipped = extract(args.game)
    validate(data, misses, skipped)
    serialized = "globalThis.X4_SHIP_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    if args.check and args.check.read_text(encoding="utf-8") != serialized:
        raise ValueError(f"Generated data is out of date: {args.check}")
    print(f"ships={len(data['ships'])} equipment={len(data['equipment'])} wares={len(data['wares'])}")
    print(f"unresolved_patches={len(misses)} skipped={dict(skipped)}")


if __name__ == "__main__":
    main()
