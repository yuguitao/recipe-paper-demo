import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const model = require('../live-model.js');

const recipe = (id, rank, ingredients, sourceId = 'recipes-a') => ({ id, sourceId, rank, ingredients,
  title: id, capturedDate: '2026-10-24', isSynthetic: false });
const summary = (itemId, provinceId, observedDate, median, marketCount = 1) => ({
  sourceId: 'mofcom-daily-market', itemId, itemName: itemId === 'tomato' ? '西红柿' : '鲜鸡蛋',
  provinceId, observedDate, median, marketCount, unit: 'CNY/kg', priceType: 'wholesale',
  sourceUrls: ['https://cif.mofcom.gov.cn/cif/seach.fhtml?commdityid=170120'], isSynthetic: false, isDerived: true
});
const fixture = () => ({ generatedAt: '2026-10-24T10:00:00+08:00',
  recipeRankings: [recipe('r1', 1, ['鸡翅']), recipe('r2', 2, ['番茄', '西红柿']), recipe('r3', 3, ['鸡蛋'])],
  ingredientSignals: [{ sourceId: 'recipes-a', ingredientId: 'tomato', sourceRecipeIds: ['r2'], capturedDate: '2026-10-24', isSynthetic: false }],
  dailyPriceSummaries: [summary('tomato', '330000', '2026-10-22', 2, 3), summary('egg', '330000', '2026-10-22', 6, 2)],
  nationalDailyPriceSummaries: [summary('tomato', null, '2026-10-22', 4, 10), summary('egg', null, '2026-10-22', 5, 7)]
});
const options = { sourceId: 'recipes-a', provinceId: '330000' };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);

test('price identity is exact, including cut, processing, and combined-ingredient exclusions', () => {
  assert.equal(model.matchPriceItem(' 番茄 '), 'tomato');
  assert.equal(model.matchPriceItem('鸡蛋'), 'egg');
  assert.equal(model.matchPriceItem('白条鸡'), 'whole_chicken');
  assert.equal(model.matchPriceItem('牛腿肉'), 'beef_leg');
  assert.equal(model.matchPriceItem('大葱'), 'scallion');
  for (const name of ['鸡翅', '鸡胸肉', '鸡肉', '牛肉', '牛肉馅', '葱', '葱花', '小葱', '葱姜蒜', '番茄酱', '土豆淀粉', '蛋清', '鸡蛋（50克）', '西红柿 1个', '番茄鸡蛋', 'toString', 'constructor']) {
    assert.equal(model.matchPriceItem(name), null, name);
  }
});

test('no favorite removes its weight; priced strategy excludes unavailable recipes rather than neutral imputation', () => {
  const result = model.recommend(fixture(), options);
  near(result.weights.rank, .45 / .70);
  near(result.weights.price, .25 / .70);
  assert.equal(result.weights.favorite, 0);
  assert.equal(result.total, 3);
  assert.equal(result.excluded, 1);
  assert.equal(result.ranked[0].recipe.id, 'r2');
  assert.equal(result.ranked[0].priceMatches.length, 1, 'synonyms must not double-weight an ingredient');
  assert.equal(result.ranked[0].priceMatches[0].localPrice, 2);
  assert.equal(result.ranked[0].priceMatches[0].nationalPrice, 4);
  assert.equal(result.ranked[0].components.price, 100);
  assert.equal(result.ranked[0].components.rank, 50, 'rank scale includes excluded candidates');
  for (const row of result.ranked) near(row.score, Object.values(row.contributions).reduce((a, b) => a + b, 0));
});

test('rank-only strategy keeps unpriced recipes and separate platform ranks', () => {
  const data = fixture();
  data.recipeRankings.push(recipe('foreign', 1, ['西红柿'], 'recipes-b'));
  const result = model.recommend(data, { ...options, strategy: 'popular' });
  assert.equal(result.total, 3);
  assert.equal(result.excluded, 0);
  assert.deepEqual(result.weights, { rank: 1, favorite: 0, price: 0 });
  assert.deepEqual(result.ranked.map(row => row.recipe.id), ['r1', 'r2', 'r3']);
  assert.equal(result.ranked[0].components.price, null);
});

test('favorite is matched from same-source current ingredient evidence', () => {
  const result = model.recommend(fixture(), { ...options, ingredientId: 'tomato', strategy: 'ingredient' });
  assert.deepEqual(result.weights, { rank: .25, favorite: .65, price: .1 });
  assert.equal(result.ranked[0].recipe.id, 'r2');
  assert.equal(result.ranked[0].favoriteMatch, true);
  assert.equal(result.ranked[0].components.favorite, 100);
  assert.equal(result.ranked[1].favoriteMatch, false);
});

test('weekly local and national means use exactly the same available dates', () => {
  const data = fixture();
  data.dailyPriceSummaries = [summary('tomato', '330000', '2026-10-20', 2, 2), summary('tomato', '330000', '2026-10-22', 4, 3)];
  data.nationalDailyPriceSummaries = [summary('tomato', null, '2026-10-20', 4, 10), summary('tomato', null, '2026-10-21', 100, 20), summary('tomato', null, '2026-10-22', 6, 12)];
  const result = model.recommend(data, { ...options, period: 'week' });
  const evidence = result.ranked[0].priceMatches[0];
  assert.equal(evidence.localPrice, 3);
  assert.equal(evidence.nationalPrice, 5, 'unmatched Oct 21 national observation cannot affect comparison');
  assert.deepEqual(evidence.observedDates, ['2026-10-20', '2026-10-22']);
  assert.equal(evidence.sampleDays, 2);
  assert.equal(evidence.expectedCalendarDays, 7);
  assert.deepEqual(evidence.localMarketCountRange, [2, 3]);
  assert.equal(evidence.score, 90);
  assert.deepEqual(result.window, { start: '2026-10-18', end: '2026-10-24' });
});

test('daily comparison never backfills older local price against newer national price', () => {
  const data = fixture();
  data.dailyPriceSummaries = [summary('tomato', '330000', '2026-10-21', 1)];
  const result = model.recommend(data, options);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.excluded, 3);
});

test('future dates, synthetic data, retail quotes, and wrong units cannot enter price matching', () => {
  for (const change of [{ observedDate: '2026-10-25' }, { isSynthetic: true }, { priceType: 'retail' }, { unit: 'CNY/jin' }]) {
    const data = fixture();
    data.dailyPriceSummaries = [{ ...summary('tomato', '330000', '2026-10-22', 2), ...change }];
    data.nationalDailyPriceSummaries = [{ ...summary('tomato', null, '2026-10-22', 4), ...change }];
    assert.equal(model.recommend(data, options).ranked.length, 0);
  }
});

test('actual published snapshot is immutable and yields only traceable price evidence', () => {
  const data = JSON.parse(readFileSync(new URL('../data/latest.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(data);
  for (const sourceId of ['xiachufang_weekly', 'meishichina_current']) {
    for (const period of ['day', 'week']) {
      const result = model.recommend(data, { sourceId, provinceId: '330000', period, strategy: 'local-price' });
      assert.equal(result.total, result.ranked.length + result.excluded);
      // A production source can legitimately go stale beyond the week window.
      // Empty results must still publish, with no invented price evidence.
      if (!result.ranked.length) assert.equal(result.excluded, result.total);
      for (const row of result.ranked) {
        assert.ok(Number.isFinite(row.score));
        assert.ok(row.priceMatches.length > 0);
        for (const price of row.priceMatches) {
          assert.ok(price.sourceUrl.startsWith('https://cif.mofcom.gov.cn/'));
          assert.ok(price.localMarketCount > 0 && price.nationalMarketCount > 0);
          assert.ok(price.observedDates.length > 0 && price.observedDates.length <= (period === 'week' ? 7 : 1));
        }
      }
    }
  }
  assert.equal(JSON.stringify(data), before);
});
