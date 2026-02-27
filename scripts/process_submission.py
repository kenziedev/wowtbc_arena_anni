"""Process a GitHub Issue submission to add guilds or characters to sources.json."""

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8")

import requests

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

REGION = "kr"
API_BASE = f"https://{REGION}.api.blizzard.com"
OAUTH_URL = "https://oauth.battle.net/token"
NS_PROFILE = "profile-classicann-kr"
LOCALE = "ko_KR"


def resolve_realm(raw: str) -> str:
    raw = raw.strip().lower()
    return REALM_ALIASES.get(raw, raw if raw else DEFAULT_REALM)


def get_access_token() -> str | None:
    cid = os.environ.get("BLIZZARD_CLIENT_ID", "")
    secret = os.environ.get("BLIZZARD_CLIENT_SECRET", "")
    if not cid or not secret:
        return None
    try:
        resp = requests.post(OAUTH_URL, data={"grant_type": "client_credentials"}, auth=(cid, secret), timeout=30)
        resp.raise_for_status()
        return resp.json()["access_token"]
    except Exception as e:
        print(f"  [WARN] OAuth failed, skipping validation: {e}")
        return None


def verify_guild(token: str, name: str, realm: str) -> bool:
    slug = quote(name.lower())
    url = f"{API_BASE}/data/wow/guild/{realm}/{slug}/roster"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"},
                        params={"namespace": NS_PROFILE, "locale": LOCALE}, timeout=15)
    return resp.status_code == 200


def verify_character(token: str, name: str, realm: str) -> bool:
    encoded = quote(name.lower())
    url = f"{API_BASE}/profile/wow/character/{realm}/{encoded}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"},
                        params={"namespace": NS_PROFILE, "locale": LOCALE}, timeout=15)
    return resp.status_code == 200


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


def update_sources(new_entries: dict, token: str | None) -> tuple[list[str], list[str]]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        sources = json.load(f)

    added = []
    skipped = []

    existing_guilds = {(g["name"].lower(), g["realm"]) for g in sources.get("guilds", [])}
    for g in new_entries.get("guilds", []):
        key = (g["name"].lower(), g["realm"])
        if key in existing_guilds:
            skipped.append(f"길드: {g['name']} (이미 등록됨)")
            continue
        if token and not verify_guild(token, g["name"], g["realm"]):
            skipped.append(f"길드: {g['name']} (존재하지 않음)")
            continue
        sources.setdefault("guilds", []).append(g)
        existing_guilds.add(key)
        added.append(f"길드: {g['name']} ({g['realm']})")

    existing_chars = {(c["name"].lower(), c["realm"]) for c in sources.get("characters", [])}
    for c in new_entries.get("characters", []):
        key = (c["name"].lower(), c["realm"])
        if key in existing_chars:
            skipped.append(f"캐릭터: {c['name']} (이미 등록됨)")
            continue
        if token and not verify_character(token, c["name"], c["realm"]):
            skipped.append(f"캐릭터: {c['name']} (존재하지 않음)")
            continue
        sources.setdefault("characters", []).append(c)
        existing_chars.add(key)
        added.append(f"캐릭터: {c['name']} ({c['realm']})")

    if added:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(sources, f, ensure_ascii=False, indent=2)

    return added, skipped


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

    print("Validating against Battle.net API...")
    token = get_access_token()
    if not token:
        print("  [WARN] No API credentials, skipping existence check")

    added, skipped = update_sources(entries, token)

    if added:
        print(f"Added {len(added)} new entries:")
        for a in added:
            print(f"  + {a}")
    if skipped:
        print(f"Skipped {len(skipped)} entries:")
        for s in skipped:
            print(f"  - {s}")
    if not added:
        print("No new valid entries to add.")


if __name__ == "__main__":
    main()
