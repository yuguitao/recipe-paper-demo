#!/usr/bin/env python3
"""Collect small, attributable public recipe-list snapshots (stdlib only).

Only two allowlisted listing pages are downloaded. No login, browser spoofing,
private APIs, recipe instructions, images, pagination or anti-bot bypass is used.
Robots are checked on every run, and declared crawl delays are respected.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser
from zoneinfo import ZoneInfo


USER_AGENT = "RecipeResearchDemo/0.3 (+https://github.com/yuguitao/recipe-paper-demo)"
BOT_NAME = "RecipeResearchDemo"
LOCAL_ZONE = ZoneInfo("Asia/Shanghai")
MAX_BYTES = 1_500_000
TIMEOUT = 25
SOURCE_URLS = {
    "xiachufang_weekly": "https://www.xiachufang.com/explore/",
    "meishichina_current": "https://home.meishichina.com/show-top-type-recipe.html",
}


class SourceError(RuntimeError):
    pass


class Node:
    def __init__(self, tag="root", attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def has_class(self, name):
        return name in self.attrs.get("class", "").split()

    def nodes(self, tag=None, class_name=None):
        for child in self.children:
            if not isinstance(child, Node):
                continue
            if (tag is None or child.tag == tag) and (
                class_name is None or child.has_class(class_name)
            ):
                yield child
            yield from child.nodes(tag, class_name)

    def text(self):
        return "".join(c.text() if isinstance(c, Node) else c for c in self.children)


class TreeParser(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def clean(text):
    return re.sub(r"\s+", " ", text).strip()


def first(node, tag=None, class_name=None):
    return next(node.nodes(tag, class_name), None)


def parse_tree(html):
    parser = TreeParser()
    parser.feed(html)
    return parser.root


def as_datetime(now=None):
    if now is None:
        return datetime.now(timezone.utc)
    if isinstance(now, str):
        now = datetime.fromisoformat(now.replace("Z", "+00:00"))
    if not isinstance(now, datetime):
        raise TypeError("now must be datetime, ISO 8601 string, or None")
    return now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now


def iso(now):
    return now.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class PublicPageClient:
    """One host / one listing. Stop on access denial; no evasive retry."""

    def __init__(self, url):
        self.url = url
        parts = urlsplit(url)
        self.host = parts.netloc
        self.robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
        self.last_request = None
        self.delay = 1.0
        self.audit = {"url": self.robots_url, "allowed": False, "crawlDelaySeconds": None}

    def _read(self, url):
        if self.last_request is not None:
            pause = self.delay - (time.monotonic() - self.last_request)
            if pause > 0:
                time.sleep(pause)
        self.last_request = time.monotonic()
        request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,text/plain;q=0.9,*/*;q=0.2"})
        try:
            with urlopen(request, timeout=TIMEOUT) as response:
                # Redirects to login/challenge or a new host are not valid data.
                final_url = response.geturl()
                if urlsplit(final_url).netloc != self.host:
                    raise SourceError("页面重定向到其他主机，停止采集")
                if any(word in urlsplit(final_url).path.lower() for word in ("login", "captcha", "/auth/")):
                    raise SourceError("页面要求登录或验证，停止采集")
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise SourceError("页面超过允许大小，停止采集")
                charset = response.headers.get_content_charset() or "utf-8"
                return raw.decode(charset, errors="replace")
        except HTTPError as exc:
            raise SourceError(f"HTTP {exc.code}；未尝试绕过访问限制") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise SourceError(f"公开页面获取失败：{type(exc).__name__}") from exc

    def get(self):
        robots_text = self._read(self.robots_url)
        # A challenge page in place of robots is not permission to crawl.
        if not re.search(r"^\s*User-agent\s*:", robots_text, re.I | re.M):
            raise SourceError("无法确认 robots.txt 规则，停止自动采集")
        rules = RobotFileParser(self.robots_url)
        rules.parse(robots_text.splitlines())
        allowed = rules.can_fetch(BOT_NAME, self.url)
        delay = rules.crawl_delay(BOT_NAME)
        self.audit.update({"allowed": allowed, "crawlDelaySeconds": delay or 0})
        if not allowed:
            raise SourceError("robots.txt 不允许此页面的自动采集")
        if delay and delay > 60:
            raise SourceError("来源要求超过 60 秒的访问间隔，本轮不请求页面")
        self.delay = max(1.0, float(delay or 0))
        return self._read(self.url)


def base_record(source_id, title, link, recipe_id, rank, fetched_at, window):
    moment = as_datetime(fetched_at)
    return {
        "id": f"{source_id}:{recipe_id}",
        "sourceId": source_id,
        "recipeId": str(recipe_id),
        "title": title,
        "sourceUrl": link,
        "listingUrl": SOURCE_URLS[source_id],
        "rank": rank,
        "rankMeaning": "此榜单首页的展示顺位；平台排序公式未披露，不等于作品数或收藏数排序",
        "window": dict(window),
        "observedDate": None,
        "capturedDate": moment.astimezone(LOCAL_ZONE).date().isoformat(),
        "periodDateKnown": False,
        "fetchedAt": fetched_at,
        "ingredients": [],
        "isSynthetic": False,
    }


def parse_xiachufang(html, fetched_at):
    source_id = "xiachufang_weekly"
    root = parse_tree(html)
    heading = first(root, "h1")
    listing = first(root, "div", "normal-recipe-list")
    if not heading or "本周最受欢迎" not in heading.text() or listing is None:
        raise SourceError("榜单标题或结构变化，停止解析以免误标热度")
    window = {"type": "weekly", "label": "平台标注：本周最受欢迎；未公布准确起讫日期", "start": None, "end": None}
    rows = []
    for block in listing.nodes("div", "recipe"):
        name = first(block, "p", "name")
        anchor = first(name, "a") if name else None
        ingredient_node = first(block, "p", "ing")
        stats = first(block, "p", "stats")
        if anchor is None or ingredient_node is None:
            raise SourceError("榜单条目缺少名称或公开食材字段，停止解析")
        match = re.fullmatch(r"/recipe/(\d+)/", anchor.attrs.get("href", ""))
        if not match:
            raise SourceError("出现未知菜谱链接结构，停止解析")
        title = clean(anchor.text())
        row = base_record(source_id, title, urljoin(SOURCE_URLS[source_id], anchor.attrs["href"]), match[1], len(rows) + 1, fetched_at, window)
        # The list includes unlinked ingredient text as well as category links.
        row["ingredients"] = [clean(x) for x in re.split(r"[、，,；;]", ingredient_node.text()) if clean(x)]
        work_match = re.search(r"七天内\s*([\d,]+)\s*人做过", clean(stats.text()) if stats else "")
        row["workCount"] = int(work_match[1].replace(",", "")) if work_match else None
        row["workCountMeaning"] = "平台展示的七天内做过人数；不是浏览量、搜索量或评分"
        row["workCountWindow"] = "平台标注：七天内做过；准确起讫日期未知"
        rows.append(row)
    validate_rows(rows, 5, 40)
    return rows


def parse_meishichina(html, fetched_at):
    source_id = "meishichina_current"
    root = parse_tree(html)
    heading = next((node for node in root.nodes("h1") if "当季最热" in node.text()), None)
    listing = first(root, "ul", "alist")
    if not heading or "当季最热" not in heading.text() or listing is None:
        raise SourceError("榜单标题或结构变化，停止解析以免误标热度")
    window = {"type": "platform_current", "label": "平台标注：当季最热；未公布具体周期及起讫日期", "start": None, "end": None}
    rows = []
    for block in listing.nodes("li"):
        heading = first(block, "h2")
        anchor = first(heading, "a") if heading else None
        ingredient_node = first(block, "div", "subcontent")
        counts = first(block, "div", "subline")
        if anchor is None or ingredient_node is None:
            continue
        link = anchor.attrs.get("href", "")
        match = re.fullmatch(r"https://home\.meishichina\.com/recipe-(\d+)\.html", link)
        if not match:
            raise SourceError("出现未知菜谱链接结构，停止解析")
        row = base_record(source_id, clean(anchor.text()), link, match[1], len(rows) + 1, fetched_at, window)
        ingredient_text = re.sub(r"^原料[：:]", "", clean(ingredient_node.text())).rstrip("。.")
        row["ingredients"] = [clean(x) for x in re.split(r"[、，,；;]", ingredient_text) if clean(x)]
        count_match = re.search(r"([\d,]+)\s*人收藏", clean(counts.text()) if counts else "")
        row["collectionCount"] = int(count_match[1].replace(",", "")) if count_match else None
        row["collectionCountMeaning"] = "来源页面展示的收藏人数；累计范围未披露，不解读为本周新增收藏"
        rows.append(row)
    validate_rows(rows, 5, 30)
    return rows


def validate_rows(rows, minimum, maximum):
    if not minimum <= len(rows) <= maximum:
        raise SourceError(f"榜单条目数异常：{len(rows)}，不发布不完整或误解析的数据")
    if len({row["id"] for row in rows}) != len(rows):
        raise SourceError("榜单存在重复菜谱标识，停止发布该来源")


# Conservative explicit matching of listed ingredient fields, not title inference.
# Broad ingredient groups are intentional and documented; raw names stay intact.
INGREDIENT_GROUPS = [
    ("bass", "鲈鱼", ["鲈鱼"]),
    ("tomato", "番茄", ["番茄", "西红柿"]),
    ("egg", "鸡蛋", ["鸡蛋", "土鸡蛋"]),
    ("chicken", "鸡肉（含鸡翅）", ["鸡肉", "鸡翅", "鸡翅中", "鸡胸肉", "鸡腿", "鸡腿肉"]),
    ("shiitake", "香菇", ["香菇", "鲜香菇", "干香菇"]),
    ("tofu", "豆腐", ["豆腐", "嫩豆腐", "老豆腐", "北豆腐", "南豆腐"]),
    ("beef", "牛肉", ["牛肉", "牛腩", "牛里脊"]),
    ("broccoli", "西兰花", ["西兰花", "西蓝花"]),
    ("shrimp", "虾（含虾仁）", ["虾", "鲜虾", "大虾", "基围虾", "虾仁"]),
    ("lotus", "莲藕", ["莲藕", "藕"]),
    ("ribs", "排骨", ["排骨", "猪排骨", "肋排"]),
    ("noodles", "面条", ["面条", "挂面", "鲜面条", "手擀面"]),
    ("scallion", "葱", ["葱", "小葱", "大葱", "葱花", "香葱"]),
    ("kingoyster", "杏鲍菇", ["杏鲍菇"]),
    ("onion", "洋葱", ["洋葱", "紫洋葱"]),
    ("yam", "山药", ["山药", "铁棍山药"]),
    ("wood-ear", "木耳", ["木耳", "黑木耳", "干木耳", "泡发木耳"]),
    ("peanut", "花生", ["花生", "花生米", "鲜花生", "带壳花生"]),
    ("pepper", "青椒", ["青椒", "绿椒"]),
    ("pumpkin", "南瓜", ["南瓜"]),
    ("oats", "燕麦", ["燕麦", "燕麦片"]),
    ("milk", "牛奶", ["牛奶", "纯牛奶"]),
    ("chive", "韭菜", ["韭菜"]),
    ("asparagus", "芦笋", ["芦笋"]),
    ("wintermelon", "冬瓜", ["冬瓜"]),
    ("eggplant", "茄子", ["茄子", "长茄子", "圆茄子"]),
    ("potato", "土豆", ["土豆", "马铃薯"]),
    ("carrot", "胡萝卜", ["胡萝卜"]),
    ("cucumber", "黄瓜", ["黄瓜"]),
    ("loofah", "丝瓜", ["丝瓜"]),
    ("cabbage", "白菜（含娃娃菜）", ["白菜", "大白菜", "娃娃菜"]),
    ("round-cabbage", "包菜", ["包菜", "卷心菜", "圆白菜"]),
    ("zucchini", "西葫芦", ["西葫芦"]),
    ("radish", "白萝卜", ["白萝卜"]),
    ("bean-sprout", "豆芽", ["豆芽", "绿豆芽", "黄豆芽"]),
    ("rice", "大米", ["大米", "米饭"]),
    ("corn", "玉米", ["玉米", "甜玉米"]),
    ("enoki", "金针菇", ["金针菇"]),
    ("lemon", "柠檬", ["柠檬", "青柠檬", "黄柠檬"]),
    ("passionfruit", "百香果", ["百香果"]),
]
ALIASES = {alias: (ingredient_id, name) for ingredient_id, name, aliases in INGREDIENT_GROUPS for alias in aliases}


def derive_ingredient_signals(rankings):
    signals = []
    for source_id in SOURCE_URLS:
        sample = [row for row in rankings if row["sourceId"] == source_id]
        if not sample:
            continue
        matched = {}
        for recipe in sample:
            recipe_hits = {}
            for raw in recipe["ingredients"]:
                # Explanations in parentheses may be removed; no fuzzy word match.
                name = re.sub(r"[（(].*?[）)]", "", raw).strip()
                if name in ALIASES:
                    ingredient_id, canonical_name = ALIASES[name]
                    recipe_hits[ingredient_id] = canonical_name
            for ingredient_id, name in recipe_hits.items():
                hit = matched.setdefault(ingredient_id, {"name": name, "recipes": []})
                hit["recipes"].append(recipe["id"])
        for ingredient_id, hit in sorted(matched.items(), key=lambda item: (-len(item[1]["recipes"]), item[0])):
            signals.append({
                "id": f"{source_id}:ingredient:{ingredient_id}",
                "sourceId": source_id,
                "sourceUrl": SOURCE_URLS[source_id],
                "ingredientId": ingredient_id,
                "name": hit["name"],
                "metric": "ranked_recipe_ingredient_mentions",
                "value": len(hit["recipes"]),
                "unit": "recipes",
                "sampleSize": len(sample),
                "sharePct": round(100 * len(hit["recipes"]) / len(sample), 2),
                "sourceRecipeIds": hit["recipes"],
                "window": dict(sample[0]["window"]),
                "observedDate": None,
                "capturedDate": sample[0]["capturedDate"],
                "periodDateKnown": False,
                "fetchedAt": sample[0]["fetchedAt"],
                "method": "从来源榜单首页公开食材字段按显式同义词表匹配，每道菜对同一食材最多计一次；分母为该来源本次首页菜谱数。两平台分别计算，未按作品数或收藏数加权。",
                "coverage": "仅为所采榜单首页样本的食材出现频率；不代表全国、地区、全网、搜索量或销量热度",
                "isDerived": True,
                "isSynthetic": False,
            })
    return signals


def source_catalog():
    """Status is connection state, not an endorsement of a source's accuracy."""
    return [
        {
            "id": "xiachufang_weekly", "name": "下厨房 · 本周最受欢迎", "publisher": "下厨房", "category": "recipe_popularity",
            "url": SOURCE_URLS["xiachufang_weekly"], "status": "pending", "error": None, "lastSuccessAt": None,
            "collectionMode": "公开榜单首页；每日低频检查", "refreshFrequency": "daily", "sourceFrequency": "页面标注本周；平台刷新时刻与日历起讫未披露",
            "metrics": ["榜单展示顺位", "七天内做过人数", "公开食材列表及样本出现次数"],
            "scope": "单个平台公开榜单首页；无地区维度", "limitations": "排名公式未披露；做过人数不等于浏览量或搜索量；本周不推断为已知日历周。",
            "evidenceUrl": SOURCE_URLS["xiachufang_weekly"], "automated": True,
        },
        {
            "id": "meishichina_current", "name": "美食天下 · 当季最热", "publisher": "美食天下", "category": "recipe_popularity",
            "url": SOURCE_URLS["meishichina_current"], "status": "pending", "error": None, "lastSuccessAt": None,
            "collectionMode": "公开榜单首页；每日低频检查", "refreshFrequency": "daily", "sourceFrequency": "页面标注当季；具体周期与刷新时刻未披露",
            "metrics": ["榜单展示顺位", "页面展示收藏人数", "公开食材列表及样本出现次数"],
            "scope": "单个平台公开榜单首页；无地区维度", "limitations": "不称周榜；收藏人数统计区间未披露；源食材字段可能省略或写错，原文保留且不依据标题补全。",
            "evidenceUrl": SOURCE_URLS["meishichina_current"], "automated": True,
        },
        {
            "id": "douguo_reference", "name": "豆果美食", "publisher": "豆果美食", "category": "recipe_popularity",
            "url": "https://www.douguo.com/", "status": "unavailable", "error": "2026-10-24 透明标识的公开请求返回 HTTP 403；未绕过验证或接入榜单", "lastSuccessAt": None,
            "collectionMode": "仅列候选来源，当前未接入", "refreshFrequency": "not_connected", "sourceFrequency": "未验证",
            "metrics": [], "scope": "未提供本网站数据", "limitations": "仅可跳转原站；无数据不生成热度分数。",
            "evidenceUrl": "https://www.douguo.com/", "verificationDate": "2026-10-24", "automated": False,
        },
        {
            "id": "baidu_index_reference", "name": "百度指数", "publisher": "百度", "category": "search_interest",
            "url": "https://index.baidu.com/", "status": "reference_only", "error": None, "lastSuccessAt": None,
            "collectionMode": "官方入口供核验；本项目没有获准的数据接口", "refreshFrequency": "not_connected", "sourceFrequency": "官方帮助说明每日更新",
            "metrics": ["搜索指数（尚未接入）"], "scope": "百度搜索行为的加权指数；与食谱收藏和销量口径不同",
            "limitations": "官方帮助说明大众版不支持下载、暂不提供开放 API。不得将其名称展示为本站已获取的数据。",
            "evidenceUrl": "https://index.baidu.com/Helper", "automated": False,
        },
        {
            "id": "douyin_index_reference", "name": "抖音指数（原巨量算数）", "publisher": "巨量引擎", "category": "content_interest",
            "url": "https://trendinsight.oceanengine.com/", "status": "reference_only", "error": None, "lastSuccessAt": None,
            "collectionMode": "官方产品入口；当前没有接入数据", "refreshFrequency": "not_connected", "sourceFrequency": "当前项目未验证具体指标的更新周期",
            "metrics": ["内容消费趋势（尚未接入）"], "scope": "抖音平台内容关注；不等于全国饮食需求",
            "limitations": "获取方式、授权范围和具体指标需要与平台核对；不抓取未公开接口，不把入口当成已接入数据。",
            "evidenceUrl": "https://trendinsight.oceanengine.com/", "automated": False,
        },
        {
            "id": "google_trends_reference", "name": "Google Trends API", "publisher": "Google", "category": "search_interest",
            "url": "https://trends.google.com/trends/", "status": "authorization_required", "error": None, "lastSuccessAt": None,
            "collectionMode": "官方 API Alpha 需申请访问；当前未获准接入", "refreshFrequency": "not_connected", "sourceFrequency": "官方文档列出按日、周、月、年聚合",
            "metrics": ["Google 搜索兴趣（尚未接入）"], "scope": "Google 搜索样本；不能代替中国食材消费热度",
            "limitations": "未配置官方 API 权限或凭据；不使用非官方接口来冒充已接入。",
            "evidenceUrl": "https://developers.google.com/search/apis/trends", "automated": False,
        },
        {
            "id": "wikimedia_pageviews_reference", "name": "Wikimedia Analytics · 页面浏览量", "publisher": "Wikimedia Foundation", "category": "encyclopedia_interest",
            "url": "https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/getting-started.html", "status": "reference_only", "error": None, "lastSuccessAt": None,
            "collectionMode": "已核实官方公开 API 文档；本轮未集成", "refreshFrequency": "not_connected", "sourceFrequency": "官方 API 支持按日页面浏览量",
            "metrics": ["食材百科条目浏览量（尚未接入）"], "scope": "百科关注；中文条目不等于中国境内用户",
            "limitations": "需要固定条目、处理重定向和明确浏览者口径；当前未采集任何此来源数据。",
            "evidenceUrl": "https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html", "automated": False,
        },
    ]


def collect_source(source, now=None):
    client = PublicPageClient(source["url"])
    try:
        html = client.get()
        fetched_at = iso(as_datetime(now))
        parser = parse_xiachufang if source["id"] == "xiachufang_weekly" else parse_meishichina
        rows = parser(html, fetched_at)
        source.update({"status": "ok", "error": None, "lastSuccessAt": fetched_at, "lastAttemptAt": fetched_at, "recordCount": len(rows)})
        return source, rows
    except (SourceError, ValueError, LookupError) as exc:
        source.update({"status": "error", "error": str(exc), "lastAttemptAt": iso(as_datetime(now)), "recordCount": 0})
        return source, []
    finally:
        source["robots"] = client.audit


def collect(now=None):
    sources = source_catalog()
    rankings = []
    # These two hosts are independent. Within each host, requests are sequential.
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda source: collect_source(source, now), sources[:2]))
    for index, (source, rows) in enumerate(results):
        sources[index] = source
        rankings.extend(rows)
    return {"sources": sources, "recipeRankings": rankings, "ingredientSignals": derive_ingredient_signals(rankings)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write UTF-8 JSON to this path; otherwise stdout")
    args = parser.parse_args()
    payload = collect()
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_name(args.output.name + ".tmp")
        temporary.write_text(rendered, encoding="utf-8")
        temporary.replace(args.output)
        for source in payload["sources"][:2]:
            print(f"{source['id']}: {source['status']}, {source.get('recordCount', 0)} recipes", file=sys.stderr)
    else:
        print(rendered, end="")
    # JSON records per-source failure; callers can retain their last good data.
    return 0 if payload["recipeRankings"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
