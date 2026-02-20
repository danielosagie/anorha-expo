const fs = require('fs');
const content = fs.readFileSync('src/components/ListingEditorForm.tsx', 'utf8');

let stack = [];
let lines = content.split('\n');
let insideBlockComment = false;

for (let i = 1588; i <= 3804; i++) {
  let line = lines[i];
  if (line === undefined) break;

  if (line.includes('/*')) insideBlockComment = true;
  if (line.includes('*/')) {
     insideBlockComment = false;
     continue; 
  }
  if (insideBlockComment) continue;
  
  line = line.replace(/\/\/.*$/, '');
  
  // match tags
  let tagRegex = /<(\/)?([a-zA-Z0-9_\.]+)[^>]*?>/g;
  let match;
  while ((match = tagRegex.exec(line)) !== null) {
      const fullMatch = match[0];
      const isClosing = match[1] === '/';
      const tagName = match[2];
      const isSelfClosing = fullMatch.endsWith('/>');
      
      if (isSelfClosing) continue;
      
      // ignore types like <string> <Record> <any>
      if (['string', 'Record', 'any', 'number', 'boolean', 'ListingEditorFormRef'].includes(tagName)) continue;

      if (isClosing) {
          // find last matching tag to pop to recover gracefully if mistmached
          let found = false;
          for (let j = stack.length - 1; j >= 0; j--) {
             if (stack[j].name === tagName) {
                if (j < stack.length - 1) {
                   console.log(`MISMATCH RECOVER at line ${i+1}: skipping ${stack.length - 1 - j} tags to find </${tagName}>. Skipped: ${stack.slice(j+1).map(s=>s.name).join(', ')}`);
                }
                stack = stack.slice(0, j);
                found = true;
                break;
             }
          }
          if (!found) {
             console.log(`EXTRA CLOSING TAG at line ${i+1}: </${tagName}> without open tag. Stack: ${stack.map(s=>s.name).join(' ')}`);
          }
      } else {
          stack.push({name: tagName, line: i+1});
      }
  }
}

console.log("REMAINING STACK:");
stack.forEach(s => console.log(`${s.name} from line ${s.line}`));

