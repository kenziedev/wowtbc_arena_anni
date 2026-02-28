"""Parse TBC talent tree XML from Vampyr7878's repo and build talent_defs.json."""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
ICONS_DIR = BASE_DIR / "icons"
WOWHEAD_ICON_CDN = "https://wow.zamimg.com/images/wow/icons/medium"

XML_BASE = (
    "https://raw.githubusercontent.com/Vampyr7878/"
    "WoW-Talent-Caluclator-TBC/master/WoW%20Talent%20Calculator%20TBC/Data"
)

CLASSES = [
    {"en": "Warrior",  "ko": "전사",    "xml": "Warrior.xml",  "trees_ko": ["무기", "분노", "방어"]},
    {"en": "Paladin",  "ko": "성기사",  "xml": "Paladin.xml",  "trees_ko": ["신성", "보호", "징벌"]},
    {"en": "Hunter",   "ko": "사냥꾼",  "xml": "Hunter.xml",   "trees_ko": ["야수", "사격", "생존"]},
    {"en": "Rogue",    "ko": "도적",    "xml": "Rogue.xml",    "trees_ko": ["암살", "전투", "잠행"]},
    {"en": "Priest",   "ko": "사제",    "xml": "Priest.xml",   "trees_ko": ["수양", "신성", "암흑"]},
    {"en": "Shaman",   "ko": "주술사",  "xml": "Shaman.xml",   "trees_ko": ["정기", "고양", "복원"]},
    {"en": "Mage",     "ko": "마법사",  "xml": "Mage.xml",     "trees_ko": ["비전", "화염", "냉기"]},
    {"en": "Warlock",  "ko": "흑마법사","xml": "Warlock.xml",  "trees_ko": ["고통", "악마", "파괴"]},
    {"en": "Druid",    "ko": "드루이드","xml": "Druid.xml",    "trees_ko": ["조화", "야성", "회복"]},
]

session = requests.Session()


def download_icon(icon_name: str) -> bool:
    dest = ICONS_DIR / f"{icon_name.lower()}.jpg"
    if dest.exists():
        return True
    url = f"{WOWHEAD_ICON_CDN}/{icon_name.lower()}.jpg"
    try:
        r = session.get(url, timeout=10)
        if r.status_code == 200 and r.content:
            dest.write_bytes(r.content)
            return True
    except requests.RequestException:
        pass
    return False


def parse_class_xml(xml_url: str, trees_ko: list[str]) -> list[dict]:
    resp = session.get(xml_url, timeout=15)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)

    trees = []
    for spec_idx, spec_el in enumerate(root.findall("Specialization")):
        tree_name_en = (spec_el.find("Name").text or "").strip()
        tree_name_ko = trees_ko[spec_idx] if spec_idx < len(trees_ko) else tree_name_en

        talents_el = spec_el.find("Talents")
        grid = []  # flat list, 4 entries per tier

        for talent_el in talents_el.findall("Talent"):
            name = (talent_el.find("Name").text or "").strip()
            icon_raw = (talent_el.find("Icon").text or "").strip()

            if not name:
                grid.append(None)
                continue

            ranks_el = talent_el.find("Ranks")
            descriptions = []
            if ranks_el is not None:
                for rank_el in ranks_el.findall("Rank"):
                    desc_el = rank_el.find("Description")
                    desc = (desc_el.text or "").strip() if desc_el is not None else ""
                    descriptions.append(desc)

            dep_el = talent_el.find("Dependancy")
            dep = (dep_el.text or "").strip() if dep_el is not None else ""

            grid.append({
                "name": name,
                "icon": icon_raw.lower(),
                "max_rank": len(descriptions),
                "descriptions": descriptions,
                "prereq": dep if dep else None,
            })

        trees.append({
            "name": tree_name_en,
            "ko": tree_name_ko,
            "grid": grid,
        })

    return trees


def main():
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    result = {}
    all_icons = set()

    for cls in CLASSES:
        url = f"{XML_BASE}/{cls['xml']}"
        print(f"Parsing {cls['en']}...")
        trees = parse_class_xml(url, cls["trees_ko"])

        talent_count = 0
        for tree in trees:
            for t in tree["grid"]:
                if t is not None:
                    talent_count += 1
                    if t["icon"]:
                        all_icons.add(t["icon"])

        print(f"  {talent_count} talents across {len(trees)} trees: "
              f"{', '.join(t['name'] + '/' + t['ko'] for t in trees)}")

        result[cls["en"]] = {
            "ko": cls["ko"],
            "trees": trees,
        }

    # Download missing icons
    existing = {p.stem for p in ICONS_DIR.glob("*.jpg")}
    missing = all_icons - existing - {""}
    if missing:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        print(f"\nDownloading {len(missing)} talent icons...")
        done = 0
        failed = 0
        with ThreadPoolExecutor(max_workers=20) as ex:
            futures = {ex.submit(download_icon, n): n for n in missing}
            for f in as_completed(futures):
                done += 1
                if not f.result():
                    failed += 1
                if done % 50 == 0 or done == len(missing):
                    print(f"  {done}/{len(missing)} (failed: {failed})")
    else:
        print("\nAll talent icons already downloaded.")

    out_path = DATA_DIR / "talent_defs.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\nSaved to {out_path}")
    total = sum(
        sum(1 for t in tree["grid"] if t is not None)
        for cls_data in result.values()
        for tree in cls_data["trees"]
    )
    print(f"Total: {total} talents, {len(all_icons)} unique icons")


if __name__ == "__main__":
    main()
