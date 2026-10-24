(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : '#'; } catch (_) { return '#'; } };
  const link = (url, label) => `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  const num = value => Number.isFinite(value) ? value.toFixed(2) : '—';
  const pct = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—';
  const words = value => Array.isArray(value) ? value.join('；') : value || '';
  const formatTime = value => { if (!value || !Number.isFinite(Date.parse(value))) return '暂无成功记录'; return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)); };
  const chinaDay = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value || Date.now()));
  const dayOffset = (day, delta) => { const date = new Date(day + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + delta); return date.toISOString().slice(0,10); };
  const map = globalThis.ChinaMapData;
  let data = globalThis.ObservedFoodData;
  if (!data || !Array.isArray(data.observations) || !map) {
    $('feed-state').textContent = '公开数据资源未完整载入';
    $('feed-time').textContent = '请重新加载页面，或通过来源原页查看数据。';
    $('feed-light').classList.add('failed');
    return;
  }
  const state = {itemId:'tomato',provinceId:'330000',period:'day',sourceId:'xiachufang_weekly',ingredientId:'',strategy:'balanced',sourceFilter:'all'};
  let mapRows = new Map();
  let checking = false;
  let simToken = 0;
  let autoplayTimer = null;
  let autoStep = 0;
  const events = [];
  const strategies = {balanced:'综合观察',popular:'榜单优先',ingredient:'食材偏好优先','local-price':'本地价格机会'};
  const activeSource = s => !['reference_only','authorization_required','unavailable'].includes(s.status) && Boolean(s.collector || s.automated || s.hasObservedData);
  const sourceProblem = s => s.status !== 'ok' || s.collectionStatus === 'partial' || s.partial === true || Boolean(s.failures?.length) || Boolean(s.validationWarnings?.length);
  const sourceById = id => data.sources.find(s => s.id === id) || {};
  const provinceById = id => map.regions.find(r => r.id === id) || {name:id};
  const empty = text => `<div class="live-empty">${esc(text)}</div>`;

  function recordEvent(message, at) {
    events.unshift({message,at:at || new Date().toISOString()});
    events.splice(4);
    $('feed-events').innerHTML = events.map(e => `<li><time>${esc(formatTime(e.at))}</time><span>${esc(e.message)}</span></li>`).join('');
  }

  function syncOptions() {
    const foodNames = new Map(data.observations.map(r => [r.itemId,r.itemName]));
    const preferred = ['tomato','cucumber','potato','cabbage','egg','broccoli','lotus','eggplant','pepper'];
    const foods = [...foodNames].sort((a,b) => {
      const ai = preferred.indexOf(a[0]), bi = preferred.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a[1].localeCompare(b[1],'zh');
    });
    if (!foodNames.has(state.itemId)) state.itemId = foods[0]?.[0] || '';
    $('live-food').innerHTML = foods.map(([id,name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    $('live-food').value = state.itemId;
    $('live-province').innerHTML = map.regions.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    $('live-province').value = state.provinceId;
    const recipeSources = data.sources.filter(s => data.recipeRankings.some(r => r.sourceId === s.id)).sort((a,b) => (a.id === 'xiachufang_weekly' ? -1 : b.id === 'xiachufang_weekly' ? 1 : 0));
    if (!recipeSources.some(s => s.id === state.sourceId)) state.sourceId = recipeSources[0]?.id || '';
    $('live-ranking-source').innerHTML = recipeSources.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    $('live-ranking-source').value = state.sourceId;
    syncIngredients();
  }

  function syncIngredients() {
    const signals = data.ingredientSignals.filter(s => s.sourceId === state.sourceId).slice().sort((a,b) => b.value-a.value || a.name.localeCompare(b.name,'zh'));
    if (!signals.some(s => s.ingredientId === state.ingredientId)) state.ingredientId = '';
    $('sim-ingredient').innerHTML = '<option value="">不限食材</option>' + signals.map(s => `<option value="${esc(s.ingredientId)}">${esc(s.name)} · ${s.value} 道</option>`).join('');
    $('sim-ingredient').value = state.ingredientId;
  }

  function renderMetrics() {
    const connected = data.sources.filter(s => s.hasObservedData).length;
    const provinces = new Set(data.observations.map(r => r.geography.provinceId)).size;
    const markets = new Set(data.observations.map(r => r.geography.provinceId + ':' + r.geography.market)).size;
    const items = new Set(data.observations.map(r => r.itemId)).size;
    const cells = [
      ['已接入信息源',connected,'个','每项均有状态与原始入口'],
      ['报价覆盖地区',provinces,'个省级地区',`${markets} 个样本市场 · 缺失地区留白`],
      ['当前市场报价',data.observations.length.toLocaleString('zh-CN'),'条',`${items} 类食材 · 批发口径`],
      ['当前菜谱样本',data.recipeRankings.length,'道','分平台呈现 · 不合并热度分数']
    ];
    $('feed-metrics').innerHTML = cells.map(([label,value,unit,note]) => `<div class="feed-metric"><span>${label}</span><strong>${value}</strong><small>${unit}</small><p>${note}</p></div>`).join('');
    const stale = data.sources.filter(s => activeSource(s) && sourceProblem(s));
    $('feed-state').textContent = stale.length ? `${stale.length} 个来源存在更新异常，请查看状态` : '已载入可追溯的公开数据快照';
    $('feed-time').textContent = `最近成功采集：${formatTime(data.lastSuccessfulAt)}（北京时间） · 原始行情日期见下方`;
    $('feed-light').classList.toggle('failed',stale.length > 0);
  }

  function priceRows() {
    const daily = (data.dailyPriceSummaries || []).filter(r => r.sourceId === 'mofcom-daily-market' && r.itemId === state.itemId && r.unit === 'CNY/kg' && r.priceType === 'wholesale');
    const latestDate = daily.map(r => r.observedDate).sort().at(-1) || null;
    if (state.period === 'week') {
      const rows = (data.weeklyPriceSummaries || []).filter(r => r.sourceId === 'mofcom-daily-market' && r.itemId === state.itemId && r.unit === 'CNY/kg' && r.priceType === 'wholesale').map(r => ({...r,value:r.meanOfDailyMedians}));
      return {rows,daily,latestDate,selected:rows.find(r => r.provinceId === state.provinceId)};
    }
    const rows = daily.filter(r => r.observedDate === latestDate).map(r => ({...r,value:r.median}));
    return {rows,daily,latestDate,selected:rows.find(r => r.provinceId === state.provinceId)};
  }

  function drawMap() {
    const shape = (r,path,inset) => `<g class="map-region" data-real-region="${r.id}" ${inset ? 'aria-hidden="true"' : `role="button" tabindex="0" aria-label="选择${esc(r.name)}"`} aria-pressed="false"><title>${esc(r.name)}</title><path class="province-shape" d="${path}" fill="#e7e9e2"></path></g>`;
    const shapes = map.regions.map(r => shape(r,r.path,false)).join('');
    const labels = map.regions.map(r => `<g class="map-region map-label-overlay" data-real-region="${r.id}" aria-hidden="true">${r.callout ? `<path class="map-callout" d="M${r.callout.from.join(',')}L${r.callout.to.join(',')}"></path>` : ''}<rect class="map-label-hit" x="${r.label[0]-(r.name.length*7+5)}" y="${r.label[1]-11}" width="${r.name.length*14+10}" height="23" rx="3"></rect><text class="province-name${r.callout ? ' small-province-label':''}" x="${r.label[0]}" y="${r.label[1]}" text-anchor="middle" dominant-baseline="middle">${esc(r.name)}</text></g>`).join('');
    const inset = map.inset ? `<rect class="map-inset-box" x="${map.inset.x}" y="${map.inset.y}" width="${map.inset.width}" height="${map.inset.height}" rx="3"></rect>${map.regions.filter(r => r.insetPath).map(r => shape(r,r.insetPath,true)).join('')}<path class="map-sea-boundary" d="${map.insetBoundaryPath || ''}" aria-hidden="true"></path><text class="map-inset-label" x="${map.inset.label[0]}" y="${map.inset.label[1]}">${esc(map.inset.title)}</text>` : '';
    $('live-map-svg').innerHTML = `<svg viewBox="${map.viewBox}" role="group" aria-label="中国省级地区真实批发报价地图"><desc>点击地区或使用上方地区菜单。颜色代表已观测市场的价格派生值，灰色表示没有本期可比报价。</desc>${shapes}<path class="map-sea-boundary" d="${map.boundaryPath || ''}" aria-hidden="true"></path>${inset}${labels}</svg>`;
    const note = document.querySelector('.live-map-side > .live-small-note');
    note.innerHTML += ` 地图：${link(map.source.documentationUrl,'DataV.GeoAtlas · 高德')}，学习交流用。`;
  }

  function mapHover(id) {
    const row = mapRows.get(id);
    $('live-map-hover').textContent = `${provinceById(id).name} · ${row ? num(row.value)+' 元/kg' : '暂无可比报价'}`;
  }

  function updateMap(view) {
    mapRows = new Map(view.rows.map(r => [r.provinceId,r]));
    const values = view.rows.map(r => r.value).filter(Number.isFinite);
    const min = Math.min(...values), max = Math.max(...values);
    const mix = value => {
      const t = max === min ? .5 : (value-min)/(max-min);
      const a=[229,238,214],b=[81,127,90];
      return 'rgb('+a.map((v,i) => Math.round(v+(b[i]-v)*t)).join(',')+')';
    };
    $('live-map-svg').querySelectorAll('[data-real-region]').forEach(el => {
      const id = el.dataset.realRegion, row = mapRows.get(id), selected = id === state.provinceId;
      el.setAttribute('aria-pressed',String(selected));
      el.classList.toggle('no-price',!row);
      const path = el.querySelector('.province-shape');
      if (path) path.setAttribute('fill',row ? (selected ? '#244c3d' : mix(row.value)) : '#e7e9e2');
      const label = `${provinceById(id).name}，${row ? num(row.value)+' 元每公斤' : '暂无本期报价'}${selected ? '，已选择' : ''}`;
      if (el.getAttribute('role') === 'button') el.setAttribute('aria-label',label);
      if (el.querySelector('title')) el.querySelector('title').textContent = label;
    });
    $('live-min').textContent = values.length ? num(min) : '—';
    $('live-max').textContent = values.length ? num(max) : '—';
    $('live-price-unit').textContent = state.period === 'week' ? '元/kg · 可用日中位数的均值' : '元/kg · 省内样本市场中位数';
    const item = data.observations.find(r => r.itemId === state.itemId);
    $('live-map-title').textContent = `${item?.itemName || '食材'} · 全国报价观察`;
    const week = view.rows[0];
    $('live-price-date').textContent = state.period === 'week' ? `${week?.start || '—'} — ${week?.end || '—'}` : `原始行情日 ${view.latestDate || '暂无'}`;
    mapHover(state.provinceId);
  }

  function renderTrend(view) {
    const end = view.rows.find(r => r.end)?.end || chinaDay(data.generatedAt);
    const dates = Array.from({length:7},(_,i) => dayOffset(end,i-6));
    const daily = view.daily.filter(r => r.provinceId === state.provinceId && dates.includes(r.observedDate));
    const max = Math.max(1,...daily.map(r => r.median));
    const byDay = new Map(daily.map(r => [r.observedDate,r]));
    $('live-price-trend').innerHTML = `<div class="price-trend-heading"><span>近 7 天实际观测</span><strong>${byDay.size}/7 天</strong></div><div class="daily-bars" role="img" aria-label="近7天${byDay.size}天有报价，其余日期缺失">${dates.map(day => {
      const row=byDay.get(day);
      return `<div class="daily-bar" title="${day} · ${row ? num(row.median)+' 元/kg，'+row.marketCount+'个样本市场' : '无观测'}"><i class="${row ? '' : 'missing-bar'}" style="height:${row ? Math.max(8,Math.round(row.median/max*50)) : 2}px"></i><span>${day.slice(5).replace('-','/')}</span></div>`;
    }).join('')}</div><p class="price-trend-note">${byDay.size < 2 ? `仅 ${byDay.size} 个观测日，尚不足以判断周趋势。` : '各日柱高为当日市场样本中位数，市场覆盖可能变化。'} 缺失日不补值；前一期价不冒充另一个历史观测日。</p>`;
  }

  function renderPrice() {
    const view = priceRows(), row=view.selected;
    updateMap(view);
    const item = data.observations.find(r => r.itemId === state.itemId);
    const date = state.period === 'week' ? row?.latestObservedDate : view.latestDate;
    const quotes = data.observations.filter(q => q.sourceId === 'mofcom-daily-market' && q.itemId === state.itemId && q.geography.provinceId === state.provinceId && q.observedDate === date && q.unit === 'CNY/kg' && q.priceType === 'wholesale').sort((a,b) => a.value-b.value || a.geography.market.localeCompare(b.geography.market,'zh'));
    const source = sourceById('mofcom-daily-market');
    $('live-place-name').textContent = provinceById(state.provinceId).name;
    $('live-price-food').textContent = item?.itemName || '暂无食材';
    $('live-local-value').textContent = row ? num(row.value) : '—';
    const cached = source.status === 'stale' ? '采集失败，以下为保留的旧记录。' : sourceProblem(source) ? '来源存在部分更新异常，请核对本条行情日。' : '';
    $('live-local-caption').textContent = row ? (state.period === 'week' ? `${cached}近 7 天已观测 ${row.sampleDays}/7 天；已观测日的市场中位数均值。` : `${cached}${date} · 所采市场批发价中位数，不是零售价。`) : '本地区本期没有可比报价；保留缺失，可选择其他地区或食材。';
    const sample = state.period === 'week' ? (row?.marketCountRange || []).join('–') : row?.marketCount;
    const lower = state.period === 'week' ? row?.minDailyMedian : row?.min;
    const upper = state.period === 'week' ? row?.maxDailyMedian : row?.max;
    $('live-price-statline').innerHTML = `<div><span>${state.period === 'week' ? '每日市场样本' : '市场样本'}</span><strong>${sample || '—'}${sample ? ' 个' : ''}</strong></div><div><span>${state.period === 'week' ? '最低日中位数' : '最低市场报价'}</span><strong>${num(lower)}</strong></div><div><span>${state.period === 'week' ? '最高日中位数' : '最高市场报价'}</span><strong>${num(upper)}</strong></div>`;
    renderTrend(view);
    $('live-quote-count').textContent = quotes.length ? `${date} · ${quotes.length} 个市场` : '暂无本期报价';
    $('live-quote-list').innerHTML = quotes.length ? quotes.slice(0,3).map(q => `<div class="live-quote"><div>${link(q.sourceUrl,q.geography.market)}<small>本站计算变化 ${pct(q.changePct)} · 对比源表前一期</small></div><b>${num(q.value)}</b></div>`).join('') : empty('没有报价记录，推荐模拟也不会用示例价格补齐。');
    $('live-all-quotes').innerHTML = quotes.length ? quotes.map(q => `<tr><td>${link(q.sourceUrl,q.geography.market)}</td><td>${num(q.value)}</td><td>${num(q.priorValue)}</td><td>${pct(q.changePct)}</td><td>${pct(q.sourceChangePct)}</td></tr>`).join('') : '<tr><td colspan="5">暂无本期市场记录</td></tr>';
    $('live-price-attribution').innerHTML = `${link(source.url,'文章来源：商务部网站')} · 商务预报「百家日报」。抓取于 ${esc(formatTime(source.lastSuccessAt))}（北京时间）。${state.period === 'week' ? '上方明细为最近观测日原始报价。' : ''}本站变化率＝(当期价−前一期价)/前一期价；源表原值单列保留，可能不一致。`;
  }

  function recipeRow(recipe) {
    const isWeekly=recipe.sourceId === 'xiachufang_weekly';
    const count=isWeekly ? recipe.workCount : recipe.collectionCount;
    return `<div class="recipe-rank-row"><span class="recipe-rank-index">${String(recipe.rank).padStart(2,'0')}</span><div class="recipe-rank-info">${link(recipe.sourceUrl,recipe.title)}<p>${esc(recipe.ingredients.slice(0,5).join(' · '))}${recipe.ingredients.length>5 ? '…' : ''}</p></div><div class="recipe-rank-metric">${Number.isFinite(count) ? count.toLocaleString('zh-CN') : '—'}<small>${isWeekly ? '七天内做过' : '页面收藏人数'}</small></div></div>`;
  }

  function renderPopularity() {
    const source=sourceById(state.sourceId);
    const recipes=data.recipeRankings.filter(r => r.sourceId===state.sourceId).sort((a,b) => a.rank-b.rank);
    const signals=data.ingredientSignals.filter(s => s.sourceId===state.sourceId).sort((a,b) => b.value-a.value || a.name.localeCompare(b.name,'zh'));
    $('ingredient-signal-caption').textContent = `来自本次 ${recipes.length} 道菜谱的公开食材字段。条长＝出现次数 / 样本菜谱数，按平台单独统计。`;
    $('ingredient-signal-bars').innerHTML = signals.length ? signals.slice(0,8).map((s,i) => `<div class="ingredient-signal-row"><span>${esc(s.name)}</span><span class="signal-track"><i style="width:${s.sharePct}%;animation-delay:${i*35}ms"></i></span><b title="${s.value}/${s.sampleSize} 道菜谱">${s.value}/${s.sampleSize} <small>${s.sharePct.toFixed(0)}%</small></b></div>`).join('') : empty('这个平台暂时没有可用的食材样本。');
    $('recipe-signal-title').textContent = source.name || '暂无菜谱来源';
    $('recipe-ranking-origin').href=safeUrl(source.url);
    const window=recipes[0]?.window?.label || '来源未公布榜期';
    $('recipe-signal-caption').textContent = `${window}。采集：${formatTime(source.lastSuccessAt)}（北京时间）。${state.sourceId === 'xiachufang_weekly' ? '人数为平台标注的“七天内做过”；展示顺位不是人数排序。' : '收藏人数的累计区间未披露，不能解释为本周新增。'}${source.status === 'stale' ? '当前获取失败，保留旧快照。' : ''}`;
    $('recipe-ranking-list').innerHTML=recipes.length ? recipes.slice(0,5).map(recipeRow).join('') : empty('暂未取得此平台榜单。');
    $('recipe-ranking-more').innerHTML=recipes.map(recipeRow).join('');
  }

  function sourceStatus(source) {
    if (source.hasObservedData && (source.collectionStatus === 'partial' || source.partial === true || source.failures?.length || source.validationWarnings?.length)) return ['部分更新 · 请核验','partial'];
    if (source.status === 'ok' && source.hasObservedData) return ['已接入','ok'];
    if (source.hasObservedData) return ['旧记录 · 获取异常','stale'];
    if (source.status === 'authorization_required') return ['待授权 · 未接入','reference'];
    if (['unavailable','missing','error'].includes(source.status)) return ['当前不可用 · 未接入','stale'];
    return ['仅供参考 · 未接入','reference'];
  }

  function sourceCard(source) {
    const [status,cls]=sourceStatus(source), counts=source.recordCounts || {};
    const kind=source.kind==='price' || source.category==='price' ? 'PRICE / 市场报价' : source.category==='recipe_popularity' ? 'RECIPE / 菜谱榜单' : 'INTEREST / 关注信号';
    const records=[counts.observations ? `${counts.observations} 条市场报价` : '',counts.recipeRankings ? `${counts.recipeRankings} 道菜谱` : '',counts.ingredientSignals ? `${counts.ingredientSignals} 项派生食材信号` : ''].filter(Boolean).join('；') || '未向本站提供数据';
    const actualFrequency=activeSource(source) ? '每天 08:25、17:25（北京）低频检查' : '未运行定时采集';
    const frequency=source.sourceFrequency || (source.updateFrequency==='daily' ? '原始栏目按日发布，节假日或延迟以原页为准' : '未确认');
    const limitations=words(source.limitations);
    const metrics=words(source.metrics) || source.methodology || '来源入口与访问条件核验';
    return `<article class="source-card"><div class="source-card-top"><span class="source-card-kind">${kind}</span><span class="source-status ${cls}">${status}</span></div><h3>${esc(source.name)}</h3><p class="source-card-publisher">${esc(source.publisher || source.operator || '')}</p><dl><dt>本站记录</dt><dd>${esc(records)}</dd><dt>来源更新</dt><dd>${esc(frequency)}</dd><dt>本站检查</dt><dd>${actualFrequency}</dd><dt>成功采集</dt><dd>${source.lastSuccessAt ? esc(formatTime(source.lastSuccessAt))+'（北京时间）' : '暂无'}</dd><dt>原始日期</dt><dd>${esc(source.latestObservedDate || (counts.recipeRankings ? '平台未给出准确榜期；保留原始周期标签' : '暂无观测'))}</dd><dt>覆盖范围</dt><dd>${esc(source.scope || source.coverage || '尚未接入')}</dd></dl><details><summary>指标、接入方式与局限</summary><p><strong>指标：</strong>${esc(metrics)}</p><p><strong>接入：</strong>${esc(source.collectionMode || source.access || '')}</p>${limitations ? `<p><strong>局限：</strong>${esc(limitations)}</p>` : ''}${source.error ? `<p><strong>当前状态：</strong>${esc(source.error)}</p>` : ''}${source.validationWarnings?.length ? `<p><strong>数据校验：</strong>${esc(words(source.validationWarnings))}</p>` : ''}${source.changeMethodology ? `<p><strong>变化率：</strong>${esc(source.changeMethodology)}</p>` : ''}${source.attribution ? `<p>${esc(source.attribution)}</p>` : ''}${source.pages?.length ? `<p>保留 ${source.pages.length} 个原始响应的 SHA-256 与抓取地址，可在当前 JSON 快照的来源记录中复核。</p>` : ''}</details><div class="source-card-actions">${link(source.url,'原始入口 ↗')}${source.termsUrl ? link(source.termsUrl,'网站声明 ↗') : source.evidenceUrl && source.evidenceUrl!==source.url ? link(source.evidenceUrl,'官方说明 ↗') : ''}</div></article>`;
  }

  function renderSources() {
    const connected=data.sources.filter(s=>s.hasObservedData).length;
    $('source-connection-summary').textContent=`${connected} 项接入 · ${data.sources.length-connected} 项参考或待接入`;
    const list=data.sources.filter(s=>state.sourceFilter==='all' || (state.sourceFilter==='connected' ? s.hasObservedData : !s.hasObservedData)).slice().sort((a,b)=>Number(b.hasObservedData)-Number(a.hasObservedData) || (a.kind==='price' ? -1 : b.kind==='price' ? 1 : 0) || a.name.localeCompare(b.name,'zh'));
    $('source-catalog').innerHTML=list.map(sourceCard).join('') || empty('此分类暂无来源。');
    $('source-filter').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.sourceFilter===state.sourceFilter)));
  }

  function setStage(stage,complete) {
    $('sim-progress').querySelectorAll('[data-stage]').forEach(el=>{const value=Number(el.dataset.stage);el.classList.toggle('active',value===stage&&!complete);el.classList.toggle('complete',value<stage || complete);});
  }

  function simulationResult(result) {
    const source=sourceById(state.sourceId), province=provinceById(state.provinceId);
    const favorite=data.ingredientSignals.find(s=>s.sourceId===state.sourceId&&s.ingredientId===state.ingredientId)?.name;
    const auto=autoplayTimer ? '自动演示 · 同一期快照，仅切换偏好。' : '';
    $('sim-status').textContent=`${auto}${province.name} · ${source.name || '暂无来源'} · ${strategies[state.strategy]}${favorite ? ' · 想吃'+favorite : ''}。${result.total} 道候选，${result.ranked.length} 道可比较${result.excluded ? `，${result.excluded} 道因缺少本地精确匹配报价未纳入本轮` : ''}。${state.period==='week' ? '报价使用近7天已有观测，不填补缺失日。' : ''}`;
    const dimensions=[['rank','榜单顺位'],['favorite','食材偏好'],['price','已报价食材优势']];
    $('sim-cards').innerHTML=result.ranked.length ? result.ranked.slice(0,3).map((row,index)=>{
      const prices=row.priceMatches || [];
      const evidence=prices.length ? prices.slice(0,3).map(p=>`${esc(p.itemName)}：本地 ${num(p.localPrice)} / 全国样本 ${num(p.nationalPrice)} 元/kg`).join('<br>') : '本轮不使用价格维度；没有匹配报价也可按榜单与偏好参与。';
      return `<article class="live-sim-card" style="animation-delay:${index*95}ms"><div class="live-sim-card-top"><span>RECOMMEND / 0${index+1}</span><strong>${row.score.toFixed(1)}<small>模拟分</small></strong></div><h3>${link(row.recipe.sourceUrl,row.recipe.title)}</h3><p>原榜单第 ${row.recipe.rank} 位${favorite ? ` · ${row.favoriteMatch ? '包含' : '未匹配'}${esc(favorite)}` : ' · 未指定偏好食材'}</p><div class="live-sim-evidence">${evidence}${prices.length ? `<br><small>${prices.length} 种食材有同口径报价；非整道菜成本。${result.weights.price===0 ? '本轮报价仅供参考，未参与排序。' : ''}</small>` : ''}</div><div class="sim-score-rows">${dimensions.filter(([key])=>result.weights[key]>0).map(([key,label])=>`<div><span>${label}</span><b>${row.components[key].toFixed(1)} × ${(result.weights[key]*100).toFixed(0)}% = ${row.contributions[key].toFixed(1)}</b></div>`).join('')}</div><details><summary>查看报价依据</summary><p>${prices.length ? prices.map(p=>`${link(p.sourceUrl,p.itemName)} · 本地${state.period==='week' ? '每日 '+(p.localMarketCountRange || [p.localMarketCount]).join('–') : ' '+p.localMarketCount} 个市场 · 行情日 ${(p.observedDates || []).map(esc).join('、')}`).join('<br>') : '本轮未引用价格作为排序依据。'}</p><p>原始食材：${esc(row.recipe.ingredients.join('、'))}</p></details></article>`;
    }).join('') : empty('当前条件下没有可比较的菜谱。可以切换到“榜单优先”查看不依赖报价的推荐，或自行选择有报价的地区。');
    $('sim-method-content').innerHTML=`<p><strong>这是公开数据上的可解释规则模拟。</strong>不代表论文模型，不推断营养、健康适用性或完整菜谱成本。</p><p><strong>本轮权重：</strong>${dimensions.map(([key,label])=>`${label} ${(result.weights[key]*100).toFixed(1)}%`).join('；')}。未指定偏好食材时省略该维度，其余权重重新归一。</p><p><strong>榜单顺位分：</strong>100 × (N − 原始顺位) / (N − 1)，N 为此平台本次样本数；仅一个候选时为 100。这只是模拟所需的序数缩放，不是平台官方热度分。</p><p><strong>食材偏好：</strong>按该平台食材信号保存的菜谱 ID 匹配，命中为 100，否则为 0。食材关注分组仅用于偏好，不用于模糊匹配报价。</p><p><strong>本地价格优势：</strong>对严格同名或明确同义的食材，计算 clamp(50 + 100 × (全国样本中位价 − 本地样本中位价) / 全国样本中位价, 0, 100)，再对已匹配食材取均值。全国样本指本次所采市场，不是官方全国价格。周模式只比较相同实际观测日期，缺失日不补齐。不同食材的价格不直接互相比较。</p><p><strong>规格与缺失：</strong>鸡翅不套用白条鸡价，泛称牛肉不套用牛腿肉价，葱花不套用大葱价。只保留明确匹配；当价格权重大于 0 且某菜谱没有本地可比报价时，该菜谱不参与本轮。部分食材有报价时会显示覆盖数量，不能据此声称整道菜便宜。</p><p><strong>综合分：</strong>三项分数乘以本轮权重后相加；同分按原榜单顺位。默认权重为 45/30/25；榜单优先为 80/20/0；食材偏好优先为 25/65/10；本地价格机会为 25/15/60。自动演示只改变这些输入，数据仍是同一期真实快照。</p>`;
  }

  async function runSimulation(animate=true) {
    const token=++simToken;
    const model=globalThis.LiveFoodModel;
    if (!model) { $('sim-cards').innerHTML=empty('模拟模块未加载，请刷新页面。'); return; }
    $('sim-run').disabled=true;
    const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const wait=()=>new Promise(resolve=>setTimeout(resolve,animate&&!reduced ? 240 : 0));
    setStage(0,false);
    if(animate) $('sim-status').textContent='演示计算过程：使用当前已发布快照，不重新抓取源站。';
    await wait(); if(token!==simToken)return;
    setStage(1,false);
    await wait(); if(token!==simToken)return;
    const result=model.recommend(data,{sourceId:state.sourceId,provinceId:state.provinceId,period:state.period,ingredientId:state.ingredientId,strategy:state.strategy});
    setStage(2,false);
    await wait(); if(token!==simToken)return;
    setStage(3,true);
    simulationResult(result);
    $('sim-run').disabled=false;
  }

  function stopAutoplay() {
    if(autoplayTimer) clearInterval(autoplayTimer);
    autoplayTimer=null;
    $('sim-autoplay').setAttribute('aria-pressed','false');
    $('sim-autoplay').textContent='自动演示';
    $('sim-status').textContent=$('sim-status').textContent.replace('自动演示 · 同一期快照，仅切换偏好。','');
  }

  function startAutoplay() {
    if(autoplayTimer){stopAutoplay();runSimulation(false);return;}
    const step=()=>{
      const modes=['popular','balanced','ingredient','local-price'];
      const options=[...$('sim-ingredient').options].filter(o=>o.value);
      state.strategy=modes[autoStep % modes.length];
      state.ingredientId=autoStep%4===0 ? '' : (options[(autoStep-1)%Math.max(1,options.length)]?.value || '');
      autoStep++;
      $('sim-strategy').value=state.strategy;
      $('sim-ingredient').value=state.ingredientId;
      runSimulation(true);
    };
    autoplayTimer=setInterval(step,6500);
    $('sim-autoplay').setAttribute('aria-pressed','true');
    $('sim-autoplay').textContent='停止自动演示';
    step();
  }

  function renderAll() {
    syncOptions(); renderMetrics(); renderPrice(); renderPopularity(); renderSources(); runSimulation(false);
  }

  async function checkSnapshot(manual=false) {
    if(checking)return;
    if(location.protocol==='file:') {
      $('feed-state').textContent='离线快照 · 数据时间保持原样';
      $('feed-time').textContent='当前为离线文件；在线 GitHub 网站支持检查已发布快照。';
      if(manual)recordEvent('离线文件不能检查在线快照，继续显示内嵌记录。');
      return;
    }
    checking=true;
    $('feed-refresh').disabled=true;
    $('feed-refresh').classList.add('is-checking');
    $('feed-light').classList.add('checking');
    $('feed-state').textContent='正在检查网站已发布的最新快照…';
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetch(new URL('./data/latest.json?check='+Date.now(),document.baseURI),{cache:'no-store',signal:controller.signal,credentials:'omit'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const next=await response.json();
      if(next.schemaVersion!=='1.0.0'||next.isSynthetic!==false||!Array.isArray(next.observations)||!Array.isArray(next.recipeRankings)||!Array.isArray(next.ingredientSignals)||!Array.isArray(next.sources))throw new Error('快照格式不符合约定');
      const changed=next.contentVersion!==data.contentVersion;
      const collectionChanged=next.lastAttemptAt!==data.lastAttemptAt || next.generatedAt!==data.generatedAt;
      data=next;
      if(changed){renderAll();$('feed-metrics').classList.remove('data-flash');requestAnimationFrame(()=>$('feed-metrics').classList.add('data-flash'));}
      else {renderMetrics();if(collectionChanged){renderSources();renderPopularity();renderPrice();runSimulation(false);}}
      const stale=data.sources.some(s=>activeSource(s)&&sourceProblem(s));
      $('feed-state').textContent=changed ? '发现已发布的新数据，地图与榜单已更新' : stale ? '检查完成 · 部分来源更新异常' : '检查完成 · 数据内容未变化';
      $('feed-time').textContent=`网页检查：${formatTime(new Date().toISOString())} · 成功采集：${formatTime(data.lastSuccessfulAt)}（北京时间）`;
      $('feed-light').classList.toggle('failed',stale);
      if(manual||changed||!events.some(e=>e.message.includes('快照内容未变化')))recordEvent(changed ? '发现不同内容版本，已更新数据与推荐。' : '快照内容未变化；网页检查未触发源站采集。');
    } catch(error) {
      $('feed-state').textContent='本次检查失败 · 保留已载入快照';
      $('feed-time').textContent=`成功采集时间仍为 ${formatTime(data.lastSuccessfulAt)}（北京时间）；可稍后重试。`;
      $('feed-light').classList.add('failed');
      recordEvent(`网站快照检查失败（${error.name==='AbortError' ? '请求超时' : error.message}），原始数据日期保持不变。`);
    } finally {
      clearTimeout(timeout); checking=false;
      $('feed-refresh').disabled=false;
      $('feed-refresh').classList.remove('is-checking');
      $('feed-light').classList.remove('checking');
    }
  }

  function selectProvince(id) {
    if(!map.regions.some(r=>r.id===id))return;
    stopAutoplay(); state.provinceId=id;
    $('live-province').value=id;
    renderPrice();runSimulation(true);
  }

  $('live-price-controls').addEventListener('submit',e=>e.preventDefault());
  $('live-food').addEventListener('change',()=>{state.itemId=$('live-food').value;renderPrice();});
  $('live-province').addEventListener('change',()=>selectProvince($('live-province').value));
  $('live-period').addEventListener('change',()=>{stopAutoplay();state.period=$('live-period').value;renderPrice();runSimulation(true);});
  $('live-map-svg').addEventListener('click',e=>{const region=e.target.closest('[data-real-region]');if(region)selectProvince(region.dataset.realRegion);});
  $('live-map-svg').addEventListener('keydown',e=>{const region=e.target.closest('[data-real-region]');if(region&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectProvince(region.dataset.realRegion);}});
  $('live-map-svg').addEventListener('pointerover',e=>{const region=e.target.closest('[data-real-region]');if(region)mapHover(region.dataset.realRegion);});
  $('live-map-svg').addEventListener('focusin',e=>{const region=e.target.closest('[data-real-region]');if(region)mapHover(region.dataset.realRegion);});
  $('live-map-svg').addEventListener('pointerleave',()=>mapHover(state.provinceId));
  $('live-ranking-source').addEventListener('change',()=>{stopAutoplay();state.sourceId=$('live-ranking-source').value;syncIngredients();renderPopularity();runSimulation(true);});
  $('source-filter').addEventListener('click',e=>{const button=e.target.closest('[data-source-filter]');if(button){state.sourceFilter=button.dataset.sourceFilter;renderSources();}});
  $('sim-ingredient').addEventListener('change',()=>{stopAutoplay();state.ingredientId=$('sim-ingredient').value;runSimulation(true);});
  $('sim-strategy').addEventListener('change',()=>{stopAutoplay();state.strategy=$('sim-strategy').value;runSimulation(true);});
  $('sim-run').addEventListener('click',()=>{stopAutoplay();runSimulation(true);});
  $('sim-autoplay').addEventListener('click',startAutoplay);
  $('feed-refresh').addEventListener('click',()=>checkSnapshot(true));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAutoplay();});
  setInterval(()=>{if(!document.hidden)checkSnapshot(false);},300000);
  const openLegacy=()=>{if(['#food-map','#experiment'].includes(location.hash))$('synthetic-lab').open=true;};
  document.querySelectorAll('a[href="#food-map"],a[href="#experiment"]').forEach(a=>a.addEventListener('click',()=>$('synthetic-lab').open=true));
  window.addEventListener('hashchange',openLegacy);
  openLegacy();
  drawMap();renderAll();
  recordEvent('已载入公开来源快照；采集成功时间独立于网页检查。',data.lastSuccessfulAt || data.generatedAt);
  checkSnapshot(false);
})();
