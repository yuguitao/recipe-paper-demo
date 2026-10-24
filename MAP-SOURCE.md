# 全国地图几何来源

## 数据与出处

- 地图几何：阿里云 **DataV.GeoAtlas** 全国省级边界 GeoJSON；官方说明其源数据来自高德开放平台。
- 原始数据：<https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json>
- 官方工具文档：<https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/>
- 获取日期：2026-10-24（这是本项目取得文件的日期，不代表源数据更新时间）。
- 原始文件 SHA-256：`99adfeded5223848bbe37a0a12f8023e11ee12161c7800521c27db42fdeac275`

本项目使用该数据制作研究原型的地区选择示意图。官方文档将 GeoAtlas 数据限定为学习和交流用途，并要求版权相关问题向高德开放平台确认。本项目不将这些地图数据重新授权为 MIT、CC0 或其他无限制开放许可；正式商业使用需另行取得相应数据授权。

## 转换方式

`map-data.js` 将上述 GeoJSON 的 34 个省级要素转换为静态 SVG 路径，并保留源文件独立的海域界线要素。没有手工臆造省界或用方格替代地图。

- 使用球面墨卡托投影，主图统一比例，不对省份分别缩放。
- 主图显示纬度 18° 以上的源多边形；南海诸岛附图另设空间范围，显示源海南、台湾岛屿和全部源海域界线，以保留南部岛礁。
- 路径坐标保留到 `viewBox` 单位的两位小数；仅删除连续重复的投影坐标，没有删除源岛屿。
- 北京、天津、上海、香港、澳门使用文字引线辅助选取；引线端点和标签位移仅用于排版，实际边界路径不变。
- 地区名称简写和六位代码直接对应 GeoJSON 的省级 `name` / `adcode`；全名保留在 `fullName`。
- 本图供网站地区选择和研究交互使用，不作为测绘、导航或行政区划认定依据。

## 浏览器接口

通过 `<script src="./map-data.js"></script>` 加载，获得 `globalThis.ChinaMapData`，也可用 CommonJS `require()` 读取。

```js
{
  viewBox: '0 0 860 612',
  regions: [{
    id: '330000',
    name: '浙江',
    fullName: '浙江省',
    path: 'M...Z',
    label: [x, y],
    center: [x, y],
    // 以下为可选字段
    callout: { from: [x, y], to: [x, y] },
    insetPath: 'M...Z'
  }],
  boundaryPath: 'M...Z',
  inset: {
    x: 721, y: 394, width: 112, height: 198,
    title: '南海诸岛', label: [777, 579]
  },
  insetBoundaryPath: 'M...Z',
  source: { name, url, documentationUrl, retrievedAt, license, sha256, projection }
}
```

所有路径已处于相同的顶层 `viewBox` 坐标系。建议渲染顺序为主图省界、主图海域界线、附图背景、各地区附图路径、附图海域界线、文字标签。海域界线来源为细长多边形，使用 `fill`，无需另加虚线描边。小区域还应提供省份下拉选择作为触控和键盘操作的替代入口。

## 与网站推荐数据的关系

地图几何来源于上述公开地图文件；网站食材价格、季节和趋势属于独立的合成示例数据。地图来源不为这些合成数值提供背书，两类数据不应混淆。
