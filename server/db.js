import { Database } from 'bun:sqlite';

const db = new Database('./data/tracker.db');

db.run(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    frequency TEXT NOT NULL,
    interval INTEGER DEFAULT 1,
    time INTEGER,
    start_date INTEGER NOT NULL,
    end_date INTEGER,
    fixed_date INTEGER,
    rule_day INTEGER,
    rule_nth INTEGER,
    rule_month INTEGER,
    exceptions TEXT DEFAULT '[]',
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
  )
`);

// Migration: add profile_id column if missing (for existing databases)
try {
  db.run('ALTER TABLE jobs ADD COLUMN profile_id TEXT');
} catch { /* column already exists */ }

// Ensure default profile exists
const defaultProfile = db.query('SELECT id FROM profiles LIMIT 1').get();
if (!defaultProfile) {
  const defaultId = crypto.randomUUID();
  db.run('INSERT INTO profiles (id, name) VALUES (?, ?)', [defaultId, 'Default']);
  db.run('UPDATE settings SET value = ? WHERE key = ?', [defaultId, 'lastProfileId']);
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['lastProfileId', defaultId]);
  // Migrate orphan jobs to default profile
  db.run('UPDATE jobs SET profile_id = ? WHERE profile_id IS NULL', [defaultId]);
}

// === PROFILE FUNCTIONS ===

export function getAllProfiles() {
  return db.query('SELECT * FROM profiles').all();
}

export function getProfile(id) {
  return db.query('SELECT * FROM profiles WHERE id = ?').get(id);
}

export function createProfile(profile) {
  db.run('INSERT INTO profiles (id, name) VALUES (?, ?)', [profile.id, profile.name]);
  return profile;
}

export function updateProfile(id, name) {
  db.run('UPDATE profiles SET name = ? WHERE id = ?', [name, id]);
  return getProfile(id);
}

export function deleteProfile(id) {
  db.run('DELETE FROM jobs WHERE profile_id = ?', [id]);
  db.run('DELETE FROM profiles WHERE id = ?', [id]);
}

// === SETTINGS FUNCTIONS ===

export function getSetting(key) {
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

export function getAllSettings() {
  const rows = db.query('SELECT * FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// === JOB FUNCTIONS ===

export function getAllJobs(profileId) {
  const rows = db.query('SELECT * FROM jobs WHERE profile_id = ?').all(profileId);
  return rows.map(row => ({ ...row, exceptions: JSON.parse(row.exceptions) }));
}

export function getJob(id) {
  const row = db.query('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, exceptions: JSON.parse(row.exceptions) };
}

export function createJob(job) {
  const stmt = db.prepare(`
    INSERT INTO jobs (id, profile_id, name, frequency, interval, time, start_date, end_date, fixed_date, rule_day, rule_nth, rule_month, exceptions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    job.id,
    job.profile_id,
    job.name,
    job.frequency,
    job.interval,
    job.time,
    job.start_date,
    job.end_date,
    job.fixed_date,
    job.rule_day,
    job.rule_nth,
    job.rule_month,
    JSON.stringify(job.exceptions || [])
  );
  return job;
}

export function updateJob(id, job) {
  const stmt = db.prepare(`
    UPDATE jobs SET name = ?, frequency = ?, interval = ?, time = ?, start_date = ?, end_date = ?, fixed_date = ?, rule_day = ?, rule_nth = ?, rule_month = ?, exceptions = ?
    WHERE id = ?
  `);
  stmt.run(
    job.name,
    job.frequency,
    job.interval,
    job.time,
    job.start_date,
    job.end_date,
    job.fixed_date,
    job.rule_day,
    job.rule_nth,
    job.rule_month,
    JSON.stringify(job.exceptions || []),
    id
  );
  return getJob(id);
}

export function deleteJob(id) {
  db.run('DELETE FROM jobs WHERE id = ?', [id]);
}
