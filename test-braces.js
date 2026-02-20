const fs = require('fs');
const content = fs.readFileSync('src/components/ListingEditorForm.tsx', 'utf8');
const lines = content.split('\n');

let braceCount = 0;
let parenCount = 0;

for (let i = 359; i < 3500; i++) { // Let's check up to 3500 since the user diff showed changes around 3500-3800, maybe earlier? No, user diff was only at the end. But wait, I'll check the whole file.
  const line = lines[i] || '';
  let cleanLine = line.replace(/\/\/.*$/, '').replace(/\{?\/\*.*?\*\/\}?/g, '').replace(/".*?"/g, '').replace(/'.*?'/g, '').replace(/`.*?`/g, '');
  
  const openBraces = (cleanLine.match(/\{/g) || []).length;
  const closeBraces = (cleanLine.match(/\}/g) || []).length;
  braceCount += openBraces - closeBraces;

  const openParens = (cleanLine.match(/\(/g) || []).length;
  const closeParens = (cleanLine.match(/\)/g) || []).length;
  parenCount += openParens - closeParens;

  if (braceCount < 0) {
    console.log(`NEGATIVE BRACE BALANCE at line ${i + 1}: ${line}`);
    break; // We found the earliest negative brace balance
  }
}
console.log(`Up to 3500: Brace: ${braceCount}, Paren: ${parenCount}`);
