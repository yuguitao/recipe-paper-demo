import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Isolated fixtures only; none of these example.test records enter public data.
const project = fileURLToPath(new URL('../', import.meta.url));
const bridge = `import json,sys\nsys.path.insert(0,'scripts')\nimport update_data\np=json.loads(sys.stdin.readline())\na,b=update_data.build_dataset(p.get('previous',{}),p['results'],p.get('history',{}),p['now'])\njson.dump({'latest':a,'history':b},sys.stdout,ensure_ascii=False,allow_nan=False)`;
const day = '2026-10-24';
function merge(results, previous = {}, history = {}, now = `${day}T08:25:00+08:00`) {
  const run = spawnSync('python3', ['-c', bridge], {
    cwd: project, input: JSON.stringify({ results, previous, history, now }) + '\n', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 10000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}
const source = (id, status = 'ok') => ({ id, name: id, status, url: 'https://example.test/source', updateFrequency: 'daily' });
const quote = (sid, value, observedDate = '2026-10-23', market = 'A') => ({
  id: `${sid}-tomato-${market}-${observedDate}`, sourceId: sid, kind: 'price', itemId: 'tomato', itemName: '番茄', value,
  unit: 'CNY/kg', originalUnit: '元/公斤', priceType: 'wholesale', isSynthetic: false,
  geography: { level: 'market', provinceId: '330000', province: '浙江省', marketId: market, market },
  observedDate, fetchedAt: `${day}T08:00:00+08:00`, sourceUrl: `https://example.test/${sid}/${market}/${observedDate}`,
});

test('an upstream failure preserves the last observed value, date, attribution and successful time', () => {
  const first = merge([{ sources: [source('a'), source('b')], observations: [quote('a', 5), quote('b', 8)] }]);
  const second = merge([{ sources: [source('a', 'error'), source('b')], observations: [{ ...quote('b', 9), fetchedAt: `${day}T16:00:00+08:00` }] }], first.latest, first.history, `${day}T17:25:00+08:00`);
  const old = second.latest.observations.find(row => row.sourceId === 'a');
  assert.equal(old.value, 5);
  assert.equal(old.observedDate, '2026-10-23');
  assert.equal(old.sourceUrl, 'https://example.test/a/A/2026-10-23');
  assert.equal(old.recordStatus, 'stale');
  const status = second.latest.sources.find(row => row.id === 'a');
  assert.equal(status.status, 'stale');
  assert.equal(status.lastSuccessAt, `${day}T08:00:00+08:00`);
  assert.equal(status.lastAttemptAt, `${day}T17:25:00+08:00`);
  assert.equal(second.latest.status, 'partial');
});

test('unconverted units, future publication dates and synthetic records cannot replace genuine cache', () => {
  const first = merge([{ sources: [source('a')], observations: [quote('a', 5)] }]);
  const bad = [
    { ...quote('a', 2), unit: '元/斤' },
    quote('a', 3, '2026-10-25'),
    { ...quote('a', 100), isSynthetic: true },
    { ...quote('a', 0), value: true },
  ];
  const next = merge([{ sources: [source('a')], observations: bad }], first.latest, first.history);
  assert.equal(next.latest.observations.length, 1);
  assert.equal(next.latest.observations[0].value, 5);
  assert.equal(next.latest.sources[0].status, 'stale');
  assert.equal(next.latest.sources[0].validationWarnings.length, 4);
  assert.equal(next.history.observations.length, 1);
});

test('partial source success and validation warnings remain visible while missing markets retain their original quotes', () => {
  const first = merge([{ sources: [source('a')], observations: [quote('a', 5), quote('a', 8, '2026-10-22', 'B')] }]);
  for (const mode of ['partial-status', 'partial-flag', 'failure-list', 'validation-warning']) {
    const invalidRow = mode === 'validation-warning';
    const sources = [{ ...source('a', mode === 'partial-status' ? 'partial' : 'ok'), error: invalidRow ? '' : '部分品类页面获取失败' }];
    if (mode === 'partial-flag') sources[0].partial = true;
    if (mode === 'failure-list') sources[0].failures = [{ itemId: 'tomato', error: '本品类页面获取失败' }];
    const observations = [quote('a', 6)];
    if (invalidRow) observations.push({ ...quote('a', 2, '2026-10-23', 'B'), unit: 'CNY/jin' });
    const next = merge([{ sources, observations }], first.latest, first.history);
    const oldMarket = next.latest.observations.find(row => row.geography.marketId === 'B');
    assert.equal(oldMarket.value, 8);
    assert.equal(oldMarket.observedDate, '2026-10-22');
    assert.equal(oldMarket.retainedFromPrevious, true);
    assert.equal(next.latest.observations.find(row => row.geography.marketId === 'A').value, 6);
    assert.equal(next.latest.sources[0].status, 'ok');
    assert.equal(next.latest.status, 'partial');
    assert.equal(next.latest.summary.status, 'partial');
    assert.equal(next.latest.summary.partialSources, 1);
    assert.equal(next.latest.summary.failedSources, 0);
    if (invalidRow) assert.ok(next.latest.sources[0].validationWarnings.length > 0);
    const recovered = merge([{ sources: [source('a')], observations: [quote('a', 6), quote('a', 9, '2026-10-23', 'B')] }], next.latest, next.history);
    assert.equal(recovered.latest.status, 'ok');
    assert.equal(recovered.latest.summary.partialSources, 0);
    assert.equal(Boolean(recovered.latest.sources[0].partial), false);
    assert.equal(Boolean(recovered.latest.sources[0].failures?.length), false);
    assert.equal(Boolean(recovered.latest.sources[0].error), false);
    assert.equal(Boolean(recovered.latest.sources[0].validationWarnings?.length), false);
  }
});

test('same-day revisions deduplicate, and another fetch alone does not masquerade as new data', () => {
  const first = merge([{ sources: [source('a')], observations: [quote('a', 5)] }]);
  const revision = { ...quote('a', 6), fetchedAt: `${day}T16:00:00+08:00` };
  const second = merge([{ sources: [source('a')], observations: [revision] }], first.latest, first.history, `${day}T17:25:00+08:00`);
  assert.equal(second.history.observations.length, 1);
  assert.equal(second.history.observations[0].value, 6);
  assert.notEqual(second.latest.contentVersion, first.latest.contentVersion);
  const check = merge([{ sources: [source('a')], observations: [{ ...revision, fetchedAt: `${day}T18:00:00+08:00` }] }], second.latest, second.history, `${day}T18:25:00+08:00`);
  assert.equal(check.latest.contentVersion, second.latest.contentVersion);
  assert.equal(check.latest.lastContentChangeAt, second.latest.lastContentChangeAt);
});

test('weekly statistics keep source, market, quote type and sample-day coverage distinct', () => {
  const records = [quote('a', 2, '2026-10-22', 'A'), quote('a', 4, '2026-10-23', 'A'), quote('a', 20, '2026-10-23', 'B'), quote('b', 90, '2026-10-23', 'A')];
  records.push({ ...quote('a', 30, '2026-10-23', 'A'), priceType: 'retail' });
  const result = merge([{ sources: [source('a'), source('b')], observations: records }]);
  const weekly = result.latest.weeklyPrices;
  assert.equal(weekly.length, 4);
  const marketA = weekly.find(row => row.sourceId === 'a' && row.geography.marketId === 'A' && row.priceType === 'wholesale');
  assert.equal(marketA.mean, 3);
  assert.equal(marketA.observedDays, 2);
  assert.deepEqual(marketA.observedDates, ['2026-10-22', '2026-10-23']);
  assert.equal(marketA.expectedCalendarDays, 7);
  assert.equal(weekly.find(row => row.sourceId === 'b').mean, 90);
});

test('provincial display is a daily sample median followed by a covered-day mean, never a pooled official average', () => {
  const rows = [quote('a', 2, '2026-10-22', 'A'), quote('a', 4, '2026-10-22', 'B'), quote('a', 20, '2026-10-22', 'C'), quote('a', 8, '2026-10-23', 'A'), quote('a', 12, '2026-10-23', 'B')];
  const result = merge([{ sources: [source('a')], observations: rows }]);
  assert.deepEqual(result.latest.dailyPriceSummaries.map(row => row.median), [4, 10]);
  assert.deepEqual(result.latest.dailyPriceSummaries.map(row => row.marketCount), [3, 2]);
  const week = result.latest.weeklyPriceSummaries[0];
  assert.equal(week.meanOfDailyMedians, 7);
  assert.equal(week.sampleDays, 2);
  assert.deepEqual(week.marketCountRange, [2, 3]);
  const outside = quote('a', 100, '2026-10-22', 'D');
  outside.geography.provinceId = '320000';
  outside.geography.province = '江苏省';
  const national = merge([{ sources: [source('a')], observations: [...rows, outside] }]).latest.nationalDailyPriceSummaries;
  assert.equal(national[0].median, 12); // Median of 2,4,20,100; not median of provincial medians 4,100.
  assert.equal(national[0].marketCount, 4);
  assert.equal(national[0].provinceCount, 2);
  assert.equal(national[1].median, 10);
});

test('unknown publisher periods stay unknown and catalog-only sources cannot contribute data', () => {
  const recipe = { id: 'r1', sourceId: 'recipes', title: '测试菜谱', rank: 1, sourceUrl: 'https://example.test/recipes', fetchedAt: `${day}T08:00:00+08:00`, observedDate: day, window: { type: 'weekly', label: '平台本周榜', start: null, end: null }, periodDateKnown: false, isSynthetic: false };
  const first = merge([{ sources: [{ ...source('recipes'), lastAttemptAt: `${day}T08:00:00+08:00` }, source('restricted', 'authorization_required'), { ...source('catalog', 'unavailable'), automated: false }], recipeRankings: [recipe], observations: [quote('restricted', 99)] }]);
  assert.equal(first.latest.recipeRankings[0].observedDate, null);
  assert.equal(first.latest.recipeRankings[0].capturedDate, day);
  assert.equal(first.latest.recipeRankings[0].window.start, null);
  assert.equal(first.latest.observations.length, 0);
  assert.equal(first.history.observations.length, 0);
  assert.equal(first.history.recipeSnapshots.length, 1);
  assert.equal(first.latest.sources.find(s => s.id === 'restricted').hasObservedData, false);
  assert.equal(first.latest.sources.find(s => s.id === 'catalog').status, 'unavailable');
  assert.equal(first.latest.summary.failedSources, 0);
  assert.equal(first.latest.lastAttemptAt, `${day}T08:00:00+08:00`);
  assert.equal(first.latest.generatedAt, `${day}T08:25:00+08:00`);
});

test('30-day history expires old observations while a failed source keeps its explicitly stale last quote', () => {
  const old = quote('a', 5, '2026-09-01');
  const result = merge([{ sources: [source('a')], observations: [old] }]);
  assert.equal(result.latest.observations.length, 1);
  assert.equal(result.history.observations.length, 0);
  assert.equal(result.latest.weeklyPrices.length, 0);
  const failed = merge([{ sources: [source('a', 'error')] }], result.latest, result.history);
  assert.equal(failed.latest.observations[0].value, 5);
  assert.equal(failed.latest.sources[0].status, 'stale');
  assert.equal(failed.latest.sources[0].latestObservedDate, '2026-09-01');
});
