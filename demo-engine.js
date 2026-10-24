/*
 * Recipe paper website — synthetic interaction engine, version 0.1.0.
 * This is NOT the user's paper algorithm and NOT an efficacy experiment.
 * Every feature value and region/season association below is deliberately
 * authored for interface demonstration. Values are not measured nutrients,
 * health scores, food-safety guarantees, or clinical recommendations.
 *
 * Browser: globalThis.RecipeDemo; Node: require('./demo-engine.js').
 * Keep this adapter contract when replacing this file with the real algorithm.
 */
(function (root) {
  'use strict';

  const keys = ['taste', 'nutrition', 'health', 'region', 'season'];
  const dimensions = [
    { key: 'taste', label: '口味', color: '#d37250' },
    { key: 'nutrition', label: '营养', color: '#81a76a' },
    { key: 'health', label: '健康', color: '#4e827b' },
    { key: 'region', label: '地域', color: '#9b87b4' },
    { key: 'season', label: '时令', color: '#d8ae59' }
  ];
  const regionLabels = { any: '不限', jiangzhe: '江浙', chuangxiang: '川湘', yue: '粤式', north: '北方' };
  const seasonLabels = { any: '不限', spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' };
  const allergenLabels = { egg: '蛋', soy: '大豆', nut: '花生 / 坚果', fish: '鱼', shellfish: '虾蟹贝类', milk: '奶', wheat: '小麦' };
  const nutritionLabels = { balanced: '均衡', protein: '蛋白优先', plant: '蔬菜优先' };
  const healthLabels = { light: '清淡', less_oil: '少油', less_salt: '少盐' };

  const metadata = {
    id: 'synthetic-recipe-demo',
    version: '0.1.0',
    label: '合成数据 · 示例规则',
    isSynthetic: true,
    source: '为交互原型手工编写的 16 条示例记录；没有使用论文数据或实验结果。',
    modelType: '归一化权重的线性加权示例；不是论文推荐模型。',
    scoreMeaning: '0–100 是当前示例规则下的匹配分，不是概率、营养测量值或健康效果。',
    neutralScore: 70,
    mismatchScore: 40,
    normalization: '硬排除后，仅在启用且权重大于零的维度之间归一化；总权重为零时不排序。',
    unconstrainedDimensions: '地域 / 时令选“不限”时，该维度对每道菜统一赋 70 分。',
    notice: '菜名用于说明交互。属性、配方与标签均为示例，不可用于真实过敏管理、营养计算或临床饮食决策。',
    knownLimitations: [
      '口味仅以示例辣度代表，不能覆盖完整感官偏好。',
      '营养与健康选项仅选择合成标签分，不含个体健康数据。',
      '地域及时令标签用于观察排序变化，不是产地或食材时令数据库。',
      '排除项只检查示例配方中已标注的标签，不包含交叉接触、调味料变体或其它过敏原。',
      '此处的单因素关闭和口味基线仅说明交互，不能证明论文优于任何基线。'
    ]
  };

  function recipe(id, name, subtitle, region, seasons, ingredients, allergens, spice, nutrition, health) {
    return {
      id, name, subtitle, region, seasons, ingredients, allergens,
      features: {
        spice,
        nutrition: { balanced: nutrition[0], protein: nutrition[1], plant: nutrition[2] },
        health: { light: health[0], less_oil: health[1], less_salt: health[2] }
      },
      dataOrigin: 'synthetic'
    };
  }

  const recipes = [
    recipe('r01', '清蒸鲈鱼', '鱼肉与姜葱的示例组合', 'yue', ['spring', 'autumn'], ['鲈鱼', '姜', '葱', '酱油'], ['fish', 'soy'], 0, [78, 94, 23], [95, 94, 76]),
    recipe('r02', '番茄炒蛋', '家常蔬菜与蛋的示例组合', 'north', ['summer'], ['番茄', '鸡蛋', '葱'], ['egg'], 0, [87, 67, 74], [80, 64, 86]),
    recipe('r03', '香菇蒸鸡', '菌菇与鸡肉的示例组合', 'yue', ['autumn', 'winter'], ['鸡肉', '香菇', '姜', '酱油'], ['soy'], 0, [84, 92, 48], [91, 90, 79]),
    recipe('r04', '麻婆豆腐', '豆腐与香辛料的示例组合', 'chuangxiang', ['spring', 'summer', 'autumn', 'winter'], ['豆腐', '牛肉末', '花椒', '豆瓣酱'], ['soy'], 3, [78, 81, 66], [31, 38, 42]),
    recipe('r05', '西兰花虾仁', '蔬菜与虾仁的示例组合', 'yue', ['spring', 'autumn'], ['西兰花', '虾仁', '蒜', '酱油'], ['shellfish', 'soy'], 0, [95, 88, 83], [87, 77, 82]),
    recipe('r06', '莲藕排骨汤', '根茎与排骨的示例组合', 'jiangzhe', ['autumn', 'winter'], ['莲藕', '排骨', '姜', '蘸料酱油'], ['soy'], 0, [88, 79, 72], [89, 88, 85]),
    recipe('r07', '葱油拌面', '面食与葱香的示例组合', 'jiangzhe', ['spring', 'summer'], ['小麦面条', '葱', '酱油'], ['wheat', 'soy'], 0, [54, 35, 29], [63, 37, 48]),
    recipe('r08', '牛肉菌菇煲', '牛肉与菌菇的示例组合', 'north', ['autumn', 'winter'], ['牛肉', '杏鲍菇', '洋葱', '酱油'], ['soy'], 1, [90, 96, 59], [70, 66, 63]),
    recipe('r09', '山药木耳炒蛋', '山药与木耳的示例组合', 'jiangzhe', ['autumn', 'winter'], ['山药', '木耳', '鸡蛋'], ['egg'], 0, [91, 60, 94], [88, 73, 90]),
    recipe('r10', '宫保鸡丁', '鸡肉与花生的示例组合', 'chuangxiang', ['spring', 'summer', 'autumn', 'winter'], ['鸡肉', '花生', '辣椒', '酱油'], ['nut', 'soy'], 2, [83, 91, 35], [40, 45, 46]),
    recipe('r11', '奶香南瓜燕麦粥', '南瓜与谷物的示例组合', 'north', ['autumn', 'winter'], ['南瓜', '燕麦', '牛奶'], ['milk'], 0, [80, 53, 81], [93, 97, 96]),
    recipe('r12', '韭菜鸡蛋饺子', '面皮与蔬菜蛋馅的示例组合', 'north', ['spring'], ['小麦面皮', '韭菜', '鸡蛋'], ['wheat', 'egg'], 0, [82, 61, 77], [73, 71, 73]),
    recipe('r13', '芦笋豆腐煲', '芦笋与豆腐的示例组合', 'jiangzhe', ['spring'], ['芦笋', '豆腐', '香菇'], ['soy'], 0, [92, 73, 98], [94, 87, 92]),
    recipe('r14', '青椒牛肉丝', '青椒与牛肉的示例组合', 'chuangxiang', ['summer', 'autumn'], ['青椒', '牛肉', '姜', '酱油'], ['soy'], 2, [89, 94, 64], [48, 55, 56]),
    recipe('r15', '虾仁冬瓜汤', '冬瓜与虾仁的示例组合', 'yue', ['summer'], ['冬瓜', '虾仁', '姜'], ['shellfish'], 0, [86, 76, 90], [97, 98, 93]),
    recipe('r16', '豉香蒸茄子', '茄子与豆豉的示例组合', 'chuangxiang', ['summer', 'autumn'], ['茄子', '豆豉', '蒜', '辣椒'], ['soy'], 1, [72, 38, 97], [76, 86, 57])
  ];

  const defaultProfile = {
    spice: 1,
    nutrition: 'balanced',
    health: 'light',
    region: 'jiangzhe',
    season: 'autumn',
    exclusions: [],
    weights: { taste: 3, nutrition: 3, health: 3, region: 2, season: 2 }
  };

  const presets = [
    {
      id: 'balanced', label: '均衡探索', description: '同时观察五个维度的作用',
      profile: { ...defaultProfile, exclusions: [], weights: { ...defaultProfile.weights } }
    },
    {
      id: 'spicy', label: '偏爱香辣', description: '提高辣度与口味权重，偏好川湘示例标签',
      profile: { ...defaultProfile, spice: 3, region: 'chuangxiang', exclusions: [], weights: { taste: 5, nutrition: 2, health: 1, region: 4, season: 1 } }
    },
    {
      id: 'light', label: '少油偏好', description: '提高少油示例标签的权重',
      profile: { ...defaultProfile, spice: 0, health: 'less_oil', region: 'any', exclusions: [], weights: { taste: 2, nutrition: 3, health: 5, region: 1, season: 2 } }
    },
    {
      id: 'seasonal', label: '春日蔬菜', description: '偏好蔬菜标签与春季示例标签',
      profile: { ...defaultProfile, spice: 0, nutrition: 'plant', season: 'spring', exclusions: [], weights: { taste: 2, nutrition: 4, health: 2, region: 1, season: 5 } }
    }
  ];

  function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function normalizeProfile(input) {
    const p = input && typeof input === 'object' ? input : {};
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const weights = {};
    keys.forEach(function (key) {
      const value = p.weights && own(p.weights, key) ? p.weights[key] : defaultProfile.weights[key];
      weights[key] = clampNumber(value, defaultProfile.weights[key], 0, 5);
    });
    return {
      spice: clampNumber(p.spice, defaultProfile.spice, 0, 3),
      nutrition: own(nutritionLabels, p.nutrition) ? p.nutrition : defaultProfile.nutrition,
      health: own(healthLabels, p.health) ? p.health : defaultProfile.health,
      region: own(regionLabels, p.region) ? p.region : defaultProfile.region,
      season: own(seasonLabels, p.season) ? p.season : defaultProfile.season,
      exclusions: Array.isArray(p.exclusions) ? Array.from(new Set(p.exclusions.filter(key => own(allergenLabels, key)))) : [],
      weights
    };
  }

  function componentScores(item, p) {
    return {
      taste: 100 * (1 - Math.abs(item.features.spice - p.spice) / 3),
      nutrition: item.features.nutrition[p.nutrition],
      health: item.features.health[p.health],
      region: p.region === 'any' ? 70 : item.region === p.region ? 100 : 40,
      season: p.season === 'any' ? 70 : item.seasons.includes(p.season) ? 100 : 40
    };
  }

  function explanationFor(item, p, components, contributions, normalizedWeights) {
    const messages = {
      taste: '口味示例匹配 ' + components.taste.toFixed(0) + ' / 100；菜谱辣度 ' + item.features.spice + ' / 3',
      nutrition: nutritionLabels[p.nutrition] + '示例标签 ' + components.nutrition.toFixed(0) + ' / 100',
      health: healthLabels[p.health] + '示例标签 ' + components.health.toFixed(0) + ' / 100',
      region: p.region === 'any' ? '未指定地域：统一使用中性分 70' : regionLabels[item.region] + '示例标签；地域匹配 ' + components.region + ' / 100',
      season: p.season === 'any' ? '未指定时令：统一使用中性分 70' : seasonLabels[p.season] + '示例匹配 ' + components.season + ' / 100'
    };
    return keys.filter(key => normalizedWeights[key] > 0)
      .sort((a, b) => contributions[b] - contributions[a] || keys.indexOf(a) - keys.indexOf(b))
      .slice(0, 3)
      .map(key => messages[key]);
  }

  function evaluate(profile, options) {
    const p = normalizeProfile(profile);
    const disabled = new Set(options && Array.isArray(options.disabledDimensions) ? options.disabledDimensions : []);
    const weights = {};
    keys.forEach(key => { weights[key] = disabled.has(key) ? 0 : p.weights[key]; });
    const totalWeight = keys.reduce((sum, key) => sum + weights[key], 0);
    const normalizedWeights = {};
    keys.forEach(key => { normalizedWeights[key] = totalWeight ? weights[key] / totalWeight : 0; });

    // Hard exclusions are applied independently of scores and all weighting modes.
    const rejected = [];
    const accepted = [];
    recipes.forEach(function (item) {
      const matches = item.allergens.filter(key => p.exclusions.includes(key));
      if (matches.length) {
        rejected.push({ recipe: item, reasons: matches.map(key => '命中示例排除标签：' + allergenLabels[key]) });
      } else {
        accepted.push(item);
      }
    });

    if (totalWeight === 0) {
      return { ranked: [], rejected, normalizedWeights, invalidWeights: true };
    }

    const ranked = accepted.map(function (item) {
      const components = componentScores(item, p);
      const contributions = {};
      keys.forEach(key => { contributions[key] = components[key] * normalizedWeights[key]; });
      const score = keys.reduce((sum, key) => sum + contributions[key], 0);
      return {
        recipe: item, score, components, contributions,
        explanation: explanationFor(item, p, components, contributions, normalizedWeights)
      };
    });
    ranked.sort((a, b) => b.score - a.score || (a.recipe.id < b.recipe.id ? -1 : a.recipe.id > b.recipe.id ? 1 : 0));
    return { ranked, rejected, normalizedWeights, invalidWeights: false };
  }

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(key => deepFreeze(value[key]));
      Object.freeze(value);
    }
    return value;
  }

  const api = deepFreeze({
    keys, dimensions, metadata, recipes, defaultProfile, presets,
    regionLabels, seasonLabels, allergenLabels, nutritionLabels, healthLabels,
    normalizeProfile, evaluate
  });
  root.RecipeDemo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
