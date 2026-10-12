import test from 'node:test';
import assert from 'node:assert/strict';
import { createRewards, grantRewards, consumeReviveCard } from '../src/rewards.js';

test('each score milestone grants exactly one revival card', () => {
  const rewards = createRewards();
  assert.deepEqual(grantRewards(rewards, 1999), []);
  assert.deepEqual(grantRewards(rewards, 2000), [2000]);
  assert.deepEqual(grantRewards(rewards, 2001), []);
  assert.deepEqual(grantRewards(rewards, 4000), [4000]);
  assert.deepEqual(grantRewards(rewards, 6000), [6000]);
  assert.deepEqual(grantRewards(rewards, 8000), []);
  assert.equal(rewards.cards, 3);
});

test('jumping over milestones grants all missing cards without duplicates', () => {
  const rewards = createRewards();
  assert.deepEqual(grantRewards(rewards, 6100), [2000, 4000, 6000]);
  assert.deepEqual(grantRewards(rewards, 6100), []);
  assert.equal(rewards.cards, 3);
});

test('reviving consumes a card and does not reissue earned rewards', () => {
  const rewards = createRewards();
  grantRewards(rewards, 2000);
  assert.equal(consumeReviveCard(rewards), true);
  assert.equal(consumeReviveCard(rewards), false);
  assert.deepEqual(grantRewards(rewards, 2500), []);
  assert.equal(rewards.cards, 0);
  assert.deepEqual(grantRewards(rewards, 4000), [4000]);
  assert.equal(rewards.cards, 1);
});

test('starting a new round resets card inventory and milestone eligibility', () => {
  const first = createRewards();
  grantRewards(first, 6000);
  const next = createRewards();
  assert.equal(next.cards, 0);
  assert.deepEqual(grantRewards(next, 2000), [2000]);
  assert.equal(first.cards, 3);
});
