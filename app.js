(function () {
  'use strict';
  const engine = globalThis.RecipeDemo;
  if (!engine) {
    document.getElementById('hero-recipe').textContent = '示例引擎未载入';
    document.getElementById('live-summary').textContent = '请确保 demo-engine.js 与网页位于同一目录。';
    return;
  }
  const byId = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let profile = clone(engine.defaultProfile);
  let selectedId = null;
  let result;
  let comparisonResult;
  let toastTimer;
  const spiceLabels = ['不辣', '微辣', '中辣', '偏辣'];

  byId('presets').innerHTML = engine.presets.map(p => `<button type="button" class="preset" data-preset="${esc(p.id)}" title="${esc(p.description)}" aria-pressed="false">${esc(p.label)}</button>`).join('');
  byId('weight-controls').innerHTML = engine.dimensions.map(d => `<div class="weight-control" style="--weight-color:${d.color}"><label for="weight-${d.key}"><span class="dimension-dot" style="background:${d.color}" aria-hidden="true"></span>${esc(d.label)}</label><input id="weight-${d.key}" name="weight-${d.key}" type="range" min="0" max="5" step="1" value="${profile.weights[d.key]}" aria-label="${esc(d.label)}重要性"><output for="weight-${d.key}" id="value-${d.key}">${profile.weights[d.key]}</output></div>`).join('');
  byId('exclusions').innerHTML = Object.entries(engine.allergenLabels).map(([key, label]) => `<label class="exclusion-chip" for="exclude-${key}"><input type="checkbox" name="exclusion" id="exclude-${key}" value="${key}">${esc(label)}</label>`).join('');

  function syncControls() {
    ['spice', 'nutrition', 'health', 'region', 'season'].forEach(key => { byId(key).value = String(profile[key]); });
    engine.keys.forEach(key => { byId(`weight-${key}`).value = profile.weights[key]; });
    document.querySelectorAll('input[name="exclusion"]').forEach(input => { input.checked = profile.exclusions.includes(input.value); });
  }

  function readControls() {
    profile = {
      spice: Number(byId('spice').value), nutrition: byId('nutrition').value,
      health: byId('health').value, region: byId('region').value,
      season: byId('season').value,
      exclusions: Array.from(document.querySelectorAll('input[name="exclusion"]:checked'), input => input.value),
      weights: Object.fromEntries(engine.keys.map(key => [key, Number(byId(`weight-${key}`).value)]))
    };
  }

  function presetMatches(p) {
    return ['spice', 'nutrition', 'health', 'region', 'season'].every(k => p[k] === profile[k]) && engine.keys.every(k => p.weights[k] === profile.weights[k]);
  }

  function currentComparison() {
    const mode = byId('compare-mode').value;
    if (mode === 'taste') {
      return engine.evaluate({ ...profile, weights: { taste: 1, nutrition: 0, health: 0, region: 0, season: 0 } });
    }
    return engine.evaluate(profile, { disabledDimensions: [mode.replace('without-', '')] });
  }

  function emptyHtml(title, description) {
    return `<div class="empty-state"><h4>${esc(title)}</h4><p>${esc(description)}</p></div>`;
  }

  function renderHero() {
    const first = result.ranked[0];
    byId('hero-recipe').textContent = first ? first.recipe.name : result.invalidWeights ? '等待设置重要性' : '没有符合条件的菜谱';
    byId('hero-subtitle').textContent = first ? `${engine.regionLabels[first.recipe.region]}示例标签 · 排序分 ${first.score.toFixed(1)} / 100` : '修改条件后，预览将即时更新';
    byId('hero-bars').innerHTML = engine.dimensions.map(d => {
      const score = first ? first.components[d.key] : 0;
      return `<div class="hero-bar"><span>${esc(d.label)}</span><div class="hero-bar-track"><span style="width:${score}%;background:${d.color}"></span></div><b>${first ? score.toFixed(0) : '—'}</b></div>`;
    }).join('');
  }

  function renderCards() {
    const candidateCount = engine.recipes.length - result.rejected.length;
    byId('candidate-count').textContent = `${candidateCount} / ${engine.recipes.length} 个候选`;
    if (result.invalidWeights) {
      byId('live-summary').textContent = '当前所有维度的重要性均为 0，无法进行有意义的排序。';
      byId('top-results').innerHTML = emptyHtml('至少启用一个排序维度', '将任意重要性滑杆调到 1 或以上。硬排除条件仍保留。');
      return;
    }
    if (!result.ranked.length) {
      byId('live-summary').textContent = `全部 ${engine.recipes.length} 个示例候选都命中了排除条件。`;
      byId('top-results').innerHTML = emptyHtml('没有符合条件的结果', '系统不会自动放宽排除条件。可展开下方列表查看原因，或自行修改排除项。');
      return;
    }
    const picked = result.ranked.slice(0, 3);
    byId('live-summary').textContent = `从 ${candidateCount} 个可用示例中展示前 ${picked.length} 项；${result.rejected.length} 项已按食材标签排除。`;
    byId('top-results').innerHTML = picked.map((row, index) => `<button type="button" class="recipe-card" data-recipe="${esc(row.recipe.id)}" aria-pressed="${selectedId === row.recipe.id}" aria-label="查看${esc(row.recipe.name)}的推荐依据，排序分${row.score.toFixed(1)}"><span class="recipe-topline"><span class="rank-number">RANK 0${index + 1}</span><span class="recipe-score">${row.score.toFixed(1)}<small>分</small></span></span><span class="dish-mark" aria-hidden="true" style="--dish-color:${['#7c9a68', '#bd9864', '#7e9f94'][index]}"></span><span class="recipe-name">${esc(row.recipe.name)}</span><span class="recipe-subtitle">${esc(row.recipe.subtitle)}</span><span class="recipe-tags"><span class="tag">${esc(engine.regionLabels[row.recipe.region])}示例</span><span class="tag">${esc(row.recipe.seasons.length === 4 ? '四季示例' : row.recipe.seasons.map(s => engine.seasonLabels[s]).join(' · '))}</span></span><span class="recipe-link"><span>${selectedId === row.recipe.id ? '正在查看依据' : '查看推荐依据'}</span><span aria-hidden="true">↗</span></span></button>`).join('');
  }

  function renderExplanation() {
    const row = result.ranked.find(r => r.recipe.id === selectedId);
    if (!row) {
      byId('explanation').innerHTML = '<p class="small-note">获得有效推荐后，这里会展示真实计算得到的示例分解。</p>';
      return;
    }
    byId('explanation').innerHTML = `<div class="detail-content"><div class="explanation-copy"><h4>${esc(row.recipe.name)}</h4><p class="ingredient-list">示例食材：${esc(row.recipe.ingredients.join('、'))}</p><ul class="reason-list">${row.explanation.map(line => `<li>${esc(line)}</li>`).join('')}</ul><p class="explanation-note">以上来自当前示例属性与计算，不是论文模型解释。</p></div><div class="contribution-chart"><div class="contribution-legend"><span>加权后贡献 / 分</span><span>总分 ${row.score.toFixed(1)}</span></div>${engine.dimensions.map(d => `<div class="contribution-row" title="${esc(d.label)}：维度分 ${row.components[d.key].toFixed(2)} × 权重 ${(result.normalizedWeights[d.key] * 100).toFixed(2)}% = ${row.contributions[d.key].toFixed(2)} 分"><span>${esc(d.label)}</span><div class="contribution-track"><span style="width:${row.contributions[d.key]}%;background:${d.color}"></span></div><b>${row.contributions[d.key].toFixed(1)}</b></div>`).join('')}<p class="contribution-footer">未舍入贡献之和 = 排序分；显示值四舍五入；每条轨道 100 分</p></div></div>`;
  }

  function renderComparison() {
    comparisonResult = currentComparison();
    if (result.invalidWeights) {
      byId('comparison').innerHTML = '<p class="small-note">先为当前规则设置至少一个非零权重，再比较两种排序。</p>';
      return;
    }
    if (!result.ranked.length) {
      byId('comparison').innerHTML = '<p class="small-note">相同硬约束下，两侧均没有可推荐的候选。</p>';
      return;
    }
    const left = result.ranked.slice(0, 5), right = comparisonResult.ranked.slice(0, 5);
    const modeText = byId('compare-mode').selectedOptions[0].textContent;
    let rows = '';
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const same = left[i] && right[i] && left[i].recipe.id === right[i].recipe.id;
      rows += `<tr><td>${String(i + 1).padStart(2, '0')}</td><td>${left[i] ? esc(left[i].recipe.name) : '—'}</td><td>${right[i] ? esc(right[i].recipe.name) : '—'}${same ? '<span class="same-chip">相同</span>' : ''}</td></tr>`;
    }
    const leftTop = left.slice(0, 3).map(r => r.recipe.id), rightTop = right.slice(0, 3).map(r => r.recipe.id);
    const overlap = leftTop.filter(id => rightTop.includes(id)).length;
    byId('comparison').innerHTML = `<table class="comparison-table"><caption class="sr-only">当前规则与对照规则的前五项排序</caption><thead><tr><th scope="col">位次</th><th scope="col">当前五维设置</th><th scope="col">${esc(modeText)}</th></tr></thead><tbody>${rows}</tbody></table><p class="comparison-overlap">${comparisonResult.invalidWeights ? '关闭该维度后，有效权重总和为 0，对照侧不返回排序。' : `两侧前 ${Math.min(3, left.length, right.length)} 项共有 ${overlap} 道相同菜谱。这里只描述排序差异，不评价哪种方法更有效。`}</p>`;
  }

  function renderRejected() {
    byId('rejected-summary').textContent = `查看被硬约束排除的菜谱（${result.rejected.length}）`;
    byId('rejected-list').innerHTML = result.rejected.length ? result.rejected.map(row => `<div class="rejected-item"><span>${esc(row.recipe.name)}</span><span>${row.reasons.map(esc).join('；')}</span></div>`).join('') : '<p class="small-note" style="margin-top:10px">当前没有菜谱命中所选的示例排除标签。</p>';
  }

  function render() {
    result = engine.evaluate(profile);
    if (!result.ranked.slice(0, 3).some(row => row.recipe.id === selectedId)) selectedId = result.ranked[0]?.recipe.id || null;
    byId('spice-value').textContent = spiceLabels[profile.spice] || String(profile.spice);
    engine.keys.forEach(key => { byId(`value-${key}`).textContent = profile.weights[key]; });
    const total = engine.keys.reduce((sum, key) => sum + profile.weights[key], 0);
    byId('weight-total').textContent = total ? `当前重要性合计 ${total}，计算时自动归一化。` : '总和为 0，请至少启用一个维度。';
    engine.presets.forEach(p => document.querySelector(`[data-preset="${p.id}"]`).setAttribute('aria-pressed', String(presetMatches(p.profile))));
    renderHero(); renderCards(); renderExplanation(); renderComparison(); renderRejected();
  }

  function toast(message) {
    byId('toast').textContent = message;
    byId('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => byId('toast').classList.remove('visible'), 3500);
  }

  function exportCase() {
    const record = {
      schemaVersion: '0.1.0', createdAt: new Date().toISOString(),
      inferenceMode: 'synthetic_demo', paperConnected: false,
      metadata: engine.metadata,
      profile: clone(profile),
      current: result,
      comparison: { mode: byId('compare-mode').value, result: comparisonResult },
      selectedRecipeId: selectedId,
      replay: 'RecipeDemo.evaluate(record.profile)。对照为 taste 时使用仅 taste=1 的权重；否则使用 disabledDimensions。',
      note: '本记录仅包含合成数据和示例规则；不是用户论文结果或算法有效性的证据。'
    };
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'recipe-demo-case.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('已生成输入、排序与版本信息的 JSON 文件');
  }

  byId('settings').addEventListener('submit', event => event.preventDefault());
  byId('settings').addEventListener('input', () => { readControls(); render(); });
  byId('presets').addEventListener('click', event => {
    const button = event.target.closest('[data-preset]');
    if (!button) return;
    const preset = engine.presets.find(p => p.id === button.dataset.preset);
    const exclusions = profile.exclusions.slice();
    profile = clone(preset.profile);
    profile.exclusions = exclusions;
    syncControls(); render();
    if (exclusions.length) toast('已切换偏好场景，食材排除条件保持不变');
  });
  byId('top-results').addEventListener('click', event => {
    const button = event.target.closest('[data-recipe]');
    if (!button) return;
    selectedId = button.dataset.recipe;
    document.querySelectorAll('[data-recipe]').forEach(card => card.setAttribute('aria-pressed', String(card.dataset.recipe === selectedId)));
    document.querySelectorAll('[data-recipe] .recipe-link span:first-child').forEach(label => { label.textContent = label.closest('[data-recipe]').dataset.recipe === selectedId ? '正在查看依据' : '查看推荐依据'; });
    renderExplanation();
  });
  byId('compare-mode').addEventListener('change', renderComparison);
  byId('reset').addEventListener('click', () => {
    profile = clone(engine.defaultProfile); selectedId = null;
    byId('compare-mode').value = 'taste'; syncControls(); render();
    toast('已恢复默认情境，并清除食材排除项');
  });
  byId('export').addEventListener('click', exportCase);
  syncControls(); render();
})();
