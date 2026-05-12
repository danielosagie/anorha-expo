const fs = require('fs');
const content = fs.readFileSync('src/components/ListingEditorForm.tsx', 'utf8');

const lines = content.split('\n');
let viewCount = 0;
let fragCount = 0;
let braceCount = 0;
let parenCount = 0;

// Read from the start of ListingEditorFormInner to line 3807
for (let i = 359; i < 3805; i++) {
  const line = lines[i];
  if (!line) continue;
  
  // Very rough regex matching
  const openViews = (line.match(/<View\b/g) || []).length;
  const closeViews = (line.match(/<\/View>/g) || []).length;
  viewCount += openViews - closeViews;
  
  const openFrags = (line.match(/<>/g) || []).length;
  const closeFrags = (line.match(/<\/>/g) || []).length;
  fragCount += openFrags - closeFrags;

  // Extremely rough char counting (ignoring strings/comments for a quick check)
  // Just strip comments and strings loosely
  let cleanLine = line.replace(/\/\/.*$/, '').replace(/\{?\/\*.*?\*\/\}?/g, '').replace(/".*?"/g, '').replace(/'.*?'/g, '').replace(/`.*?`/g, '');
  
  const openBraces = (cleanLine.match(/\{/g) || []).length;
  const closeBraces = (cleanLine.match(/\}/g) || []).length;
  braceCount += openBraces - closeBraces;

  const openParens = (cleanLine.match(/\(/g) || []).length;
  const closeParens = (cleanLine.match(/\)/g) || []).length;
  parenCount += openParens - closeParens;
}

console.log(`At line 3805 (where we insert </View> ); } ) `);
console.log(`View: ${viewCount}, Frag: ${fragCount}, Brace: ${braceCount}, Paren: ${parenCount}`);
