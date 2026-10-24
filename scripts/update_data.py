#!/usr/bin/env python3
"""Collect public food observations without replacing failed sources with fiction.

Only the adapters perform network requests.  The merge functions are pure so
retention, units, dates, and failure behavior can be tested with saved fixtures.
"""
from __future__ import annotations

import argparse
import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import hashlib
import importlib
import json
import math
from pathlib import Path
import statistics
import sys
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ZONE = ZoneInfo("Asia/Shanghai")
SCHEMA = "1.0.0"
RETENTION_DAYS = 30
FIELDS = ("observations", "recipeRankings", "ingredientSignals")
REFERENCE_STATES = {"reference_only", "authorization_required", "not_configured", "manual_only", "blocked_by_robots", "unavailable"}
SUCCESS_STATES = {"ok", "success", "connected", "available", "partial"}


def instant(value: Any = None) -> datetime:
    if value is None:
        return datetime.now(ZONE)
    if isinstance(value, datetime):
        return value.replace(tzinfo=ZONE) if value.tzinfo is None else value.astimezone(ZONE)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.replace(tzinfo=ZONE) if parsed.tzinfo is None else parsed.astimezone(ZONE)


def stamp(value: Any = None) -> str:
    return instant(value).isoformat(timespec="seconds")


def valid_date(value: Any, today: date) -> bool:
    try:
        parsed = date.fromisoformat(value)
        return len(value) == 10 and parsed <= today
    except (TypeError, ValueError):
        return False


def numeric(value: Any, *, positive: bool = False) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and (not positive or value > 0)


def clean_record(row: Any, field: str, source_ids: set[str], now: datetime) -> tuple[dict | None, str | None]:
    if not isinstance(row, dict):
        return None, "记录不是对象。"
    item = copy.deepcopy(row)
    sid = item.get("sourceId")
    if sid not in source_ids:
        return None, "记录缺少已登记的数据来源。"
    if item.get("isSynthetic") is not False:
        return None, f"{sid}: 真实数据入口不接受合成或来源身份不明确的记录。"
    url = item.get("sourceUrl", "")
    if not isinstance(url, str) or not url.startswith(("https://", "http://")):
        return None, f"{sid}: 缺少可追溯的原始页面链接。"
    try:
        fetched = instant(item.get("fetchedAt")) if item.get("fetchedAt") else None
    except (ValueError, TypeError):
        fetched = None
    if fetched is None or fetched > now + timedelta(minutes=10):
        return None, f"{sid}: 缺少有效的实际采集时间。"
    item["fetchedAt"] = fetched.isoformat(timespec="seconds")
    item["capturedDate"] = fetched.date().isoformat()
    if field == "observations":
        if not valid_date(item.get("observedDate"), now.date()):
            return None, f"{sid}: 价格缺少原文日期，或日期晚于本次采集。"
        if not numeric(item.get("value"), positive=True):
            return None, f"{sid}: 价格不是有限正数。"
        if item.get("unit") != "CNY/kg":
            return None, f"{sid}: 价格单位未明确归一为 CNY/kg。"
        if item.get("priceType") not in ("wholesale", "retail", "farmgate"):
            return None, f"{sid}: 缺少批发/零售/产地报价口径。"
        geo = item.get("geography")
        if not isinstance(geo, dict) or geo.get("level") not in ("national", "province", "market", "city"):
            return None, f"{sid}: 缺少报价地理范围。"
        if not item.get("itemId") or not item.get("itemName"):
            return None, f"{sid}: 缺少统一食材标识或名称。"
        item["kind"] = "price"
    elif field == "recipeRankings":
        if not item.get("title") or not numeric(item.get("rank"), positive=True):
            return None, f"{sid}: 菜谱榜单缺少名称或有效顺位。"
        item["rank"] = int(item["rank"])
        if not isinstance(item.get("window"), dict):
            return None, f"{sid}: 榜单缺少平台周期说明。"
        if item.get("periodDateKnown") is not True:
            # A snapshot is dated by capture; it does not acquire an invented
            # source day/week merely because the collector ran today.
            item["periodDateKnown"] = False
            item["observedDate"] = None
        elif not valid_date(item.get("observedDate"), now.date()):
            return None, f"{sid}: 声称有榜期日期但没有可验证的日期。"
    else:
        # Derived ingredient signals may have an unknown publisher period.
        if item.get("periodDateKnown") is not True:
            item["periodDateKnown"] = False
            item["observedDate"] = None
        elif not valid_date(item.get("observedDate"), now.date()):
            return None, f"{sid}: 食材关注信号缺少对应观测日期。"
    item.pop("retainedFromPrevious", None)
    item.pop("recordStatus", None)
    return item, None


def price_series(row: dict) -> tuple:
    geo = row.get("geography", {})
    return (
        row.get("sourceId"), row.get("itemId"), row.get("unit"), row.get("priceType"),
        geo.get("level"), geo.get("provinceId"), geo.get("province"),
        geo.get("city"), geo.get("marketId"), geo.get("market"),
        row.get("specification"), row.get("grade"),
    )


def merge_price_rows(rows: list[dict], *, by_day: bool) -> list[dict]:
    merged: dict[tuple, dict] = {}
    for row in rows:
        key = price_series(row) + ((row.get("observedDate"),) if by_day else ())
        previous = merged.get(key)
        rank = (row.get("observedDate", ""), row.get("fetchedAt", ""))
        old_rank = (previous.get("observedDate", ""), previous.get("fetchedAt", "")) if previous else ("", "")
        if previous is None or rank >= old_rank:
            merged[key] = copy.deepcopy(row)
    return sorted(merged.values(), key=lambda row: (row.get("observedDate", ""), row.get("sourceId", ""), row.get("itemId", ""), str(price_series(row))))


def seven_day_prices(rows: list[dict], now: datetime) -> list[dict]:
    end = now.date()
    start = end - timedelta(days=6)
    groups: dict[tuple, list[dict]] = {}
    for row in merge_price_rows(rows, by_day=True):
        observed = row.get("observedDate")
        if not valid_date(observed, end) or not (start.isoformat() <= observed <= end.isoformat()):
            continue
        groups.setdefault(price_series(row), []).append(row)
    result = []
    for records in groups.values():
        records.sort(key=lambda row: row["observedDate"])
        last = records[-1]
        values = [row["value"] for row in records]
        result.append({
            "sourceId": last["sourceId"], "itemId": last["itemId"], "itemName": last["itemName"],
            "unit": last["unit"], "priceType": last["priceType"], "geography": copy.deepcopy(last["geography"]),
            "specification": last.get("specification"), "grade": last.get("grade"),
            "start": start.isoformat(), "end": end.isoformat(),
            "mean": round(sum(values) / len(values), 4), "min": min(values), "max": max(values),
            "observedDays": len(records), "expectedCalendarDays": 7,
            "observedDates": [row["observedDate"] for row in records],
            "latestValue": last["value"], "latestObservedDate": last["observedDate"],
            "sourceUrls": list(dict.fromkeys(row["sourceUrl"] for row in records)),
            "method": "同来源、同食材、同市场、同单位、同报价口径的已观测日价简单均值；缺失日不插值。",
            "isSynthetic": False,
        })
    return result


def regional_summaries(rows: list[dict], now: datetime) -> tuple[list[dict], list[dict]]:
    """Summarize sample markets without calling the result an official average."""
    end = now.date()
    start = end - timedelta(days=6)
    groups: dict[tuple, list[dict]] = {}
    for row in merge_price_rows(rows, by_day=True):
        if not valid_date(row.get("observedDate"), end) or not (start.isoformat() <= row["observedDate"] <= end.isoformat()):
            continue
        geo = row["geography"]
        if geo.get("level") != "market" or not geo.get("provinceId"):
            continue
        key = (row["sourceId"], row["itemId"], geo["provinceId"], row["unit"], row["priceType"], row.get("specification"), row.get("grade"), row["observedDate"])
        groups.setdefault(key, []).append(row)
    daily = []
    for records in groups.values():
        sample = records[0]
        values = [row["value"] for row in records]
        daily.append({
            "sourceId": sample["sourceId"], "itemId": sample["itemId"], "itemName": sample["itemName"],
            "provinceId": sample["geography"]["provinceId"], "province": sample["geography"].get("province"),
            "observedDate": sample["observedDate"], "unit": sample["unit"], "priceType": sample["priceType"],
            "specification": sample.get("specification"), "grade": sample.get("grade"),
            "median": round(statistics.median(values), 4), "min": min(values), "max": max(values),
            "marketCount": len(records), "sourceUrls": list(dict.fromkeys(row["sourceUrl"] for row in records)),
            "method": "本页同来源、同食材、同日已覆盖市场报价的中位数；不是官方省级均价或零售价。",
            "isDerived": True, "isSynthetic": False,
        })
    daily.sort(key=lambda row: (row["observedDate"], row["sourceId"], row["itemId"], row["provinceId"]))
    weekly_groups = {}
    for row in daily:
        key = (row["sourceId"], row["itemId"], row["provinceId"], row["unit"], row["priceType"], row.get("specification"), row.get("grade"))
        weekly_groups.setdefault(key, []).append(row)
    weekly = []
    for records in weekly_groups.values():
        last = records[-1]
        values = [row["median"] for row in records]
        weekly.append({
            "sourceId": last["sourceId"], "itemId": last["itemId"], "itemName": last["itemName"],
            "provinceId": last["provinceId"], "province": last.get("province"), "unit": last["unit"], "priceType": last["priceType"],
            "specification": last.get("specification"), "grade": last.get("grade"),
            "start": start.isoformat(), "end": end.isoformat(), "meanOfDailyMedians": round(sum(values) / len(values), 4),
            "minDailyMedian": min(values), "maxDailyMedian": max(values), "sampleDays": len(records), "expectedCalendarDays": 7,
            "observedDates": [row["observedDate"] for row in records], "marketCountRange": [min(row["marketCount"] for row in records), max(row["marketCount"] for row in records)],
            "latestObservedDate": last["observedDate"],
            "method": "近7天可用日的样本市场报价中位数再求简单均值；缺失日不填充，市场样本可能逐日变化。",
            "isDerived": True, "isSynthetic": False,
        })
    return daily, weekly


def national_daily_summaries(rows: list[dict], now: datetime) -> list[dict]:
    """Use individual market quotes, never an unweighted median of provinces."""
    end = now.date()
    start = end - timedelta(days=6)
    groups: dict[tuple, list[dict]] = {}
    for row in merge_price_rows(rows, by_day=True):
        observed = row.get("observedDate")
        if row.get("geography", {}).get("level") != "market" or not valid_date(observed, end) or not start.isoformat() <= observed <= end.isoformat():
            continue
        key = (row["sourceId"], row["itemId"], observed, row["unit"], row["priceType"], row.get("specification"), row.get("grade"))
        groups.setdefault(key, []).append(row)
    summaries = []
    for records in groups.values():
        sample = records[0]
        values = [row["value"] for row in records]
        summaries.append({
            "sourceId": sample["sourceId"], "itemId": sample["itemId"], "itemName": sample["itemName"],
            "observedDate": sample["observedDate"], "unit": sample["unit"], "priceType": sample["priceType"],
            "specification": sample.get("specification"), "grade": sample.get("grade"),
            "median": round(statistics.median(values), 4), "min": min(values), "max": max(values),
            "marketCount": len(records), "provinceCount": len({row["geography"].get("provinceId") for row in records if row["geography"].get("provinceId")}),
            "sourceUrls": list(dict.fromkeys(row["sourceUrl"] for row in records)),
            "method": "同来源、同食材、同日、同口径的所有已覆盖市场原始报价中位数；不是官方全国均价，不是省级中位数的中位数。",
            "isDerived": True, "isSynthetic": False,
        })
    return sorted(summaries, key=lambda row: (row["observedDate"], row["sourceId"], row["itemId"], row["priceType"], str(row["specification"]), str(row["grade"])))


def source_records(data: dict, source_id: str) -> dict[str, list[dict]]:
    return {field: [copy.deepcopy(row) for row in data.get(field, []) if row.get("sourceId") == source_id] for field in FIELDS}


def merge_history(previous: dict, latest: dict, accepted: dict[str, list[dict]], now: datetime) -> dict:
    cutoff = (now.date() - timedelta(days=RETENTION_DAYS - 1)).isoformat()
    allowed_sources = {row['id'] for row in latest['sources'] if row['status'] not in REFERENCE_STATES}
    price_rows = merge_price_rows(previous.get("observations", []) + accepted["observations"], by_day=True)
    price_rows = [row for row in price_rows if row.get('sourceId') in allowed_sources and valid_date(row.get("observedDate"), now.date()) and row["observedDate"] >= cutoff]
    snapshots = {}
    for snap in previous.get("recipeSnapshots", []):
        if snap.get('sourceId') in allowed_sources and snap.get("capturedDate", "") >= cutoff:
            snapshots[(snap.get("sourceId"), snap.get("capturedDate"))] = copy.deepcopy(snap)
    grouped = {}
    for row in accepted["recipeRankings"]:
        grouped.setdefault((row["sourceId"], row["capturedDate"]), []).append(row)
    for (sid, day), rows in grouped.items():
        snapshots[(sid, day)] = {
            "sourceId": sid, "capturedDate": day,
            "fetchedAt": max(row["fetchedAt"] for row in rows),
            "periodDateKnown": all(row.get("periodDateKnown") is True for row in rows),
            "window": copy.deepcopy(rows[0].get("window")), "rankings": copy.deepcopy(rows),
        }
    ingredients = {}
    for snap in previous.get("ingredientSnapshots", []):
        if snap.get('sourceId') in allowed_sources and snap.get("capturedDate", "") >= cutoff:
            ingredients[(snap.get("sourceId"), snap.get("capturedDate"))] = copy.deepcopy(snap)
    grouped = {}
    for row in accepted["ingredientSignals"]:
        grouped.setdefault((row["sourceId"], row["capturedDate"]), []).append(row)
    for (sid, day), rows in grouped.items():
        ingredients[(sid, day)] = {"sourceId": sid, "capturedDate": day, "fetchedAt": max(row["fetchedAt"] for row in rows), "signals": copy.deepcopy(rows)}
    runs = [row for row in previous.get("collectionRuns", []) if row.get("at", "")[:10] >= cutoff]
    runs.append({"at": stamp(now), "status": latest["status"], "contentVersion": latest["contentVersion"], "sourceStatuses": {s["id"]: s["status"] for s in latest["sources"]}})
    runs = list({run["at"]: run for run in runs}.values())[-180:]
    return {
        "schemaVersion": SCHEMA, "generatedAt": stamp(now), "retentionDays": RETENTION_DAYS,
        "observations": price_rows,
        "recipeSnapshots": sorted(snapshots.values(), key=lambda row: (row["capturedDate"], row["sourceId"])),
        "ingredientSnapshots": sorted(ingredients.values(), key=lambda row: (row["capturedDate"], row["sourceId"])),
        "collectionRuns": runs,
    }


def content_version(data: dict) -> str:
    def stable(value):
        if isinstance(value, list):
            return [stable(item) for item in value]
        if isinstance(value, dict):
            return {key: stable(item) for key, item in value.items() if key not in {"fetchedAt", "capturedDate", "retainedFromPrevious", "recordStatus"}}
        return value
    payload = json.dumps(stable({field: data[field] for field in FIELDS}), sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def build_dataset(previous: dict, results: list[dict], previous_history: dict, now: Any = None) -> tuple[dict, dict]:
    clock = instant(now)
    attempted_at = stamp(clock)
    old_sources = {row["id"]: copy.deepcopy(row) for row in previous.get("sources", []) if isinstance(row, dict) and row.get("id")}
    incoming_sources = {}
    for result in results:
        for source in result.get("sources", []):
            if isinstance(source, dict) and source.get("id"):
                incoming_sources[source["id"]] = copy.deepcopy(source)
    accepted = {field: [] for field in FIELDS}
    warnings: dict[str, list[str]] = {}
    for result in results:
        for field in FIELDS:
            for row in result.get(field, []):
                clean, error = clean_record(row, field, set(incoming_sources), clock)
                if clean is not None:
                    accepted[field].append(clean)
                elif error:
                    warnings.setdefault(str(row.get("sourceId", "unknown")) if isinstance(row, dict) else "unknown", []).append(error)
    output = {field: [] for field in FIELDS}
    source_list = []
    for sid in sorted(set(old_sources) | set(incoming_sources)):
        old = old_sources.get(sid, {})
        current = incoming_sources.get(sid)
        source = {**old, **(current or {})}
        if current is not None:
            # These describe this request, not a permanent property of a source.
            # A successful adapter may omit them after recovering from failure.
            for transient in ("error", "partial", "failures"):
                if transient not in current:
                    source.pop(transient, None)
        previous_rows = source_records(previous, sid)
        new_rows = source_records(accepted, sid)
        new_count = sum(len(rows) for rows in new_rows.values())
        old_count = sum(len(rows) for rows in previous_rows.values())
        raw_status = str(current.get("status", "ok" if new_count else "error")) if current else "not_attempted"
        source["collectionStatus"] = raw_status
        if current and raw_status not in REFERENCE_STATES:
            # Saved seeds retain their actual request time.  Building a new
            # bundle is not itself a new upstream request.
            source["lastAttemptAt"] = stamp(current["lastAttemptAt"]) if current.get("lastAttemptAt") else attempted_at
        else:
            source.setdefault("lastAttemptAt", None)
        if new_count and raw_status in SUCCESS_STATES:
            source["status"] = "ok"
            source["lastSuccessAt"] = max(row["fetchedAt"] for rows in new_rows.values() for row in rows)
            if not source.get("error"):
                source.pop("error", None)
            # Prices keep the latest published quote in every compatible market
            # series.  A newly missing market is never assigned a substitute.
            old_prices = []
            for row in previous_rows["observations"]:
                row["retainedFromPrevious"] = True
                row["recordStatus"] = "retained"
                old_prices.append(row)
            output["observations"].extend(merge_price_rows(old_prices + new_rows["observations"], by_day=False))
            for field in ("recipeRankings", "ingredientSignals"):
                output[field].extend(new_rows[field])
        elif raw_status in REFERENCE_STATES:
            source["status"] = raw_status
            # A source deliberately disabled for permission/robots reasons is
            # catalogued only, even if an obsolete package once held its data.
            source.setdefault("lastSuccessAt", old.get("lastSuccessAt"))
        else:
            source["status"] = "stale" if old_count else "missing"
            source["lastSuccessAt"] = old.get("lastSuccessAt")
            source["error"] = source.get("error") or ("本次没有返回可验证的新记录，保留此前成功快照。" if old_count else "本次没有取得可验证数据。")
            for field in FIELDS:
                for row in previous_rows[field]:
                    row["retainedFromPrevious"] = True
                    row["recordStatus"] = "stale"
                    output[field].append(row)
        if sid in warnings:
            source["validationWarnings"] = list(dict.fromkeys(warnings[sid]))[:12]
        else:
            source.pop("validationWarnings", None)
        owned = source_records(output, sid)
        dates = [row["observedDate"] for rows in owned.values() for row in rows if row.get("observedDate")]
        source["latestObservedDate"] = max(dates) if dates else None
        source["recordCounts"] = {field: len(rows) for field, rows in owned.items()}
        source["hasObservedData"] = any(owned.values())
        source_list.append(source)
    good = sum(s["status"] == "ok" for s in source_list)
    failed = sum(s["status"] in ("stale", "missing") for s in source_list)
    partial = sum(s["status"] == "ok" and (s.get("collectionStatus") == "partial" or s.get("partial") is True or bool(s.get("failures")) or bool(s.get("validationWarnings"))) for s in source_list)
    successes = [s.get("lastSuccessAt") for s in source_list if s.get("lastSuccessAt") and s.get("hasObservedData")]
    attempts = [s.get("lastAttemptAt") for s in source_list if s.get("lastAttemptAt") and s["status"] not in REFERENCE_STATES]
    latest = {
        "schemaVersion": SCHEMA, "dataMode": "observed_public_sources", "isSynthetic": False,
        "generatedAt": attempted_at, "lastAttemptAt": max(attempts) if attempts else None,
        "lastSuccessfulAt": max(successes) if successes else None,
        "timezone": "Asia/Shanghai", "status": "ok" if good and not failed and not partial else "partial" if good else "stale" if any(output.values()) else "missing",
        "schedule": {"timezone": "Asia/Shanghai", "times": ["08:25", "17:25"], "cronUtc": "25 0,9 * * *", "mode": "scheduled_snapshot", "notice": "每天两次检查公开来源；源数据按其日/周周期发布。GitHub 调度可能延迟，页面刷新只读取已发布快照。"},
        "sources": source_list, **output,
        "methodology": {"price": "保留原文日期和批发/零售口径；市场样本不代表全省平均或消费者零售价。", "popularity": "仅报告原平台顺位及明确的观测指标，不把评分、浏览量、搜索量和销量混称为统一热度。", "missing": "未取得地区/食材数据时显示缺失；失败来源保留原日期旧快照，不使用合成数据补齐。", "weekly": "近7天价格只在同来源、同食材、同市场、同单位、同口径内按可用日价求均值，并公开样本日数；不对榜单顺位或未知榜期制造周趋势。"},
    }
    latest["contentVersion"] = content_version(latest)
    latest["lastContentChangeAt"] = previous.get("lastContentChangeAt", attempted_at) if previous.get("contentVersion") == latest["contentVersion"] else attempted_at
    connected = {source['id'] for source in source_list if source['status'] == 'ok'}
    history_accepted = {field: [row for row in accepted[field] if row['sourceId'] in connected] for field in FIELDS}
    history = merge_history(previous_history, latest, history_accepted, clock)
    latest["weeklyPrices"] = seven_day_prices(history["observations"], clock)
    latest["dailyPriceSummaries"], latest["weeklyPriceSummaries"] = regional_summaries(history["observations"], clock)
    latest["nationalDailyPriceSummaries"] = national_daily_summaries(history["observations"], clock)
    latest["history"] = {"url": "./data/history.json", "retentionDays": RETENTION_DAYS, "priceObservationCount": len(history["observations"]), "recipeSnapshotCount": len(history["recipeSnapshots"])}
    latest["summary"] = {"status": latest["status"], "connectedSources": good, "failedSources": failed, "partialSources": partial, "referenceSources": sum(s["status"] in REFERENCE_STATES for s in source_list), "priceQuotes": len(latest["observations"]), "rankedRecipes": len(latest["recipeRankings"]), "ingredientSignals": len(latest["ingredientSignals"])}
    return latest, history


def run_adapter(module_name: str, clock: datetime, previous: dict) -> dict:
    try:
        module = importlib.import_module(module_name)
        result = module.collect(now=clock)
        if not isinstance(result, dict):
            raise ValueError("collector 返回类型不是对象")
        for source in result.get("sources", []):
            source["collector"] = module_name
        return result
    except Exception as exc:
        known = [copy.deepcopy(row) for row in previous.get("sources", []) if row.get("collector") == module_name]
        if not known:
            known = [{"id": module_name, "name": "价格数据采集器" if module_name == "collect_prices" else "菜谱与食材关注数据采集器", "collector": module_name}]
        for source in known:
            if source.get("status") in REFERENCE_STATES:
                continue
            source["status"] = "error"
            source["lastAttemptAt"] = stamp(clock)
            source["error"] = f"{type(exc).__name__}: {str(exc)[:350]}"
        return {"sources": known}


def read_json(path: Path, fallback: dict) -> dict:
    if not path.exists():
        return copy.deepcopy(fallback)
    # Corrupt cached data is a failure, not an excuse to erase it silently.
    with path.open(encoding="utf-8") as handle:
        result = json.load(handle)
    if not isinstance(result, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return result


def atomic_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--from-seeds", action="store_true", help="Merge verified saved collector outputs without network; preserves their actual capture times.")
    parser.add_argument("--now", help="Explicit clock for reproducible fixture verification; normal updates use the current Asia/Shanghai time.")
    args = parser.parse_args()
    clock = instant(args.now)
    previous = read_json(args.data_dir / "latest.json", {})
    previous_history = read_json(args.data_dir / "history.json", {})
    if args.from_seeds:
        results = []
        for name, collector in (("price-seed.json", "collect_prices"), ("popularity-seed.json", "collect_popularity")):
            result = read_json(args.data_dir / name, {})
            for source in result.get('sources', []):
                source['collector'] = collector
            results.append(result)
    else:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(run_adapter, name, clock, previous) for name in ("collect_prices", "collect_popularity")]
            results = [future.result() for future in futures]
    latest, history = build_dataset(previous, results, previous_history, clock)
    text = json.dumps(latest, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    history_text = json.dumps(history, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    atomic_text(args.data_dir / "history.json", history_text)
    atomic_text(args.data_dir / "latest.json", text)
    inline = json.dumps(latest, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("</", "<\\/")
    atomic_text(args.data_dir / "latest.js", "/* Published public-source snapshot. Not a live upstream API call. */\n" + "globalThis.ObservedFoodData = " + inline + ";\n")
    print(json.dumps({"status": latest["status"], "generatedAt": latest["generatedAt"], "lastSuccessfulAt": latest["lastSuccessfulAt"], "contentVersion": latest["contentVersion"], **latest["summary"]}, ensure_ascii=False))
    for source in latest["sources"]:
        print(f"{source['id']}: {source['status']} | observed={source.get('latestObservedDate')} | {source.get('error', '')}")
    # Upstream failures are represented in the published state; syntax/cache
    # integrity errors still fail the process before overwriting any valid file.
    return 0


if __name__ == "__main__":
    sys.exit(main())
