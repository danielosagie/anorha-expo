const fs = require('fs');
const content = fs.readFileSync('src/components/ListingEditorForm.tsx', 'utf8');
const lines = content.split('\n');

let braceCount = 0;
let parenCount = 0;
let viewCount = 0;
let fragCount = 0;

for (let i = 359; i < 3805; i++) {
  // skip lines 3058, 3059, 3060
  if (i === 3058 || i === 3059 || i === 3060) continue; // Note 0-indexed, so 3058 = line 3059
  
  const line = lines[i] || '';
  
  const openViews = (line.match(/<View\b/g) || []).length;
  const closeViews = (line.match(/<\/View>/g) || []).length;
  viewCount += openViews - closeViews;
  
  const openFrags = (line.match(/<>/g) || []).length;
  const closeFrags = (line.match(/<\/>/g) || []).length;
  fragCount += openFrags - closeFrags;

  let cleanLine = line.replace(/\/\/.*$/, '').replace(/\{?\/\*.*?\*\/\}?/g, '').replace(/".*?"/g, '').replace(/'.*?'/g, '').replace(/`.*?`/g, '');
  
  const openBraces = (cleanLine.match(/\{/g) || []).length;
  const closeBraces = (cleanLine.match(/\}/g) || []).length;
  braceCount += openBraces - closeBraces;

  const openParens = (cleanLine.match(/\(/g) || []).length;
  const closeParens = (cleanLine.match(/\)/g) || []).length;
  parenCount += openParens - closeParens;
}

console.log(`With 3059-3061 removed -> Brace: ${braceCount}, Paren: ${parenCount}, View: ${viewCount}, Frag: ${fragCount}`);
