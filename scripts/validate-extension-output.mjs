import fs from 'node:fs';
import path from 'node:path';

const outputRoot = path.resolve('.output/chrome-mv3');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.svg']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const problems = [];

function isUnicodeNonCharacter(codePoint) {
  return (codePoint >= 0xFDD0 && codePoint <= 0xFDEF)
    || (codePoint & 0xFFFF) === 0xFFFE
    || (codePoint & 0xFFFF) === 0xFFFF;
}

function inspect(file) {
  let text;
  try {
    text = decoder.decode(fs.readFileSync(file));
  } catch (error) {
    problems.push(`${path.relative(outputRoot, file)} is not valid UTF-8: ${String(error)}`);
    return;
  }

  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) continue;
    if (codePoint > 0xFFFF) index += 1;
    if (isUnicodeNonCharacter(codePoint)) {
      problems.push(`${path.relative(outputRoot, file)} contains U+${codePoint.toString(16).toUpperCase()}`);
      return;
    }
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) inspect(file);
  }
}

walk(outputRoot);
if (problems.length) {
  throw new Error(`Chrome-incompatible extension text output:\n${problems.join('\n')}`);
}
console.log('Validated extension text output: UTF-8 with no Unicode non-characters.');
