import { test, expect } from 'vitest';
import { CURRENT_GRID } from './driverGrid';

test('the grid lists 22 distinct drivers with distinct numbers, two per team', () => {
  expect(CURRENT_GRID).toHaveLength(22);
  expect(new Set(CURRENT_GRID.map((d) => d.name.toLowerCase())).size).toBe(22);
  expect(new Set(CURRENT_GRID.map((d) => d.number)).size).toBe(22);
  const perTeam = new Map<string, number>();
  for (const d of CURRENT_GRID) perTeam.set(d.team, (perTeam.get(d.team) ?? 0) + 1);
  expect([...perTeam.values()].every((n) => n === 2)).toBe(true);
});

test('names carry no accents or surrounding spaces, like the onboard stream names', () => {
  for (const d of CURRENT_GRID) {
    expect(d.name).toBe(d.name.trim());
    expect(d.name.normalize('NFD')).toBe(d.name);
    expect(d.colour).toMatch(/^#[0-9A-F]{6}$/i);
  }
});
