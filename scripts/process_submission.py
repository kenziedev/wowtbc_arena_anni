"""Process a GitHub Issue submission to add guilds or characters to sources.json."""

import json
import os
import re
import sys
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "sources.json"

DEFAULT_REALM = "fengus-ferocity"

REALM_ALIASES = {
    "펜구스": "fengus-ferocity",
    "펜구스의 흉포": "fengus-ferocity",
    "fengus": "fengus-ferocity",
    "몰다르": "moldars-moxie",
    "몰다르의 투지": "moldars-moxie",
    "moldars": "moldars-moxie",
}


def resolve_realm(raw: str) -> str:
    raw = raw.strip().lower()
    return REALM_ALIASES.get(raw, raw if raw else DEFAULT_REALM)


def parse_issue_body(body: str) -> dict:
    result = {"guilds": [], "characters": []}

    lines = body.strip().splitlines()
    section = None

    for line in lines:
        line = line.strip()
        if not line or line.startswith("<!--"):
            continue

        lower = line.lower()
        if "길드" in lower or "guild" in lower:
            section = "guilds"
            if ":" in line:
                line = line.split(":", 1)[1].strip()
                if not line:
                    continue
            else:
                continue
        elif "캐릭터" in lower or "character" in lower:
            section = "characters"
            if ":" in line:
                line = line.split(":", 1)[1].strip()
                if not line:
                    continue
            else:
                continue

        if section and line.startswith(("-", "*", "+")):
            line = line.lstrip("-*+ ").strip()

        if not line or not section:
            continue

        parts = re.split(r"[,/\t@]", line, maxsplit=1)
        name = parts[0].strip()
        realm = resolve_realm(parts[1]) if len(parts) > 1 else DEFAULT_REALM

        if not name:
            continue

        if section == "guilds":
            result["guilds"].append({"name": name, "realm": realm})
        else:
            result["characters"].append({"name": name, "realm": realm})

    return result


def update_sources(new_entries: dict) -> list[str]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        sources = json.load(f)

    added = []

    existing_guilds = {(g["name"].lower(), g["realm"]) for g in sources.get("guilds", [])}
    for g in new_entries.get("guilds", []):
        key = (g["name"].lower(), g["realm"])
        if key not in existing_guilds:
            sources.setdefault("guilds", []).append(g)
            existing_guilds.add(key)
            added.append(f"길드: {g['name']} ({g['realm']})")

    existing_chars = {(c["name"].lower(), c["realm"]) for c in sources.get("characters", [])}
    for c in new_entries.get("characters", []):
        key = (c["name"].lower(), c["realm"])
        if key not in existing_chars:
            sources.setdefault("characters", []).append(c)
            existing_chars.add(key)
            added.append(f"캐릭터: {c['name']} ({c['realm']})")

    if added:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(sources, f, ensure_ascii=False, indent=2)

    return added


def main():
    body = os.environ.get("ISSUE_BODY", "")
    if not body:
        print("ERROR: ISSUE_BODY environment variable is empty")
        sys.exit(1)

    print("Parsing issue body...")
    entries = parse_issue_body(body)
    print(f"  Found {len(entries['guilds'])} guilds, {len(entries['characters'])} characters")

    if not entries["guilds"] and not entries["characters"]:
        print("No valid entries found in issue body")
        sys.exit(0)

    added = update_sources(entries)
    if added:
        print(f"Added {len(added)} new entries:")
        for a in added:
            print(f"  + {a}")
    else:
        print("All entries already exist in sources.json")


if __name__ == "__main__":
    main()
