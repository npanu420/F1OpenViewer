import { test } from 'vitest';
import assert from 'node:assert/strict';
import { groupSessionTabs, groupBySeries, pickDefaultSessionId, STAGE_ORDER } from './sessionGrouping';

const DUTCH_GP_2026 = [
  { id: 'gp', label: '2026 Dutch Grand Prix' },
  { id: 'kids', label: '2025 Dutch GP - F1 Kids' },
  { id: 'post-race', label: 'Post-Race Show - Netherlands' },
  { id: 'pre-race', label: 'Pre-Race Show - Netherlands' },
  { id: 'quali', label: '2025 Dutch GP - Qualifying' },
  { id: 'post-quali', label: 'Post-Qualifying Show - Netherlands' },
  { id: 'pre-quali', label: 'Pre-Qualifying Show - Netherlands' },
  { id: 'sprint', label: '2026 Dutch GP - Sprint' },
  { id: 'post-sprint', label: 'Post-Sprint Show - Netherlands' },
  { id: 'pre-sprint', label: 'Pre-Sprint Show - Netherlands' },
  { id: 'kids-sprint', label: '2026 Dutch GP - F1 Kids Sprint' },
  { id: 'sprint-quali', label: '2026 Dutch GP - Sprint Qualifying' },
  { id: 'fp1', label: '2026 Dutch GP - Practice 1' },
];

test('groups a full sprint weekend into the 5 stages present, in canonical order', () => {
  const { stages, extras } = groupSessionTabs(DUTCH_GP_2026);
  assert.deepEqual(
    stages.map((s) => s.key),
    ['fp1', 'sprint-quali', 'sprint', 'qualifying', 'race']
  );
  assert.equal(extras.length, 0);
});

test('sprint qualifying is not swallowed by the looser sprint matcher', () => {
  const { stages } = groupSessionTabs(DUTCH_GP_2026);
  const sprintQuali = stages.find((s) => s.key === 'sprint-quali');
  const sprint = stages.find((s) => s.key === 'sprint');
  assert.equal(sprintQuali?.variants.session?.id, 'sprint-quali');
  assert.equal(sprint?.variants.session?.id, 'sprint');
});

test('pre/post-show and kids attach as variants of their stage', () => {
  const { stages } = groupSessionTabs(DUTCH_GP_2026);
  const race = stages.find((s) => s.key === 'race')!;
  assert.equal(race.variants.session?.id, 'gp');
  assert.equal(race.variants.kids?.id, 'kids');
  assert.equal(race.variants['pre-show']?.id, 'pre-race');
  assert.equal(race.variants['post-show']?.id, 'post-race');

  const sprint = stages.find((s) => s.key === 'sprint')!;
  assert.equal(sprint.variants.kids?.id, 'kids-sprint');
  assert.equal(sprint.variants['pre-show']?.id, 'pre-sprint');
  assert.equal(sprint.variants['post-show']?.id, 'post-sprint');
});

test('Weekend Warm-Up has no stage keyword, but is hardcoded as FP1 pre-show', () => {
  const items = [
    { id: 'gp', label: '2026 Dutch Grand Prix' },
    { id: 'warmup', label: '2026 Dutch GP - Weekend Warm-Up' },
  ];
  const { stages, extras } = groupSessionTabs(items);
  const fp1 = stages.find((s) => s.key === 'fp1');
  assert.equal(fp1?.variants['pre-show']?.id, 'warmup');
  assert.equal(extras.length, 0);
});

test('unrecognized titles fall back to extras instead of being dropped', () => {
  const items = [
    { id: 'gp', label: '2026 Dutch Grand Prix' },
    { id: 'mystery', label: 'Random Extra Content' },
  ];
  const { stages, extras } = groupSessionTabs(items);
  assert.equal(stages.length, 1);
  assert.deepEqual(extras.map((e) => e.id), ['mystery']);
});

test('a duplicate (stage, variant) slot falls back to extras instead of overwriting', () => {
  const items = [
    { id: 'race-a', label: '2026 Dutch Grand Prix' },
    { id: 'race-b', label: '2026 Dutch GP - Race' },
  ];
  const { stages, extras } = groupSessionTabs(items);
  const race = stages.find((s) => s.key === 'race')!;
  assert.equal(race.variants.session?.id, 'race-a');
  assert.deepEqual(extras.map((e) => e.id), ['race-b']);
});

test('pickDefaultSessionId prefers the Race session over catalog order', () => {
  // catalog returns kids first, race last: should still default to the race
  const shuffled = [...DUTCH_GP_2026].reverse();
  assert.equal(pickDefaultSessionId(shuffled), 'gp');
});

test('pickDefaultSessionId falls back to the earliest present stage when there is no race stage at all', () => {
  const items = DUTCH_GP_2026.filter((i) => !['gp', 'kids', 'pre-race', 'post-race'].includes(i.id));
  assert.equal(pickDefaultSessionId(items), 'fp1');
});

test('pickDefaultSessionId falls back to a non-session variant when the race stage has no clean replay', () => {
  const items = DUTCH_GP_2026.filter((i) => i.id !== 'gp');
  assert.equal(pickDefaultSessionId(items), 'kids');
});

test('pickDefaultSessionId falls back to the first item when nothing is classifiable', () => {
  const items = [{ id: 'only', label: 'Random Extra Content' }];
  assert.equal(pickDefaultSessionId(items), 'only');
});

test('STAGE_ORDER stays in weekend-chronological order', () => {
  assert.deepEqual(STAGE_ORDER, ['fp1', 'fp2', 'fp3', 'sprint-quali', 'sprint', 'qualifying', 'race']);
});

const SUPPORT_RACES = [
  { id: 'academy-feature', label: 'Feature Race', series: 'F1 Academy' },
  { id: 'academy-reverse', label: 'Reverse Grid Race', series: 'F1 Academy' },
  { id: 'psc-practice', label: '2026 Dutch GP - PSC Practice', series: 'Porsche Supercup' },
  { id: 'psc-quali', label: '2026 Dutch GP - PSC Qualifying', series: 'Porsche Supercup' },
];

test('groupBySeries buckets support races away from F1, preserving first-seen series order', () => {
  const { f1, otherSeries } = groupBySeries([...SUPPORT_RACES, ...DUTCH_GP_2026]);
  assert.equal(f1.length, DUTCH_GP_2026.length);
  assert.deepEqual(otherSeries.map((g) => g.label), ['F1 Academy', 'Porsche Supercup']);
  assert.deepEqual(
    otherSeries.find((g) => g.label === 'F1 Academy')?.items.map((i) => i.id),
    ['academy-feature', 'academy-reverse']
  );
});

test('items with no series tag default to F1', () => {
  const { f1, otherSeries } = groupBySeries(DUTCH_GP_2026);
  assert.equal(f1.length, DUTCH_GP_2026.length);
  assert.equal(otherSeries.length, 0);
});

test('groupSessionTabs and pickDefaultSessionId never see support-race items mixed in', () => {
  const mixed = [...SUPPORT_RACES, ...DUTCH_GP_2026];
  // PSC Qualifying would otherwise collide with the real Qualifying stage/variant slot.
  const { stages } = groupSessionTabs(groupBySeries(mixed).f1);
  const qualifying = stages.find((s) => s.key === 'qualifying');
  assert.equal(qualifying?.variants.session?.id, 'quali');
  assert.equal(pickDefaultSessionId(mixed), 'gp');
});
