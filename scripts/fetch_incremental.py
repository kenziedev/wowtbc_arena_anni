"""Fetch PvP data only for newly added guilds/characters and merge into existing data."""

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from fetch_leaderboard import (
    get_access_token,
    fetch_guild_members,
    fetch_character_pvp,
    fetch_character_worker,
    build_leaderboard,
    sync_to_supabase,
    resolve_icons,
    BRACKETS,
    MAX_WORKERS,
    MIN_LEVEL,
)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
ADDED_FILE = BASE_DIR / "config" / "_added.json"


def load_existing_characters() -> list[dict]:
    path = DATA_DIR / "all_characters.json"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def main():
    if not ADDED_FILE.exists():
        print("No _added.json found, nothing to do.")
        return

    with open(ADDED_FILE, "r", encoding="utf-8") as f:
        added = json.load(f)

    new_guilds = added.get("guilds", [])
    new_characters = added.get("characters", [])

    if not new_guilds and not new_characters:
        print("No new entries to fetch.")
        return

    client_id = os.environ.get("BLIZZARD_CLIENT_ID", "")
    client_secret = os.environ.get("BLIZZARD_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        print("ERROR: BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET must be set")
        sys.exit(1)

    print("Authenticating...")
    token = get_access_token(client_id, client_secret)

    existing = load_existing_characters()
    existing_keys = {(c["name"].lower(), c["realm"]) for c in existing}

    chars_to_fetch = []

    for guild in new_guilds:
        gname, grealm = guild["name"], guild["realm"]
        print(f"Fetching guild roster: {gname} ({grealm})...")
        members = fetch_guild_members(token, gname, grealm)
        print(f"  {len(members)} eligible members (lvl >= {MIN_LEVEL})")
        for m in members:
            key = (m["name"].lower(), m["realm"])
            if key not in existing_keys:
                existing_keys.add(key)
                chars_to_fetch.append(m)

    for char in new_characters:
        key = (char["name"].lower(), char["realm"])
        if key not in existing_keys:
            existing_keys.add(key)
            chars_to_fetch.append({"name": char["name"], "realm": char["realm"], "level": 70, "id": 0})

    total = len(chars_to_fetch)
    if total == 0:
        print("All new entries already exist in data. Nothing to fetch.")
        ADDED_FILE.unlink(missing_ok=True)
        return

    print(f"\nNew characters to fetch: {total}")
    print(f"Using {MAX_WORKERS} parallel workers...")

    new_pvp = []
    done = 0
    tasks = [(token, c["name"], c["realm"], i, total) for i, c in enumerate(chars_to_fetch)]

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(fetch_character_worker, t): t for t in tasks}
        for future in as_completed(futures):
            idx, name, pvp = future.result()
            done += 1
            if done % 20 == 0 or done == total:
                print(f"  Progress: {done}/{total}")
            if pvp:
                new_pvp.append(pvp)

    print(f"\nNew characters with data: {len(new_pvp)}")

    resolve_icons(token, new_pvp)

    # Merge into existing data
    merged = list(existing)
    merged_keys = {(c["name"].lower(), c["realm"]) for c in merged}
    added_count = 0
    for pvp in new_pvp:
        key = (pvp["name"].lower(), pvp["realm"])
        if key not in merged_keys:
            merged.append(pvp)
            merged_keys.add(key)
            added_count += 1

    print(f"Merged {added_count} new characters into all_characters.json (total: {len(merged)})")

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with open(DATA_DIR / "all_characters.json", "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    # Rebuild leaderboards
    meta_path = DATA_DIR / "meta.json"
    meta = {}
    if meta_path.exists():
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)

    meta["updated_at"] = datetime.now(timezone.utc).isoformat()
    meta["total_with_pvp"] = len([c for c in merged if c.get("brackets")])
    meta["brackets"] = meta.get("brackets", {})

    for bracket in BRACKETS:
        leaderboard = build_leaderboard(merged, bracket)
        print(f"  {bracket}: {len(leaderboard)} ranked players")
        with open(DATA_DIR / f"{bracket}.json", "w", encoding="utf-8") as f:
            json.dump(leaderboard, f, ensure_ascii=False, indent=2)
        meta["brackets"][bracket] = {"count": len(leaderboard), "file": f"{bracket}.json"}

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # Supabase sync (only new characters)
    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if supabase_url and supabase_key and new_pvp:
        print("\nSyncing new characters to Supabase...")
        synced = sync_to_supabase(supabase_url, supabase_key, new_pvp)
        print(f"  Synced {synced} snapshots")

    ADDED_FILE.unlink(missing_ok=True)
    print("Done (incremental).")


if __name__ == "__main__":
    main()
