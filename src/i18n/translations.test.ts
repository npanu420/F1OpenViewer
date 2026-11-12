import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { translations } from './translations';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

test('EN and IT define exactly the same keys', () => {
  const en = Object.keys(translations.en).sort();
  const it = Object.keys(translations.it).sort();
  expect(it.filter((k) => !en.includes(k))).toEqual([]);
  expect(en.filter((k) => !it.includes(k))).toEqual([]);
});

test('every literal t(\'key\') used in src exists in the English dictionary', () => {
  const root = path.join(__dirname, '..');
  const missing = new Set<string>();
  for (const file of walk(root)) {
    if (file.endsWith(`i18n${path.sep}translations.ts`)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'\s*\)/g)) {
      if (!(m[1] in translations.en)) missing.add(`${path.relative(root, file)}: ${m[1]}`);
    }
  }
  expect([...missing]).toEqual([]);
});

test('dynamic stage/variant keys used by the session tabs exist in both languages', async () => {
  const { STAGE_ORDER } = await import('../domain/sessionGrouping');
  const variants = ['session', 'pre-show', 'post-show', 'kids'];
  for (const lang of ['en', 'it'] as const) {
    for (const k of STAGE_ORDER) expect(translations[lang][`stage.${k}`], `${lang} stage.${k}`).toBeTruthy();
    for (const v of variants) expect(translations[lang][`variant.${v}`], `${lang} variant.${v}`).toBeTruthy();
  }
});

test('work-in-progress languages only use English keys and keep their placeholders', () => {
  const en = translations.en;
  for (const lang of ['fr', 'de', 'es'] as const) {
    const dict = translations[lang];
    expect(Object.keys(dict).filter((k) => !(k in en)), `${lang} unknown keys`).toEqual([]);
    for (const [k, v] of Object.entries(dict)) {
      const want = (en[k].match(/\{[a-zA-Z]+\}/g) ?? []).sort();
      const got = (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
      expect(got, `${lang} ${k}`).toEqual(want);
      expect(v.trim(), `${lang} ${k}`).not.toBe('');
    }
  }
});
