const fs = require('fs');
const path = 'C:\\Users\\HP\\Desktop\\admin-frontend\\src\\features\\users\\OwnerOperationsCenter.tsx';
let content = fs.readFileSync(path, 'utf8');

const forbiddenStart = '  // Forbidden / unauthorized state';
const forbiddenEnd = '    );\n  }';

const startIndex = content.indexOf(forbiddenStart);
const endIndex = content.indexOf(forbiddenEnd, startIndex) + forbiddenEnd.length;

if (startIndex === -1 || endIndex === -1) {
    console.error('Could not find forbidden block');
    process.exit(1);
}

const forbiddenBlock = content.substring(startIndex, endIndex);

// Remove the block
content = content.substring(0, startIndex) + content.substring(endIndex);

// Find the insertion point: after riskScore useMemo
const riskScoreEnd = '}, [mappedStats, mappedOwner.status]);';
const insertIndex = content.indexOf(riskScoreEnd) + riskScoreEnd.length;

if (insertIndex === -1) {
    console.error('Could not find riskScore insertion point');
    process.exit(1);
}

// Re-insert
content = content.substring(0, insertIndex) + '\n\n' + forbiddenBlock + content.substring(insertIndex);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully refactored hooks order');
