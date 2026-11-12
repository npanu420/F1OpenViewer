/** Slot ids of the automatic arrangement, shared with the manual grid. */
export function autoSlotIdsForCount(count: number): string[] {
  return resizeAutoSlotIds([], count);
}

/** Cut or extend `ids` to `count` slots. Kept ids stay put, so their players never reload. */
export function resizeAutoSlotIds(ids: readonly string[], count: number): string[] {
  const total = Math.max(1, Math.floor(count));
  const out = ids.slice(0, total);
  for (let index = 0; out.length < total; index++) {
    const id = `slot-${index}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export interface AutoStream {
  id: string;
  type: 'main' | 'driver' | 'data';
  name?: string;
  driverNumber?: number;
}

/** What live timing says about a driver, as far as the automatic layout cares. */
export interface DriverTimingState {
  /** Running order, 1 = leader. */
  line: number;
  /** Retired, or knocked out of qualifying: the onboard has nothing left to show. */
  out: boolean;
}

export interface AutoTiming {
  drivers: ReadonlyMap<number, DriverTimingState>;
  /** Streams on screen now. They keep their tile until they drop a few places past the cut. */
  shown: ReadonlySet<string>;
}

/** Places an onboard on screen may lose before a driver behind takes its tile (no flip-flop in a battle). */
export const SHOWN_POSITION_BONUS = 2;

/** Compact, comparable form of the timing rows: re-planning only happens when it changes. */
export function timingStateKey(rows: readonly { number: string; line: number; retired: boolean; knockedOut?: boolean }[]): string {
  return rows.map((r) => `${r.number}:${r.line}:${r.retired || r.knockedOut ? 1 : 0}`).join(',');
}

export function parseTimingStateKey(key: string): Map<number, DriverTimingState> {
  const out = new Map<number, DriverTimingState>();
  if (!key) return out;
  for (const part of key.split(',')) {
    const [num, line, gone] = part.split(':');
    const n = Number(num);
    if (Number.isFinite(n)) out.set(n, { line: Number(line) || 999, out: gone === '1' });
  }
  return out;
}

/**
 * Stream priority for the automatic layout: main feed, favourites, data channels, other onboards.
 * With live timing open the data channels go last, the timing tower already covers them.
 * With timing data, onboards of drivers who are out leave the layout and the other onboards
 * follow the running order.
 */
export function orderAutoStreams(
  streams: readonly AutoStream[],
  favorites: readonly string[],
  timingOpen: boolean,
  timing?: AutoTiming | null
): string[] {
  const rank = new Map(favorites.map((name, index) => [name.trim().toLowerCase(), index]));
  const rankOf = (stream: AutoStream) => rank.get((stream.name ?? '').trim().toLowerCase());
  const stateOf = (stream: AutoStream) =>
    stream.driverNumber != null ? timing?.drivers.get(stream.driverNumber) : undefined;
  const main = streams.filter((s) => s.type === 'main');
  const data = streams.filter((s) => s.type === 'data');
  const drivers = streams.filter((s) => s.type === 'driver' && !stateOf(s)?.out);
  const favorite = drivers.filter((s) => rankOf(s) != null).sort((a, b) => rankOf(a)! - rankOf(b)!);
  let others = drivers.filter((s) => rankOf(s) == null);
  if (timing && timing.drivers.size > 0) {
    const place = (s: AutoStream) => {
      const line = stateOf(s)?.line;
      if (line == null) return Number.POSITIVE_INFINITY;
      return timing.shown.has(s.id) ? line - SHOWN_POSITION_BONUS : line;
    };
    // Stable sort: drivers without timing keep their catalog order, after the others.
    others = others.map((s, index) => ({ s, index })).sort((a, b) => place(a.s) - place(b.s) || a.index - b.index).map((x) => x.s);
  }
  const ordered = timingOpen ? [...main, ...favorite, ...others, ...data] : [...main, ...favorite, ...data, ...others];
  return ordered.map((s) => s.id);
}

/**
 * Assigns streams to the automatic slots. Pinned (hand-placed) slots keep their stream, the rest
 * take the highest-priority streams in order. Also returns the streams that were not shown before,
 * so they can be started.
 */
export function planAutoSlots(
  slotIds: readonly string[],
  slotToItemId: Readonly<Record<string, string>>,
  order: readonly string[],
  pinned: ReadonlySet<string> = new Set()
): { mapping: Record<string, string>; added: string[] } {
  const known = new Set(order);
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const slot of slotIds) {
    const itemId = slotToItemId[slot];
    // One player per stream: a duplicate keeps only its first panel.
    if (pinned.has(slot) && itemId && known.has(itemId) && !used.has(itemId)) {
      mapping[slot] = itemId;
      used.add(itemId);
    }
  }
  // The top-priority streams that fit fill the free panels. The first one always takes the first
  // free panel (the big tile); the others stay in the panel they already have, so a change in the
  // priority only reloads the streams that actually come or go.
  const free = slotIds.filter((slot) => !mapping[slot]);
  const chosen = order.filter((itemId) => !used.has(itemId)).slice(0, free.length);
  const taken = new Set<string>();
  if (chosen.length > 0) {
    mapping[free[0]] = chosen[0];
    taken.add(chosen[0]);
  }
  for (const slot of free) {
    const itemId = slotToItemId[slot];
    if (mapping[slot] || !itemId || taken.has(itemId) || !chosen.includes(itemId)) continue;
    mapping[slot] = itemId;
    taken.add(itemId);
  }
  const rest = chosen.filter((itemId) => !taken.has(itemId));
  for (const slot of free) if (!mapping[slot] && rest.length > 0) mapping[slot] = rest.shift()!;
  const shownBefore = new Set(slotIds.map((slot) => slotToItemId[slot]).filter(Boolean));
  const added = slotIds.map((slot) => mapping[slot]).filter((itemId) => itemId && !shownBefore.has(itemId));
  return { mapping, added };
}
