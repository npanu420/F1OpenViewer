/**
 * Unit + property tests for the live-timing reducer/selectors.
 * Run via `npm test` (node:test runs .ts natively on Node 23+).
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  mergeDeep,
  feedKey,
  createStore,
  applyRecord,
  applyRecords,
  selectDrivers,
  selectWeather,
  selectTrackStatus,
  selectRaceControl,
  selectClock,
  selectLapCount,
  selectTeamRadio,
} from './timing';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const randInt = (r: () => number, n: number) => Math.floor(r() * n);

test('feedKey strips .z suffix', () => {
  assert.equal(feedKey('CarData.z'), 'CarData');
  assert.equal(feedKey('Position.z'), 'Position');
  assert.equal(feedKey('TimingData'), 'TimingData');
});

test('mergeDeep: object deltas merge by key, keep untouched keys', () => {
  const t = { a: 1, nested: { x: 1, y: 2 } };
  mergeDeep(t, { nested: { y: 9, z: 3 }, b: 2 });
  assert.deepEqual(t, { a: 1, b: 2, nested: { x: 1, y: 9, z: 3 } });
});

test('mergeDeep: scalar replaces, array merges by index', () => {
  assert.equal(mergeDeep(5, 'x'), 'x');
  const arr = [{ v: 1 }, { v: 2 }, { v: 3 }];
  mergeDeep(arr, [undefined, { v: 22 }]);
  assert.deepEqual(arr, [{ v: 1 }, { v: 22 }, { v: 3 }]);
});

test('mergeDeep: keyed-object delta into array target (RaceControl quirk)', () => {
  const target: any = [{ Message: 'a' }];
  mergeDeep(target, { 1: { Message: 'b' } });
  assert.equal(target[0].Message, 'a');
  assert.equal(target[1].Message, 'b');
});

test('applyRecord: TimingData snapshot then delta updates position', () => {
  const store = createStore();
  applyRecord(store, 'TimingData', { Lines: { '63': { Line: 1, Position: '1', InPit: true } } });
  applyRecord(store, 'TimingData', { Lines: { '63': { Position: '2', InPit: false } } });
  assert.equal(store.TimingData.Lines['63'].Position, '2');
  assert.equal(store.TimingData.Lines['63'].InPit, false);
  assert.equal(store.TimingData.Lines['63'].Line, 1); // untouched key survives
});

test('applyRecord: CarData/Position replace (snapshot), never accumulate', () => {
  const store = createStore();
  applyRecord(store, 'CarData.z', { Entries: [{ Cars: { '1': { Channels: { 2: 100 } } } }] });
  applyRecord(store, 'CarData.z', { Entries: [{ Cars: { '1': { Channels: { 2: 300 } } } }] });
  assert.equal(store.CarData.Entries.length, 1);
  assert.equal(store.CarData.Entries[0].Cars['1'].Channels[2], 300);
});

test('property: applying snapshot+deltas == applying merged result', () => {
  // Order independence sanity: a value set by the last delta always wins.
  const r = rng(123);
  for (let trial = 0; trial < 300; trial++) {
    const store = createStore();
    let expected = '';
    const n = 2 + randInt(r, 8);
    for (let i = 0; i < n; i++) {
      const pos = String(1 + randInt(r, 20));
      expected = pos;
      applyRecord(store, 'TimingData', { Lines: { '44': { Position: pos } } });
    }
    assert.equal(store.TimingData.Lines['44'].Position, expected);
  }
});

const SAMPLE = {
  DriverList: {
    '63': { RacingNumber: '63', Tla: 'RUS', BroadcastName: 'G RUSSELL', TeamColour: '27F4D2', Line: 1 },
    '44': { RacingNumber: '44', Tla: 'HAM', BroadcastName: 'L HAMILTON', TeamColour: '27F4D2', Line: 2 },
    _kf: true,
  },
  TimingData: {
    Lines: {
      '63': {
        Line: 1,
        Position: '1',
        GapToLeader: '',
        IntervalToPositionAhead: { Value: '' },
        LastLapTime: { Value: '1:30.123' },
        BestLapTime: { Value: '1:29.900' },
        InPit: false,
        Sectors: [
          { Value: '25.9', OverallFastest: true, PersonalFastest: true, Segments: { '0': { Status: 2051 }, '1': { Status: 2049 } } },
          { Value: '39.2', OverallFastest: false, PersonalFastest: false },
        ],
      },
      '44': { Line: 2, Position: '2', GapToLeader: '+1.234', InPit: true },
    },
  },
  TimingAppData: {
    Lines: {
      '63': { Stints: { '0': { Compound: 'MEDIUM', TotalLaps: 3 } } },
      '44': { Stints: [{ Compound: 'SOFT', TotalLaps: 10 }] },
    },
  },
  CarData: {
    Entries: [
      { Cars: { '63': { Channels: { 2: 280, 3: 7, 45: 0 } }, '44': { Channels: { 2: 250, 3: 6, 45: 10 } } } },
    ],
  },
};

test('selectDrivers: joins feeds, sorts by line, maps tyre/telemetry', () => {
  const store = createStore();
  for (const [feed, data] of Object.entries(SAMPLE)) applyRecord(store, feed, data);
  const rows = selectDrivers(store);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => x.tla), ['RUS', 'HAM']); // line order
  const rus = rows[0];
  assert.equal(rus.teamColour, '#27F4D2');
  assert.equal(rus.tyre, 'MEDIUM');
  assert.equal(rus.stintLaps, 3);
  assert.equal(rus.speedKmh, 280);
  assert.equal(rus.gear, 7);
  assert.equal(rus.drs, false); // 0 < 8
  assert.equal(rus.lastLap, '1:30.123');
  assert.equal(rus.sectors.length, 2);
  assert.equal(rus.sectors[0].overallFastest, true);
  assert.deepEqual(rus.sectors[0].segments, [2051, 2049]); // keyed segments → index order
  assert.deepEqual(rus.sectors[1].segments, []); // missing Segments → empty
  const ham = rows[1];
  assert.equal(ham.inPit, true);
  assert.equal(ham.tyre, 'SOFT');
  assert.equal(ham.drs, true); // 10 >= 8
});

test('selectDrivers: ignores _meta keys, empty store → []', () => {
  assert.deepEqual(selectDrivers(createStore()), []);
  const store = createStore();
  applyRecord(store, 'DriverList', { _kf: true });
  assert.deepEqual(selectDrivers(store), []);
});

test('selectWeather maps fields and rainfall boolean', () => {
  const store = createStore();
  applyRecord(store, 'WeatherData', { AirTemp: '15.9', TrackTemp: '28.1', Rainfall: '0' });
  assert.deepEqual(selectWeather(store), {
    airTemp: '15.9',
    trackTemp: '28.1',
    humidity: '',
    pressure: '',
    windSpeed: '',
    windDirection: '',
    rainfall: false,
  });
  applyRecord(store, 'WeatherData', { Rainfall: '1' });
  assert.equal(selectWeather(store)!.rainfall, true);
});

test('selectTrackStatus maps known codes', () => {
  const store = createStore();
  applyRecord(store, 'TrackStatus', { Status: '1', Message: 'AllClear' });
  assert.equal(selectTrackStatus(store)!.label, 'Track Clear');
  applyRecord(store, 'TrackStatus', { Status: '4' });
  assert.equal(selectTrackStatus(store)!.label, 'Safety Car');
});

test('selectRaceControl: array snapshot then keyed deltas, newest first', () => {
  const store = createStore();
  applyRecord(store, 'RaceControlMessages', { Messages: [{ Utc: 't0', Message: 'AWNINGS', Lap: 1 }] });
  applyRecord(store, 'RaceControlMessages', { Messages: { '1': { Utc: 't1', Message: 'GREEN', Flag: 'GREEN', Lap: 1 } } });
  const msgs = selectRaceControl(store);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].message, 'GREEN'); // newest first
  assert.equal(msgs[0].flag, 'GREEN');
  assert.equal(msgs[1].message, 'AWNINGS');
});

test('selectClock', () => {
  const store = createStore();
  applyRecord(store, 'ExtrapolatedClock', { Remaining: '02:00:00', Extrapolating: true });
  assert.deepEqual(selectClock(store), { remaining: '02:00:00', extrapolating: true });
});

test('selectLapCount: needs a total, tracks current via delta', () => {
  const store = createStore();
  assert.equal(selectLapCount(store), null); // no feed
  applyRecord(store, 'LapCount', { CurrentLap: 1, TotalLaps: 52 });
  assert.deepEqual(selectLapCount(store), { current: 1, total: 52 });
  applyRecord(store, 'LapCount', { CurrentLap: 12 });
  assert.deepEqual(selectLapCount(store), { current: 12, total: 52 });
});

test('selectTeamRadio: array snapshot then keyed deltas, newest first', () => {
  const store = createStore();
  applyRecord(store, 'TeamRadio', { Captures: [{ Utc: 't0', RacingNumber: '63', Path: 'TeamRadio/RUS_0.mp3' }] });
  applyRecord(store, 'TeamRadio', { Captures: { '1': { Utc: 't1', RacingNumber: '44', Path: 'TeamRadio/HAM_1.mp3' } } });
  const clips = selectTeamRadio(store);
  assert.equal(clips.length, 2);
  assert.equal(clips[0].number, '44'); // newest first
  assert.equal(clips[0].path, 'TeamRadio/HAM_1.mp3');
  assert.equal(clips[1].number, '63');
});

test('applyRecords: bulk apply in order', () => {
  const store = createStore();
  applyRecords(store, [
    { feed: 'TimingData', data: { Lines: { '1': { Position: '5' } } } },
    { feed: 'TimingData', data: { Lines: { '1': { Position: '3' } } } },
  ]);
  assert.equal(store.TimingData.Lines['1'].Position, '3');
});
