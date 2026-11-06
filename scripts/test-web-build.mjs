import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
const entries=await readdir('.next/standalone');
const forbidden=['.private','.local-data','.local-desktop-data','desktop-release','outputs','work'];
assert.deepEqual(entries.filter(entry=>forbidden.includes(entry)),[],'Deployment must not include private setup keys, local databases or release copies');
console.log('PASS: standalone deployment excludes private setup keys and local shop data.');
