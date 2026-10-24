/* Pure, transparent ranking demonstration. Prices are evidence, not recipe costs. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveFoodModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PRICE_SOURCE = 'mofcom-daily-market';
  const DAY = 86400000;
  const strategies = Object.freeze({
    balanced: Object.freeze({ rank: .45, favorite: .30, price: .25 }),
    popular: Object.freeze({ rank: .80, favorite: .20, price: 0 }),
    ingredient: Object.freeze({ rank: .25, favorite: .65, price: .10 }),
    'local-price': Object.freeze({ rank: .25, favorite: .15, price: .60 })
  });
  // Whole-string equivalence only. No substring, stem, amount, or preparation stripping.
  // A generic meat, cut, processed food, or combined seasoning cannot borrow another quote.
  const exactNames = Object.freeze({
    '西红柿': 'tomato', '番茄': 'tomato',
    '黄瓜': 'cucumber', '土豆': 'potato', '马铃薯': 'potato',
    '圆白菜': 'cabbage', '包菜': 'cabbage', '卷心菜': 'cabbage',
    '鲜鸡蛋': 'egg', '鸡蛋': 'egg', '白条鸡': 'whole_chicken',
    '莲藕': 'lotus', '藕': 'lotus', '茄子': 'eggplant', '青椒': 'pepper',
    '冬瓜': 'wintermelon', '西兰花': 'broccoli', '西蓝花': 'broccoli',
    '洋葱': 'onion', '大葱': 'scallion', '韭菜': 'chive',
    '生姜': 'ginger', '姜': 'ginger', '牛腿肉': 'beef_leg'
  });
  const methodology = Object.freeze({
    rank: '榜单顺位分=100×(N−顺位)/(N−1)，首位100、末位0；仅一条时为100。N为选定来源的有效当前快照条数，不混合平台指标。',
    favorite: '所选食材在当前来源的食材出现记录中命中该菜谱则100，否则0；没有选择食材时移除偏好权重，并将其余权重归一化。',
    price: '每种精确匹配食材的价位优势=max(0,min(100,50+100×(全国样本市场中位价−本省样本市场中位价)/全国样本市场中位价))；多食材等权平均。它不是菜谱成本、节省金额或官方价格指数。',
    week: '本省与全国按完全相同的实际观测日集合，分别对每日市场中位数求均值再比较；缺失日不插值。全国基准来自原始市场报价，而不是各省中位数的中位数。',
    missing: '价格权重大于0时，无任何精确匹配且有本地可比报价的候选被排除。其余候选仅比较已匹配食材，不宣称覆盖全部食材。',
    matching: '只接受完整食材名的显式同义词；鸡翅、鸡胸、鸡肉不匹配白条鸡，牛肉不匹配牛腿肉，葱花、小葱和葱不匹配大葱。'
  });

  function matchPriceItem(rawIngredient) {
    if (typeof rawIngredient !== 'string') return null;
    const name = rawIngredient.trim();
    return Object.hasOwn(exactNames, name) ? exactNames[name] : null;
  }
  const clamp = value => Math.max(0, Math.min(100, value));
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const textCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const stamp = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
  }
  function chinaDate(value) {
    if (validDate(value)) return value;
    const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? new Date(parsed + 8 * 3600000).toISOString().slice(0, 10) : null;
  }
  function shiftDate(value, days) {
    return new Date(Date.parse(value + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
  }
  function samePriceScope(row) {
    return row && row.sourceId === PRICE_SOURCE && row.isSynthetic === false &&
      row.unit === 'CNY/kg' && row.priceType === 'wholesale' &&
      row.specification == null && row.grade == null && validDate(row.observedDate);
  }
  function summaryKey(row, national) {
    return [row.itemId, national ? '' : String(row.provinceId), row.observedDate].join('|');
  }
  function summariesFromRaw(data) {
    const grouped = new Map();
    const rows = Array.isArray(data.priceHistory) ? data.priceHistory : data.observations || [];
    const seen = new Set();
    rows.forEach(row => {
      if (!samePriceScope(row) || row.kind !== 'price' || !positive(row.value) ||
          row.geography?.level !== 'market' || !row.geography.provinceId) return;
      const unique = [row.itemId, row.observedDate, row.geography.marketId || row.geography.market].join('|');
      if (seen.has(unique)) return;
      seen.add(unique);
      ['', String(row.geography.provinceId)].forEach(provinceId => {
        const key = [row.itemId, provinceId, row.observedDate].join('|');
        if (!grouped.has(key)) grouped.set(key, { itemId: row.itemId, itemName: row.itemName,
          provinceId, observedDate: row.observedDate, values: [], sourceUrls: new Set() });
        const group = grouped.get(key);
        group.values.push(row.value);
        if (row.sourceUrl) group.sourceUrls.add(row.sourceUrl);
      });
    });
    const local = new Map();
    const national = new Map();
    grouped.forEach(group => {
      const row = { itemId: group.itemId, itemName: group.itemName, provinceId: group.provinceId,
        observedDate: group.observedDate, median: median(group.values), marketCount: group.values.length,
        sourceUrls: [...group.sourceUrls].sort() };
      (row.provinceId ? local : national).set(summaryKey(row, !row.provinceId), row);
    });
    return { local, national };
  }
  function priceSummaries(data) {
    const suppliedLocal = Array.isArray(data.dailyPriceSummaries);
    const suppliedNational = Array.isArray(data.nationalDailyPriceSummaries);
    // Use the paired pipeline aggregates together. Never mix a full historical local
    // sample with an incomplete latest-only national reconstruction for that date.
    if (!suppliedLocal || !suppliedNational) return summariesFromRaw(data);
    const local = new Map();
    const national = new Map();
    [[data.dailyPriceSummaries, local, false], [data.nationalDailyPriceSummaries, national, true]].forEach(([rows, target, isNational]) => {
      rows.forEach(row => {
        if (!samePriceScope(row) || !positive(row.median) || !positive(row.marketCount) || (!isNational && !row.provinceId)) return;
        target.set(summaryKey(row, isNational), row);
      });
    });
    return { local, national };
  }
  function buildPriceEvidence(data, provinceId, period) {
    const { local, national } = priceSummaries(data);
    const knownDates = [...national.values()].map(row => row.observedDate).sort();
    const end = chinaDate(data.generatedAt) || knownDates.at(-1) || null;
    if (!end) return { byItem: new Map(), window: { start: null, end: null } };
    const start = period === 'week' ? shiftDate(end, -6) : null;
    const items = new Set([...national.values()].map(row => row.itemId));
    const byItem = new Map();
    items.forEach(itemId => {
      const candidates = [...national.values()].filter(row => row.itemId === itemId && row.observedDate <= end &&
        (period !== 'week' || row.observedDate >= start)).sort((a, b) => textCompare(a.observedDate, b.observedDate));
      const selected = period === 'week' ? candidates : candidates.slice(-1);
      const pairs = selected.map(nationalRow => ({ national: nationalRow,
        local: local.get([itemId, provinceId, nationalRow.observedDate].join('|')) })).filter(pair => pair.local);
      if (!pairs.length) return;
      const localPrice = mean(pairs.map(pair => pair.local.median));
      const nationalPrice = mean(pairs.map(pair => pair.national.median));
      const localCounts = pairs.map(pair => pair.local.marketCount);
      const nationalCounts = pairs.map(pair => pair.national.marketCount);
      const sourceUrls = [...new Set(pairs.flatMap(pair => pair.local.sourceUrls || []))].sort();
      byItem.set(itemId, { itemId, itemName: pairs[0].local.itemName,
        localPrice, nationalPrice,
        localMarketCount: Math.min(...localCounts), localMarketCountRange: [Math.min(...localCounts), Math.max(...localCounts)],
        nationalMarketCount: Math.min(...nationalCounts), nationalMarketCountRange: [Math.min(...nationalCounts), Math.max(...nationalCounts)],
        observedDates: pairs.map(pair => pair.national.observedDate),
        sampleDays: pairs.length, expectedCalendarDays: period === 'week' ? 7 : 1,
        sourceUrl: sourceUrls[0] || null, sourceUrls,
        score: clamp(50 + 100 * (nationalPrice - localPrice) / nationalPrice),
        method: period === 'week' ? '同观测日集合的每日市场中位数均值比较' : '同日市场样本中位数比较' });
    });
    return { byItem, window: { start, end } };
  }
  function recommend(data, options) {
    data = data && typeof data === 'object' ? data : {};
    options = options && typeof options === 'object' ? options : {};
    const sourceId = options.sourceId || '';
    const provinceId = String(options.provinceId || '');
    const period = options.period === 'week' ? 'week' : 'day';
    const ingredientId = typeof options.ingredientId === 'string' ? options.ingredientId : '';
    const strategy = Object.hasOwn(strategies, options.strategy) ? options.strategy : 'balanced';
    const weights = { ...strategies[strategy] };
    if (!ingredientId) weights.favorite = 0;
    const weightTotal = weights.rank + weights.favorite + weights.price;
    Object.keys(weights).forEach(key => { weights[key] /= weightTotal; });
    const recipes = (data.recipeRankings || []).filter(recipe => recipe.sourceId === sourceId && recipe.isSynthetic === false &&
      Number.isInteger(recipe.rank) && recipe.rank > 0 && recipe.id).slice().sort((a, b) => a.rank - b.rank || textCompare(a.id, b.id));
    const matchingSignals = (data.ingredientSignals || []).filter(signal => signal.sourceId === sourceId && signal.ingredientId === ingredientId && signal.isSynthetic === false);
    const priceEvidence = buildPriceEvidence(data, provinceId, period);
    const ranked = [];
    const exclusions = [];
    recipes.forEach(recipe => {
      const ingredientNames = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
      const exactItems = [...new Set(ingredientNames.map(matchPriceItem).filter(Boolean))];
      const priceMatches = exactItems.map(itemId => priceEvidence.byItem.get(itemId)).filter(Boolean).map(match => ({ ...match,
        matchedIngredients: ingredientNames.filter(name => matchPriceItem(name) === match.itemId) }));
      if (weights.price > 0 && !priceMatches.length) {
        exclusions.push({ recipeId: recipe.id, reason: 'no_comparable_local_price' });
        return;
      }
      const favoriteMatch = ingredientId ? matchingSignals.some(signal =>
        (!signal.capturedDate || !recipe.capturedDate || signal.capturedDate === recipe.capturedDate) &&
        (signal.sourceRecipeIds || []).includes(recipe.id)) : null;
      const components = {
        rank: recipes.length === 1 ? 100 : clamp(100 * (recipes.length - recipe.rank) / (recipes.length - 1)),
        favorite: ingredientId ? (favoriteMatch ? 100 : 0) : null,
        price: priceMatches.length ? mean(priceMatches.map(match => match.score)) : null
      };
      const contributions = { rank: weights.rank * components.rank,
        favorite: weights.favorite * (components.favorite ?? 0), price: weights.price * (components.price ?? 0) };
      ranked.push({ recipe, score: contributions.rank + contributions.favorite + contributions.price,
        components, contributions, priceMatches, favoriteMatch });
    });
    ranked.sort((a, b) => b.score - a.score || a.recipe.rank - b.recipe.rank || textCompare(a.recipe.id, b.recipe.id));
    return { weights, ranked, excluded: exclusions.length, total: recipes.length, exclusions,
      sourceId, provinceId, period, ingredientId, strategy, window: priceEvidence.window,
      methodology, isSimulation: true, paperModelConnected: false };
  }
  return Object.freeze({ recommend, matchPriceItem, strategies, methodology });
});
