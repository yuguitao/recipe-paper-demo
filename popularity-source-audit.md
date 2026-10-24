# 菜谱关注度与食材样本信号：来源审计

核验日期：2026-10-24（北京时间）。此文件说明**已获取的数据**和**尚未接入的参考平台**，不是平台背书或全国饮食消费统计。

## 本次真实接入结果

`data/popularity-seed.json` 来自 `scripts/collect_popularity.py` 的实际公开 HTTP 获取，不是手填榜单或随机样本。

| 来源 | 实际页面口径 | 本次采样 | 本次成功获取时刻（北京时间） | 可展示指标 |
| --- | --- | --- | --- | --- |
| [下厨房：本周最受欢迎](https://www.xiachufang.com/explore/) | 页面标注“本周最受欢迎”；每条菜谱另标“七天内 N 人做过” | 首页 25 道菜谱 | 2026-10-24 10:09:07 | 首页展示顺位、七天内做过人数、食材字段 |
| [美食天下：当季最热](https://home.meishichina.com/show-top-type-recipe.html) | 目标页标注“当季最热”；每条另标“N 人收藏” | 首页 10 道菜谱 | 2026-10-24 10:08:58 | 首页展示顺位、页面收藏人数、原料字段 |

种子快照共 **35 条真实菜谱记录**、**41 条分平台的食材出现频率记录**。此计数只描述这次获取；下一次获取的条目和数量可以变化。网站刷新应读取更新后的快照与成功获取时间，不能只靠动画把旧数据显示成新数据。

### 三个需要一直保留的区别

1. **榜单顺位与人数指标不同。** 排名字段 `rank` 是源列表中的展示顺位，两个平台的排序公式均未披露；不能声称按已展示的作品数或收藏数排序。下厨房的 `workCount` 是源页“七天内做过人数”，不是评分、浏览量或搜索量。美食天下的 `collectionCount` 是源页收藏人数，其累计范围未披露，不解读为本周新增收藏。
2. **采集日期与榜单周期不同。** 下厨房没有在所采页面给出这期榜单准确起止日；美食天下目标页不是明确的日榜或周榜。两类记录都保留 `observedDate: null`、`periodDateKnown: false`、`window.start/end: null`，另用 `capturedDate` 与 `fetchedAt` 表示真实获取时刻。每天检查一次或两次不会把季榜变成日榜。
3. **网站快照与官方页面可能暂时不同。** 原站会变化，搜索引擎缓存也可能滞后。本次抓取中，美食天下第 1 项为“百香果柠檬虾”，源页收藏人数 221；此前可检索缓存中的排序和数字不同。发布的种子以实际 HTTP 获取结果为准，不用搜索摘要拼接成当前榜单。

美食天下有些入口或搜索摘要会称其链接为“一周热门”，但实际目标页的标题与栏目均为“当季最热”。采集器检查目标页面标题，展示时遵从实际页面，未擅自改成周榜。

## 食材“关注信号”如何计算

这是从菜谱榜单派生的**有限样本代理指标**，在界面适合命名为“上榜菜谱中的食材出现比例”或“榜单样本食材信号”。不称“全国食材热搜”“地区销量”“实时消费指数”。这两类源数据没有省份维度，不能均分或复制到各省后声称取得了地方热度。

每个平台单独计算：

```text
某食材的出现比例 = 含该食材的已采首页菜谱数 / 该平台本次已采首页全部菜谱数
```

- 只读取列表页提供的 `ingredients` 食材字段，不抓取详情页步骤或图片，也不根据菜名补全食材。
- 使用采集器内可审阅的 `INGREDIENT_GROUPS` 显式同义词表。比如“西红柿/番茄”归为番茄，“西蓝花/西兰花”归为西兰花；原始食材字段一直保留。
- 同一道菜中同一食材最多计 1 次；分母为该平台完整采到的首页样本数。两平台样本不混为一个全国样本，也不按收藏数或做过人数加权。
- 含部位归并的组会在名称说明，例如“鸡肉（含鸡翅）”“虾（含虾仁）”“白菜（含娃娃菜）”。这些组用于榜单样本出现频率，**不能直接用作商品价格规格匹配**；整鸡、鸡翅、鸡胸肉、整虾与虾仁等价格应分别核验。价格模拟需要依赖原始菜谱食材字段与具体价格记录。
- 未匹配或有歧义的原料保留原文但不强行归类，例如单写“肉沫”不能判断具体肉类。源页可能有错字或漏项；不静默修正。未匹配不等于该食材不存在。
- 分母、计数、百分比、来源菜谱 `sourceRecipeIds`、规则和窗口都保存到每条 `ingredientSignals` 记录，可由原页与代码复核。

例如这次下厨房样本中，鸡蛋在 25 道菜谱的食材字段里出现于 4 道，得到 **4 / 25 = 16%**；这不意味着鸡蛋占全国搜索量或销量的 16%。当季榜单和周榜各自只解释各自的样本。没有上一期真实快照时不产生涨跌幅或趋势箭头。

## 来源目录与接入边界

| 平台 / 官方入口 | 本项目状态 | 经核实的用途或口径 | 周期 / 接入限制 |
| --- | --- | --- | --- |
| [下厨房](https://www.xiachufang.com/explore/) | 已接入公开榜单首页 | 菜谱榜单展示顺位、七天内做过人数、食材列表 | 本站每日低频检查；官方榜期准确日期与刷新时间未披露 |
| [美食天下](https://home.meishichina.com/show-top-type-recipe.html) | 已接入公开榜单首页 | 当季最热展示顺位、公开收藏人数、原料列表 | 本站每日低频检查；不称周榜，收藏统计区间未披露 |
| [豆果美食](https://www.douguo.com/) | 当前不可自动获取 | 候选菜谱平台，仅保留跳转入口 | 2026-10-24 正常公开请求返回 HTTP 403；没有绕过、获取或生成该平台榜单 |
| [百度指数](https://index.baidu.com/) / [官方帮助](https://index.baidu.com/Helper) | 仅供参考，未接入 | 百度搜索行为形成的加权搜索指数，不能和收藏量或销售量混用 | 官方帮助说明每日更新；大众版不支持数据下载、暂不提供开放 API。本项目没有获准接口 |
| [抖音指数（原巨量算数）](https://trendinsight.oceanengine.com/) | 仅供参考，未接入 | 官方产品介绍中的抖音内容消费趋势 | 本项目未核验具体指标的刷新周期；接口方式和授权范围需另行确认，未读取未公开接口 |
| [Google Trends API 官方文档](https://developers.google.com/search/apis/trends) | 需要官方访问权限，未接入 | 搜索兴趣统计；文档列有日、周、月、年聚合 | 官方 API Alpha 需申请访问；本项目无凭据，也未使用非官方接口 |
| [Wikimedia Analytics 官方文档](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/getting-started.html) | 仅作为公开数据方案参考，未接入 | API 可提供按日页面浏览量；不是食材消费指数 | [页面浏览量定义](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html)需要区分用户类型、条目与重定向；中文条目不等于中国境内用户，本项目没有采集这类数值 |

参考来源不出现在“已接入”计数里，也不参与当前推荐计算。它们是可核验的备选信息路径，不是为了给模拟分数添加来源标签。所有 `status != "ok"` 的目录项都没有本来源的菜谱数据记录。

## 获取方式、访问规则与频率

采集器仅用 Python 标准库，透明标识 `RecipeResearchDemo/0.3` 及项目地址，无登录、Cookies、账号凭据、代理轮换或浏览器伪装。

- 每次执行先读取各主机的 `robots.txt`。如果不能核实规则、规则禁止、页面要求登录/验证或 HTTP 报错，该源立即记录失败，不进行绕过。
- [下厨房 robots](https://www.xiachufang.com/robots.txt) 中通用代理规则允许当前 `/explore/` 路径，并声明 `Crawl-delay: 10`。采集器在读取 robots 和榜单之间实际等待至少 10 秒。
- [美食天下 robots](https://home.meishichina.com/robots.txt) 允许当前静态榜单路径；规则限制了查询参数、搜索等其他路径。本项目只读允许的无查询参数列表页，默认同主机至少间隔 1 秒。
- [豆果 robots](https://www.douguo.com/robots.txt) 已核查，虽公开首页不被相应路径规则禁止，实际 HTTP 仍返回 403，因此停止，不把 robots 当成可绕过访问限制的许可。
- 单个来源每次只获取一份 robots 和一页榜单，不翻页，不批量抓取配方全文。最多下载 1.5 MB、单次请求超时 25 秒；如果页面结构或标题变更、条目缺失异常、菜谱 ID 重复，拒绝发布该源新记录。
- 两个不同主机可并行处理，同一主机的请求保持顺序和间隔；没有失败重试轰炸。每源失败返回 `status: error` 与错误原因，另一来源仍可成功。
- 部署管线可在每日固定时刻运行；页面显示的是公开数据的最近成功快照。重读本站 JSON 的交互动画不能被描述为直接连接原站的实时流。

robots 是访问约束，不代表开放内容许可。仓库仅存少量菜名、原页面链接、公开数值和食材名称等必要元数据，不转载整篇配方步骤或图片；提供原作者平台链接以便用户回看上下文。原站文本有时包含宣传性菜名，引用标题不代表本网站确认营养、健康或减重效果。

## 运行与接口

从项目根目录运行：

```bash
python scripts/collect_popularity.py --output data/popularity-seed.json
```

可被统一更新管线导入：

```python
from scripts.collect_popularity import collect

payload = collect()
# payload: {"sources": [...], "recipeRankings": [...], "ingredientSignals": [...]}
```

`collect(now=None)` 支持管线传入统一的 ISO 8601 字符串或 `datetime`；省略时每源以实际请求后的时刻记录 `fetchedAt`。部署应使用实际当前时间，测试时传入时间不能据此声称获取了历史榜单。

记录关键字段：

| 对象 | 关键字段 |
| --- | --- |
| `sources` | `id`、`name`、`publisher`、`url`、`status`、`error`、`lastSuccessAt`、`lastAttemptAt`、`recordCount`、`robots`、`metrics`、`limitations`、`evidenceUrl`、`automated` |
| `recipeRankings` | `id`、`sourceId`、`recipeId`、`title`、菜谱 `sourceUrl`、榜单 `listingUrl`、`rank`、`rankMeaning`、`workCount` 或 `collectionCount` 及解释、原始 `ingredients`、`window`、`observedDate: null`、`capturedDate`、`periodDateKnown: false`、`fetchedAt`、`isSynthetic: false` |
| `ingredientSignals` | `ingredientId`、`name`、`sourceId`、榜单 `sourceUrl`、`value`、`unit: "recipes"`、`sampleSize`、`sharePct`、`sourceRecipeIds`、`method`、`coverage`、窗口与时间字段、`isDerived: true`、`isSynthetic: false` |

`isSynthetic: false` 表示数据来自实际源页或可复核的确定性派生，并不把它宣称为完整、无误或全国代表性数据。统一管线如果保留上次成功数据，必须同时保留原 `fetchedAt` 并显示本轮错误或陈旧状态，不能把失败时刻写成新的成功时间。

## 本次验证

- 实际网络采集两源均返回可解析的公开列表，输出 25 + 10 条菜谱。
- 核验每条来源、公开原链接、榜单窗口、真实获取时间与非模拟标识；精确周期未知时没有填造发布日期。
- 核验派生信号的 `0 < value <= sampleSize`、分平台分母及每菜去重，保留全部来源菜谱 ID。
- 用无榜单结构的“Access denied”页面验证解析器会拒绝误接入，而不是生成空榜后标记成功。
- 改进美食天下解析：页面第一个 `h1` 为站点栏目名称“菜谱”，采集器明确定位“当季最热”标题，避免把站点 logo 当作榜单标题。
