
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Fly.io volume path is /data, fallback to root for local dev
// Fix: Use path.resolve('app.db') to avoid TypeScript error where 'cwd' is missing on 'process' type in some environments.
const DB_PATH = process.env.NODE_ENV === 'production' ? '/data/app.db' : path.resolve('app.db');

// Ensure directory exists for local dev
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

export const getSetting = (key: string): string | null => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
};

export const setSetting = (key: string, value: string) => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
};

export default db;
