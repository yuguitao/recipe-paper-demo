#!/usr/bin/env python3
"""Collect small, attributed factual quotations from MOFCOM's public daily table.

No API key, login, hidden API, browser impersonation, or full-page republication.
The Ministry of Agriculture is a reference-only source until authorized.
Python 3.9+; standard library only. Run once daily, not on each page visit.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.robotparser import RobotFileParser
from zoneinfo import ZoneInfo


SOURCE_ID = "mofcom-daily-market"
ORIGIN = "https://cif.mofcom.gov.cn"
DIRECTORY_URL = ORIGIN + "/cif/seach.fhtml?commdityid=170010"
TERMS_URL = "https://www.mofcom.gov.cn/fzlm/wzsm/index.html"
ABOUT_URL = ORIGIN + "/cif/html/about/index.html"
USER_AGENT = "RecipeResearch/0.3 (+https://yuguitao.github.io/recipe-paper-demo/)"
CHINA_TZ = ZoneInfo("Asia/Shanghai")
MAX_RESPONSE_BYTES = 2_000_000

# Match link labels in the visible official commodity directory. Codes are not guessed.
# Meat cuts retain distinct IDs: whole carcass/leg prices are not boneless meat prices.
COMMODITIES = (
    ("tomato", "西红柿"), ("cucumber", "黄瓜"), ("potato", "土豆"),
    ("cabbage", "圆白菜"), ("egg", "鲜鸡蛋"), ("whole_chicken", "白条鸡"),
    ("lotus", "莲藕"), ("eggplant", "茄子"), ("pepper", "青椒"),
    ("wintermelon", "冬瓜"), ("broccoli", "西兰花"), ("onion", "洋葱"),
    ("scallion", "大葱"), ("chive", "韭菜"), ("ginger", "生姜"),
    ("beef_leg", "牛腿肉"),
)
PROVINCES = {
    "北京市": "110000", "天津市": "120000", "河北省": "130000",
    "山西省": "140000", "内蒙古自治区": "150000", "辽宁省": "210000",
    "吉林省": "220000", "黑龙江省": "230000", "上海市": "310000",
    "江苏省": "320000", "浙江省": "330000", "安徽省": "340000",
    "福建省": "350000", "江西省": "360000", "山东省": "370000",
    "河南省": "410000", "湖北省": "420000", "湖南省": "430000",
    "广东省": "440000", "广西壮族自治区": "450000", "海南省": "460000",
    "重庆市": "500000", "四川省": "510000", "贵州省": "520000",
    "云南省": "530000", "西藏自治区": "540000", "陕西省": "610000",
    "甘肃省": "620000", "青海省": "630000", "宁夏回族自治区": "640000",
    "新疆维吾尔自治区": "650000", "新疆生产建设兵团": "650000",
}


def _utc_now(now=None):
    if now is None:
        return datetime.now(timezone.utc)
    if isinstance(now, str):
        now = datetime.fromisoformat(now.replace("Z", "+00:00"))
    if not isinstance(now, datetime):
        raise TypeError("now must be a datetime or an ISO datetime string")
    return now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now.astimezone(timezone.utc)


def _iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _clean(value):
    return re.sub(r"\s+", " ", value).strip()


class AccessBlocked(RuntimeError):
    """Stop this source; do not change identity or try an alternate endpoint."""


class OfficialRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urlsplit(newurl)
        if parts.scheme != "https" or parts.netloc != "cif.mofcom.gov.cn":
            raise AccessBlocked("Unexpected redirect outside the verified official HTTPS host")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class PublicClient:
    """One robots check, serial polite requests, no retries or authentication."""

    def __init__(self, timeout=20):
        self.timeout = timeout
        self.opener = build_opener(OfficialRedirects())
        self.robots = None
        self.robots_status = "not_checked"
        self.interval = 1.0
        self.previous_request = 0.0
        self.request_count = 0

    def _get(self, url):
        if self.request_count >= 17:
            raise AccessBlocked("Per-run request budget reached")
        wait = self.interval - (time.monotonic() - self.previous_request)
        if wait > 0:
            time.sleep(wait)
        self.previous_request = time.monotonic()
        self.request_count += 1
        request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,text/plain"})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise ValueError("Public page exceeds the expected size limit")
                charset = response.headers.get_content_charset() or "utf-8"
                content = raw.decode(charset, errors="strict")
                if re.search(r"请输入验证码|请完成.{0,8}验证|人机验证|verify you are human|access denied", content, re.I):
                    raise AccessBlocked("Official source requires access verification; collection stopped")
                return content, sha256(raw).hexdigest()
        except HTTPError as exc:
            if exc.code in (401, 403, 429):
                raise AccessBlocked("Official source returned HTTP %s; collection stopped" % exc.code) from exc
            raise

    def check_robots(self):
        robots_url = ORIGIN + "/robots.txt"
        try:
            content, _ = self._get(robots_url)
        except HTTPError as exc:
            if exc.code not in (404, 410):
                raise
            self.robots_status = "not_published_http_%s" % exc.code
            return
        if "<html" in content.lower():
            raise AccessBlocked("robots.txt returned HTML; access rules could not be verified")
        self.robots = RobotFileParser(robots_url)
        self.robots.parse(content.splitlines())
        self.robots_status = "checked"
        delay = self.robots.crawl_delay(USER_AGENT) or self.robots.crawl_delay("*")
        if delay:
            if delay > 60:
                raise AccessBlocked("robots.txt crawl delay exceeds this collector's time budget")
            self.interval = max(self.interval, float(delay))
        rate = self.robots.request_rate(USER_AGENT) or self.robots.request_rate("*")
        if rate:
            self.interval = max(self.interval, rate.seconds / rate.requests)

    def get(self, url):
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.netloc != "cif.mofcom.gov.cn":
            raise ValueError("Only verified official MOFCOM HTTPS links are accepted")
        if self.robots and not self.robots.can_fetch(USER_AGENT, url):
            raise AccessBlocked("robots.txt disallows this public table")
        return self._get(url)


class DailyTableParser(HTMLParser):
    """Read visible links, heading and the one price table; ignore scripts."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.text = []
        self.rows = []
        self._link = None
        self._link_text = []
        self._target_depth = 0
        self._row = None
        self._row_links = []
        self._cell = None
        self._ignore_depth = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "style"):
            self._ignore_depth += 1
        if tag == "a":
            self._link = attrs.get("href")
            self._link_text = []
            if self._row is not None and self._link:
                self._row_links.append(self._link)
        if tag == "table":
            if attrs.get("id") == "goaler" or self._target_depth:
                self._target_depth += 1
        if self._target_depth and tag == "tr":
            self._row = []
            self._row_links = []
        if self._target_depth and tag in ("td", "th"):
            self._cell = []

    def handle_data(self, data):
        if self._ignore_depth:
            return
        self.text.append(data)
        if self._link:
            self._link_text.append(data)
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._ignore_depth:
            self._ignore_depth -= 1
        if tag == "a":
            if self._link:
                self.links.append((_clean("".join(self._link_text)), self._link))
            self._link = None
            self._link_text = []
        if self._target_depth and tag in ("td", "th") and self._cell is not None:
            if self._row is not None:
                self._row.append(_clean("".join(self._cell)))
            self._cell = None
        if self._target_depth and tag == "tr" and self._row is not None:
            self.rows.append((self._row, self._row_links))
            self._row = None
        if tag == "table" and self._target_depth:
            self._target_depth -= 1


def _parse(html):
    parser = DailyTableParser()
    parser.feed(html)
    parser.close()
    return parser


def discover_commodities(html):
    """Return only commodity URLs actually linked in the public directory."""
    result = {}
    for label, href in _parse(html).links:
        url = urljoin(DIRECTORY_URL, href)
        parts = urlsplit(url)
        params = parse_qs(parts.query)
        if (parts.scheme == "https" and parts.netloc == "cif.mofcom.gov.cn"
                and parts.path == "/cif/seach.fhtml"
                and re.fullmatch(r"\d+", params.get("commdityid", [""])[0])):
            result[label] = url
    return result


def _number(text):
    try:
        value = Decimal(text.replace(",", "").replace("%", ""))
    except (InvalidOperation, AttributeError):
        return None
    return value if value.is_finite() else None


def parse_daily_table(html, item_id, item_name, source_url, fetched_at, today=None):
    """Return validated observations and diagnostics from one public HTML page."""
    parser = _parse(html)
    visible = _clean(" ".join(parser.text))
    match = re.search(r"(\d{4}-\d{1,2}-\d{1,2})\s*([^\s<>]+?)批发价格行情", visible)
    if not match or match.group(2) != item_name:
        raise ValueError("Missing or unexpected commodity/date heading for " + item_name)
    observed = date.fromisoformat(match.group(1))
    if today is not None and observed > today:
        raise ValueError("The source heading is dated in the future")
    if not re.search(r"单位\s*[:：]\s*元\s*/\s*公斤", visible):
        raise ValueError("Unrecognized source unit; no implicit conversion performed")
    if not parser.rows or parser.rows[0][0][:5] != ["地区", "市场", "当日价格", "前一日价格", "环比"]:
        raise ValueError("Daily table headers changed; refusing positional interpretation")

    records = []
    warnings = []
    seen = set()
    market_names = {}
    duplicate_count = 0
    missing_count = 0
    for cells, links in parser.rows[1:]:
        if len(cells) < 5:
            warnings.append("Ignored incomplete table row")
            continue
        source_region, market, price_text, prior_text, change_text = cells[:5]
        province_id = PROVINCES.get(source_region)
        if not province_id or not market:
            warnings.append("Ignored unrecognized region: " + source_region)
            continue
        price = _number(price_text)
        if price is None or price <= 0 or price > 10000:
            missing_count += 1
            continue
        graph = next((urljoin(source_url, link) for link in links
                      if urlsplit(urljoin(source_url, link)).path == "/cif/seachline.fhtml"), None)
        graph_params = parse_qs(urlsplit(graph).query) if graph else {}
        market_id = graph_params.get("enterid", [None])[0]
        if not market_id or not re.fullmatch(r"\d+", market_id):
            warnings.append("Ignored market without a stable source identifier: " + market)
            continue
        if graph_params.get("Edate", [observed.isoformat()])[0] != observed.isoformat():
            raise ValueError("Row date differs from the table heading")
        key = (observed.isoformat(), item_id, market_id)
        if key in seen:
            # Official table can repeat a Xinjiang market under both Xinjiang and XPCC.
            duplicate_count += 1
            continue
        seen.add(key)
        province = "新疆维吾尔自治区" if source_region == "新疆生产建设兵团" else source_region
        stable = "|".join((SOURCE_ID,) + key)
        record = {
            "id": "price-" + sha256(stable.encode()).hexdigest()[:24],
            "sourceId": SOURCE_ID, "kind": "price", "itemId": item_id,
            "itemName": item_name, "value": float(price), "unit": "CNY/kg",
            "originalUnit": "元/公斤", "priceType": "wholesale",
            "geography": {"level": "market", "provinceId": province_id,
                          "province": province, "market": market, "marketId": market_id,
                          "sourceRegion": source_region},
            "observedDate": observed.isoformat(), "fetchedAt": fetched_at,
            "sourceUrl": source_url, "isSynthetic": False,
        }
        if graph:
            record["detailUrl"] = graph
        prior = _number(prior_text)
        if prior is not None and prior > 0 and prior <= 10000:
            record["priorValue"] = float(prior)
            record["changePct"] = float(((price - prior) / prior * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        raw_change = _number(change_text)
        if raw_change is not None:
            record["sourceChangePct"] = float(raw_change)
        # A market may have different directory IDs under Xinjiang and XPCC.
        # Collapse an identical quote from the same named market in the same province.
        name_key = (province_id, market)
        existing = market_names.get(name_key)
        if existing is not None:
            if (existing["value"], existing.get("priorValue")) == (record["value"], record.get("priorValue")):
                aliases = existing["geography"].setdefault("sourceMarketIds", [existing["geography"]["marketId"]])
                if market_id not in aliases:
                    aliases.append(market_id)
                duplicate_count += 1
                continue
            warnings.append("Conflicting same-name market quotations; retaining separate source IDs: " + market)
        else:
            market_names[name_key] = record
        records.append(record)
    if not records:
        raise ValueError("No valid market quotations in " + item_name + " table")
    return records, {
        "observedDate": observed.isoformat(), "rows": len(records),
        "duplicateRowsRemoved": duplicate_count, "missingPriceRows": missing_count,
        "warnings": sorted(set(warnings)),
    }


def source_registry():
    return [
        {
            "id": SOURCE_ID, "name": "商务部商务预报 · 百家日报",
            "operator": "中华人民共和国商务部 / 商务部市场运行和消费促进司",
            "url": DIRECTORY_URL, "aboutUrl": ABOUT_URL, "termsUrl": TERMS_URL,
            "kind": "price", "updateFrequency": "daily",
            "coverage": "公开表内有报价的农产品批发市场；各品类、地区、日期覆盖不等",
            "methodology": "读取公开日度表中的市场当日价、前一日价；原单位元/公斤。页面日期为行情日期，抓取时间单独保留。",
            "access": "公开 HTML，低频定时读取；未使用登录、私有接口或声称获得开放 API 授权。",
            "attribution": "文章来源：商务部网站；数据栏目：商务预报·百家日报",
            "reuse": "按商务部网站声明注明来源；只保存必要事实值、日期、市场名和原链接，不镜像全文、图表或页面。",
            "robotsUrl": ORIGIN + "/robots.txt", "robotsStatus": "not_checked",
            "status": "unavailable", "lastSuccessAt": None,
            "changeMethodology": "changePct=(当日价−前一日价)/前一日价×100%；sourceChangePct 原样保留表内‘环比’，两者可能不一致。",
            "limitations": [
                "批发报价不是居民零售价；不代表消费者最终成交价。",
                "省内样本中位数由本站计算，须显示市场样本数，不能称官方省均价。",
                "前一日价格未附独立日期，不据此伪造上一日历史观测。",
                "缺报价的地区/品类保留缺失，不用邻省、全国价或合成数值补齐。",
                "白条鸡、牛腿肉保留明确品名，不等同于任意鸡肉、牛肉部位。",
            ],
        },
        {
            "id": "moa-wholesale-daily", "name": "农业农村部 · 农产品批发价格日度通报",
            "operator": "中华人民共和国农业农村部市场与信息化司",
            "url": "https://scs.moa.gov.cn/jcyj/", "kind": "price",
            "updateFrequency": "daily", "coverage": "全国重点监测农产品批发市场汇总",
            "methodology": "官方全国监测通报可用于人工核验；尚未自动接入本站数据。",
            "access": "仅提供官方栏目链接；网站声明涉及内容与数据复制、摘编、传播的书面授权要求。",
            "termsUrl": "https://www.moa.gov.cn/sy_23468/homeinfo/wzsm/",
            "status": "authorization_required", "lastSuccessAt": None,
            "error": "未取得适用于本站自动转载数据的授权，当前不抓取、存储或发布该源报价。",
        },
    ]


def collect(now=None):
    """Fetch the latest published cross-section. Source failures never erase history."""
    instant = _utc_now(now)
    fetched_at = _iso(instant)
    sources = source_registry()
    source = sources[0]
    client = PublicClient()
    observations = []
    failures = []
    pages = []
    source["lastAttemptAt"] = fetched_at
    try:
        client.check_robots()
        source["robotsStatus"] = client.robots_status
        directory, directory_hash = client.get(DIRECTORY_URL)
        directory_links = discover_commodities(directory)
        if not directory_links:
            raise ValueError("No public commodity links found; directory structure may have changed")
        for item_id, item_name in COMMODITIES:
            url = directory_links.get(item_name)
            if not url:
                failures.append({"itemId": item_id, "itemName": item_name, "error": "Commodity not linked in public directory"})
                continue
            try:
                html, content_hash = ((directory, directory_hash) if url == DIRECTORY_URL else client.get(url))
                records, report = parse_daily_table(html, item_id, item_name, url, fetched_at, instant.astimezone(CHINA_TZ).date())
                observations.extend(records)
                pages.append({"itemId": item_id, "itemName": item_name, "url": url,
                              "sha256": content_hash, **report})
            except AccessBlocked:
                raise
            except (HTTPError, URLError, OSError, ValueError) as exc:
                failures.append({"itemId": item_id, "itemName": item_name, "url": url, "error": str(exc)[:300]})
    except (AccessBlocked, HTTPError, URLError, OSError, ValueError) as exc:
        failures.append({"error": str(exc)[:300]})

    source["robotsStatus"] = client.robots_status
    source["requestCount"] = client.request_count
    source["pages"] = pages
    source["expectedCommodityCount"] = len(COMMODITIES)
    source["collectedCommodityCount"] = len(pages)
    source["observationCount"] = len(observations)
    if observations:
        source["status"] = "ok"
        source["lastSuccessAt"] = fetched_at
        source["latestObservedDate"] = max(row["observedDate"] for row in observations)
        source["provinceCount"] = len({row["geography"]["provinceId"] for row in observations})
        source["marketCount"] = len({row["geography"]["marketId"] for row in observations})
    else:
        source["status"] = "error"
    if failures:
        source["failures"] = failures
        source["error"] = "; ".join(failure["error"] for failure in failures)[:1200]
        source["partial"] = bool(observations)
    observations.sort(key=lambda row: (row["observedDate"], row["itemId"], row["geography"]["provinceId"], row["geography"]["marketId"]))
    return {"sources": sources, "observations": observations}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write JSON to this path; default stdout")
    args = parser.parse_args(argv)
    payload = collect()
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    else:
        sys.stdout.write(serialized)
    active = payload["sources"][0]
    print("%s: %s; %s observations from %s commodities" % (
        SOURCE_ID, active["status"], len(payload["observations"]), active["collectedCommodityCount"]
    ), file=sys.stderr)
    return 0 if payload["observations"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
