/** Groups F1 sessions by weekend stage and broadcast variant. */

export type SessionVariant = 'session' | 'pre-show' | 'post-show' | 'kids';
export type StageKey = 'fp1' | 'fp2' | 'fp3' | 'sprint-quali' | 'sprint' | 'qualifying' | 'race';

export type GroupableItem = { id: string; label: string; series?: string };

export type StageGroup<T extends GroupableItem> = {
  key: StageKey;
  variants: Partial<Record<SessionVariant, T>>;
};

export const STAGE_ORDER: StageKey[] = [
  'fp1',
  'fp2',
  'fp3',
  'sprint-quali',
  'sprint',
  'qualifying',
  'race',
];

export const STAGE_LABELS: Record<StageKey, string> = {
  fp1: 'FP1',
  fp2: 'FP2',
  fp3: 'FP3',
  'sprint-quali': 'Sprint Quali',
  sprint: 'Sprint',
  qualifying: 'Qualifying',
  race: 'Race',
};

export const VARIANT_LABELS: Record<SessionVariant, string> = {
  session: 'Session',
  'pre-show': 'Pre-Show',
  'post-show': 'Post-Show',
  kids: 'F1 Kids',
};

// Specific matches must precede broader ones such as sprint and qualifying.
const STAGE_MATCHERS: Record<StageKey, RegExp> = {
  fp1: /\bpractice\s*1\b|\bfp1\b/i,
  fp2: /\bpractice\s*2\b|\bfp2\b/i,
  fp3: /\bpractice\s*3\b|\bfp3\b/i,
  'sprint-quali': /\bsprint\s*(qualifying|shootout)\b/i,
  sprint: /\bsprint\b/i,
  qualifying: /\bqualifying\b/i,
  race: /\bgrand prix\b|\brace\b/i,
};

function classifyStageByKeyword(title: string): StageKey | null {
  for (const key of STAGE_ORDER) {
    if (STAGE_MATCHERS[key].test(title)) return key;
  }
  return null;
}

function classifyVariant(title: string): SessionVariant {
  if (/\bf1\s*kids\b/i.test(title)) return 'kids';
  if (/^pre[\s-]/i.test(title)) return 'pre-show';
  if (/^post[\s-]/i.test(title)) return 'post-show';
  return 'session';
}

function classifyStage(title: string, variant: SessionVariant): StageKey | null {
  if (variant === 'kids') return /\bsprint\b/i.test(title) ? 'sprint' : 'race';
  return classifyStageByKeyword(title);
}

function classify(title: string): { stage: StageKey | null; variant: SessionVariant } {
  if (/weekend warm-?up/i.test(title)) return { stage: 'fp1', variant: 'pre-show' };
  const variant = classifyVariant(title);
  return { stage: classifyStage(title, variant), variant };
}

export function groupSessionTabs<T extends GroupableItem>(
  items: T[]
): { stages: StageGroup<T>[]; extras: T[] } {
  const byStage = new Map<StageKey, Partial<Record<SessionVariant, T>>>();
  const extras: T[] = [];

  for (const item of items) {
    const { stage: stageKey, variant } = classify(item.label);
    if (!stageKey) {
      extras.push(item);
      continue;
    }
    const variants = byStage.get(stageKey) ?? {};
    if (variants[variant]) {
      extras.push(item);
      continue;
    }
    variants[variant] = item;
    byStage.set(stageKey, variants);
  }

  const stages: StageGroup<T>[] = STAGE_ORDER.filter((key) => byStage.has(key)).map((key) => ({
    key,
    variants: byStage.get(key)!,
  }));

  return { stages, extras };
}

export type SeriesGroup<T extends GroupableItem> = { label: string; items: T[] };

/** Splits sessions by racing series while preserving their source order. */
export function groupBySeries<T extends GroupableItem>(
  items: T[]
): { f1: T[]; otherSeries: SeriesGroup<T>[] } {
  const f1: T[] = [];
  const otherSeries: SeriesGroup<T>[] = [];
  const bySeriesLabel = new Map<string, SeriesGroup<T>>();

  for (const item of items) {
    const series = item.series || 'F1';
    if (series === 'F1') {
      f1.push(item);
      continue;
    }
    let group = bySeriesLabel.get(series);
    if (!group) {
      group = { label: series, items: [] };
      bySeriesLabel.set(series, group);
      otherSeries.push(group);
    }
    group.items.push(item);
  }

  return { f1, otherSeries };
}

export function pickDefaultSessionId<T extends GroupableItem>(items: T[]): string | null {
  if (!items.length) return null;
  const { f1 } = groupBySeries(items);
  const { stages } = groupSessionTabs(f1);
  const race = stages.find((s) => s.key === 'race');
  const bestOf = (s: StageGroup<T>) => s.variants.session ?? Object.values(s.variants)[0];
  if (race) {
    const item = bestOf(race);
    if (item) return item.id;
  }
  for (const stage of stages) {
    const item = bestOf(stage);
    if (item) return item.id;
  }
  return items[0].id;
}
