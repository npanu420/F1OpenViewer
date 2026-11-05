import { test } from 'vitest';
import assert from 'node:assert/strict';
import lt from './livetiming.js';

test('safeArchivePath accepts archive-style paths and strips leading slashes', () => {
  assert.equal(
    lt.safeArchivePath('/2024/2024-05-05_Miami_Grand_Prix/2024-05-05_Race/'),
    '2024/2024-05-05_Miami_Grand_Prix/2024-05-05_Race/'
  );
  assert.equal(lt.safeArchivePath('TeamRadio/MAXVER01_1_20240505_150000.mp3'), 'TeamRadio/MAXVER01_1_20240505_150000.mp3');
  // accented folder names must keep working
  assert.equal(lt.safeArchivePath('2023/2023-11-05_São_Paulo_Grand_Prix/2023-11-05_Race/'), '2023/2023-11-05_São_Paulo_Grand_Prix/2023-11-05_Race/');
});

test('safeArchivePath rejects traversal, foreign schemes and odd characters', () => {
  for (const bad of ['', '../x', 'a/../b', 'a/..', 'a b', 'http://evil/x', 'a?x=1', 'a#b', 'a\\b', undefined, null]) {
    assert.throws(() => lt.safeArchivePath(bad), /Invalid archive path/, String(bad));
  }
});
