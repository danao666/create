export const REVIVE_MILESTONES = [2000, 4000, 6000];

export function createRewards() {
  return { cards: 0, granted: new Set() };
}

export function grantRewards(rewards, score) {
  const earned = REVIVE_MILESTONES.filter(points => score >= points && !rewards.granted.has(points));
  for (const points of earned) rewards.granted.add(points);
  rewards.cards += earned.length;
  return earned;
}

export function consumeReviveCard(rewards) {
  if (rewards.cards < 1) return false;
  rewards.cards -= 1;
  return true;
}
