// === INDEXEDDB STORAGE ===

import { validateJob } from './stencil.js';

const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const DB_NAME = 'TaskTrackerDB';
const DB_VERSION = 2;
const STORE_JOBS = 'jobs';
const STORE_PROFILES = 'profiles';
const STORE_SETTINGS = 'settings';
let db = null;
let _demoMode = false;

export function setDemoMode(value) { _demoMode = value; }

export async function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_JOBS)) {
        const jobStore = database.createObjectStore(STORE_JOBS, { keyPath: 'id' });
        jobStore.createIndex('profile_id', 'profile_id', { unique: false });
      } else if (e.oldVersion < 2) {
        const jobStore = e.target.transaction.objectStore(STORE_JOBS);
        if (!jobStore.indexNames.contains('profile_id'))
          jobStore.createIndex('profile_id', 'profile_id', { unique: false });
      }
      if (!database.objectStoreNames.contains(STORE_PROFILES))
        database.createObjectStore(STORE_PROFILES, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(STORE_SETTINGS))
        database.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
    };
  }).then(() => navigator.storage?.persist?.());
}

export async function getAllJobs() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_JOBS, 'readonly');
    const req = tx.objectStore(STORE_JOBS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getJob(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_JOBS, 'readonly');
    const req = tx.objectStore(STORE_JOBS).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveJob(job) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_JOBS, 'readwrite');
    const req = tx.objectStore(STORE_JOBS).put(job);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteJob(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_JOBS, 'readwrite');
    const req = tx.objectStore(STORE_JOBS).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllJobs() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_JOBS, 'readwrite');
    const req = tx.objectStore(STORE_JOBS).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getJobsByProfile(profileId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_JOBS, 'readonly');
    const idx = tx.objectStore(STORE_JOBS).index('profile_id');
    const req = idx.getAll(profileId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// === PROFILE STORAGE ===

export async function getAllProfiles() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROFILES, 'readonly');
    const req = tx.objectStore(STORE_PROFILES).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProfile(profile) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROFILES, 'readwrite');
    const req = tx.objectStore(STORE_PROFILES).put(profile);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteLocalProfile(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROFILES, 'readwrite');
    const req = tx.objectStore(STORE_PROFILES).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// === SETTINGS STORAGE ===

export async function getSetting(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const req = tx.objectStore(STORE_SETTINGS).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

export async function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, 'readwrite');
    const req = tx.objectStore(STORE_SETTINGS).put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// === DATA SYNC ===

export async function syncProfilesFromServer() {
  const res = await fetch('/api/profiles');
  const profiles = await res.json();
  const localProfiles = await getAllProfiles();
  const serverProfileIds = new Set(profiles.map(p => p.id));
  for (const local of localProfiles) {
    if (!serverProfileIds.has(local.id)) await deleteLocalProfile(local.id);
  }
  for (const p of profiles) await saveProfile(p);
  return profiles;
}

export async function syncSettingsFromServer() {
  const res = await fetch('/api/settings');
  const settings = await res.json();
  for (const [key, value] of Object.entries(settings)) {
    await setSetting(key, value);
  }
  return settings;
}

export async function syncJobsFromServer(profileId) {
  const res = await fetch(`/api/jobs?profile_id=${profileId}`);
  const jobs = await res.json();
  const localJobs = await getJobsByProfile(profileId);
  const serverJobIds = new Set(jobs.map(j => j.id));
  for (const local of localJobs) {
    if (!serverJobIds.has(local.id)) await deleteJob(local.id);
  }
  for (const job of jobs) await saveJob(job);
  return jobs;
}

export async function syncJob(job) {
  if (!job.profile_id) throw new Error('job.profile_id is required');
  try {
    await saveJob(job);
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      showError('Storage full. Please delete some jobs.');
      return false;
    }
    showError(`Failed to save locally: ${e.message}`);
    return false;
  }
  if (_demoMode) return true;
  try {
    const existing = await fetch(`/api/jobs/${job.id}`);
    if (existing.ok) {
      await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job)
      });
    } else {
      await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job)
      });
    }
  } catch {
    window.dispatchEvent(new Event('servererror'));
  }
  return true;
}

export async function syncDeleteJob(id) {
  try {
    await deleteJob(id);
  } catch (e) {
    showError(`Failed to delete locally: ${e.message}`);
    return false;
  }
  if (_demoMode) return true;
  try {
    await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
  } catch {
    window.dispatchEvent(new Event('servererror'));
  }
  return true;
}

export async function syncProfile(profile) {
  await saveProfile(profile);
  if (_demoMode) return;
  try {
    const existing = await fetch(`/api/profiles/${profile.id}`);
    if (existing.ok) {
      await fetch(`/api/profiles/${profile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
    } else {
      await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
    }
  } catch {
    window.dispatchEvent(new Event('servererror'));
  }
}

export async function syncDeleteProfile(id) {
  await deleteLocalProfile(id);
  if (_demoMode) return;
  try {
    await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
  } catch {
    window.dispatchEvent(new Event('servererror'));
  }
}

export async function syncSetting(key, value) {
  await setSetting(key, value);
  if (_demoMode || !navigator.onLine) return;
  try {
    await fetch(`/api/settings/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
  } catch {
    // Server unavailable, setting saved locally
  }
}

// === UI: TOAST NOTIFICATIONS ===

export function ensureToastContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info', duration = 4000) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

export function showError(message) {
  showToast(message, 'error', 5000);
}

export function showSuccess(message) {
  showToast(message, 'success', 3000);
}

// === IMPORT/EXPORT ===

const SETTING_KEYS = ['theme', 'lastProfileId', 'privacyMode', 'viewMode', 'firstDayOfWeek', 'showWeekends'];

export async function clearAllProfiles() {
  const profiles = await getAllProfiles();
  for (const p of profiles) await deleteLocalProfile(p.id);
}

export async function clearAllSettings() {
  for (const key of SETTING_KEYS) await setSetting(key, null);
}

export async function gatherExportData() {
  const profiles = await getAllProfiles();
  const jobs = await getAllJobs();
  const settings = {};
  for (const key of SETTING_KEYS) {
    const val = await getSetting(key);
    if (val != null) settings[key] = val;
  }
  return { exported_at: new Date().toISOString(), profiles, settings, jobs };
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function parseImportFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!Array.isArray(data.profiles)) throw new Error('profiles must be an array');
  if (!Array.isArray(data.jobs)) throw new Error('jobs must be an array');

  // Validate profile IDs
  for (const p of data.profiles) {
    if (!p.id || !UUID_REGEX.test(p.id)) {
      throw new Error(`Invalid profile ID format: ${p.id?.substring(0, 20) || 'missing'}`);
    }
  }

  // Validate job IDs and profile references
  const profileIds = new Set(data.profiles.map(p => p.id));
  for (const j of data.jobs) {
    if (!j.id || !UUID_REGEX.test(j.id)) {
      throw new Error(`Invalid job ID format: ${j.id?.substring(0, 20) || 'missing'}`);
    }
    if (!j.profile_id || !profileIds.has(j.profile_id)) {
      throw new Error(`Job "${j.name || j.id}" references invalid profile`);
    }
  }

  data.settings = data.settings || {};
  return data;
}

function validateJobTypes(job) {
  const errors = [];

  // Required string fields
  if (typeof job.id !== 'string') errors.push('id must be a string');
  if (typeof job.profile_id !== 'string') errors.push('profile_id must be a string');
  if (typeof job.name !== 'string') errors.push('name must be a string');
  if (typeof job.frequency !== 'string') errors.push('frequency must be a string');

  // Validate frequency enum
  const validFrequencies = ['once', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'];
  if (!validFrequencies.includes(job.frequency)) {
    errors.push(`frequency must be one of: ${validFrequencies.join(', ')}`);
  }

  // Required integer fields
  if (!Number.isInteger(job.start_date)) errors.push('start_date must be an integer');

  // Optional integer fields (null allowed)
  if (job.interval != null && !Number.isInteger(job.interval)) errors.push('interval must be an integer');
  if (job.time != null && !Number.isInteger(job.time)) errors.push('time must be an integer');
  if (job.end_date != null && !Number.isInteger(job.end_date)) errors.push('end_date must be an integer');
  if (job.fixed_date != null && !Number.isInteger(job.fixed_date)) errors.push('fixed_date must be an integer');
  if (job.rule_day != null && !Number.isInteger(job.rule_day)) errors.push('rule_day must be an integer');
  if (job.rule_nth != null && !Number.isInteger(job.rule_nth)) errors.push('rule_nth must be an integer');
  if (job.rule_month != null && !Number.isInteger(job.rule_month)) errors.push('rule_month must be an integer');

  // Exceptions must be array of integers
  if (!Array.isArray(job.exceptions)) {
    errors.push('exceptions must be an array');
  } else if (!job.exceptions.every(e => Number.isInteger(e))) {
    errors.push('exceptions must contain only integers');
  }

  return errors;
}

export async function importToLocal(data) {
  await clearAllJobs();
  await clearAllProfiles();
  await clearAllSettings();

  for (const p of data.profiles) await saveProfile(p);

  for (const j of data.jobs) {
    // Type validation first
    const typeErrors = validateJobTypes(j);
    if (typeErrors.length > 0) {
      throw new Error(`Invalid job "${j.name || j.id}": ${typeErrors.join('; ')}`);
    }

    // Logical validation second
    const validation = validateJob(j);
    if (!validation.valid) {
      throw new Error(`Invalid job "${j.name}": ${validation.errors.join('; ')}`);
    }

    await saveJob(j);
  }

  for (const [key, value] of Object.entries(data.settings)) {
    if (value != null) await setSetting(key, value);
  }
}

export async function setPendingImport(data) {
  await setSetting('_pendingImport', data ? JSON.stringify(data) : null);
}

export async function getPendingImport() {
  const val = await getSetting('_pendingImport');
  return val ? JSON.parse(val) : null;
}
