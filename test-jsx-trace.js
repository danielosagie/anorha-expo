const fs = require('fs');
const content = fs.readFileSync('src/components/ListingEditorForm.tsx', 'utf8');

// A very naive JSX tag stack tracer
let stack = [];
let lines = content.split('\n');
let insideBlockComment = false;

for (let i = 1588; i <= 3804; i++) {
  let line = lines[i];
  if (line === undefined) break;

  // ignore block comments
  if (line.includes('/*')) insideBlockComment = true;
  if (line.includes('*/')) {
     insideBlockComment = false;
     continue; 
  }
  if (insideBlockComment) continue;
  
  // ignoring single line comments
  line = line.replace(/\/\/.*$/, '');
  
  // match tags <Tag > and </Tag>
  let tagRegex = /<(\/)?([a-zA-Z0-9_\.]+)[^>]*(\/?)>/g;
  let match;
  while ((match = tagRegex.exec(line)) !== null) {
      const isClosing = match[1] === '/';
      const tagName = match[2];
      const isSelfClosing = match[3] === '/';
      
      if (isSelfClosing) continue;
      
      if (isClosing) {
          if (stack.length > 0 && stack[stack.length - 1].name === tagName) {
             stack.pop();
          } else {
             console.log(`MISMATCH at line ${i+1}: expected </${stack.length > 0 ? stack[stack.length-1].name : 'NOTHING'}>, found </${tagName}>. Stack: ${stack.map(s=>s.name).join(' ')}`);
             stack.pop(); // try popping to recover
          }
      } else {
          stack.push({name: tagName, line: i+1});
      }
  }
}

console.log("REMAINING STACK:");
stack.forEach(s => console.log(`${s.name} from line ${s.line}`));

