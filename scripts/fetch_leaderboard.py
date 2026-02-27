import os
import sys
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8")

import requests

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
CONFIG_DIR = BASE_DIR / "config"

REGION = "kr"
API_BASE = f"https://{REGION}.api.blizzard.com"
OAUTH_URL = "https://oauth.battle.net/token"
NS_PROFILE = "profile-classicann-kr"
NS_DYNAMIC = "dynamic-classicann-kr"
LOCALE = "ko_KR"

BRACKETS = ["2v2", "3v3", "5v5"]
MIN_LEVEL = 60
REQUEST_DELAY = 0.05


def get_access_token(client_id: str, client_secret: str) -> str:
    resp = requests.post(
        OAUTH_URL,
        data={"grant_type": "client_credentials"},
        auth=(client_id, client_secret),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def api_get(token: str, url: str, namespace: str, retries: int = 2) -> dict | None:
    headers = {"Authorization": f"Bearer {token}"}
    params = {"namespace": namespace, "locale": LOCALE}

    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, headers=headers, params=params, timeout=15)
            if resp.status_code == 404:
                return None
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 5))
                print(f"  [RATE LIMIT] waiting {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            print(f"  [ERROR] {url}: {e}")
            return None
    return None


def load_sources() -> dict:
    path = CONFIG_DIR / "sources.json"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def fetch_guild_members(token: str, guild_name: str, realm_slug: str) -> list[dict]:
    guild_slug = quote(guild_name.lower())
    url = f"{API_BASE}/data/wow/guild/{realm_slug}/{guild_slug}/roster"
    data = api_get(token, url, NS_PROFILE)
    if not data:
        print(f"  [WARN] Guild '{guild_name}' on {realm_slug}: not found or error")
        return []

    members = []
    for m in data.get("members", []):
        char = m.get("character", {})
        level = char.get("level", 0)
        if level >= MIN_LEVEL:
            name = char.get("name", "")
            realm = char.get("realm", {})
            members.append({
                "name": name,
                "realm": realm.get("slug", realm_slug),
                "level": level,
                "id": char.get("id", 0),
            })
    return members


def fetch_character_pvp(token: str, name: str, realm_slug: str) -> dict | None:
    encoded = quote(name.lower())
    base_url = f"{API_BASE}/profile/wow/character/{realm_slug}/{encoded}"

    profile = api_get(token, base_url, NS_PROFILE)
    if not profile:
        return None

    result = {
        "name": profile.get("name", name),
        "realm": realm_slug,
        "realm_name": profile.get("realm", {}).get("name", ""),
        "level": profile.get("level", 0),
        "class": profile.get("character_class", {}).get("name", ""),
        "race": profile.get("race", {}).get("name", ""),
        "faction": profile.get("faction", {}).get("type", ""),
        "guild": profile.get("guild", {}).get("name", ""),
        "brackets": {},
    }

    if isinstance(result["realm_name"], dict):
        result["realm_name"] = result["realm_name"].get("ko_KR", result["realm_name"].get("en_US", ""))

    for bracket in BRACKETS:
        time.sleep(REQUEST_DELAY)
        pvp_url = f"{base_url}/pvp-bracket/{bracket}"
        pvp_data = api_get(token, pvp_url, NS_PROFILE)
        if pvp_data:
            stats = pvp_data.get("season_match_statistics", {})
            result["brackets"][bracket] = {
                "rating": pvp_data.get("rating", 0),
                "won": stats.get("won", 0),
                "lost": stats.get("lost", 0),
                "played": stats.get("played", 0),
                "season_id": pvp_data.get("season", {}).get("id"),
            }

    return result


def build_leaderboard(all_pvp_data: list[dict], bracket: str) -> list[dict]:
    entries = []
    for char in all_pvp_data:
        bdata = char.get("brackets", {}).get(bracket)
        if not bdata or bdata["rating"] == 0:
            continue
        total = bdata["won"] + bdata["lost"]
        winrate = (bdata["won"] / total * 100) if total > 0 else 0
        entries.append({
            "name": char["name"],
            "realm": char["realm"],
            "realm_name": char.get("realm_name", ""),
            "class": char.get("class", ""),
            "race": char.get("race", ""),
            "faction": char.get("faction", ""),
            "guild": char.get("guild", ""),
            "rating": bdata["rating"],
            "won": bdata["won"],
            "lost": bdata["lost"],
            "played": bdata["played"],
            "winrate": round(winrate, 1),
        })

    entries.sort(key=lambda x: x["rating"], reverse=True)
    for i, entry in enumerate(entries, 1):
        entry["rank"] = i

    return entries


def main():
    client_id = os.environ.get("BLIZZARD_CLIENT_ID", "")
    client_secret = os.environ.get("BLIZZARD_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        print("ERROR: BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET must be set")
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    sources = load_sources()

    print("Authenticating...")
    token = get_access_token(client_id, client_secret)
    print("Authenticated.")

    # Collect unique characters from guild rosters
    seen = set()
    characters = []

    for guild in sources.get("guilds", []):
        gname = guild["name"]
        grealm = guild["realm"]
        print(f"Fetching guild roster: {gname} ({grealm})...")
        members = fetch_guild_members(token, gname, grealm)
        print(f"  {len(members)} eligible members (lvl >= {MIN_LEVEL})")
        for m in members:
            key = (m["name"].lower(), m["realm"])
            if key not in seen:
                seen.add(key)
                characters.append(m)
        time.sleep(0.5)

    for char in sources.get("characters", []):
        key = (char["name"].lower(), char["realm"])
        if key not in seen:
            seen.add(key)
            characters.append({"name": char["name"], "realm": char["realm"], "level": 70, "id": 0})

    print(f"\nTotal unique characters to query: {len(characters)}")

    # Fetch PvP data for each character
    all_pvp = []
    total = len(characters)
    for i, char in enumerate(characters, 1):
        if i % 25 == 0 or i == 1:
            print(f"  Querying PvP data... ({i}/{total})")
        pvp = fetch_character_pvp(token, char["name"], char["realm"])
        if pvp and pvp["brackets"]:
            all_pvp.append(pvp)
        time.sleep(REQUEST_DELAY)

    print(f"\nCharacters with PvP data: {len(all_pvp)}")

    # Build leaderboards per bracket
    meta = {
        "region": REGION,
        "namespace": NS_PROFILE,
        "locale": LOCALE,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total_characters_scanned": total,
        "total_with_pvp": len(all_pvp),
        "guilds_scanned": [g["name"] for g in sources.get("guilds", [])],
        "brackets": {},
    }

    for bracket in BRACKETS:
        leaderboard = build_leaderboard(all_pvp, bracket)
        print(f"{bracket}: {len(leaderboard)} ranked players")

        out_path = DATA_DIR / f"{bracket}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(leaderboard, f, ensure_ascii=False, indent=2)

        meta["brackets"][bracket] = {
            "count": len(leaderboard),
            "file": f"{bracket}.json",
        }

    # Save all character PvP data (for individual lookups)
    all_pvp_path = DATA_DIR / "all_characters.json"
    with open(all_pvp_path, "w", encoding="utf-8") as f:
        json.dump(all_pvp, f, ensure_ascii=False, indent=2)

    meta_path = DATA_DIR / "meta.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\nData saved to {DATA_DIR}")

    # Store history in Supabase
    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "")

    if supabase_url and supabase_key:
        print("\nSyncing to Supabase...")
        synced = sync_to_supabase(supabase_url, supabase_key, all_pvp)
        print(f"  Synced {synced} character snapshots")
    else:
        print("\nSkipping Supabase (SUPABASE_URL / SUPABASE_SERVICE_KEY not set)")

    print("Done.")


def supabase_request(url: str, key: str, method: str, path: str, body=None):
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    full_url = f"{url}/rest/v1/{path}"
    resp = requests.request(method, full_url, headers=headers, json=body, timeout=15)
    if resp.status_code >= 400:
        print(f"  [SUPABASE ERROR] {method} {path}: {resp.status_code} {resp.text[:200]}")
        return None
    if resp.text:
        return resp.json()
    return None


def sync_to_supabase(url: str, key: str, all_pvp: list[dict]) -> int:
    now = datetime.now(timezone.utc).isoformat()
    synced = 0

    for char in all_pvp:
        char_row = {
            "name": char["name"],
            "realm": char["realm"],
            "class": char.get("class", ""),
            "race": char.get("race", ""),
            "faction": char.get("faction", ""),
            "guild": char.get("guild", ""),
            "updated_at": now,
        }

        # Upsert character
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        }
        resp = requests.post(
            f"{url}/rest/v1/characters",
            headers=headers,
            json=char_row,
            params={"on_conflict": "name,realm"},
            timeout=15,
        )
        if resp.status_code >= 400:
            print(f"  [SUPABASE] character upsert failed for {char['name']}: {resp.text[:100]}")
            continue

        char_data = resp.json()
        if not char_data:
            continue
        char_id = char_data[0]["id"]

        # Insert rating snapshots for each bracket
        for bracket, bdata in char.get("brackets", {}).items():
            snapshot = {
                "character_id": char_id,
                "bracket": bracket,
                "rating": bdata["rating"],
                "won": bdata["won"],
                "lost": bdata["lost"],
                "played": bdata["played"],
                "recorded_at": now,
            }
            supabase_request(url, key, "POST", "rating_snapshots", snapshot)
            synced += 1

    return synced


if __name__ == "__main__":
    main()
