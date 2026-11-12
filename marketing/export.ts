import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('.state/waitlist.sqlite', import.meta.url));
const database = new DatabaseSync(path, { readOnly: true });
try {
  const rows = database.prepare('SELECT email, created_at, consent_version FROM waitlist ORDER BY created_at').all();
  process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
} finally {
  database.close();
}
