import {
  getAllJobs, getJob, createJob, updateJob, deleteJob,
  getAllProfiles, getProfile, createProfile, updateProfile, deleteProfile,
  getSetting, setSetting, getAllSettings
} from './db.js';
import { resolve } from 'path';

const PORT = process.env.PORT || 6967;

// === VALIDATION ===
const FREQUENCIES = ['once', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'];

function validateProfile(body) {
  if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 100)
    return 'name must be 1-100 characters';
  return null;
}

function validateJob(body) {
  if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 200)
    return 'name must be 1-200 characters';
  if (!FREQUENCIES.includes(body.frequency))
    return `frequency must be one of: ${FREQUENCIES.join(', ')}`;
  if (!Number.isInteger(body.start_date))
    return 'start_date must be an integer';
  if (body.end_date != null && !Number.isInteger(body.end_date))
    return 'end_date must be an integer';
  if (body.time != null && !Number.isInteger(body.time))
    return 'time must be an integer';
  if (body.interval != null && !Number.isInteger(body.interval))
    return 'interval must be an integer';
  if (body.exceptions != null && !Array.isArray(body.exceptions))
    return 'exceptions must be an array';
  return null;
}

function validateSetting(body) {
  if (!('value' in body)) return 'value is required';
  return null;
}
const PUBLIC_DIR = resolve('./public');

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // === PROFILES API ===
    if (path.startsWith('/api/profiles')) {
      const id = path.split('/')[3];

      if (req.method === 'GET' && !id) {
        return Response.json(getAllProfiles());
      }

      if (req.method === 'GET' && id) {
        const profile = getProfile(id);
        if (!profile) return new Response('Not Found', { status: 404 });
        return Response.json(profile);
      }

      if (req.method === 'POST') {
        const body = await req.json();
        const err = validateProfile(body);
        if (err) return new Response(err, { status: 400 });
        const profile = createProfile(body);
        return Response.json(profile, { status: 201 });
      }

      if (req.method === 'PUT' && id) {
        const body = await req.json();
        const err = validateProfile(body);
        if (err) return new Response(err, { status: 400 });
        const profile = updateProfile(id, body.name);
        if (!profile) return new Response('Not Found', { status: 404 });
        return Response.json(profile);
      }

      if (req.method === 'DELETE' && id) {
        deleteProfile(id);
        return new Response(null, { status: 204 });
      }

      return new Response('Method Not Allowed', { status: 405 });
    }

    // === SETTINGS API ===
    if (path.startsWith('/api/settings')) {
      const key = path.split('/')[3];

      if (req.method === 'GET' && !key) {
        return Response.json(getAllSettings());
      }

      if (req.method === 'GET' && key) {
        const value = getSetting(key);
        return Response.json({ key, value });
      }

      if (req.method === 'PUT' && key) {
        const body = await req.json();
        const err = validateSetting(body);
        if (err) return new Response(err, { status: 400 });
        setSetting(key, body.value);
        return Response.json({ key, value: body.value });
      }

      return new Response('Method Not Allowed', { status: 405 });
    }

    // === JOBS API ===
    if (path.startsWith('/api/jobs')) {
      const id = path.split('/')[3];
      const profileId = url.searchParams.get('profile_id');

      if (req.method === 'GET' && !id) {
        if (!profileId) return new Response('profile_id required', { status: 400 });
        return Response.json(getAllJobs(profileId));
      }

      if (req.method === 'GET' && id) {
        const job = getJob(id);
        if (!job) return new Response('Not Found', { status: 404 });
        return Response.json(job);
      }

      if (req.method === 'POST') {
        const body = await req.json();
        if (!body.profile_id) return new Response('profile_id required', { status: 400 });
        const err = validateJob(body);
        if (err) return new Response(err, { status: 400 });
        const job = createJob(body);
        return Response.json(job, { status: 201 });
      }

      if (req.method === 'PUT' && id) {
        const body = await req.json();
        const err = validateJob(body);
        if (err) return new Response(err, { status: 400 });
        const job = updateJob(id, body);
        if (!job) return new Response('Not Found', { status: 404 });
        return Response.json(job);
      }

      if (req.method === 'DELETE' && id) {
        deleteJob(id);
        return new Response(null, { status: 204 });
      }

      return new Response('Method Not Allowed', { status: 405 });
    }

    let filePath = path === '/' ? '/index.html' : path;
    const resolved = resolve(PUBLIC_DIR, `.${filePath}`);
    if (!resolved.startsWith(PUBLIC_DIR)) {
      return new Response('Forbidden', { status: 403 });
    }
    const file = Bun.file(resolved);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response('Not Found', { status: 404 });
  }
});

console.log(`Server running on http://localhost:${PORT}`);
