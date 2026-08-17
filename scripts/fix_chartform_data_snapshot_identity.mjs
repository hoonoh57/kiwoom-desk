import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'forms', 'ChartForm.ts');

function canonicalize(source) {
  return String(source ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
function replaceRequired(source, marker, replacement, label) {
  if (!source.includes(marker)) throw new Error(`Loaded-data identity migration marker not found: ${label}`);
  return source.replace(marker, replacement);
}

let source = canonicalize(await fs.readFile(file, 'utf8'));
if (source.includes('runtimeDataLoadedIdentity')) {
  console.log('Strict loaded-data identity guard already present.');
  process.exit(0);
}

source = replaceRequired(
  source,
  `  private runtimeBootstrapOpen = true;\n  private runtimeDataRestored = false;\n  private readonly runtimeStateSubscribers`,
  `  private runtimeBootstrapOpen = true;\n  private runtimeDataRestored = false;\n  private runtimeDataLoadedIdentity = '';\n  private readonly runtimeStateSubscribers`,
  'loaded identity field',
);

source = replaceRequired(
  source,
  `  private captureRuntimeDataSnapshot(): unknown {\n    if (!this.bars.length) return undefined;\n    return {\n      schemaVersion: 1,\n      identity: this.runtimeDataIdentity(),`,
  `  private captureRuntimeDataSnapshot(): unknown {\n    const identity = this.runtimeDataIdentity();\n    if (!this.bars.length || this.runtimeDataLoadedIdentity !== identity) return undefined;\n    return {\n      schemaVersion: 1,\n      identity,`,
  'capture only committed data identity',
);

source = replaceRequired(
  source,
  `    this.liveTickSynced = raw.liveTickSynced === true;\n    this.runtimeDataRestored = true;`,
  `    this.liveTickSynced = raw.liveTickSynced === true;\n    this.runtimeDataLoadedIdentity = this.runtimeDataIdentity();\n    this.runtimeDataRestored = true;`,
  'restored data commits identity',
);

source = replaceRequired(
  source,
  `    if (!more) {\n      this.runtimeDataRestored = false;\n      this.clearRealtimeRegistration();`,
  `    if (!more) {\n      this.runtimeDataRestored = false;\n      this.runtimeDataLoadedIdentity = '';\n      this.clearRealtimeRegistration();`,
  'new acquisition invalidates old data identity',
);

source = replaceRequired(
  source,
  `      this.refreshSeries(!more);`,
  `      if (!more) this.runtimeDataLoadedIdentity = this.runtimeDataIdentity();\n      this.refreshSeries(!more);`,
  'successful base acquisition commits identity',
);

await fs.writeFile(file, source, 'utf8');
console.log('ChartForm now captures snapshots only for the last committed data identity.');
