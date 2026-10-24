/*
 * National ingredient market interaction — synthetic, deterministic demo.
 * No live prices, observed search volumes, measured seasonality, or paper model.
 * All price factors, seasonal windows and trend indices are authored scenarios.
 */
(function (root) {
  'use strict';

  const base = root.RecipeDemo || (typeof require === 'function' ? require('./demo-engine.js') : null);
  if (!base) throw new Error('RecipeMarket requires demo-engine.js first.');
  const keys = ['preference', 'price', 'season', 'trend'];
  const dimensions = [
    { key: 'preference', label: '个人偏好', color: '#8b9d78' },
    { key: 'price', label: '食材价格', color: '#508c7b' },
    { key: 'season', label: '当季匹配', color: '#d2a95b' },
    { key: 'trend', label: '趋势热度', color: '#bd8069' }
  ];

  // Explicit scenario parameters, not estimates of actual provincial prices.
  const provinceRows = [
    ['110000', '北京', 'north', 1.12], ['120000', '天津', 'north', 1.04],
    ['130000', '河北', 'north', 0.95], ['140000', '山西', 'north', 0.96],
    ['150000', '内蒙古', 'northwest', 1.02], ['210000', '辽宁', 'northeast', 0.98],
    ['220000', '吉林', 'northeast', 0.94], ['230000', '黑龙江', 'northeast', 0.93],
    ['310000', '上海', 'east', 1.17], ['320000', '江苏', 'east', 1.02],
    ['330000', '浙江', 'east', 1.06], ['340000', '安徽', 'east', 0.94],
    ['350000', '福建', 'south', 1.01], ['360000', '江西', 'central', 0.93],
    ['370000', '山东', 'north', 0.93], ['410000', '河南', 'central', 0.91],
    ['420000', '湖北', 'central', 0.95], ['430000', '湖南', 'central', 0.96],
    ['440000', '广东', 'south', 1.07], ['450000', '广西', 'south', 0.94],
    ['460000', '海南', 'island', 1.09], ['500000', '重庆', 'southwest', 0.99],
    ['510000', '四川', 'southwest', 0.96], ['520000', '贵州', 'southwest', 0.94],
    ['530000', '云南', 'southwest', 0.92], ['540000', '西藏', 'northwest', 1.21],
    ['610000', '陕西', 'northwest', 0.97], ['620000', '甘肃', 'northwest', 0.98],
    ['630000', '青海', 'northwest', 1.08], ['640000', '宁夏', 'northwest', 0.96],
    ['650000', '新疆', 'northwest', 1.03], ['710000', '台湾', 'island', 1.14],
    ['810000', '香港', 'south', 1.32], ['820000', '澳门', 'south', 1.27]
  ];
  const provinces = provinceRows.map(([id, name, zone, priceFactor]) => ({ id, name, zone, priceFactor }));
  const zoneParameters = {
    northeast: { shift: 1, vegetable: 1.08, protein: 0.92, aquatic: 1.12, staple: 0.94, trend: { vegetable: -2, protein: 8, aquatic: -4, staple: 6 } },
    north: { shift: 0, vegetable: 0.96, protein: 0.98, aquatic: 1.10, staple: 0.93, trend: { vegetable: 1, protein: 5, aquatic: -2, staple: 8 } },
    east: { shift: 0, vegetable: 1.00, protein: 1.04, aquatic: 0.93, staple: 1.00, trend: { vegetable: 6, protein: 0, aquatic: 7, staple: 1 } },
    central: { shift: 0, vegetable: 0.89, protein: 0.98, aquatic: 1.01, staple: 0.96, trend: { vegetable: 7, protein: 3, aquatic: 1, staple: 0 } },
    south: { shift: -1, vegetable: 0.94, protein: 1.04, aquatic: 0.85, staple: 1.06, trend: { vegetable: 4, protein: 2, aquatic: 10, staple: -3 } },
    southwest: { shift: -1, vegetable: 0.84, protein: 0.97, aquatic: 1.17, staple: 0.99, trend: { vegetable: 11, protein: 5, aquatic: -5, staple: 0 } },
    northwest: { shift: 1, vegetable: 1.15, protein: 0.88, aquatic: 1.30, staple: 0.90, trend: { vegetable: -4, protein: 13, aquatic: -7, staple: 10 } },
    island: { shift: -2, vegetable: 1.02, protein: 1.08, aquatic: 0.83, staple: 1.08, trend: { vegetable: 5, protein: -2, aquatic: 13, staple: 0 } }
  };

  // main ingredient id, display name, synthetic yuan/kg, category, synthetic peak months, trend base, trend peak month
  const ingredientRows = [
    ['bass', '鲈鱼', 36, 'aquatic', [], 59, 9],
    ['tomato', '番茄', 7.5, 'vegetable', [6, 7, 8, 9], 64, 7],
    ['egg', '鸡蛋', 11, 'protein', [], 56, 4],
    ['chicken', '鸡肉', 23, 'protein', [], 62, 11],
    ['shiitake', '香菇', 18, 'vegetable', [3, 4, 9, 10, 11], 65, 10],
    ['tofu', '豆腐', 7, 'protein', [], 66, 4],
    ['beef', '牛肉', 66, 'protein', [], 66, 12],
    ['broccoli', '西兰花', 11, 'vegetable', [3, 4, 10, 11], 71, 3],
    ['shrimp', '虾仁', 70, 'aquatic', [], 74, 6],
    ['lotus', '莲藕', 9, 'vegetable', [9, 10, 11, 12], 76, 10],
    ['ribs', '排骨', 38, 'protein', [], 66, 11],
    ['noodles', '小麦面条', 8, 'staple', [], 51, 2],
    ['scallion', '葱', 9, 'vegetable', [4, 5, 9, 10], 44, 4],
    ['kingoyster', '杏鲍菇', 12, 'vegetable', [3, 4, 9, 10, 11], 61, 10],
    ['onion', '洋葱', 5, 'vegetable', [5, 6, 7], 47, 5],
    ['yam', '山药', 13, 'vegetable', [9, 10, 11, 12], 71, 11],
    ['wood-ear', '木耳（泡发）', 16, 'vegetable', [3, 4, 9, 10], 53, 9],
    ['peanut', '花生', 18, 'protein', [9, 10], 47, 9],
    ['pepper', '青椒', 8, 'vegetable', [6, 7, 8, 9], 66, 8],
    ['pumpkin', '南瓜', 5, 'vegetable', [9, 10, 11], 91, 10],
    ['oats', '燕麦', 12, 'staple', [], 73, 3],
    ['milk', '牛奶', 12, 'protein', [], 56, 2],
    ['wrapper', '小麦面皮', 9, 'staple', [], 49, 1],
    ['chive', '韭菜', 8, 'vegetable', [3, 4, 5], 62, 3],
    ['asparagus', '芦笋', 24, 'vegetable', [3, 4, 5, 6], 78, 4],
    ['wintermelon', '冬瓜', 4, 'vegetable', [6, 7, 8, 9], 62, 7],
    ['eggplant', '茄子', 7, 'vegetable', [6, 7, 8, 9], 67, 8]
  ];
  const ingredients = ingredientRows.map(([id, name, basePrice, category, months, trendBase, trendPeak]) => ({ id, name, basePrice, category, months, trendBase, trendPeak }));
  const ingredientById = Object.fromEntries(ingredients.map(item => [item.id, item]));

  // Illustrative main ingredient portions for two people. Garnishes, sauces, oil, energy and waste are excluded.
  const portions = {
    r01: [['bass', 500]],
    r02: [['tomato', 350], ['egg', 150]],
    r03: [['chicken', 350], ['shiitake', 150]],
    r04: [['tofu', 400], ['beef', 80]],
    r05: [['broccoli', 300], ['shrimp', 180]],
    r06: [['lotus', 350], ['ribs', 350]],
    r07: [['noodles', 300], ['scallion', 50]],
    r08: [['beef', 300], ['kingoyster', 200], ['onion', 100]],
    r09: [['yam', 250], ['wood-ear', 80], ['egg', 100]],
    r10: [['chicken', 300], ['peanut', 60], ['pepper', 120]],
    r11: [['pumpkin', 300], ['oats', 100], ['milk', 250]],
    r12: [['wrapper', 300], ['chive', 250], ['egg', 150]],
    r13: [['asparagus', 250], ['tofu', 300], ['shiitake', 100]],
    r14: [['pepper', 250], ['beef', 300]],
    r15: [['wintermelon', 400], ['shrimp', 180]],
    r16: [['eggplant', 450], ['pepper', 50]]
  };
  const basket = [
    { id: 'tomato', name: '番茄', grams: 500 },
    { id: 'egg', name: '鸡蛋', grams: 500 },
    { id: 'tofu', name: '豆腐', grams: 500 },
    { id: 'chicken', name: '鸡肉', grams: 500 }
  ];
  const strategies = [
    { id: 'balanced', label: '综合推荐', weights: { preference: 0.45, price: 0.25, season: 0.20, trend: 0.10 } },
    { id: 'economy', label: '价格优先', weights: { preference: 0.20, price: 0.65, season: 0.10, trend: 0.05 } },
    { id: 'seasonal', label: '时令优先', weights: { preference: 0.20, price: 0.10, season: 0.65, trend: 0.05 } },
    { id: 'trending', label: '趋势优先', weights: { preference: 0.20, price: 0.10, season: 0.10, trend: 0.60 } }
  ];
  const defaultContext = { provinceId: '330000', month: 10, budget: 25, strategy: 'balanced', withinBudget: false };
  const metadata = {
    id: 'synthetic-province-market', version: '0.2.0', isSynthetic: true,
    label: '合成情境 · 非实时行情',
    source: '全部价格、月份窗口及热度为人工设定的演示参数；未采集或接入市场、搜索平台、社交平台数据。',
    geography: '覆盖 34 个省级区域；地区参数仅用于展示交互差异。',
    currency: '人民币元；台港澳同样使用统一人民币合成口径，不包含实际汇率或当地报价。',
    dateMeaning: '月份只选择固定合成情境，不表示数据采集月份；数据不会随当天日期更新。',
    trendMeaning: '热度 0–100 是可复现的合成指数，不是搜索量、销售量、真实趋势或同比变化。',
    seasonMeaning: '当季标签来自人工设定月份窗口和区域偏移，不是实际产季调查；全年供应类主料使用中性 65 分。',
    costMeaning: '每道菜为 2 人份示例主料成本，按展示单价 × 克数 / 1000 求和；不含辅料、调味料、能耗和损耗。',
    basketMeaning: '同一固定篮子：番茄、鸡蛋、豆腐、鸡肉各 500 克，共 2 千克；仅用于地区间示例成本比较。',
    formula: '综合分 = 个人偏好分 × 策略权重 + 价格分 × 策略权重 + 当季分 × 策略权重 + 热度分 × 策略权重。价格分 = max(0, 100 × (1 - 主料成本 / (2 × 预算)))。当季及热度按主料克数加权平均。',
    paperConnected: false,
    dataMode: 'synthetic',
    futureRecord: { provinceId: '六位区域代码', ingredientId: '统一食材标识', pricePerKg: '经单位换算后的人民币元/kg', observedAt: 'ISO 8601 采集时点', sourceUrl: '可核验数据源链接', sourceType: '零售/批发/平台热度等明确口径', isSynthetic: false }
  };

  function clamp(value, fallback, min, max) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : fallback;
  }
  const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const monthWrap = month => ((month - 1) % 12 + 12) % 12 + 1;
  const distance = (a, b) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b));

  function normalizeContext(input) {
    const context = input && typeof input === 'object' ? input : {};
    return {
      provinceId: provinces.some(item => item.id === String(context.provinceId)) ? String(context.provinceId) : defaultContext.provinceId,
      month: Math.round(clamp(context.month, defaultContext.month, 1, 12)),
      budget: round2(clamp(context.budget, defaultContext.budget, 1, 200)),
      strategy: strategies.some(item => item.id === context.strategy) ? context.strategy : defaultContext.strategy,
      withinBudget: context.withinBudget === true
    };
  }

  function marketItem(item, province, month) {
    const zone = zoneParameters[province.zone];
    const peakMonths = item.months.map(peak => monthWrap(peak + zone.shift));
    const nearest = peakMonths.length ? Math.min(...peakMonths.map(peak => distance(month, peak))) : null;
    const seasonScore = nearest === null ? 65 : nearest === 0 ? 100 : nearest === 1 ? 70 : nearest === 2 ? 45 : 25;
    const priceSeasonFactor = nearest === null ? 1 : 1.20 - seasonScore * 0.004;
    const annualWave = 1 + 0.035 * Math.cos((month - 1) * Math.PI / 6);
    const price = round2(item.basePrice * province.priceFactor * zone[item.category] * priceSeasonFactor * annualWave);
    const trendWave = 15 * Math.cos((month - monthWrap(item.trendPeak + zone.shift)) * Math.PI / 6);
    const trend = Math.round(Math.max(0, Math.min(100, item.trendBase + trendWave + zone.trend[item.category])));
    return {
      id: item.id, name: item.name, price, unit: '元/kg',
      inSeason: nearest === 0, seasonal: peakMonths.length > 0,
      seasonScore, trend, months: peakMonths, category: item.category,
      isSynthetic: true
    };
  }

  function snapshot(input) {
    const context = normalizeContext(input);
    const province = provinces.find(item => item.id === context.provinceId);
    const items = ingredients.map(item => marketItem(item, province, context.month));
    const byId = Object.fromEntries(items.map(item => [item.id, item]));
    const basketItems = basket.map(item => ({ ...item, price: byId[item.id].price, cost: item.grams * byId[item.id].price / 1000 }));
    return {
      province, month: context.month,
      seasonLabel: context.month >= 3 && context.month <= 5 ? '春季' : context.month >= 6 && context.month <= 8 ? '夏季' : context.month >= 9 && context.month <= 11 ? '秋季' : '冬季',
      items,
      basketCost: round2(basketItems.reduce((sum, item) => sum + item.cost, 0)),
      basketItems,
      seasonalCount: items.filter(item => item.inSeason).length,
      seasonalTotal: items.filter(item => item.seasonal).length,
      trendIndex: Math.round(items.reduce((sum, item) => sum + item.trend, 0) / items.length),
      isSynthetic: true
    };
  }

  function mapValues(input, metric) {
    const context = normalizeContext(input);
    const field = metric === 'season' ? 'seasonalCount' : metric === 'trend' ? 'trendIndex' : 'basketCost';
    return provinces.map(province => ({ id: province.id, value: snapshot({ ...context, provinceId: province.id })[field] }));
  }

  function recommend(profile, input) {
    const context = normalizeContext(input);
    const market = snapshot(context);
    const byId = Object.fromEntries(market.items.map(item => [item.id, item]));
    const strategy = strategies.find(item => item.id === context.strategy);
    const weights = { ...strategy.weights };
    const original = base.evaluate(profile);
    const rejected = original.rejected.map(row => ({ recipe: row.recipe, reasons: row.reasons.slice() }));
    if (original.invalidWeights) return { context, snapshot: market, ranked: [], rejected, invalidWeights: true, weights };
    const ranked = [];
    original.ranked.forEach(row => {
      const recipePortions = portions[row.recipe.id];
      if (!recipePortions || recipePortions.some(([id]) => !byId[id])) {
        rejected.push({ recipe: row.recipe, reasons: ['缺少完整主料报价，无法估算成本。'] });
        return;
      }
      const mainIngredients = recipePortions.map(([id, grams]) => ({ id, name: byId[id].name, grams, price: byId[id].price, cost: grams * byId[id].price / 1000, inSeason: byId[id].inSeason, seasonScore: byId[id].seasonScore, trend: byId[id].trend }));
      const unroundedCost = mainIngredients.reduce((sum, item) => sum + item.cost, 0);
      const cost = round2(unroundedCost);
      if (context.withinBudget && cost > context.budget) {
        rejected.push({ recipe: row.recipe, reasons: [`2 人份主料示例成本 ¥${cost.toFixed(2)} 超出预算 ¥${context.budget.toFixed(2)}。`] });
        return;
      }
      const grams = mainIngredients.reduce((sum, item) => sum + item.grams, 0);
      const components = {
        preference: row.score,
        price: Math.max(0, 100 * (1 - cost / (2 * context.budget))),
        season: mainIngredients.reduce((sum, item) => sum + item.grams * item.seasonScore, 0) / grams,
        trend: mainIngredients.reduce((sum, item) => sum + item.grams * item.trend, 0) / grams
      };
      const contributions = Object.fromEntries(keys.map(key => [key, components[key] * weights[key]]));
      const score = keys.reduce((sum, key) => sum + contributions[key], 0);
      const seasonalNames = mainIngredients.filter(item => item.inSeason).map(item => item.name);
      const explanation = [
        `2 人份主料约 ¥${cost.toFixed(2)}，${cost <= context.budget ? '在' : '超出'} ¥${context.budget.toFixed(0)} 示例预算。`,
        seasonalNames.length ? `${seasonalNames.join('、')}命中 ${market.province.name} ${context.month} 月的合成当季窗口。` : '当前主料未命中所选月份的合成当季窗口。',
        `主料合成热度 ${components.trend.toFixed(0)} / 100；个人五维偏好分 ${row.score.toFixed(1)}。`
      ];
      ranked.push({ recipe: row.recipe, score, baseScore: row.score, cost, components, contributions, explanation, ingredients: mainIngredients });
    });
    ranked.sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id));
    return { context, snapshot: market, ranked, rejected, invalidWeights: false, weights };
  }

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(key => deepFreeze(value[key]));
      Object.freeze(value);
    }
    return value;
  }
  const api = deepFreeze({ keys, dimensions, provinces, ingredients, portions, basket, strategies, defaultContext, metadata, normalizeContext, snapshot, mapValues, recommend });
  root.RecipeMarket = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
