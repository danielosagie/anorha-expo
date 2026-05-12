const fs = require('fs');
const content = fs.readFileSync('src/components/ListingEditorForm.tsx', 'utf8');
const lines = content.split('\n');

let braceCount = 0;
let parenCount = 0;

for (let i = 359; i < 3500; i++) {
  const line = lines[i] || '';
  let cleanLine = line.replace(/\/\/.*$/, '').replace(/\{?\s*\/\*.*?\*\/\s*\}?/g, '').replace(/".*?"/g, '').replace(/'.*?'/g, '').replace(/`.*?`/g, '');
  
  const openBraces = (cleanLine.match(/\{/g) || []).length;
  const closeBraces = (cleanLine.match(/\}/g) || []).length;
  braceCount += openBraces - closeBraces;

  const openParens = (cleanLine.match(/\(/g) || []).length;
  const closeParens = (cleanLine.match(/\)/g) || []).length;
  parenCount += openParens - closeParens;

  if (parenCount < 0) {
     console.log(`PAREN HIT -1 AT LINE ${i+1}: ${line}`);
     break;
  }
}

if (parenCount >= 0) console.log("PAREN COUNT AT 3500: ", parenCount);
console.log("BRACE COUNT AT 3500:", braceCount);

