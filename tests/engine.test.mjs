import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const demo = require('../demo-engine.js');
const clone = value => JSON.parse(JSON.stringify(value));

test('exclusions survive full, taste-only, and ablated rankings', () => {
  const profile = { ...clone(demo.defaultProfile), exclusions: ['soy', 'fish', 'egg'] };
  const full = demo.evaluate(profile);
  const taste = demo.evaluate({ ...profile, weights: { taste: 1, nutrition: 0, health: 0, region: 0, season: 0 } });
  const ablated = demo.evaluate(profile, { disabledDimensions: ['health'] });
  for (const output of [full, taste, ablated]) {
    assert.equal(output.ranked.length + output.rejected.length, demo.recipes.length);
    assert.ok(output.ranked.every(({recipe}) => !recipe.allergens.some(key => profile.exclusions.includes(key))));
    assert.ok(output.rejected.every(({reasons}) => reasons.length > 0));
  }
  assert.deepEqual(full.rejected.map(x => x.recipe.id), taste.rejected.map(x => x.recipe.id));
  assert.deepEqual(full.rejected.map(x => x.recipe.id), ablated.rejected.map(x => x.recipe.id));
});

test('empty candidates remain empty, and zero weights are not silently replaced', () => {
  const profile = clone(demo.defaultProfile);
  profile.exclusions = Object.keys(demo.allergenLabels);
  const empty = demo.evaluate(profile);
  assert.equal(empty.ranked.length, 0);
  assert.equal(empty.rejected.length, demo.recipes.length);
  assert.equal(empty.invalidWeights, false);
  profile.weights = Object.fromEntries(demo.keys.map(key => [key, 0]));
  const zero = demo.evaluate(profile);
  assert.equal(zero.invalidWeights, true);
  assert.equal(zero.ranked.length, 0);
  assert.equal(zero.rejected.length, demo.recipes.length);
  const disabled = demo.evaluate(demo.defaultProfile, { disabledDimensions: demo.keys });
  assert.equal(disabled.invalidWeights, true);
});

test('displayable contributions add up to matching scores and disabled terms contribute zero', () => {
  for (const preset of demo.presets) {
    const output = demo.evaluate(preset.profile, { disabledDimensions: ['region'] });
    assert.ok(Math.abs(Object.values(output.normalizedWeights).reduce((a,b) => a+b,0) - 1) < 1e-12);
    for (const row of output.ranked) {
      assert.ok(Math.abs(Object.values(row.contributions).reduce((a,b) => a+b,0) - row.score) < 1e-12);
      assert.equal(row.contributions.region, 0);
      assert.ok(row.score >= 0 && row.score <= 100 + 1e-12);
      assert.ok(Object.values(row.components).every(value => Number.isFinite(value) && value >= 0 && value <= 100));
    }
  }
});

test('taste-only baseline responds to preference and is deterministic under ties', () => {
  const profile = { ...clone(demo.defaultProfile), weights: { taste: 1, nutrition: 0, health: 0, region: 0, season: 0 } };
  const mild = demo.evaluate({ ...profile, spice: 0 });
  const spicy = demo.evaluate({ ...profile, spice: 3 });
  assert.equal(mild.ranked[0].recipe.features.spice, 0);
  assert.equal(spicy.ranked[0].recipe.features.spice, 3);
  assert.notEqual(mild.ranked[0].recipe.id, spicy.ranked[0].recipe.id);
  assert.deepEqual(mild, demo.evaluate({ ...profile, spice: 0 }));
});

test('unconstrained region and season give identical documented neutral scores', () => {
  const output = demo.evaluate({ ...clone(demo.defaultProfile), region: 'any', season: 'any' });
  assert.ok(output.ranked.every(row => row.components.region === demo.metadata.neutralScore && row.components.season === demo.metadata.neutralScore));
});

test('evaluating a profile neither changes caller input nor overwrites frozen sample data', () => {
  const profile = clone(demo.defaultProfile);
  const before = JSON.stringify(profile);
  demo.evaluate(profile, { disabledDimensions: ['health'] });
  assert.equal(JSON.stringify(profile), before);
  assert.ok(Object.isFrozen(demo.recipes[0].features.nutrition));
  assert.ok(demo.metadata.isSynthetic);
  assert.ok(demo.recipes.every(recipe => recipe.dataOrigin === 'synthetic'));
  assert.equal(new Set(demo.recipes.map(recipe => recipe.id)).size, demo.recipes.length);
});
