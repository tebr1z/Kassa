import 'dotenv/config';
import postgres from 'postgres';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openLocalDatabase } from '../desktop/local-database.mjs';
import { sourceIdentity, readCatalog, catalogSummary, importCatalog } from './catalog-transfer.mjs';

const apply = process.argv.includes('--apply');
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = process.env.BIRKASSA_DATA_DIR || path.join(process.env.APPDATA, 'BirKassa', 'local-data');
let source, target, database;
try {
  const url = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Veb baza ünvanı təyin edilməyib.');
  const parsed = new URL(url);
  if (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error('Mənbə lokal bazadır; veb DATABASE_URL istifadə edin.');
  source = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
  const catalog = await readCatalog(source);
  await source.end(); source = null;
  console.log(JSON.stringify({ preview: catalogSummary(catalog) }));
  if (apply) {
    // Require an existing initialized desktop; never create a new destination by accident.
    await readFile(path.join(dataRoot, 'database.json'), 'utf8');
    database = await openLocalDatabase(dataRoot, projectRoot);
    const backup = path.join(dataRoot, 'backups', `before-web-products-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
    await database.backup(backup);
    target = postgres(database.url, { max: 1, prepare: false, connect_timeout: 5 });
    console.log(JSON.stringify({ backup, result: await importCatalog(target, catalog, sourceIdentity(url)) }));
  } else console.log('Yalnız önbaxışdır. Köçürmək üçün --apply əlavə edin.');
} catch (error) {
  // SQL driver errors can include connection/query details; log only their safe code.
  console.error(error.code ? `Köçürmə alınmadı (${error.code}); lokal tranzaksiya geri qaytarıldı.` : error.message);
  process.exitCode = 1;
} finally {
  await source?.end({ timeout: 2 });
  await target?.end({ timeout: 2 });
  await database?.close();
}
