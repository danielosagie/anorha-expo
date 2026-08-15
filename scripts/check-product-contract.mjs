import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDORED_HEADER = [
  '// VENDORED - DO NOT EDIT.',
  '// Backend source: ../sssync-bknd/src/contracts/product-patch.contract.ts',
  '// Regenerate upstream with `npm run contracts:generate` from the backend root, then re-copy it here.',
].join('\n') + '\n';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const backendRoot = process.env.ANORHA_BKND_ROOT
  ? path.resolve(process.env.ANORHA_BKND_ROOT)
  : path.resolve(repoRoot, '../sssync-bknd');
const backendContract = path.join(backendRoot, 'src/contracts/product-patch.contract.ts');
const vendoredContract = path.join(repoRoot, 'src/contracts/product-patch.contract.ts');

try {
  await access(backendContract);
} catch {
  console.log(
    `[contracts:check] SKIPPED: backend contract not found at ${backendContract}. ` +
    'Set ANORHA_BKND_ROOT to a backend checkout that contains src/contracts/product-patch.contract.ts.',
  );
  process.exit(0);
}

const [vendoredBytes, backendBytes] = await Promise.all([
  readFile(vendoredContract),
  readFile(backendContract),
]);
const headerBytes = Buffer.from(VENDORED_HEADER);

if (!vendoredBytes.subarray(0, headerBytes.length).equals(headerBytes)) {
  console.error(
    `[contracts:check] FAILED: ${vendoredContract} is missing the required VENDORED header.\n` +
    `Expected the header to identify ${backendContract} and its upstream generator.\n` +
    `Ask: restore the header, run \`npm run contracts:generate\` in ${backendRoot}, then re-copy the generated contract body to ${vendoredContract}.`,
  );
  process.exit(1);
}

const vendoredBody = vendoredBytes.subarray(headerBytes.length);
if (!vendoredBody.equals(backendBytes)) {
  console.error(
    `[contracts:check] FAILED: vendored product contract is stale.\n` +
    `Expected ${vendoredContract} (with its VENDORED header stripped) to match ${backendContract}.\n` +
    `Ask: run \`npm run contracts:generate\` in ${backendRoot}, then re-copy ${backendContract} to ${vendoredContract} beneath the existing VENDORED header.`,
  );
  process.exit(1);
}

console.log(`[contracts:check] OK: ${vendoredContract} matches ${backendContract}.`);
