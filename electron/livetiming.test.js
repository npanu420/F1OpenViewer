/**
 * Unit + light property-based tests for the live-timing parser/decoder (M1).
 * Run: `npm test` (node:test, no extra deps). Network functions are not tested here.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import lt from './livetiming.js';

// Tiny seeded RNG so property runs are deterministic (no Math.random flakiness).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const randInt = (r, n) => Math.floor(r() * n);

test('parseOffset: known values', () => {
  assert.equal(lt.parseOffset('00:00:05.898'), 5898);
  assert.equal(lt.parseOffset('01:02:03.456'), (1 * 3600 + 2 * 60 + 3) * 1000 + 456);
  assert.equal(lt.parseOffset('00:00:00.000'), 0);
});

test('parseOffset: rejects bad shapes', () => {
  for (const bad of ['', '5898', '0:0:0.0', '00:00:05', 'aa:bb:cc.ddd', null, undefined]) {
    assert.equal(lt.parseOffset(bad), null);
  }
});

test('property: formatOffset ∘ parseOffset is identity for valid timestamps', () => {
  const r = rng(42);
  for (let i = 0; i < 2000; i++) {
    const h = randInt(r, 24);
    const m = randInt(r, 60);
    const s = randInt(r, 60);
    const ms = randInt(r, 1000);
    const p2 = (n) => String(n).padStart(2, '0');
    const ts = `${p2(h)}:${p2(m)}:${p2(s)}.${String(ms).padStart(3, '0')}`;
    const offset = lt.parseOffset(ts);
    assert.notEqual(offset, null, `parse failed for ${ts}`);
    assert.equal(lt.formatOffset(offset), ts, `roundtrip failed for ${ts}`);
  }
});

test('property: parseOffset ∘ formatOffset is identity for valid ms (< 24h)', () => {
  const r = rng(7);
  for (let i = 0; i < 2000; i++) {
    const ms = randInt(r, 24 * 3600 * 1000);
    assert.equal(lt.parseOffset(lt.formatOffset(ms)), ms);
  }
});

test('stripBom removes only a leading BOM', () => {
  assert.equal(lt.stripBom('﻿hello'), 'hello');
  assert.equal(lt.stripBom('hello'), 'hello');
  assert.equal(lt.stripBom('a﻿b'), 'a﻿b');
});

test('isCompressedFeed', () => {
  assert.ok(lt.isCompressedFeed('CarData.z'));
  assert.ok(lt.isCompressedFeed('Position.z'));
  assert.ok(!lt.isCompressedFeed('TimingData'));
});

test('inflateZ round-trips a raw-deflate base64 blob', () => {
  const obj = { Entries: [{ Cars: { 1: { Channels: { 0: 11000, 2: 280 } } } }] };
  const b64 = zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64');
  assert.deepEqual(lt.inflateZ(b64), obj);
});

test('decodePayload: plain JSON feed', () => {
  assert.deepEqual(lt.decodePayload('WeatherData', '{"AirTemp":"15.9"}'), { AirTemp: '15.9' });
});

test('decodePayload: compressed feed (quoted base64)', () => {
  const obj = { Entries: [{ Utc: 'x' }] };
  const b64 = zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64');
  // jsonStream stores the payload as a JSON-quoted string.
  assert.deepEqual(lt.decodePayload('CarData.z', JSON.stringify(b64)), obj);
});

test('decodePayload: malformed input → null (never throws)', () => {
  assert.equal(lt.decodePayload('TimingData', '{not json'), null);
  assert.equal(lt.decodePayload('CarData.z', 'not-a-quoted-b64'), null);
  assert.equal(lt.decodePayload('CarData.z', '"@@@not-base64@@@"'), null);
});

test('parseJsonStream: plain feed, multi-record with BOM and CRLF', () => {
  const body =
    '﻿00:00:05.091{"AirTemp":"15.9","TrackTemp":"28.1"}\r\n' +
    '00:01:05.070{"AirTemp":"15.8","TrackTemp":"27.6"}\r\n';
  const recs = lt.parseJsonStream(body, 'WeatherData');
  assert.equal(recs.length, 2);
  assert.equal(recs[0].offsetMs, 5091);
  assert.equal(recs[0].data.TrackTemp, '28.1');
  assert.equal(recs[1].offsetMs, 65070);
});

test('parseJsonStream: samples compressed feeds 1-in-SAMPLE_STRIDE, plain feeds untouched', () => {
  const mk = (offsetSec, n) => {
    const ts = `00:00:${String(offsetSec).padStart(2, '0')}.000`;
    const b64 = zlib.deflateRawSync(Buffer.from(JSON.stringify({ n }), 'utf8')).toString('base64');
    return `${ts}${JSON.stringify(b64)}`;
  };
  const lines = Array.from({ length: 20 }, (_, i) => mk(i, i));
  const body = lines.join('\r\n');
  const recs = lt.parseJsonStream(body, 'CarData.z');
  // Twenty lines sampled at stride five retain indices 0, 5, 10, and 15.
  assert.deepEqual(recs.map((r) => r.data.n), [0, 5, 10, 15]);

  const plainLines = Array.from({ length: 20 }, (_, i) => `00:00:${String(i).padStart(2, '0')}.000{"n":${i}}`);
  const plainRecs = lt.parseJsonStream(plainLines.join('\r\n'), 'TimingData');
  assert.equal(plainRecs.length, 20); // not sampled
});

test('parseJsonStream: skips malformed lines, keeps good ones', () => {
  const body =
    '00:00:01.000{"a":1}\n' +
    'garbage-line-no-timestamp\n' +
    '00:00:02.000{bad json}\n' +
    '00:00:03.000{"a":3}\n';
  const recs = lt.parseJsonStream(body, 'TimingData');
  assert.deepEqual(recs.map((rrec) => rrec.offsetMs), [1000, 3000]);
});

test('parseJsonStream: records stay in stream order', () => {
  let body = '';
  const expected = [];
  for (let i = 0; i < 50; i++) {
    const ms = i * 137;
    body += `${lt.formatOffset(ms)}{"i":${i}}\n`;
    expected.push(ms);
  }
  const recs = lt.parseJsonStream(body, 'TimingData');
  assert.deepEqual(recs.map((rrec) => rrec.offsetMs), expected);
  assert.deepEqual(recs.map((rrec) => rrec.data.i), expected.map((_, i) => i));
});

test('parseJsonStream: empty / whitespace bodies → []', () => {
  assert.deepEqual(lt.parseJsonStream('', 'TimingData'), []);
  assert.deepEqual(lt.parseJsonStream('﻿', 'TimingData'), []);
  assert.deepEqual(lt.parseJsonStream('\r\n\r\n', 'TimingData'), []);
});

test('property: parseJsonStream round-trips random plain records', () => {
  const r = rng(99);
  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + randInt(r, 20);
    const records = [];
    let body = '';
    let lastMs = 0;
    for (let i = 0; i < n; i++) {
      lastMs += randInt(r, 5000);
      const data = { n: randInt(r, 1000), pos: String(1 + randInt(r, 20)) };
      records.push({ offsetMs: lastMs, data });
      body += `${lt.formatOffset(lastMs)}${JSON.stringify(data)}\n`;
    }
    const parsed = lt.parseJsonStream(body, 'TimingData');
    assert.equal(parsed.length, records.length);
    for (let i = 0; i < records.length; i++) {
      assert.equal(parsed[i].offsetMs, records[i].offsetMs);
      assert.deepEqual(parsed[i].data, records[i].data);
    }
  }
});

test('findSession: matches by sessionKey', () => {
  const index = {
    Meetings: [
      {
        Key: 1240,
        Sessions: [
          { Key: 9557, Name: 'Practice 1', Path: 'p1/' },
          { Key: 9558, Name: 'Race', Path: '2024/brit/race/' },
        ],
      },
    ],
  };
  const found = lt.findSession(index, { sessionKey: 9558 });
  assert.equal(found.path, '2024/brit/race/');
  assert.equal(found.session.Name, 'Race');
});

test('findSession: string/number key coercion', () => {
  const index = { Meetings: [{ Key: 1, Sessions: [{ Key: 42, Path: 'x/' }] }] };
  assert.equal(lt.findSession(index, { sessionKey: '42' }).path, 'x/');
  assert.equal(lt.findSession(index, { sessionKey: 42 }).path, 'x/');
});

test('findSession: fallback to session name when no key', () => {
  const index = { Meetings: [{ Key: 1, Sessions: [{ Key: 42, Name: 'Qualifying', Path: 'q/' }] }] };
  assert.equal(lt.findSession(index, { sessionName: 'qualifying' }).path, 'q/');
});

test('findSession: meetingName scopes the session-name match (replay resolution)', () => {
  const index = {
    Meetings: [
      { Name: 'Spanish Grand Prix', Sessions: [{ Name: 'Race', Path: 'spa/race/' }] },
      {
        Name: 'Austrian Grand Prix',
        Sessions: [
          { Name: 'Sprint Qualifying', Path: 'aut/sq/' },
          { Name: 'Sprint', Path: 'aut/sprint/' },
          { Name: 'Race', Path: 'aut/race/' },
        ],
      },
    ],
  };
  // substring meeting match + exact session name, disambiguating across meetings
  assert.equal(lt.findSession(index, { meetingName: 'Austrian', sessionName: 'Race' }).path, 'aut/race/');
  // exact session-name avoids Sprint vs Sprint Qualifying collision
  assert.equal(lt.findSession(index, { meetingName: 'Austrian Grand Prix', sessionName: 'Sprint' }).path, 'aut/sprint/');
  assert.equal(lt.findSession(index, { meetingName: 'austrian', sessionName: 'Sprint Qualifying' }).path, 'aut/sq/');
  // A session from another meeting must not match.
  assert.equal(lt.findSession(index, { meetingName: 'Monaco', sessionName: 'Race' }), null);
});

test('parseCoreFrame: type:3 Subscribe completion = initial snapshot, keyed by feed', () => {
  const frame = JSON.stringify({ type: 3, invocationId: '1', result: { DriverList: { '1': { Tla: 'VER' } }, TimingData: { Lines: {} } } });
  const recs = lt.parseCoreFrame(frame);
  assert.deepEqual(recs, [
    { feed: 'DriverList', data: { '1': { Tla: 'VER' } } },
    { feed: 'TimingData', data: { Lines: {} } },
  ]);
});

test('parseCoreFrame: type:1 feed invocation', () => {
  const frame = JSON.stringify({ type: 1, target: 'feed', arguments: ['TimingData', { Lines: { '1': { Position: '1' } } }, '2026-01-01T00:00:00Z'] });
  assert.deepEqual(lt.parseCoreFrame(frame), [
    { feed: 'TimingData', data: { Lines: { '1': { Position: '1' } } } },
  ]);
});

test('parseCoreFrame: multiple record-separator-joined messages in one frame', () => {
  const a = JSON.stringify({ type: 1, target: 'feed', arguments: ['TrackStatus', { Status: '1' }, 't'] });
  const b = JSON.stringify({ type: 1, target: 'feed', arguments: ['LapCount', { CurrentLap: 3 }, 't'] });
  assert.deepEqual(lt.parseCoreFrame(`${a}\x1e${b}\x1e`), [
    { feed: 'TrackStatus', data: { Status: '1' } },
    { feed: 'LapCount', data: { CurrentLap: 3 } },
  ]);
});

test('parseCoreFrame: handshake ack / ping / close / malformed → []', () => {
  assert.deepEqual(lt.parseCoreFrame('{}'), []);
  assert.deepEqual(lt.parseCoreFrame(JSON.stringify({ type: 6 })), []);
  assert.deepEqual(lt.parseCoreFrame(JSON.stringify({ type: 7 })), []);
  assert.deepEqual(lt.parseCoreFrame('not json'), []);
});

test('parseCoreFrame: inflates .z feeds (base64 string, not a JSON-quoted text line like jsonStream)', () => {
  const obj = { Entries: [{ Cars: { '1': { Channels: { '2': 140 } } } }] };
  const b64 = zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64');
  const frame = JSON.stringify({ type: 1, target: 'feed', arguments: ['CarData.z', b64, 't'] });
  assert.deepEqual(lt.parseCoreFrame(frame), [{ feed: 'CarData.z', data: obj }]);
});

test('parseCoreFrame: drops a .z record with a garbage blob instead of applying it', () => {
  const frame = JSON.stringify({ type: 1, target: 'feed', arguments: ['CarData.z', 'not-base64-deflate', 't'] });
  assert.deepEqual(lt.parseCoreFrame(frame), []);
});

test('findSession: no match / bad input → null', () => {
  assert.equal(lt.findSession({ Meetings: [] }, { sessionKey: 1 }), null);
  assert.equal(lt.findSession(null, { sessionKey: 1 }), null);
  assert.equal(lt.findSession({}, { sessionKey: 1 }), null);
});
