// === IMPORTS ===
import { generateUUID, parseYMD, buildYMD, todayInt, addDays, getWeekStart, el } from './utils.js';
import { createBuffer, stencilAll, setProfileIdGetter } from './stencil.js';
import { initDB, syncProfilesFromServer, syncSettingsFromServer, syncJobsFromServer, getAllProfiles, getSetting, getJobsByProfile, syncJob, syncDeleteJob, syncProfile, syncDeleteProfile, syncSetting, setDemoMode, showToast, showSuccess, showError, gatherExportData, downloadJson, parseImportFile, importToLocal, setPendingImport, getPendingImport, getAllJobs } from './storage.js';
import { showPrivacyToast, hidePrivacyToast, showOfflineToast, hideOfflineToast, showDemoToast, showPortToast, obfuscateName } from './privacy.js';
import { renderCalendarHeader, renderCalendarGrid, renderSidebarContent, renderSidebarHeader, showModal, hideModal, showJobEditorModal, showDeleteModal, showJobDetailModal, showProfileEditorModal, showProfileDeleteModal, showSettingsModal, showImportExportModal, showOfflineExportWarning, showHelpModal, setUICallbacks } from './ui.js';

// === APPLICATION STATE ===

export const state = {
  jobs: [],
  buffer: createBuffer(),
  epoch: null,
  bufferCenterMonth: null, // {year, month} - tracks which month the buffer is centered on
  viewYear: null,
  viewMonth: null,
  viewMode: 'week',
  weekStart: null,
  selectedDay: null,
  searchQuery: '',
  frequencyFilters: new Set(['once', 'daily', 'weekly', 'monthly', 'yearly', 'hourly']),
  profiles: [],
  currentProfileId: null,
  theme: 'nord',
  privacyMode: false,
  firstDayOfWeek: 1,
  showWeekends: true,
  demoMode: false
};

// Setup callbacks for other modules to access state
setProfileIdGetter(() => state.currentProfileId);
setUICallbacks(() => state, recomputeBuffer, renderAll);

function calculateEpoch(year, month) {
  let epochMonth = month - 1;
  let epochYear = year;
  if (epochMonth < 0) { epochMonth = 11; epochYear--; }
  return buildYMD(epochYear, epochMonth, 1);
}

function initState() {
  const today = todayInt();
  const { year, month } = parseYMD(today);
  state.viewYear = year;
  state.viewMonth = month;
  state.bufferCenterMonth = { year, month };
  state.epoch = calculateEpoch(year, month);
}

function recomputeBuffer() {
  stencilAll(state.jobs, state.buffer, state.epoch);
}

function updateBufferIfNeeded() {
  const { viewYear, viewMonth, bufferCenterMonth } = state;
  if (bufferCenterMonth.year === viewYear && bufferCenterMonth.month === viewMonth) return;
  state.bufferCenterMonth = { year: viewYear, month: viewMonth };
  state.epoch = calculateEpoch(viewYear, viewMonth);
  recomputeBuffer();
}

function renderAll() {
  renderCalendarHeader(state.viewYear, state.viewMonth, state.viewMode);
  renderCalendarGrid(state.viewYear, state.viewMonth, state.buffer, state.epoch, getFilteredJobs(), state.viewMode, state.weekStart);
  renderSidebarContent(getFilteredJobs());
}

function applySettings(settings) {
  state.theme = settings.theme || 'nord';
  state.privacyMode = settings.privacyMode === true || settings.privacyMode === '1';
  state.viewMode = settings.viewMode || 'week';
  state.firstDayOfWeek = settings.firstDayOfWeek != null ? parseInt(settings.firstDayOfWeek) : 1;
  state.showWeekends = settings.showWeekends !== false && settings.showWeekends !== 'false';
}

function applyThemeToDOM(theme) {
  const wasOffline = document.body.classList.contains('offline');
  document.body.className = `theme-${theme}`;
  if (wasOffline) document.body.classList.add('offline');
}

function getFilteredJobs() {
  return state.jobs.filter(job => {
    if (!state.frequencyFilters.has(job.frequency)) return false;
    if (state.searchQuery.length >= 2 && !job.name.toLowerCase().includes(state.searchQuery)) return false;
    return true;
  });
}

// === DELETE OPERATIONS ===

async function deleteInstance(jobId, yyyymmdd) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  job.exceptions.push(yyyymmdd);
  await syncJob(job);
  recomputeBuffer();
  renderAll();
  hideModal();
}

async function deleteFuture(jobId, yyyymmdd) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  job.end_date = addDays(yyyymmdd, -1);
  await syncJob(job);
  recomputeBuffer();
  renderAll();
  hideModal();
}

async function deleteAll(jobId) {
  await syncDeleteJob(jobId);
  state.jobs = state.jobs.filter(j => j.id !== jobId);
  recomputeBuffer();
  renderAll();
  hideModal();
}

// === PROFILE OPERATIONS ===

async function saveProfile(profile, isNew) {
  await syncProfile(profile);
  if (isNew) {
    state.profiles.push(profile);
    state.currentProfileId = profile.id;
    await syncSetting('lastProfileId', profile.id);
    state.jobs = [];
    recomputeBuffer();
    renderAll();
  } else {
    const existing = state.profiles.find(p => p.id === profile.id);
    if (existing) existing.name = profile.name;
  }
  renderProfileDropdown();
  hideModal();
}

async function confirmDeleteProfile(profileId) {
  if (state.profiles.length <= 1) {
    showToast('Cannot delete the last profile', 'error');
    hideModal();
    return;
  }
  await syncDeleteProfile(profileId);
  state.profiles = state.profiles.filter(p => p.id !== profileId);
  if (state.currentProfileId === profileId) {
    state.currentProfileId = state.profiles[0].id;
    await syncSetting('lastProfileId', state.currentProfileId);
    await loadJobsForProfile(state.currentProfileId);
  }
  renderProfileDropdown();
  hideModal();
}

// === INITIALIZATION ===

async function activateDemoMode(response) {
  const contentType = response.headers.get('Content-Type') || '';
  const status = response.status;

  // Exclude: WAF challenges, server errors (a real backend that is merely erroring)
  if (status === 403 || status >= 500) return false;

  // Static host: a real backend always serves /api/profiles as 200 JSON, so any
  // 404 (whatever its body/headers) means there is no backend. An HTML 200 covers
  // SPA-fallback hosts that rewrite unknown paths to index.html.
  const isStaticHost = status === 404 || (status === 200 && contentType.includes('html'));

  if (isStaticHost) {
    state.demoMode = true;
    setDemoMode(true);
    await syncSetting('demoMode', true);
    return true;
  }
  return false;
}

async function loadProfilesAndSettings() {
  let offline = false;

  // Always probe server (handles demo mode detection and exit)
  try {
    const res = await fetch('/api/profiles');
    if (!await activateDemoMode(res)) {
      // Server available - clear any persisted demo mode
      state.demoMode = false;
      setDemoMode(false);
      if (await getSetting('demoMode')) {
        await syncSetting('demoMode', false);
      }
      // Sync from server
      state.profiles = await syncProfilesFromServer();
      const settings = await syncSettingsFromServer();
      state.currentProfileId = settings.lastProfileId || (state.profiles[0] && state.profiles[0].id);
      applySettings(settings);
    }
  } catch {
    // Network error - use persisted demo mode as fallback
    const persistedDemoMode = await getSetting('demoMode');
    if (persistedDemoMode === true || persistedDemoMode === '1') {
      state.demoMode = true;
      setDemoMode(true);
    } else {
      offline = true;
    }
  }

  // Demo mode or offline: load from local
  if (state.demoMode || offline) {
    state.profiles = await getAllProfiles();
    state.currentProfileId = await getSetting('lastProfileId');
    applySettings({
      theme: await getSetting('theme'),
      privacyMode: await getSetting('privacyMode'),
      viewMode: await getSetting('viewMode'),
      firstDayOfWeek: await getSetting('firstDayOfWeek'),
      showWeekends: await getSetting('showWeekends')
    });
    if (state.profiles.length === 0) {
      const defaultProfile = { id: generateUUID(), name: 'Default' };
      await syncProfile(defaultProfile);
      state.profiles = [defaultProfile];
      state.currentProfileId = defaultProfile.id;
    } else if (!state.currentProfileId) {
      state.currentProfileId = state.profiles[0].id;
    }
  }

  if (state.theme) applyThemeToDOM(state.theme);
  if (state.privacyMode) {
    updatePrivacyButton();
    showPrivacyToast();
  }
  if (state.viewMode === 'week') {
    state.weekStart = getWeekStart(todayInt(), state.firstDayOfWeek);
  }
  return offline;
}

async function loadJobsForProfile(profileId, triggerOfflineOnFail = true) {
  if (state.demoMode) {
    state.jobs = await getJobsByProfile(profileId);
  } else {
    try {
      state.jobs = await syncJobsFromServer(profileId);
    } catch {
      state.jobs = await getJobsByProfile(profileId);
      if (triggerOfflineOnFail) enterOfflineMode();
    }
  }
  recomputeBuffer();
  renderAll();
}

async function init() {
  await initDB();
  initState();
  const offline = await loadProfilesAndSettings();
  if (offline) enterOfflineMode();
  if (state.demoMode) {
    document.body.classList.remove('offline');
    showDemoToast();
  }
  renderSidebarHeader();
  if (state.currentProfileId) {
    await loadJobsForProfile(state.currentProfileId);
  } else {
    renderAll();
  }
  attachEventListeners();
}

function attachEventListeners() {
  // Profile dropdown
  const dropdown = document.getElementById('profile-dropdown');
  const dropdownBtn = document.getElementById('profile-dropdown-btn');
  const dropdownMenu = document.getElementById('profile-dropdown-menu');
  const profileAddBtn = document.getElementById('profile-add');

  const toggleDropdown = (open) => {
    dropdown.classList.toggle('open', open);
    profileAddBtn.classList.toggle('visible', open);
  };

  dropdownBtn.addEventListener('click', () => toggleDropdown(!dropdown.classList.contains('open')));
  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target) && e.target !== profileAddBtn) toggleDropdown(false);
  });
  dropdownMenu.addEventListener('click', async e => {
    // Handle edit button
    const editBtn = e.target.closest('.profile-edit-btn');
    if (editBtn) {
      const profile = state.profiles.find(p => p.id === editBtn.dataset.id);
      if (profile && await serverCheck()) showProfileEditorModal(profile);
      return;
    }
    // Handle delete button
    const deleteBtn = e.target.closest('.profile-delete-btn');
    if (deleteBtn) {
      const profile = state.profiles.find(p => p.id === deleteBtn.dataset.id);
      if (profile && await serverCheck()) showProfileDeleteModal(profile);
      return;
    }
    // Handle profile selection
    const opt = e.target.closest('.profile-option');
    if (!opt) return;
    const profileId = opt.dataset.id;
    if (profileId === state.currentProfileId) {
      toggleDropdown(false);
      return;
    }
    state.currentProfileId = profileId;
    await syncSetting('lastProfileId', profileId);
    renderProfileDropdown();
    toggleDropdown(false);
    await loadJobsForProfile(profileId);
  });

  // Profile add button
  document.getElementById('profile-add').addEventListener('click', async () => {
    if (await serverCheck()) showProfileEditorModal(null);
  });

  renderProfileDropdown();

  // Privacy mode
  document.getElementById('privacy-btn').addEventListener('click', togglePrivacyMode);

  // Settings
  document.getElementById('settings-btn').addEventListener('click', () => showSettingsModal());

  // Import/Export
  document.getElementById('import-export-btn').addEventListener('click', () => showImportExportModal());

  // Help
  document.getElementById('help-btn').addEventListener('click', () => showHelpModal());

  document.getElementById('new-job-btn').addEventListener('click', async () => {
    if (await serverCheck()) showJobEditorModal(null);
  });
  document.getElementById('search-input').addEventListener('input', e => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderAll();
  });
  document.getElementById('calendar-header').addEventListener('click', e => {
    if (e.target.id === 'prev-month') goToPrevious();
    if (e.target.id === 'next-month') goToNext();
    if (e.target.id === 'today-btn') goToToday();
    const viewBtn = e.target.closest('[data-view]');
    if (viewBtn) handleViewToggle(viewBtn.dataset.view);

    // Calendar nav dropdown handling
    const dropdownBtn = e.target.closest('.calendar-nav .dropdown-btn');
    if (dropdownBtn) {
      const dropdown = dropdownBtn.parentElement;
      const wasOpen = dropdown.classList.contains('open');
      document.querySelectorAll('.calendar-nav .dropdown.open').forEach(d => d.classList.remove('open'));
      if (!wasOpen) {
        dropdown.classList.add('open');
        if (dropdown.id === 'year-dropdown') dropdown.querySelector('.year-input').focus();
      }
      return;
    }

    const dropdownOption = e.target.closest('.calendar-nav .dropdown-option');
    if (dropdownOption) {
      const dropdown = dropdownOption.closest('.dropdown');
      const value = parseInt(dropdownOption.dataset.value);
      if (dropdown.id === 'month-dropdown') {
        state.viewMonth = value;
      } else if (dropdown.id === 'year-dropdown') {
        state.viewYear = value;
      }
      if (state.viewMode === 'week') {
        state.weekStart = getWeekStart(buildYMD(state.viewYear, state.viewMonth, 1), state.firstDayOfWeek);
      }
      dropdown.classList.remove('open');
      updateBufferIfNeeded();
      renderAll();
      return;
    }
  });

  // Custom year input
  document.getElementById('calendar-header').addEventListener('keydown', e => {
    if (e.target.classList.contains('year-input') && e.key === 'Enter') {
      const value = parseInt(e.target.value);
      if (value >= 1900 && value <= 2500) {
        state.viewYear = value;
        if (state.viewMode === 'week') {
          state.weekStart = getWeekStart(buildYMD(state.viewYear, state.viewMonth, 1), state.firstDayOfWeek);
        }
        document.querySelector('.calendar-nav .dropdown.open')?.classList.remove('open');
        updateBufferIfNeeded();
        renderAll();
      }
    }
  });

  // Close calendar dropdowns when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.calendar-nav .dropdown')) {
      document.querySelectorAll('.calendar-nav .dropdown.open').forEach(d => d.classList.remove('open'));
    }
  });
  document.getElementById('sidebar-content').addEventListener('click', handleSidebarClick);
  document.getElementById('calendar-grid').addEventListener('click', handleCalendarClick);

  // Hover interlinkage
  document.getElementById('calendar-grid').addEventListener('mouseover', handleCalendarHover);
  document.getElementById('calendar-grid').addEventListener('mouseout', handleCalendarHoverOut);
  document.getElementById('sidebar-content').addEventListener('mouseover', handleSidebarHover);
  document.getElementById('sidebar-content').addEventListener('mouseout', handleSidebarHoverOut);
}

function renderProfileDropdown() {
  const menu = document.getElementById('profile-dropdown-menu');
  const btn = document.getElementById('profile-dropdown-btn');
  const profiles = state.profiles.length ? state.profiles : [{ id: 'default', name: 'Default' }];
  const getName = (p, i) => state.privacyMode ? `Profile ${i + 1}` : p.name;

  menu.replaceChildren();
  profiles.forEach((p, i) => {
    menu.append(
      el('div', { class: 'dropdown-option profile-option' + (p.id === state.currentProfileId ? ' selected' : ''), dataId: p.id },
        el('span', { class: 'profile-name' }, getName(p, i)),
        el('span', { class: 'profile-actions' },
          el('button', { class: 'profile-edit-btn', dataId: p.id }, '\u270E'),
          el('button', { class: 'profile-delete-btn', dataId: p.id }, '\u00D7')
        )
      )
    );
  });

  const currentIndex = profiles.findIndex(p => p.id === state.currentProfileId);
  const current = currentIndex >= 0 ? profiles[currentIndex] : profiles[0];
  btn.textContent = 'Profile: ' + getName(current, currentIndex >= 0 ? currentIndex : 0);
}

function handleCalendarHover(e) {
  const dayJob = e.target.closest('.day-job');
  if (!dayJob) return;
  const jobId = dayJob.dataset.id;
  const sidebarItem = document.querySelector(`.job-item[data-id="${jobId}"]`);
  if (sidebarItem) sidebarItem.classList.add('job-highlight');
}

function handleCalendarHoverOut(e) {
  const dayJob = e.target.closest('.day-job');
  if (!dayJob) return;
  const jobId = dayJob.dataset.id;
  const sidebarItem = document.querySelector(`.job-item[data-id="${jobId}"]`);
  if (sidebarItem) sidebarItem.classList.remove('job-highlight');
}

function handleSidebarHover(e) {
  const jobItem = e.target.closest('.job-item');
  if (!jobItem) return;
  const jobId = jobItem.dataset.id;
  document.querySelectorAll(`.day-job[data-id="${jobId}"]`).forEach(el => el.classList.add('job-highlight'));
}

function handleSidebarHoverOut(e) {
  const jobItem = e.target.closest('.job-item');
  if (!jobItem) return;
  const jobId = jobItem.dataset.id;
  document.querySelectorAll(`.day-job[data-id="${jobId}"]`).forEach(el => el.classList.remove('job-highlight'));
}

function goToToday() {
  const today = todayInt();
  const { year, month } = parseYMD(today);
  state.viewYear = year;
  state.viewMonth = month;
  if (state.viewMode === 'week') {
    state.weekStart = getWeekStart(today, state.firstDayOfWeek);
  }
  updateBufferIfNeeded();
  renderAll();
}

async function handleViewToggle(view) {
  if (view === state.viewMode) return;
  state.viewMode = view;
  await syncSetting('viewMode', view);
  if (view === 'week') {
    // Calculate weekStart: use today's week if viewing today's month, otherwise first of displayed month
    const today = todayInt();
    const { year: todayYear, month: todayMonth } = parseYMD(today);
    if (state.viewYear === todayYear && state.viewMonth === todayMonth) {
      state.weekStart = getWeekStart(today, state.firstDayOfWeek);
    } else {
      state.weekStart = getWeekStart(buildYMD(state.viewYear, state.viewMonth, 1), state.firstDayOfWeek);
    }
  }
  renderAll();
}

function goToPrevious() {
  if (state.viewMode === 'week') {
    state.weekStart = addDays(state.weekStart, -7);
    const { year, month } = parseYMD(state.weekStart);
    state.viewYear = year;
    state.viewMonth = month;
  } else {
    state.viewMonth--;
    if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
  }
  updateBufferIfNeeded();
  renderAll();
}

function goToNext() {
  if (state.viewMode === 'week') {
    state.weekStart = addDays(state.weekStart, 7);
    const { year, month } = parseYMD(state.weekStart);
    state.viewYear = year;
    state.viewMonth = month;
  } else {
    state.viewMonth++;
    if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
  }
  updateBufferIfNeeded();
  renderAll();
}

async function handleSidebarClick(e) {
  const editBtn = e.target.closest('.edit-btn');
  const deleteBtn = e.target.closest('.delete-btn');
  const jobItem = e.target.closest('.job-item');

  if (editBtn) {
    const job = state.jobs.find(j => j.id === editBtn.dataset.id);
    if (job && await serverCheck()) showJobEditorModal(job);
  } else if (deleteBtn) {
    const job = state.jobs.find(j => j.id === deleteBtn.dataset.id);
    if (job && await serverCheck()) showDeleteModal(job);
  } else if (jobItem) {
    const job = state.jobs.find(j => j.id === jobItem.dataset.id);
    if (job) showJobDetailModal(job);
  }
}

function handleCalendarClick(e) {
  const dayJob = e.target.closest('.day-job');
  const dayCell = e.target.closest('.day-cell');

  if (dayJob) {
    const job = state.jobs.find(j => j.id === dayJob.dataset.id);
    if (job) showJobDetailModal(job);
  } else if (dayCell) {
    state.selectedDay = parseInt(dayCell.dataset.date);
  }
}

// === PRIVACY MODE ===

async function togglePrivacyMode() {
  state.privacyMode = !state.privacyMode;
  await syncSetting('privacyMode', state.privacyMode);
  updatePrivacyButton();
  renderProfileDropdown();
  if (state.privacyMode) {
    showPrivacyToast();
  } else {
    hidePrivacyToast();
  }
  renderAll();
}

function updatePrivacyButton() {
  document.getElementById('privacy-btn').classList.toggle('active', state.privacyMode);
}

// === SETTINGS ===

async function setTheme(theme) {
  state.theme = theme;
  applyThemeToDOM(theme);
  await syncSetting('theme', theme);
}

async function setFirstDayOfWeek(fdow) {
  state.firstDayOfWeek = fdow;
  await syncSetting('firstDayOfWeek', fdow);
  if (state.viewMode === 'week') {
    state.weekStart = getWeekStart(state.weekStart, fdow);
  }
  renderAll();
}

async function setShowWeekends(show) {
  state.showWeekends = show;
  await syncSetting('showWeekends', show);
  renderAll();
}

// === IMPORT/EXPORT ===

let pendingImportData = null;

async function handleExport() {
  hideModal();

  if (state.demoMode) {
    const data = await gatherExportData();
    downloadJson(data, `task-tracker-${new Date().toISOString().slice(0, 10)}.json`);
    showPortToast('Data exported');
    return;
  }

  if (document.body.classList.contains('offline')) {
    showOfflineExportWarning();
    return;
  }

  // Server online: sync ALL profiles' jobs first
  try {
    await syncProfilesFromServer();
    const profiles = await getAllProfiles();
    for (const p of profiles) await syncJobsFromServer(p.id);
    await syncSettingsFromServer();
    const data = await gatherExportData();
    downloadJson(data, `task-tracker-${new Date().toISOString().slice(0, 10)}.json`);
    showPortToast('Data exported');
  } catch {
    showOfflineExportWarning();
  }
}

async function doExport() {
  hideModal();
  const data = await gatherExportData();
  downloadJson(data, `task-tracker-${new Date().toISOString().slice(0, 10)}.json`);
  showPortToast('Data exported');
}

function showImportConfirm() {
  const importBtn = el('button', { type: 'button', class: 'btn-danger', dataAction: 'do-import' }, 'Import');
  importBtn.disabled = true;

  const checkbox = el('input', { type: 'checkbox' });
  checkbox.addEventListener('change', () => { importBtn.disabled = !checkbox.checked; });

  showModal(
    el('div', null,
      el('h2', null, 'Import Data'),
      el('p', { class: 'divider' }, 'This will replace ALL existing data including profiles, jobs, and settings.'),
      el('div', { class: 'form-row form-row-checkbox' },
        el('label', null, checkbox, ' I understand all existing data will be replaced')
      ),
      el('div', { class: 'modal-actions divider' },
        el('button', { type: 'button', class: 'btn-secondary', dataAction: 'close' }, 'Cancel'),
        importBtn
      )
    )
  );
}

function triggerImport() {
  hideModal();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    if (!input.files[0]) return;

    // Validate and cache parsed data BEFORE showing confirmation
    try {
      pendingImportData = await parseImportFile(input.files[0]);
    } catch (e) {
      showError('Invalid file: ' + e.message);
      pendingImportData = null;
      return;
    }

    showImportConfirm();
  };
  input.click();
}

async function loadSampleData() {
  try {
    const res = await fetch('/sample.json');
    if (!res.ok) throw new Error('not available');
    pendingImportData = await parseImportFile(res);
  } catch (e) {
    showError(`Could not load sample data: ${e.message}`);
    pendingImportData = null;
    return;
  }
  showImportConfirm();
}

async function doImport() {
  if (!pendingImportData) return;
  const data = pendingImportData;
  pendingImportData = null;

  // Server check (if not demo mode)
  let serverOk = false;
  if (!state.demoMode) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch('/api/profiles', { signal: ctrl.signal });
      serverOk = res.ok;
    } catch {}
  }

  // Local import
  try {
    await importToLocal(data);
  } catch (e) {
    showError('Import failed: ' + e.message);
    return;
  }

  // Update state
  state.profiles = data.profiles;
  state.currentProfileId = data.settings.lastProfileId;
  if (!state.profiles.find(p => p.id === state.currentProfileId)) {
    state.currentProfileId = state.profiles[0]?.id || null;
  }
  applySettings(data.settings);
  state.jobs = data.jobs.filter(j => j.profile_id === state.currentProfileId);

  // Apply theme
  applyThemeToDOM(state.theme);

  // Privacy state
  updatePrivacyButton();
  state.privacyMode ? showPrivacyToast() : hidePrivacyToast();

  // Refresh UI (realign weekStart to the imported firstDayOfWeek, staying on the current view)
  if (state.viewMode === 'week') {
    state.weekStart = getWeekStart(state.weekStart, state.firstDayOfWeek);
  }
  recomputeBuffer();
  renderAll();
  renderProfileDropdown();
  hideModal();

  // Server sync
  if (state.demoMode) {
    showPortToast('Import complete');
    return;
  }

  if (!serverOk) {
    await setPendingImport(data);
    showPortToast('Import complete. Will sync when server reconnects.');
    return;
  }

  // Push with retry
  for (let i = 0; i < 2; i++) {
    try {
      await pushImportToServer(data);
      showPortToast('Import complete');
      return;
    } catch {}
  }
  await setPendingImport(data);
  showPortToast('Import complete. Will sync when server reconnects.');
}

async function pushImportToServer(data) {
  const existing = await fetch('/api/profiles').then(r => r.json());
  for (const p of existing) await fetch(`/api/profiles/${p.id}`, { method: 'DELETE' });
  for (const p of data.profiles) {
    await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p)
    });
  }
  for (const j of data.jobs) {
    await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(j)
    });
  }
  for (const [k, v] of Object.entries(data.settings)) {
    if (v != null) {
      await fetch(`/api/settings/${k}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: v })
      });
    }
  }
}

// === PERFORMANCE BENCHMARKS ===

function benchmarkStencil(jobCount = 2000) {
  const frequencies = ['once', 'daily', 'weekly', 'monthly', 'yearly'];
  const testJobs = [];
  const today = todayInt();
  const { year, month } = parseYMD(today);
  for (let i = 0; i < jobCount; i++) {
    const freq = frequencies[i % frequencies.length];
    testJobs.push({
      id: `bench-${i}`,
      name: `Benchmark Job ${i}`,
      frequency: freq,
      interval: 1 + (i % 7),
      time: (i * 30) % 1440,
      start_date: addDays(today, -180 + (i % 360)),
      end_date: null,
      fixed_date: freq === 'monthly' ? 1 + (i % 28) : null,
      rule_day: freq === 'weekly' ? i % 7 : null,
      rule_nth: null,
      rule_month: freq === 'yearly' ? i % 12 : null,
      exceptions: []
    });
  }
  const buffer = createBuffer();
  const epoch = calculateEpoch(year, month);
  const start = performance.now();
  stencilAll(testJobs, buffer, epoch);
  const elapsed = performance.now() - start;
  const passed = elapsed < 50;
  console.log(`Stencil benchmark: ${jobCount} jobs in ${elapsed.toFixed(2)}ms ${passed ? 'PASS' : 'FAIL'} (target <50ms)`);
  return { elapsed, passed, jobCount };
}

function checkMemory(iterations = 10) {
  if (!performance.memory) {
    console.log('Memory check: performance.memory not available (Chrome only)');
    return null;
  }
  const today = todayInt();
  const { year, month } = parseYMD(today);
  const epoch = calculateEpoch(year, month);
  const testJobs = [];
  for (let i = 0; i < 500; i++) {
    testJobs.push({
      id: `mem-${i}`,
      name: `Memory Test ${i}`,
      frequency: 'daily',
      interval: 1,
      time: null,
      start_date: addDays(today, -100),
      end_date: null,
      fixed_date: null,
      rule_day: null,
      rule_nth: null,
      rule_month: null,
      exceptions: []
    });
  }
  const heapSamples = [];
  for (let i = 0; i < iterations; i++) {
    const buffer = createBuffer();
    stencilAll(testJobs, buffer, epoch);
    heapSamples.push(performance.memory.usedJSHeapSize);
  }
  const first = heapSamples[0];
  const last = heapSamples.at(-1);
  const growth = last - first;
  const growthMB = (growth / 1024 / 1024).toFixed(2);
  const passed = growth < 5 * 1024 * 1024;
  console.log(`Memory check: ${iterations} iterations, growth ${growthMB}MB ${passed ? 'PASS' : 'FAIL'} (target <5MB growth)`);
  return { heapSamples, growth, passed };
}

window.benchmarkStencil = benchmarkStencil;
window.checkMemory = checkMemory;

// Expose functions for inline onclick handlers
window.hideModal = hideModal;
window.showJobEditorModal = showJobEditorModal;
window.deleteInstance = deleteInstance;
window.deleteFuture = deleteFuture;
window.deleteAll = deleteAll;
window.saveProfile = saveProfile;
window.confirmDeleteProfile = confirmDeleteProfile;
window.setTheme = setTheme;
window.setFirstDayOfWeek = setFirstDayOfWeek;
window.setShowWeekends = setShowWeekends;
window.handleExport = handleExport;
window.doExport = doExport;
window.triggerImport = triggerImport;
window.loadSampleData = loadSampleData;
window.doImport = doImport;

// Need to expose state for inline handlers that reference state.jobs
window.state = state;

// Service worker & offline detection
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

let reconnectTimeout = null;
let reconnectAttempt = 0;
let isPolling = false;
let countdownInterval = null;

async function tryReconnect() {
  reconnectTimeout = null;
  clearInterval(countdownInterval);
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const res = await fetch('/api/profiles', { signal: controller.signal });
    if (await activateDemoMode(res)) {
      isPolling = false;
      hideOfflineToast();
      document.body.classList.remove('offline');
      showDemoToast();
      return;
    }
    if (res.ok) {
      isPolling = false;
      reconnectAttempt = 0;
      hideOfflineToast();
      document.body.classList.remove('offline');
      // Sync pending import if exists
      const pending = await getPendingImport();
      if (pending) {
        try {
          await pushImportToServer(pending);
          await setPendingImport(null);
        } catch {}
      }
      return;
    }
  } catch {}
  const delays = [5, 10, 15, 30];
  const delay = delays[Math.min(reconnectAttempt++, delays.length - 1)] * 1000;
  let remaining = Math.ceil(delay / 1000);
  showOfflineToast(remaining);
  countdownInterval = setInterval(() => {
    const el = document.querySelector('.offline-toast b');
    if (el && --remaining > 0) el.textContent = remaining;
  }, 1000);
  reconnectTimeout = setTimeout(tryReconnect, delay);
}

function enterOfflineMode() {
  if (state.demoMode) return;
  document.body.classList.add('offline');
  if (!isPolling) {
    isPolling = true;
    reconnectAttempt = 0;
    tryReconnect();
  }
}

async function serverCheck() {
  if (state.demoMode) return true;
  if (document.body.classList.contains('offline')) return false;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 2000);
    const res = await fetch('/api/profiles', { signal: controller.signal });
    if (await activateDemoMode(res)) return true;
    if (!res.ok) throw new Error();
    return true;
  } catch {
    enterOfflineMode();
    return false;
  }
}
window.serverCheck = serverCheck;
window.editJobWithCheck = async (id) => {
  const job = state.jobs.find(j => j.id === id);
  if (job && await serverCheck()) showJobEditorModal(job);
};

if (!navigator.onLine) enterOfflineMode();
window.addEventListener('offline', enterOfflineMode);
window.addEventListener('online', () => {
  reconnectAttempt = 0;
  tryReconnect();
});
window.addEventListener('servererror', enterOfflineMode);

init();
