import os
import sys
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8")

import requests

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DAILY_BASELINES_FILE = DATA_DIR / "daily_baselines.json"
KST = timezone(timedelta(hours=9))

REGION = "kr"
API_BASE = f"https://{REGION}.api.blizzard.com"
OAUTH_URL = "https://oauth.battle.net/token"
NS_PROFILE = "profile-classicann-kr"
NS_DYNAMIC = "dynamic-classicann-kr"
LOCALE = "ko_KR"

BRACKETS = ["2v2", "3v3", "5v5"]
MAX_WORKERS = int(os.environ.get("FETCH_WORKERS", "20"))
SUPABASE_CHAR_BATCH = int(os.environ.get("SUPABASE_CHAR_BATCH", "200"))
SUPABASE_ID_CHUNK = int(os.environ.get("SUPABASE_ID_CHUNK", "150"))
SUPABASE_SNAPSHOT_BATCH = int(os.environ.get("SUPABASE_SNAPSHOT_BATCH", "500"))


def get_access_token(client_id: str, client_secret: str) -> str:
    resp = requests.post(
        OAUTH_URL,
        data={"grant_type": "client_credentials"},
        auth=(client_id, client_secret),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


_session = requests.Session()


def api_get(token: str, url: str, namespace: str, retries: int = 2) -> dict | None:
    headers = {"Authorization": f"Bearer {token}"}
    params = {"namespace": namespace, "locale": LOCALE}

    for attempt in range(retries + 1):
        try:
            resp = _session.get(url, headers=headers, params=params, timeout=15)
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


def character_key(name: str, realm: str) -> tuple[str, str]:
    return name.lower(), realm


def localized_name(value) -> str:
    if isinstance(value, dict):
        return value.get("ko_KR", value.get("en_US", ""))
    return value or ""


def fetch_current_season(token: str) -> dict:
    url = f"{API_BASE}/data/wow/pvp-season/index"
    data = api_get(token, url, NS_DYNAMIC)
    if not data:
        return {"id": 1, "name": ""}

    current = data.get("current_season", {})
    season_id = current.get("id", 1)

    season_name = ""
    season_data = api_get(token, f"{API_BASE}/data/wow/pvp-season/{season_id}", NS_DYNAMIC)
    if season_data:
        season_name = localized_name(season_data.get("season_name", ""))

    return {"id": season_id, "name": season_name}


def fetch_official_leaderboard(token: str, season_id: int, bracket: str) -> list[dict]:
    url = f"{API_BASE}/data/wow/pvp-season/{season_id}/pvp-leaderboard/{bracket}"
    data = api_get(token, url, NS_DYNAMIC)
    if not data:
        print(f"  [WARN] Could not fetch official leaderboard for {bracket}")
        return []

    entries = []
    for row in data.get("entries", []):
        char = row.get("character", {})
        realm = char.get("realm", {})
        name = char.get("name", "")
        realm_slug = realm.get("slug", "")
        if not name or not realm_slug:
            continue

        stats = row.get("season_match_statistics", {})
        played = stats.get("played", 0)
        won = stats.get("won", 0)
        lost = stats.get("lost", 0)
        if played == 0 and (won or lost):
            played = won + lost
        winrate = round((won / played * 100) if played > 0 else 0, 1)

        entries.append({
            "name": name,
            "realm": realm_slug,
            "realm_name": "",
            "class": "",
            "race": "",
            "faction": row.get("faction", {}).get("type", ""),
            "guild": "",
            "rating": row.get("rating", 0),
            "won": won,
            "lost": lost,
            "played": played,
            "winrate": winrate,
            "rank": row.get("rank", 0),
        })

    entries.sort(key=lambda entry: entry.get("rank", 0) or 0)
    return entries


def build_ranked_character_map(leaderboards: dict[str, list[dict]], season_id: int) -> dict[tuple[str, str], dict]:
    ranked_characters = {}

    for bracket, entries in leaderboards.items():
        for entry in entries:
            key = character_key(entry["name"], entry["realm"])
            char = ranked_characters.setdefault(key, {
                "name": entry["name"],
                "realm": entry["realm"],
                "realm_name": entry.get("realm_name", ""),
                "level": 0,
                "class": "",
                "race": "",
                "faction": entry.get("faction", ""),
                "guild": "",
                "brackets": {},
            })
            if not char.get("faction") and entry.get("faction"):
                char["faction"] = entry["faction"]
            char["brackets"][bracket] = {
                "rating": entry["rating"],
                "won": entry["won"],
                "lost": entry["lost"],
                "played": entry["played"],
                "season_id": season_id,
                "rank": entry["rank"],
            }

    return ranked_characters


def fetch_character_profile(token: str, name: str, realm_slug: str) -> dict | None:
    encoded = quote(name.lower())
    base_url = f"{API_BASE}/profile/wow/character/{realm_slug}/{encoded}"

    profile = api_get(token, base_url, NS_PROFILE)
    if not profile:
        return None

    result = {
        "name": profile.get("name", name),
        "realm": realm_slug,
        "realm_name": localized_name(profile.get("realm", {}).get("name", "")),
        "level": profile.get("level", 0),
        "class": localized_name(profile.get("character_class", {}).get("name", "")),
        "race": localized_name(profile.get("race", {}).get("name", "")),
        "faction": profile.get("faction", {}).get("type", ""),
        "guild": localized_name(profile.get("guild", {}).get("name", "")),
        "brackets": {},
    }

    spec_data = api_get(token, f"{base_url}/specializations", NS_PROFILE)
    if spec_data:
        spec_groups = []
        for group in spec_data.get("specialization_groups", []):
            trees = []
            for spec in group.get("specializations", []):
                tree = {
                    "name": localized_name(spec.get("specialization_name", "")),
                    "points": spec.get("spent_points", 0),
                    "talents": [],
                }
                for t in spec.get("talents", []):
                    tooltip = t.get("spell_tooltip", {})
                    spell = tooltip.get("spell", {})
                    tree["talents"].append({
                        "name": localized_name(spell.get("name", "")),
                        "rank": t.get("talent_rank", 0),
                        "spell_id": spell.get("id", 0),
                    })
                trees.append(tree)
            spec_groups.append({
                "active": bool(group.get("is_active")),
                "trees": trees,
            })
        result["spec_groups"] = spec_groups

    eq_data = api_get(token, f"{base_url}/equipment", NS_PROFILE)
    if eq_data:
        items = []
        item_ids_needed = set()
        for item in eq_data.get("equipped_items", []):
            slot_type = item.get("slot", {}).get("type", "")
            if slot_type in ("SHIRT", "TABARD"):
                continue
            item_id = item.get("item", {}).get("id", 0)
            entry = {
                "slot": localized_name(item.get("slot", {}).get("name", "")),
                "slot_type": slot_type,
                "name": localized_name(item.get("name", "")),
                "quality": localized_name(item.get("quality", {}).get("name", "")),
                "quality_type": item.get("quality", {}).get("type", ""),
                "item_id": item_id,
            }
            enchants = []
            for ench in item.get("enchantments", []):
                e = {"text": localized_name(ench.get("display_string", ""))}
                slot_info = ench.get("enchantment_slot", {})
                if slot_info.get("type") == "PERMANENT":
                    e["type"] = "PERMANENT"
                else:
                    e["type"] = "GEM"
                    src = ench.get("source_item", {})
                    if src.get("name"):
                        e["source"] = localized_name(src["name"])
                enchants.append(e)
            if enchants:
                entry["enchants"] = enchants
            items.append(entry)
            if item_id:
                item_ids_needed.add(item_id)
        result["equipment"] = items
        result["_item_ids"] = list(item_ids_needed)

    media_data = api_get(token, f"{base_url}/character-media", NS_PROFILE)
    if media_data:
        for asset in media_data.get("assets", []):
            if asset.get("key") == "avatar":
                result["avatar"] = asset.get("value", "")
                break

    return result


def fetch_character_profile_worker(args):
    token, stub, idx, total = args
    profile = fetch_character_profile(token, stub["name"], stub["realm"])
    return idx, character_key(stub["name"], stub["realm"]), profile


def enrich_ranked_characters(token: str, ranked_characters: dict[tuple[str, str], dict]) -> list[dict]:
    characters = list(ranked_characters.values())
    total = len(characters)
    print(f"\nEnriching {total} ranked characters...")
    print(f"Using {MAX_WORKERS} parallel workers...")

    enriched = []
    done = 0
    tasks = [(token, char, i, total) for i, char in enumerate(characters)]

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(fetch_character_profile_worker, task): task for task in tasks}
        for future in as_completed(futures):
            idx, key, profile = future.result()
            done += 1
            if done % 50 == 0 or done == total:
                print(f"  Progress: {done}/{total}")

            stub = ranked_characters[key]
            if profile:
                profile["profile_restricted"] = False
                profile["brackets"] = stub["brackets"]
                if not profile.get("faction"):
                    profile["faction"] = stub.get("faction", "")
                enriched.append(profile)
            else:
                stub["profile_restricted"] = True
                enriched.append(stub)

    return enriched


ICON_CACHE_PATH = DATA_DIR / "_icon_cache.json"
ICONS_DIR = BASE_DIR / "icons"
NS_STATIC = "static-2.5.5_65000-classicann-kr"
WOWHEAD_ICON_CDN = "https://wow.zamimg.com/images/wow/icons/medium"


def load_icon_cache() -> dict:
    if ICON_CACHE_PATH.exists():
        with open(ICON_CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_icon_cache(cache: dict):
    with open(ICON_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)


def _extract_icon_name(blizzard_url: str) -> str:
    """Extract icon filename (without extension) from a Blizzard render URL."""
    return blizzard_url.rsplit("/", 1)[-1].replace(".jpg", "")


def fetch_item_icon_name(token: str, item_id: int) -> str | None:
    """Fetch the icon name for an item from the Blizzard media API."""
    url = f"{API_BASE}/data/wow/media/item/{item_id}"
    data = api_get(token, url, NS_STATIC)
    if data:
        for asset in data.get("assets", []):
            if asset.get("key") == "icon":
                raw = asset.get("value", "")
                if raw:
                    return _extract_icon_name(raw)
    return None


def _icon_name_worker(args):
    token, item_id = args
    name = fetch_item_icon_name(token, item_id)
    return item_id, name


def _download_icon(icon_name: str) -> bool:
    """Download an icon from Wowhead CDN and save to icons/ directory."""
    dest = ICONS_DIR / f"{icon_name}.jpg"
    if dest.exists():
        return True
    url = f"{WOWHEAD_ICON_CDN}/{icon_name}.jpg"
    try:
        resp = _session.get(url, timeout=10)
        if resp.status_code == 200 and resp.content:
            dest.write_bytes(resp.content)
            return True
    except requests.RequestException:
        pass
    return False


def resolve_icons(token: str, all_pvp: list[dict]):
    """Resolve item icons: fetch names via Blizzard API, download from Wowhead CDN."""
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    cache = load_icon_cache()

    needed_ids = set()
    for char in all_pvp:
        for item_id in char.pop("_item_ids", []):
            sid = str(item_id)
            if sid not in cache:
                needed_ids.add(item_id)

    if needed_ids:
        print(f"\nFetching {len(needed_ids)} new item icon names...")
        tasks = [(token, iid) for iid in needed_ids]
        done = 0
        total = len(tasks)
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(_icon_name_worker, t): t for t in tasks}
            for future in as_completed(futures):
                item_id, icon_name = future.result()
                done += 1
                if done % 50 == 0 or done == total:
                    print(f"  Icon names: {done}/{total}")
                cache[str(item_id)] = icon_name or ""
        save_icon_cache(cache)

    icons_to_download = set()
    for name in cache.values():
        if name:
            icons_to_download.add(name)

    existing = {p.stem for p in ICONS_DIR.glob("*.jpg")}
    missing = icons_to_download - existing
    if missing:
        print(f"\nDownloading {len(missing)} icon images from CDN...")
        done = 0
        total = len(missing)
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(_download_icon, n): n for n in missing}
            for future in as_completed(futures):
                done += 1
                if done % 100 == 0 or done == total:
                    print(f"  Downloads: {done}/{total}")
    else:
        print("\nAll icon images already downloaded.")

    for char in all_pvp:
        for eq in char.get("equipment", []):
            icon_name = cache.get(str(eq.get("item_id", 0)), "")
            if icon_name:
                eq["icon"] = f"icons/{icon_name}.jpg"

    # Resolve talent spell icons via Wowhead TBC tooltip API
    talent_spell_ids = set()
    for char in all_pvp:
        for group in char.get("spec_groups", []):
            for tree in group.get("trees", []):
                for t in tree.get("talents", []):
                    sid = t.get("spell_id", 0)
                    if sid and not cache.get(f"spell_{sid}"):
                        talent_spell_ids.add(sid)

    if talent_spell_ids:
        print(f"\nFetching {len(talent_spell_ids)} talent spell icons from Wowhead...")
        WOWHEAD_TOOLTIP = "https://nether.wowhead.com/tbc/tooltip/spell"

        def _spell_icon_worker_wh(spell_id):
            try:
                resp = _session.get(f"{WOWHEAD_TOOLTIP}/{spell_id}", timeout=10)
                if resp.status_code == 200:
                    icon = resp.json().get("icon", "")
                    if icon:
                        return spell_id, icon.lower()
            except Exception:
                pass
            return spell_id, ""

        done = 0
        total = len(talent_spell_ids)
        spell_workers = int(os.environ.get("SPELL_ICON_WORKERS", str(min(MAX_WORKERS, 16))))
        with ThreadPoolExecutor(max_workers=max(1, spell_workers)) as executor:
            futures = {executor.submit(_spell_icon_worker_wh, sid): sid
                       for sid in talent_spell_ids}
            for future in as_completed(futures):
                sid, icon_name = future.result()
                done += 1
                if done % 50 == 0 or done == total:
                    print(f"  Talent icons: {done}/{total}")
                cache[f"spell_{sid}"] = icon_name
        save_icon_cache(cache)

    for char in all_pvp:
        for group in char.get("spec_groups", []):
            for tree in group.get("trees", []):
                for t in tree.get("talents", []):
                    icon_name = cache.get(f"spell_{t.get('spell_id', 0)}", "")
                    if icon_name:
                        t["icon"] = icon_name


def fetch_cutoffs(token: str, season_id: int):
    """Fetch PvP season reward cutoffs and save to data/cutoffs.json."""
    BRACKET_MAP = {"ARENA_2v2": "2v2", "ARENA_3v3": "3v3", "ARENA_5v5": "5v5"}

    url = f"{API_BASE}/data/wow/pvp-season/{season_id}/pvp-reward/index"
    data = api_get(token, url, NS_DYNAMIC)
    if not data:
        print("  [WARN] Could not fetch PvP reward cutoffs")
        return

    cutoffs = {}
    for reward in data.get("rewards", []):
        bracket_type = reward.get("bracket", {}).get("type", "")
        bracket = BRACKET_MAP.get(bracket_type)
        if not bracket:
            continue
        name = localized_name(reward.get("achievement", {}).get("name", ""))
        rating = reward.get("rating_cutoff", 0)
        title = name.split(":")[0].strip()

        if bracket not in cutoffs:
            cutoffs[bracket] = []
        if not any(c["title"] == title for c in cutoffs[bracket]):
            cutoffs[bracket].append({"title": title, "rating": rating})

    for bracket in cutoffs:
        cutoffs[bracket].sort(key=lambda c: c["rating"], reverse=True)

    out = {"season_id": season_id, "cutoffs": cutoffs}
    out_path = DATA_DIR / "cutoffs.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("Cutoffs saved:")
    for bracket, items in cutoffs.items():
        for c in items:
            print(f"  {bracket}: {c['title']} = {c['rating']}")


def load_previous_leaderboard(bracket: str) -> dict:
    """Load previous leaderboard data and return a lookup dict keyed by (name, realm)."""
    path = DATA_DIR / f"{bracket}.json"
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            prev = json.load(f)
        return {(e["name"], e["realm"]): e for e in prev}
    except Exception:
        return {}


def _daily_key(dt: datetime) -> str:
    return dt.astimezone(KST).date().isoformat()


def _entry_key(entry: dict) -> str:
    return f"{entry['name']}::{entry['realm']}"


def load_daily_baselines() -> dict:
    """Load first leaderboard snapshot captured for each KST day."""
    if not DAILY_BASELINES_FILE.exists():
        return {}
    try:
        with open(DAILY_BASELINES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_daily_baselines(baselines: dict) -> None:
    with open(DAILY_BASELINES_FILE, "w", encoding="utf-8") as f:
        json.dump(baselines, f, ensure_ascii=False, indent=2)


def build_daily_snapshot(entries: list[dict]) -> dict:
    return {
        _entry_key(entry): {
            "name": entry["name"],
            "realm": entry["realm"],
            "rating": entry.get("rating", 0),
            "rank": entry.get("rank", 0),
        }
        for entry in entries
    }


def load_yesterday_baseline(bracket: str, entries: list[dict]) -> dict:
    """Return yesterday's first KST snapshot and preserve today's first snapshot."""
    now = datetime.now(KST)
    today_key = _daily_key(now)
    yesterday_key = _daily_key(now - timedelta(days=1))
    baselines = load_daily_baselines()
    changed = False

    if today_key not in baselines:
        baselines[today_key] = {}
        changed = True

    if bracket not in baselines[today_key]:
        baselines[today_key][bracket] = build_daily_snapshot(entries)
        changed = True

    if changed:
        save_daily_baselines(baselines)

    return baselines.get(yesterday_key, {}).get(bracket, {})


def build_leaderboard(all_pvp_data: list[dict], bracket: str) -> list[dict]:
    prev_map = load_previous_leaderboard(bracket)

    entries = []
    for char in all_pvp_data:
        bdata = char.get("brackets", {}).get(bracket)
        if not bdata or bdata["rating"] == 0:
            continue
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
            "winrate": round((bdata["won"] / bdata["played"] * 100) if bdata["played"] > 0 else 0, 1),
            "rank": bdata.get("rank", 0),
        })

    entries.sort(key=lambda x: (x.get("rank", 0) or 0, -(x.get("rating", 0) or 0), x["name"]))
    yesterday_map = load_yesterday_baseline(bracket, entries)

    for entry in entries:
        daily_key = _entry_key(entry)
        prev = yesterday_map.get(daily_key)
        if not prev:
            key = (entry["name"], entry["realm"])
            prev = prev_map.get(key)
        if prev:
            rating_diff = entry["rating"] - prev.get("rating", 0)
            if rating_diff != 0:
                entry["rd"] = rating_diff
            rank_diff = prev.get("rank", 0) - entry["rank"]
            if rank_diff != 0:
                entry["rkd"] = rank_diff

    return entries


def main():
    client_id = os.environ.get("BLIZZARD_CLIENT_ID", "")
    client_secret = os.environ.get("BLIZZARD_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        print("ERROR: BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET must be set")
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("Authenticating...")
    token = get_access_token(client_id, client_secret)
    print("Authenticated.")

    print("\nResolving current PvP season...")
    season = fetch_current_season(token)
    season_id = season["id"]
    print(f"Using season {season_id}")

    print("\nFetching PvP reward cutoffs...")
    fetch_cutoffs(token, season_id)

    leaderboards = {}
    for bracket in BRACKETS:
        print(f"\nFetching official {bracket} leaderboard...")
        leaderboard = fetch_official_leaderboard(token, season_id, bracket)
        print(f"  {len(leaderboard)} entries")
        leaderboards[bracket] = leaderboard

    ranked_characters = build_ranked_character_map(leaderboards, season_id)
    total_ranked_characters = len(ranked_characters)
    print(f"\nTotal unique ranked characters: {total_ranked_characters}")

    all_pvp = enrich_ranked_characters(token, ranked_characters)

    resolve_icons(token, all_pvp)

    meta = {
        "region": REGION,
        "namespace": NS_DYNAMIC,
        "profile_namespace": NS_PROFILE,
        "locale": LOCALE,
        "season_id": season_id,
        "season_name": season.get("name", ""),
        "source": "official-pvp-leaderboard-api",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total_characters_scanned": total_ranked_characters,
        "total_with_pvp": len(all_pvp),
        "guilds_scanned": [],
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
            "source_count": len(leaderboards.get(bracket, [])),
        }

    all_pvp_path = DATA_DIR / "all_characters.json"
    with open(all_pvp_path, "w", encoding="utf-8") as f:
        json.dump(all_pvp, f, ensure_ascii=False, indent=2)

    meta_path = DATA_DIR / "meta.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\nData saved to {DATA_DIR}")

    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "")

    if supabase_url and supabase_key:
        print("\nSyncing to Supabase...")
        synced = sync_to_supabase(supabase_url, supabase_key, all_pvp)
        print(f"  Synced {synced} new/changed snapshots")
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
    try:
        resp = requests.request(method, full_url, headers=headers, json=body, timeout=30)
    except requests.RequestException as e:
        print(f"  [SUPABASE ERROR] {method} {path}: {e}")
        return None
    if resp.status_code >= 400:
        print(f"  [SUPABASE ERROR] {method} {path}: {resp.status_code} {resp.text[:200]}")
        return None
    if resp.text:
        return resp.json()
    return None


def sync_to_supabase(url: str, key: str, all_pvp: list[dict]) -> int:
    now = datetime.now(timezone.utc).isoformat()

    rows = [{
        "name": c["name"],
        "realm": c["realm"],
        "class": c.get("class", ""),
        "race": c.get("race", ""),
        "faction": c.get("faction", ""),
        "guild": c.get("guild", ""),
        "updated_at": now,
    } for c in all_pvp]

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    base = url.rstrip("/")
    chars_url = f"{base}/rest/v1/characters"
    id_map: dict[tuple[str, str], int] = {}

    errs = 0
    bs = SUPABASE_CHAR_BATCH
    for i in range(0, len(rows), bs):
        chunk = rows[i : i + bs]
        try:
            resp = requests.post(
                f"{chars_url}?on_conflict=name,realm",
                headers={
                    **headers,
                    "Prefer": "return=representation,resolution=merge-duplicates",
                },
                json=chunk,
                timeout=120,
            )
        except requests.RequestException as e:
            errs += 1
            print(f"  [SUPABASE] character batch upsert error: {e}")
            continue
        if resp.status_code >= 400:
            errs += 1
            print(f"  [SUPABASE] character batch upsert failed: {resp.status_code} {resp.text[:200]}")
            continue
        payload = resp.json()
        if isinstance(payload, dict):
            payload = [payload]
        elif not isinstance(payload, list):
            errs += 1
            continue
        for row in payload:
            if not row:
                continue
            id_map[character_key(row["name"], row["realm"])] = row["id"]

    missing = [(c["name"], c["realm"]) for c in all_pvp
               if character_key(c["name"], c["realm"]) not in id_map]
    if missing:
        print(f"  [SUPABASE] Resolving ids for {len(missing)} characters not in upsert payload...")
        for name, realm in missing:
            k = character_key(name, realm)
            try:
                lr = requests.get(
                    chars_url,
                    headers={**headers, "Accept": "application/json"},
                    params={
                        "select": "id,name,realm",
                        "name": f"eq.{name}",
                        "realm": f"eq.{realm}",
                    },
                    timeout=30,
                )
            except requests.RequestException as e:
                errs += 1
                print(f"    [SUPABASE] id lookup failed {name}-{realm}: {e}")
                continue
            if lr.status_code >= 400:
                errs += 1
                continue
            rows_found = lr.json() if lr.text else []
            if isinstance(rows_found, dict):
                rows_found = [rows_found]
            if rows_found:
                row0 = rows_found[0]
                id_map[k] = row0["id"]

    missing = [(c["name"], c["realm"]) for c in all_pvp
               if character_key(c["name"], c["realm"]) not in id_map]
    if missing:
        errs += len(missing)
        print(f"  [SUPABASE] {len(missing)} characters still without id — skipping snapshots for those")

    seen_ids = set(id_map.values())
    latest: dict[tuple[int, str], dict] = {}
    hdr_get = {"apikey": key, "Authorization": f"Bearer {key}"}

    def snapshots_use_latest_view() -> bool:
        r = requests.get(
            f"{base}/rest/v1/rating_snapshots_latest?select=character_id&limit=1",
            headers=hdr_get,
            timeout=15,
        )
        return r.status_code != 404

    use_view = snapshots_use_latest_view()
    path = "rating_snapshots_latest" if use_view else "rating_snapshots"

    id_list = [i for i in seen_ids]

    print(f"  Loading previous snapshots via {path} ({len(id_list)} characters)...")
    ich = SUPABASE_ID_CHUNK
    for j in range(0, len(id_list), ich):
        sub = id_list[j : j + ich]
        in_list = "(" + ",".join(str(x) for x in sub) + ")"

        if use_view:
            try:
                resp = requests.get(
                    f"{base}/rest/v1/{path}?character_id=in.{in_list}"
                    "&select=character_id,bracket,rating,won,lost,played",
                    headers=hdr_get,
                    timeout=120,
                )
            except requests.RequestException as e:
                errs += 1
                print(f"  [SUPABASE] snapshot read error: {e}")
                continue
            if resp.status_code >= 400:
                errs += 1
                print(f"  [SUPABASE] snapshot read failed: {resp.status_code} {resp.text[:200]}")
                continue
            for row in resp.json() if resp.text else []:
                cid = row["character_id"]
                bk = row["bracket"]
                latest[(cid, bk)] = {
                    "rating": row["rating"],
                    "won": row["won"],
                    "lost": row["lost"],
                    "played": row.get("played", 0),
                }
        else:
            print(
                "  [SUPABASE] Apply rating_snapshots_latest view on Supabase (see supabase/schema.sql) "
                "for faster sync; falling back to paginated snapshot history.",
                flush=True,
            )
            offset = 0
            chunk_size = 1000
            while True:
                try:
                    headers_page = dict(hdr_get)
                    headers_page["Prefer"] = "count=exact"
                    resp = requests.get(
                        f"{base}/rest/v1/{path}?character_id=in.{in_list}"
                        "&select=character_id,bracket,rating,won,lost,played,recorded_at"
                        "&order=recorded_at.desc"
                        f"&offset={offset}&limit={chunk_size}",
                        headers=headers_page,
                        timeout=120,
                    )
                except requests.RequestException as e:
                    errs += 1
                    print(f"  [SUPABASE] snapshot read error: {e}")
                    break
                if resp.status_code >= 400:
                    errs += 1
                    print(f"  [SUPABASE] snapshot read failed: {resp.status_code} {resp.text[:200]}")
                    break
                batch = resp.json() if resp.text else []
                if not batch:
                    break
                for row in batch:
                    k = (row["character_id"], row["bracket"])
                    rt = row.get("recorded_at", "") or ""
                    prev_row = latest.get(k)
                    prev_rt = (prev_row or {}).get("_rt", "") or ""
                    if not prev_row or rt > prev_rt:
                        latest[k] = {
                            "rating": row["rating"],
                            "won": row["won"],
                            "lost": row["lost"],
                            "played": row.get("played", 0),
                            "_rt": rt,
                        }
                offset += len(batch)
                if len(batch) < chunk_size:
                    break

    for lk in list(latest.keys()):
        d = latest.get(lk)
        if isinstance(d, dict):
            d.pop("_rt", None)

    new_snapshots: list[dict] = []
    for char in all_pvp:
        key_nr = character_key(char["name"], char["realm"])
        cid = id_map.get(key_nr)
        if not cid:
            continue
        for bracket, bdata in char.get("brackets", {}).items():
            prev = latest.get((cid, bracket))
            if prev and (
                    prev["rating"] == bdata["rating"]
                    and prev["won"] == bdata["won"]
                    and prev["lost"] == bdata["lost"]
            ):
                continue
            new_snapshots.append({
                "character_id": cid,
                "bracket": bracket,
                "rating": bdata["rating"],
                "won": bdata["won"],
                "lost": bdata["lost"],
                "played": bdata["played"],
                "recorded_at": now,
            })

    synced = 0
    snap_bs = SUPABASE_SNAPSHOT_BATCH
    for i in range(0, len(new_snapshots), snap_bs):
        batch = new_snapshots[i : i + snap_bs]
        try:
            resp = requests.post(
                f"{base}/rest/v1/rating_snapshots",
                headers={**headers, "Prefer": "return=minimal"},
                json=batch,
                timeout=120,
            )
        except requests.RequestException as e:
            errs += 1
            print(f"  [SUPABASE] snapshot batch insert error: {e}")
            continue
        if resp.status_code >= 400:
            errs += 1
            print(f"  [SUPABASE] snapshot batch insert failed: {resp.status_code} {resp.text[:200]}")
            continue
        synced += len(batch)

    if errs:
        print(f"  [SUPABASE] Completed with {errs} batched-errors (see logs above)")
    return synced


if __name__ == "__main__":
    main()
