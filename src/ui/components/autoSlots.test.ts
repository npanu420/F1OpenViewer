import { test, expect } from 'vitest';
import { autoSlotIdsForCount, orderAutoStreams, parseTimingStateKey, planAutoSlots, resizeAutoSlotIds, timingStateKey } from './autoSlots';
import { manualLayoutForCount, manualLayoutForSlots } from './layoutOperations';

const items = ['main', 'data', 'ob-1', 'ob-2', 'ob-3'];

test('slot ids are contiguous and never empty', () => {
  expect(autoSlotIdsForCount(3)).toEqual(['slot-0', 'slot-1', 'slot-2']);
  expect(autoSlotIdsForCount(0)).toEqual(['slot-0']);
});

test('empty slots are filled in priority order', () => {
  const { mapping, added } = planAutoSlots(autoSlotIdsForCount(3), {}, items);
  expect(mapping).toEqual({ 'slot-0': 'main', 'slot-1': 'data', 'slot-2': 'ob-1' });
  expect(added).toEqual(['main', 'data', 'ob-1']);
});

test('growing keeps the panels already shown and reports only the new streams', () => {
  const current = { 'slot-0': 'main', 'slot-1': 'data' };
  const { mapping, added } = planAutoSlots(autoSlotIdsForCount(4), current, items);
  expect(mapping).toEqual({ 'slot-0': 'main', 'slot-1': 'data', 'slot-2': 'ob-1', 'slot-3': 'ob-2' });
  expect(added).toEqual(['ob-1', 'ob-2']);
});

test('slots that no longer fit are dropped', () => {
  const current = { 'slot-0': 'main', 'slot-1': 'data', 'slot-2': 'ob-1' };
  const { mapping, added } = planAutoSlots(autoSlotIdsForCount(1), current, items);
  expect(mapping).toEqual({ 'slot-0': 'main' });
  expect(added).toEqual([]);
});

test('a panel filled by hand keeps its stream, the others follow the priority', () => {
  const current = { 'slot-0': 'main', 'slot-1': 'ob-3', 'slot-2': 'data' };
  const { mapping } = planAutoSlots(autoSlotIdsForCount(3), current, items, new Set(['slot-1']));
  expect(mapping).toEqual({ 'slot-0': 'main', 'slot-1': 'ob-3', 'slot-2': 'data' });
  // Not pinned: the low-priority onboard gives way; data stays in its panel.
  expect(planAutoSlots(autoSlotIdsForCount(3), current, items).mapping).toEqual({ 'slot-0': 'main', 'slot-1': 'ob-1', 'slot-2': 'data' });
});

test('a changed priority re-orders the panels and reports only streams that were not shown', () => {
  const current = { 'slot-0': 'main', 'slot-1': 'data', 'slot-2': 'ob-1' };
  // Live timing opened: data goes last.
  const { mapping, added } = planAutoSlots(autoSlotIdsForCount(3), current, ['main', 'ob-1', 'ob-2', 'ob-3', 'data']);
  // ob-1 keeps its panel (no reload); ob-2 takes the one data left.
  expect(mapping).toEqual({ 'slot-0': 'main', 'slot-1': 'ob-2', 'slot-2': 'ob-1' });
  expect(added).toEqual(['ob-2']);
});

const grid = [
  { id: 'main', type: 'main' as const },
  { id: 'VER', type: 'driver' as const, name: 'Verstappen', driverNumber: 1 },
  { id: 'NOR', type: 'driver' as const, name: 'Norris', driverNumber: 4 },
  { id: 'LEC', type: 'driver' as const, name: 'Leclerc', driverNumber: 16 },
  { id: 'HAM', type: 'driver' as const, name: 'Hamilton', driverNumber: 44 },
];
const timingOf = (entries: Array<[number, number, boolean?]>, shown: string[] = []) => ({
  drivers: new Map(entries.map(([n, line, out]) => [n, { line, out: Boolean(out) }])),
  shown: new Set(shown),
});

test('timing: onboards of retired drivers leave the auto layout, the rest follow the running order', () => {
  const order = orderAutoStreams(grid, [], true, timingOf([[1, 3], [4, 1, true], [16, 2], [44, 4]]));
  expect(order).toEqual(['main', 'LEC', 'VER', 'HAM']);
});

test('timing: a retired favourite leaves too, a favourite still racing stays ahead of the order', () => {
  const order = orderAutoStreams(grid, ['Hamilton', 'Norris'], true, timingOf([[1, 1], [4, 2, true], [16, 3], [44, 9]]));
  expect(order).toEqual(['main', 'HAM', 'VER', 'LEC']);
});

test('timing: an onboard on screen is not dropped for a single overtake at the cut', () => {
  // Three tiles: main + two onboards. HAM (shown) slipped to P3 behind LEC.
  const shown = ['main', 'VER', 'HAM'];
  const order = orderAutoStreams(grid, [], true, timingOf([[1, 1], [16, 2], [44, 3], [4, 5]], shown));
  expect(order.slice(0, 3)).toEqual(['main', 'VER', 'HAM']);
  // Further back it gives way.
  const later = orderAutoStreams(grid, [], true, timingOf([[1, 1], [16, 2], [4, 3], [44, 6]], shown));
  expect(later.slice(0, 3)).toEqual(['main', 'VER', 'LEC']);
});

test('timing: without timing data the catalog order is kept', () => {
  expect(orderAutoStreams(grid, [], true, timingOf([]))).toEqual(['main', 'VER', 'NOR', 'LEC', 'HAM']);
});

test('timing state key round-trips and only carries what the layout uses', () => {
  const key = timingStateKey([
    { number: '1', line: 2, retired: false },
    { number: '44', line: 7, retired: false, knockedOut: true },
  ]);
  expect(key).toBe('1:2:0,44:7:1');
  expect(parseTimingStateKey(key)).toEqual(new Map([[1, { line: 2, out: false }], [44, { line: 7, out: true }]]));
});

test('a retired onboard frees its panel without moving the others', () => {
  const current = { 'slot-0': 'main', 'slot-1': 'VER', 'slot-2': 'NOR', 'slot-3': 'LEC' };
  const order = ['main', 'VER', 'LEC', 'HAM'];
  const { mapping, added } = planAutoSlots(autoSlotIdsForCount(4), current, order);
  expect(mapping).toEqual({ 'slot-0': 'main', 'slot-1': 'VER', 'slot-2': 'HAM', 'slot-3': 'LEC' });
  expect(added).toEqual(['HAM']);
});

test('the main feed takes the first free panel', () => {
  const current = { 'slot-0': 'ob-1', 'slot-1': 'data' };
  const { mapping } = planAutoSlots(autoSlotIdsForCount(3), current, items);
  expect(mapping).toEqual({ 'slot-0': 'main', 'slot-1': 'data', 'slot-2': 'ob-1' });
  // Unless the user put something else there.
  expect(planAutoSlots(autoSlotIdsForCount(3), current, items, new Set(['slot-0'])).mapping)
    .toEqual({ 'slot-0': 'ob-1', 'slot-1': 'main', 'slot-2': 'data' });
});

test('unknown and duplicate assignments are replaced', () => {
  const current = { 'slot-0': 'gone', 'slot-1': 'main', 'slot-2': 'main' };
  const { mapping } = planAutoSlots(autoSlotIdsForCount(3), current, items);
  expect(mapping).toEqual({ 'slot-0': 'main', 'slot-1': 'data', 'slot-2': 'ob-1' });
});

test('more slots than streams leaves the rest empty', () => {
  const { mapping } = planAutoSlots(autoSlotIdsForCount(3), {}, ['main']);
  expect(mapping).toEqual({ 'slot-0': 'main' });
});

test('priority: main, favourites in their order, data, other onboards; data last while timing is open', () => {
  const streams = [
    { id: 'main', type: 'main' as const },
    { id: 'data', type: 'data' as const },
    { id: 'ver', type: 'driver' as const, name: 'Max Verstappen' },
    { id: 'nor', type: 'driver' as const, name: 'Lando Norris' },
    { id: 'lec', type: 'driver' as const, name: 'Charles Leclerc' },
  ];
  expect(orderAutoStreams(streams, [], false)).toEqual(['main', 'data', 'ver', 'nor', 'lec']);
  expect(orderAutoStreams(streams, ['charles leclerc', 'Max Verstappen'], false)).toEqual(['main', 'lec', 'ver', 'data', 'nor']);
  expect(orderAutoStreams(streams, ['Lando Norris'], true)).toEqual(['main', 'nor', 'ver', 'lec', 'data']);
});

test('the manual layout for a count keeps the automatic slot ids', () => {
  expect(manualLayoutForCount(1).map((c) => c.i)).toEqual(['slot-0']);
  expect(manualLayoutForCount(2).map((c) => c.i)).toEqual(['slot-0', 'slot-1']);
  const five = manualLayoutForCount(5);
  expect(five.map((c) => c.i)).toEqual(['slot-0', 'slot-1', 'slot-2', 'slot-3', 'slot-4']);
  // Extra panels go below the main + 2 block without overlapping each other.
  expect(five[3]).toMatchObject({ x: 0, y: 8 });
  expect(five[4]).toMatchObject({ x: 4, y: 8 });
});

test('resizing the slot list keeps the remaining ids and reuses free numbers', () => {
  expect(resizeAutoSlotIds(['slot-0', 'slot-2', 'slot-3'], 2)).toEqual(['slot-0', 'slot-2']);
  expect(resizeAutoSlotIds(['slot-0', 'slot-2', 'slot-3'], 5)).toEqual(['slot-0', 'slot-2', 'slot-3', 'slot-1', 'slot-4']);
  expect(manualLayoutForSlots(['slot-3', 'slot-0']).map((c) => c.i)).toEqual(['slot-3', 'slot-0']);
});

test('a removed stream stays out and the other panels keep their stream', () => {
  const current = { 'slot-0': 'main', 'slot-2': 'ob-1', 'slot-3': 'ob-2' };
  // slot-1 (data) was removed: data is excluded from the priority.
  const { mapping, added } = planAutoSlots(['slot-0', 'slot-2', 'slot-3'], current, items.filter((id) => id !== 'data'));
  expect(mapping).toEqual(current);
  expect(added).toEqual([]);
});
