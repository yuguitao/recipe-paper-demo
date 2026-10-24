import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const base = require('../demo-engine.js');
const market = require('../market-engine.js');

test('34 unique regions and all months have finite deterministic synthetic market data', () => {
  assert.equal(market.provinces.length, 34);
  assert.equal(new Set(market.provinces.map(row => row.id)).size, 34);
  for (const province of market.provinces) {
    for (let month = 1; month <= 12; month++) {
      const context = { provinceId: province.id, month };
      const snapshot = market.snapshot(context);
      assert.deepEqual(snapshot, market.snapshot(context));
      assert.equal(snapshot.isSynthetic, true);
      assert.equal(snapshot.items.length, market.ingredients.length);
      for (const item of snapshot.items) {
        assert.ok(item.price > 0 && Number.isFinite(item.price));
        assert.ok(item.trend >= 0 && item.trend <= 100);
        assert.ok(item.seasonScore >= 0 && item.seasonScore <= 100);
      }
    }
  }
  assert.equal(market.metadata.paperConnected, false);
});

test('region and month actually change prices, seasons and trends; maps share the same basket', () => {
  const east = market.snapshot({ provinceId: '330000', month: 10 });
  const north = market.snapshot({ provinceId: '230000', month: 10 });
  const summer = market.snapshot({ provinceId: '330000', month: 7 });
  assert.notEqual(east.basketCost, north.basketCost);
  assert.notEqual(east.basketCost, summer.basketCost);
  assert.notDeepEqual(east.items.map(row => row.inSeason), north.items.map(row => row.inSeason));
  assert.notDeepEqual(east.items.map(row => row.inSeason), summer.items.map(row => row.inSeason));
  assert.notDeepEqual(east.items.map(row => row.trend), summer.items.map(row => row.trend));
  assert.deepEqual(east.basketItems.map(({ id, grams }) => ({ id, grams })), north.basketItems.map(({ id, grams }) => ({ id, grams })));
  for (const metric of ['price', 'season', 'trend']) {
    const rows = market.mapValues({ month: 10 }, metric);
    assert.equal(rows.length, 34);
    const expected = metric === 'price' ? east.basketCost : metric === 'season' ? east.seasonalCount : east.trendIndex;
    assert.equal(rows.find(row => row.id === '330000').value, expected);
  }
});

test('cost calculation and weighted explanations reconcile to exact scores', () => {
  const result = market.recommend(base.defaultProfile, market.defaultContext);
  assert.equal(result.ranked.length, base.recipes.length);
  assert.ok(Math.abs(Object.values(result.weights).reduce((a, b) => a + b, 0) - 1) < 1e-12);
  for (const row of result.ranked) {
    const cost = Math.round((row.ingredients.reduce((sum, item) => sum + item.grams * item.price / 1000, 0) + Number.EPSILON) * 100) / 100;
    assert.equal(row.cost, cost);
    assert.equal(row.baseScore, row.components.preference);
    assert.ok(Math.abs(row.score - Object.values(row.contributions).reduce((a, b) => a + b, 0)) < 1e-10);
    for (const key of market.keys) {
      assert.equal(row.contributions[key], row.components[key] * result.weights[key]);
    }
    assert.ok(row.score >= 0 && row.score <= 100);
  }
});

test('strategy affects ranking, lower cost wins pure relative price score, and budget responds', () => {
  const sets = market.strategies.map(strategy => market.recommend(base.defaultProfile, { ...market.defaultContext, strategy: strategy.id }));
  assert.ok(new Set(sets.map(result => result.ranked.slice(0, 3).map(row => row.recipe.id).join(','))).size >= 3);
  const rows = sets[0].ranked.slice().sort((a, b) => a.cost - b.cost);
  assert.ok(rows[0].components.price > rows.at(-1).components.price);
  const cheapBudget = market.recommend(base.defaultProfile, { ...market.defaultContext, budget: 5, withinBudget: true });
  assert.ok(cheapBudget.ranked.length < base.recipes.length);
  assert.ok(cheapBudget.ranked.every(row => row.cost <= 5));
  assert.ok(cheapBudget.rejected.some(row => row.reasons.some(reason => reason.includes('超出预算'))));
  const impossible = market.recommend(base.defaultProfile, { ...market.defaultContext, budget: 1, withinBudget: true });
  assert.equal(impossible.ranked.length, 0);
  assert.equal(impossible.rejected.length, base.recipes.length);
});

test('allergen restrictions, zero weights and source immutability survive every strategy', () => {
  const profile = { ...base.defaultProfile, exclusions: ['soy', 'egg', 'milk', 'wheat', 'shellfish', 'fish', 'nut'] };
  for (const strategy of market.strategies) {
    const result = market.recommend(profile, { ...market.defaultContext, strategy: strategy.id });
    assert.equal(result.ranked.length, 0);
    assert.equal(result.rejected.length, base.recipes.length);
  }
  const onlySoy = market.recommend({ ...base.defaultProfile, exclusions: ['soy'] }, market.defaultContext);
  assert.ok(onlySoy.ranked.every(row => !row.recipe.allergens.includes('soy')));
  const zero = market.recommend({ ...base.defaultProfile, weights: Object.fromEntries(base.keys.map(key => [key, 0])) }, market.defaultContext);
  assert.equal(zero.invalidWeights, true);
  assert.deepEqual(zero.ranked, []);
  assert.equal(Object.isFrozen(market.defaultContext), true);
  assert.equal(Object.isFrozen(market.ingredients[0]), true);
});

test('invalid context safely normalizes without mutating caller inputs', () => {
  const input = { provinceId: '<script>', month: Infinity, budget: 'not-a-number', strategy: '__proto__', withinBudget: 'false' };
  const before = { ...input };
  assert.deepEqual(market.normalizeContext(input), market.defaultContext);
  assert.deepEqual(input, before);
  assert.equal(market.normalizeContext({ provinceId: 330000 }).provinceId, '330000');
  assert.equal(market.normalizeContext({ month: 20, budget: -50 }).month, 12);
  assert.equal(market.normalizeContext({ month: 20, budget: -50 }).budget, 1);
});
