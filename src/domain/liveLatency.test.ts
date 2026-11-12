import { test, expect } from 'vitest';
import { liveTuning, lowLatencyTarget, LOW_LATENCY_MAX, LOW_LATENCY_MIN } from './liveLatency';

test('standard mode keeps the manifest delay and the chosen live delay', () => {
  const t = liveTuning({ liveDelaySeconds: 4, lowLatencyLive: false }, false);
  expect(t.manifest).toEqual({});
  expect(t.liveSync).toEqual({ enabled: true, targetLatency: 4 });
  expect(t.rebufferingGoal).toBeNull();
  expect(t.edgeOffset).toBe(6);
  // A longer delay also starts further back, so playback does not begin by slowing down.
  expect(liveTuning({ liveDelaySeconds: 30, lowLatencyLive: false }, false).edgeOffset).toBe(30);
});

test('low-latency target is one segment plus a margin, within bounds', () => {
  expect(lowLatencyTarget(2)).toBe(2.5);
  expect(lowLatencyTarget(6)).toBe(6.5);
  expect(lowLatencyTarget(0.5)).toBe(LOW_LATENCY_MIN);
  expect(lowLatencyTarget(40)).toBe(LOW_LATENCY_MAX);
  expect(lowLatencyTarget(null)).toBe(2.5);
  expect(lowLatencyTarget(NaN)).toBe(2.5);
});

test('low-latency mode ignores the DASH manifest delay and can always start playing', () => {
  for (const segment of [1, 2, 4, 6, 10]) {
    const t = liveTuning({ liveDelaySeconds: 30, lowLatencyLive: true }, false, segment);
    expect(t.manifest).toMatchObject({ dash: { ignoreSuggestedPresentationDelay: true } });
    const sync = t.liveSync as { targetLatency: number; dynamicTargetLatency: { minLatency: number; maxLatency: number } };
    // The chosen live delay does not apply in this mode.
    expect(sync.targetLatency).toBe(lowLatencyTarget(segment));
    expect(sync.dynamicTargetLatency.minLatency).toBeLessThanOrEqual(sync.dynamicTargetLatency.maxLatency);
    // Otherwise the player waits for a buffer that can never exist this close to the edge.
    expect(t.rebufferingGoal!).toBeLessThan(sync.targetLatency);
    expect(t.edgeOffset).toBe(sync.targetLatency);
  }
});

test('low-latency HLS stays two segments back and leaves the DASH options alone', () => {
  const t = liveTuning({ liveDelaySeconds: 4, lowLatencyLive: true }, true, 6);
  expect(t.manifest).toEqual({ hls: { liveSegmentsDelay: 2 } });
});
