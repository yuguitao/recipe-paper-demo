# 菜谱推荐论文 · 交互原型

一个无需安装依赖、部署到 GitHub Pages 的中文交互原型。通过全国省级地图探索食材价格、月份、时令和流行趋势情境，并观察它们与口味、营养、健康、地域等偏好共同作用时的推荐变化。

**网站：[Recipe Lab](https://yuguitao.github.io/recipe-paper-demo/)** · **代码：[yuguitao/recipe-paper-demo](https://github.com/yuguitao/recipe-paper-demo)**

## 当前版本的身份

**这是使用示例数据和示例规则的界面原型，不是作者论文算法的复现，也不是算法有效性的实验结果。**

- 尚未提供论文正文、原始模型代码或真实评估结果。
- 菜谱属性、分数及排序用于演示交互，不应作为真实营养、健康评估或饮食决策依据。
- 不填造论文题目、作者、DOI、实验指标或基线效果；论文内容区保留待接入状态。
- 当前不运行真实 Python 推理，也没有连接外部推荐 API。
- 地图中的价格、季节属性及热度均为可复现的合成情境；尚未连接全国行情、搜索指数或实际消费趋势数据。

交互可说明“输入改变时，示例推荐如何变化”；论文算法是否有效，应由论文中的真实实验与公平对照支持。

## 全国地图体验

- 通过地图或省级地区选择器选择地点；34 个省级区域均可选。
- 切换月份，查看同一组食材在不同地点、月份下的示例价格、当季标签和热度。
- 切换地图指标，比较统一食材篮子的估算成本、当季食材数量或合成热度。固定篮子保持品种与重量一致，便于比较地区情境。
- 选择均衡、价格、时令或趋势策略，并设置每道菜预算；预算既可影响排序，也可按用户勾选成为硬筛选条件。
- 查看每道菜的示例主料成本和分数贡献。五维偏好中的食材排除项始终有效，切换地点、月份或策略不会取消这些约束。

菜谱成本按固定 **2 人份主料用量**与示例单价计算，单位统一为人民币；这是全地区共享的演示口径，不表示真实货币报价或兑换。成本不是餐馆售价，也不包含完整调味料、能源等支出。具体公式、数据版本和口径由 `market-engine.js` 中的元数据记录。地域季节标签与热度不构成实际农业物候或消费调查结论。

地图几何的来源、处理方式和使用说明见 [MAP-SOURCE.md](./MAP-SOURCE.md)。几何来源与市场示例数据分别记录；使用真实地图轮廓不表示行情已接入。

## 本地打开

直接双击根目录的 `index.html` 即可运行。请保留 CSS、JavaScript 与 `MAP-SOURCE.md` 的相对位置；地图与计算所需数据随项目提供，无需运行时访问外部服务。

如需构建部署产物和便于发送的单文件版本，在有 Node.js 的环境执行：

```bash
node scripts/build.mjs
node --test tests/*.test.mjs
```

构建结果：

- `dist/`：包含网站入口、两个 CSS、五个 JavaScript 文件、地图来源说明与 `.nojekyll`，用于部署。
- `../deliverables/recipe-recommender-prototype.html`：将 CSS 与 JS 内联后的独立 HTML，可直接双击打开；此路径相对于项目目录。

构建不下载依赖，不请求在线 API。构建脚本会检查所有 CSS 和 JavaScript 入口标签是否与约定一致，按入口顺序内联，包括地图数据和地区推荐引擎，防止单文件版本缺失资源。

## 发布到 GitHub Pages

1. 在你的 GitHub 账号或组织下创建仓库，例如 `recipe-paper-demo`，上传完整项目；保留 `.github/workflows/pages.yml` 等文件。
2. 将默认开发分支命名为 `main`；如果采用其他名称，同步修改工作流中的分支触发条件。
3. 在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。
4. 推送提交到 `main`，或在 **Actions → Deploy recipe paper demo → Run workflow** 手动运行。
5. 工作流构建网站、运行引擎测试，再将 `dist/` 部署到 Pages。通过后，部署任务会给出实际网址。

项目站点通常位于 `https://<你的账号>.github.io/<仓库名>/`。当前源码采用相对资源路径，因此可以放在仓库子路径下。新增脚本、图片和数据文件也应继续使用相对路径，避免写成指向域名根目录的 `/assets/...`。

工作流使用 GitHub 托管 runner 已有的 Node.js，无 npm 安装步骤。若启用仓库保护或环境审批，以该仓库的实际规则为准。GitHub 免费账号的 Pages 通常需要公开仓库；具体可用性以你的账号计划为准。

## 接入真实论文算法

| 条件 | 建议接法 | 必须说明 |
| --- | --- | --- |
| 算法轻量，可在浏览器计算 | 将真实推理过程实现为 JavaScript，并对照原实现验证相同输入下的结果 | 数值误差、排序与并列规则、候选集范围 |
| 训练重，但推理可由离线特征与轻量运算完成 | 从原始代码导出真实特征或中间结果，前端完成对应推理 | 模型版本、数据版本、预计算步骤与更新日期 |
| 需要 Python、大模型或较大内存 | 保留 Pages 前端，通过外部服务调用真实推理 | 服务状态、延迟、版本、请求限制与错误处理 |

GitHub Pages 只托管静态文件，不能在服务器上直接运行 Python API。固定输入的预计算结果也可以展示，但应命名为“论文案例回放”，不能显示成任意输入的实时推理。详细材料清单与建议接口见 [INTEGRATION.md](./INTEGRATION.md)。

## 发布前确认

请由作者确认网站标题、署名、论文公开阶段，以及代码、数据、菜谱图片和论文图表的使用与分发权限。本项目未替作者指定 MIT 或其他许可证。公开时应明确保留示例原型标记，或在真实算法与资料接入完成后逐项更新相关说明。

## 官方部署依据

- [GitHub Pages 的性质及项目网址](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [创建 Pages 网站、入口文件及服务端限制](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [GitHub Actions 自定义部署工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
