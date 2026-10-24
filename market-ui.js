(function () {
  'use strict';
  const market = globalThis.RecipeMarket;
  const map = globalThis.ChinaMapData;
  const base = globalThis.RecipeDemo;
  const byId = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  if (!market || !map || !base) {
    byId('atlas-svg').innerHTML = '<p class="small-note">地图资源未完整加载，请刷新页面后重试。</p>';
    return;
  }
  let context = clone(market.defaultContext);
  let profile = globalThis.RecipeLab ? globalThis.RecipeLab.getProfile() : clone(base.defaultProfile);
  let metric = 'price';
  let recommendation;
  let mapValueById = {};
  let toastTimer;
  const metrics = {
    price: { title: '同一菜篮子的示例成本', low: '#e9efdc', high: '#5b8966', format: value => '¥' + value.toFixed(2), hint: '2 kg 固定篮子' },
    season: { title: '当季食材数量 · 合成标签', low: '#f3edd7', high: '#a58f40', format: value => value + ' 种', hint: '同一食材库' },
    trend: { title: '食材平均热度 · 合成指数', low: '#f1e9de', high: '#ad735b', format: value => value + ' 分', hint: '0–100 示例值' }
  };

  byId('atlas-province').innerHTML = market.provinces.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  byId('atlas-month').innerHTML = Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}">${index + 1} 月</option>`).join('');
  byId('atlas-strategies').innerHTML = market.strategies.map(s => `<button type="button" data-strategy="${s.id}" aria-pressed="${s.id === context.strategy}">${esc(s.label)}</button>`).join('');

  function drawMap() {
    const shapes = map.regions.map(r => `<g class="map-region" data-map-region="${r.id}" role="button" tabindex="0" aria-pressed="false" aria-label="选择${esc(r.fullName || r.name)}"><title>${esc(r.name)}</title><path class="province-shape" d="${r.path}" fill="#d7e4c9"></path></g>`).join('');
    const labels = map.regions.map(r => `<g class="map-region map-label-overlay" data-map-region="${r.id}" aria-hidden="true">${r.callout ? `<path class="map-callout" d="M${r.callout.from.join(',')}L${r.callout.to.join(',')}"></path>` : ''}<rect class="map-label-hit" x="${r.label[0] - (r.name.length * 7 + 5)}" y="${r.label[1] - 11}" width="${r.name.length * 14 + 10}" height="23" rx="3"></rect><text class="province-name${r.callout ? ' small-province-label' : ''}" x="${r.label[0]}" y="${r.label[1]}" text-anchor="middle" dominant-baseline="middle">${esc(r.name)}</text></g>`).join('');
    const inset = map.inset ? `<rect class="map-inset-box" x="${map.inset.x}" y="${map.inset.y}" width="${map.inset.width}" height="${map.inset.height}" rx="3"></rect>${map.regions.filter(r => r.insetPath).map(r => `<g class="map-region" data-map-region="${r.id}" aria-hidden="true"><path class="province-shape" d="${r.insetPath}" fill="#d7e4c9"></path></g>`).join('')}<path class="map-sea-boundary" d="${map.insetBoundaryPath || ''}" aria-hidden="true"></path><text class="map-inset-label" x="${map.inset.label[0]}" y="${map.inset.label[1]}">${esc(map.inset.title)}</text>` : '';
    byId('atlas-svg').innerHTML = `<svg viewBox="${map.viewBox}" role="group" aria-label="中国省级地区选择地图"><desc>点击或用键盘选择省级地区，查看食材与推荐；也可使用上方地区菜单。地图颜色表示合成示例指标。</desc>${shapes}<path class="map-sea-boundary" d="${map.boundaryPath || ''}" aria-hidden="true"></path>${inset}${labels}</svg>`;
    byId('atlas-map-source').innerHTML = `地图边界：<a href="${esc(map.source.documentationUrl)}" target="_blank" rel="noopener noreferrer">DataV.GeoAtlas · 高德</a>，学习交流用。地图小区域也可通过上方菜单选择。`;
  }

  function mixColor(a, b, t) {
    const rgb = color => [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
    const left = rgb(a), right = rgb(b);
    return '#' + left.map((value, i) => Math.round(value + (right[i] - value) * t).toString(16).padStart(2, '0')).join('');
  }

  function hoverText(id) {
    const province = market.provinces.find(p => p.id === id);
    if (!province) return;
    byId('atlas-hover').textContent = `${province.name} · ${metrics[metric].format(mapValueById[id])} · ${metrics[metric].hint}`;
  }

  function updateMap() {
    const values = market.mapValues(context, metric);
    mapValueById = Object.fromEntries(values.map(row => [row.id, row.value]));
    const min = Math.min(...values.map(row => row.value)), max = Math.max(...values.map(row => row.value));
    const theme = metrics[metric];
    document.querySelectorAll('[data-map-region]').forEach(element => {
      const id = element.dataset.mapRegion;
      const selected = id === context.provinceId;
      element.setAttribute('aria-pressed', String(selected));
      const shape = element.querySelector('.province-shape');
      const value = mapValueById[id];
      if (shape) shape.setAttribute('fill', selected ? '#244c3d' : mixColor(theme.low, theme.high, max === min ? 0.5 : (value - min) / (max - min)));
      if (element.getAttribute('role') === 'button') {
        const region = market.provinces.find(p => p.id === id);
        element.setAttribute('aria-label', `${region.name}，${theme.format(value)}${selected ? '，已选择' : '，点击选择'}`);
        element.querySelector('title').textContent = `${region.name} · ${theme.format(value)}（合成示例）`;
      }
    });
    document.querySelectorAll('[data-province]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.province === context.provinceId)));
    document.querySelectorAll('[data-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.metric === metric)));
    byId('atlas-legend-title').textContent = theme.title;
    byId('atlas-scale-min').textContent = theme.format(min);
    byId('atlas-scale-max').textContent = theme.format(max);
    byId('atlas-gradient').style.background = `linear-gradient(90deg,${theme.low},${theme.high})`;
    byId('atlas-map-hint').innerHTML = `<span>${context.month} 月 · ${market.provinces.length} 个省级地区</span><strong>选择购买地，探索当地食材</strong>`;
    hoverText(context.provinceId);
  }

  function seasonText(item) {
    return item.inSeason ? '当季示例' : item.seasonal ? '非当季示例' : '全年标签';
  }

  function renderRegion() {
    const snap = recommendation.snapshot;
    byId('atlas-region-name').textContent = snap.province.name;
    byId('atlas-season-tag').textContent = snap.seasonLabel + '情境';
    byId('atlas-region-caption').textContent = `${context.month} 月 · 购买地食材画像 · 合成示例`;
    byId('atlas-basket').textContent = '¥' + snap.basketCost.toFixed(2);
    byId('atlas-basket').title = market.metadata.basketMeaning;
    byId('atlas-season-count').textContent = snap.seasonalCount + ' 种';
    byId('atlas-trend-index').textContent = snap.trendIndex;
    const featured = snap.items.slice().sort((a, b) => Number(b.inSeason) - Number(a.inSeason) || b.trend - a.trend || a.id.localeCompare(b.id)).slice(0, 5);
    byId('atlas-ingredient-list').innerHTML = featured.map((item, index) => `<div class="atlas-ingredient"><span class="atlas-ingredient-icon" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><div><div class="atlas-ingredient-name">${esc(item.name)}</div><div class="atlas-ingredient-tags"><span class="${item.inSeason ? 'in-season' : ''}">${seasonText(item)}</span><span>热度 ${item.trend}</span></div></div><span class="atlas-ingredient-price"><small>¥</small>${item.price.toFixed(2)}</span></div>`).join('');
    byId('atlas-all-prices').innerHTML = snap.items.map(item => `<tr><td>${esc(item.name)}</td><td>${item.price.toFixed(2)}</td><td>${seasonText(item)}</td><td>${item.trend}</td></tr>`).join('');
  }

  function recipeCard(row, index) {
    const seasonal = row.ingredients.filter(item => item.inSeason).map(item => item.name);
    return `<article class="atlas-recipe"><div class="atlas-recipe-main"><div class="atlas-recipe-top"><span class="atlas-recipe-rank">RECIPE / 0${index + 1}</span><div><div class="atlas-recipe-cost"><small>¥</small>${row.cost.toFixed(2)}</div><p class="atlas-recipe-cost-caption">2 人份主料 · 示例估算</p></div></div><h4>${esc(row.recipe.name)}</h4><p class="atlas-recipe-ingredients">${esc(row.ingredients.map(i => i.name).join(' · '))}</p><div class="atlas-recipe-tags"><span class="atlas-recipe-tag">${seasonal.length ? '当季主料 ' + seasonal.length + ' 种' : '时令分 ' + row.components.season.toFixed(0)}</span><span class="atlas-recipe-tag trend-tag">热度 ${row.components.trend.toFixed(0)}</span><span class="atlas-recipe-tag ${row.cost <= context.budget ? 'budget-tag' : 'over-budget'}">${row.cost <= context.budget ? '预算内' : '超出预算'}</span></div><ul class="atlas-recipe-reasons">${row.explanation.slice(1).map(line => `<li>${esc(line)}</li>`).join('')}</ul><div class="atlas-recipe-score"><span>综合示例分</span><b>${row.score.toFixed(1)} / 100</b></div><div class="atlas-stack" aria-label="四项加权贡献">${market.dimensions.map(d => `<span style="width:${row.contributions[d.key]}%;background:${d.color}" title="${d.label}贡献 ${row.contributions[d.key].toFixed(2)} 分"></span>`).join('')}</div></div><details class="atlas-recipe-details"><summary>为什么推荐 · 查看成本与得分</summary><div class="atlas-recipe-breakdown">${market.dimensions.map(d => `<div class="atlas-contribution-line"><span><i style="background:${d.color}"></i>${d.label}</span><span>${row.components[d.key].toFixed(1)} × ${(recommendation.weights[d.key] * 100).toFixed(0)}% = ${row.contributions[d.key].toFixed(1)}</span></div>`).join('')}<table class="atlas-cost-table"><caption class="sr-only">${esc(row.recipe.name)}两人份示例主料成本</caption><thead><tr><th scope="col">主料</th><th scope="col">克数</th><th scope="col">元/kg</th><th scope="col">元</th></tr></thead><tbody>${row.ingredients.map(item => `<tr><td>${esc(item.name)}</td><td>${item.grams}</td><td>${item.price.toFixed(2)}</td><td>${item.cost.toFixed(2)}</td></tr>`).join('')}</tbody></table><p>成本按未舍入行金额求和后保留两位；贡献显示值四舍五入。不含辅料、调味料、能耗与损耗。</p></div></details></article>`;
  }

  function renderRecipes() {
    const snap = recommendation.snapshot;
    const strategy = market.strategies.find(s => s.id === context.strategy);
    byId('atlas-rec-title').textContent = `${snap.province.name} · ${context.month} 月，这几道值得试试。`;
    byId('atlas-budget-value').textContent = `¥${context.budget} / 2 人份`;
    document.querySelectorAll('[data-strategy]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.strategy === context.strategy)));
    const rejectedCount = recommendation.rejected.length;
    const exclusionText = profile.exclusions.length ? `，已应用 ${profile.exclusions.length} 项食材排除` : '';
    byId('atlas-rec-summary').textContent = `当前为「${strategy.label}」；${recommendation.ranked.length} 道可推荐，${rejectedCount} 道已排除${exclusionText}。下方个人五维偏好也参与计算。`;
    if (recommendation.invalidWeights) {
      byId('atlas-rec-summary').textContent = '个人偏好的全部权重为 0。请在下方偏好实验中启用至少一个维度。';
      byId('atlas-rec-cards').innerHTML = '<div class="empty-state"><h4>先设置一点你的偏好</h4><p>地图和食材信息仍可浏览；启用偏好维度后会重新计算推荐。</p><a class="text-link" href="#experiment">前往偏好实验 ↗</a></div>';
    } else if (!recommendation.ranked.length) {
      byId('atlas-rec-cards').innerHTML = '<div class="empty-state"><h4>当前条件下没有合适的候选</h4><p>预算与食材排除条件都已保留。可提高预算、取消“只看预算内”，或到偏好实验自行调整排除项。</p></div>';
    } else {
      byId('atlas-rec-cards').innerHTML = recommendation.ranked.slice(0, 3).map(recipeCard).join('');
    }
    byId('atlas-data-description').innerHTML = `<div class="atlas-weight-legend">${market.dimensions.map(d => `<span><i style="background:${d.color}"></i>${d.label} ${(recommendation.weights[d.key] * 100).toFixed(0)}%</span>`).join('')}</div><p><strong>数据来源：</strong>${esc(market.metadata.source)} ${esc(market.metadata.dateMeaning)}</p><p><strong>同口径比较：</strong>${esc(market.metadata.basketMeaning)} ${esc(market.metadata.currency)}</p><p><strong>当季与趋势：</strong>${esc(market.metadata.seasonMeaning)} ${esc(market.metadata.trendMeaning)}</p><p><strong>计算方式：</strong>${esc(market.metadata.formula)}</p><p><strong>个人偏好：</strong>沿用下方五维设置与食材排除；购买地不会改写地域风味偏好。月份用于主料的合成季节分，和个人选择的菜谱时令偏好分别计算。评分为交互示例，尚未接入论文。</p><p><strong>本次排除：</strong>${recommendation.rejected.length ? recommendation.rejected.map(row => esc(row.recipe.name) + '（' + row.reasons.map(esc).join('；') + '）').join('；') : '无。'}</p>`;
  }

  function syncControls() {
    byId('atlas-province').value = context.provinceId;
    byId('atlas-month').value = String(context.month);
    byId('atlas-budget').value = String(context.budget);
    byId('atlas-within-budget').checked = context.withinBudget;
  }

  function render(updateGeometry) {
    context = market.normalizeContext(context);
    recommendation = market.recommend(profile, context);
    if (updateGeometry) updateMap();
    renderRegion();
    renderRecipes();
    syncControls();
  }

  function selectProvince(id) {
    if (!market.provinces.some(p => p.id === id)) return;
    context.provinceId = id;
    render(true);
  }

  function record() {
    return {
      schemaVersion: '0.2.0', createdAt: new Date().toISOString(),
      dataMode: 'synthetic', paperConnected: false,
      metadata: clone(market.metadata), mapSource: clone(map.source),
      context: clone(context), profile: clone(profile), displayMetric: metric,
      recommendation: clone(recommendation),
      replay: 'RecipeMarket.recommend(record.profile, record.context)'
    };
  }

  function exportRecord() {
    const blob = new Blob([JSON.stringify(record(), null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `recipe-map-${context.provinceId}-${String(context.month).padStart(2, '0')}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    byId('toast').textContent = '已导出地区、月份、价格、个人偏好与推荐结果';
    byId('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => byId('toast').classList.remove('visible'), 3500);
  }

  byId('atlas-controls').addEventListener('submit', event => event.preventDefault());
  byId('atlas-province').addEventListener('change', () => selectProvince(byId('atlas-province').value));
  byId('atlas-month').addEventListener('change', () => { context.month = Number(byId('atlas-month').value); render(true); });
  byId('atlas-layers').addEventListener('click', event => { const button = event.target.closest('[data-metric]'); if (button) { metric = button.dataset.metric; updateMap(); } });
  byId('atlas-svg').addEventListener('click', event => { const region = event.target.closest('[data-map-region]'); if (region) selectProvince(region.dataset.mapRegion); });
  byId('atlas-svg').addEventListener('keydown', event => {
    const region = event.target.closest('[data-map-region]');
    if (region && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectProvince(region.dataset.mapRegion); }
  });
  byId('atlas-svg').addEventListener('pointerover', event => { const region = event.target.closest('[data-map-region]'); if (region) hoverText(region.dataset.mapRegion); });
  byId('atlas-svg').addEventListener('focusin', event => { const region = event.target.closest('[data-map-region]'); if (region) hoverText(region.dataset.mapRegion); });
  byId('atlas-svg').addEventListener('pointerleave', () => hoverText(context.provinceId));
  document.querySelector('.atlas-shortcuts').addEventListener('click', event => { const button = event.target.closest('[data-province]'); if (button) selectProvince(button.dataset.province); });
  byId('atlas-strategies').addEventListener('click', event => { const button = event.target.closest('[data-strategy]'); if (button) { context.strategy = button.dataset.strategy; render(false); } });
  byId('atlas-budget').addEventListener('input', () => { context.budget = Number(byId('atlas-budget').value); render(false); });
  byId('atlas-within-budget').addEventListener('change', () => { context.withinBudget = byId('atlas-within-budget').checked; render(false); });
  document.addEventListener('recipe-profile-change', event => { profile = clone(event.detail); render(false); });
  byId('atlas-export').addEventListener('click', exportRecord);
  globalThis.RecipeAtlas = Object.freeze({ getRecord: record });
  drawMap();
  render(true);
})();
