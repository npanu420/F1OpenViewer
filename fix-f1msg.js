const fs = require('fs');
const p = 'electron/f1tv-bridge.js';
let s = fs.readFileSync(p, 'utf8');
// Replace the block that defines detail without f1Msg (apostrophe in dall'API can be special char)
// Match line with const detail = ... (apostrophe in quote may be unicode U+2019)
// Quoted string may contain apostrophe (ASCII or U+2019)
const re = /(\s+if \(!candidates\.length\) \{\s+)const detail = firstError \? \(firstError\.message \|\| String\(firstError\)\) : ['\u2019][\s\S]*?['\u2019];/;
const match = s.match(re);
if (match) {
  s = s.replace(re,
    match[1] + "const f1Msg = firstF1Message || extractF1ErrorMessage(firstError);\n    const detail = f1Msg || (firstError ? (firstError.message || String(firstError)) : '');"
  );
  fs.writeFileSync(p, s);
  console.log('Replaced');
} else {
  const idx = s.indexOf('const detail = firstError');
  if (idx !== -1) {
    const snippet = s.slice(idx, idx + 120);
    console.log('Snippet:', JSON.stringify(snippet));
    const charCodes = [...snippet].map(c => c.charCodeAt(0));
    console.log('Char codes:', charCodes.slice(60, 90));
  } else {
    console.log('Line not found');
  }
}
