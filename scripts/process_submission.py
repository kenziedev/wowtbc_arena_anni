"""Process a GitHub Issue submission to add guilds or characters to sources.json."""

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8")

import requests

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "sources.json"

DEFAULT_REALM = "fengus-ferocity"
MAX_WORKERS = 20

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

_session = requests.Session()


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
    try:
        resp = _session.get(url, headers={"Authorization": f"Bearer {token}"},
                            params={"namespace": NS_PROFILE, "locale": LOCALE}, timeout=15)
        return resp.status_code == 200
    except requests.RequestException:
        return False


def verify_character(token: str, name: str, realm: str) -> bool:
    encoded = quote(name.lower())
    url = f"{API_BASE}/profile/wow/character/{realm}/{encoded}"
    try:
        resp = _session.get(url, headers={"Authorization": f"Bearer {token}"},
                            params={"namespace": NS_PROFILE, "locale": LOCALE}, timeout=15)
        return resp.status_code == 200
    except requests.RequestException:
        return False


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


def _verify_worker(args):
    kind, token, name, realm = args
    if kind == "guild":
        return kind, name, realm, verify_guild(token, name, realm)
    else:
        return kind, name, realm, verify_character(token, name, realm)


def update_sources(new_entries: dict, token: str | None) -> tuple[list[str], list[str]]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        sources = json.load(f)

    existing_guilds = {(g["name"].lower(), g["realm"]) for g in sources.get("guilds", [])}
    existing_chars = {(c["name"].lower(), c["realm"]) for c in sources.get("characters", [])}

    # Filter duplicates first (no API call needed)
    to_verify = []
    already_skipped = []

    for g in new_entries.get("guilds", []):
        key = (g["name"].lower(), g["realm"])
        if key in existing_guilds:
            already_skipped.append(f"길드: {g['name']} (이미 등록됨)")
        else:
            existing_guilds.add(key)
            to_verify.append(("guild", g["name"], g["realm"]))

    for c in new_entries.get("characters", []):
        key = (c["name"].lower(), c["realm"])
        if key in existing_chars:
            already_skipped.append(f"캐릭터: {c['name']} (이미 등록됨)")
        else:
            existing_chars.add(key)
            to_verify.append(("character", c["name"], c["realm"]))

    print(f"  Duplicates skipped: {len(already_skipped)}")
    print(f"  To verify: {len(to_verify)}")

    added = []
    added_entries = {"guilds": [], "characters": []}
    skipped = list(already_skipped)

    if not token:
        for kind, name, realm in to_verify:
            if kind == "guild":
                sources.setdefault("guilds", []).append({"name": name, "realm": realm})
                added.append(f"길드: {name} ({realm})")
                added_entries["guilds"].append({"name": name, "realm": realm})
            else:
                sources.setdefault("characters", []).append({"name": name, "realm": realm})
                added.append(f"캐릭터: {name} ({realm})")
                added_entries["characters"].append({"name": name, "realm": realm})
    else:
        tasks = [(kind, token, name, realm) for kind, name, realm in to_verify]
        done = 0
        total = len(tasks)

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(_verify_worker, t): t for t in tasks}
            for future in as_completed(futures):
                kind, name, realm, exists = future.result()
                done += 1
                if done % 100 == 0 or done == total:
                    print(f"  Verified: {done}/{total}")

                if exists:
                    if kind == "guild":
                        sources.setdefault("guilds", []).append({"name": name, "realm": realm})
                        added.append(f"길드: {name} ({realm})")
                        added_entries["guilds"].append({"name": name, "realm": realm})
                    else:
                        sources.setdefault("characters", []).append({"name": name, "realm": realm})
                        added.append(f"캐릭터: {name} ({realm})")
                        added_entries["characters"].append({"name": name, "realm": realm})
                else:
                    skipped.append(f"{'길드' if kind == 'guild' else '캐릭터'}: {name} (존재하지 않음)")

    if added:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(sources, f, ensure_ascii=False, indent=2)

        added_path = CONFIG_PATH.parent / "_added.json"
        with open(added_path, "w", encoding="utf-8") as f:
            json.dump(added_entries, f, ensure_ascii=False, indent=2)

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
        print(f"\nAdded {len(added)} new entries:")
        for a in added[:20]:
            print(f"  + {a}")
        if len(added) > 20:
            print(f"  ... and {len(added) - 20} more")
    if skipped:
        print(f"\nSkipped {len(skipped)} entries:")
        for s in skipped[:20]:
            print(f"  - {s}")
        if len(skipped) > 20:
            print(f"  ... and {len(skipped) - 20} more")
    if not added:
        print("No new valid entries to add.")


if __name__ == "__main__":
    main()
