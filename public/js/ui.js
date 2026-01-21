// === UI: SIDEBAR ===
import { generateUUID, daysInMonth, buildYMD, daysBetween, todayInt, parseYMD, addDays, dayOfWeek, el } from './utils.js';
import { createJob, validateJob } from './stencil.js';
import { syncJob, showError, showToast } from './storage.js';
import { obfuscateName, obfuscateTime } from './privacy.js';

// Callback setters to avoid circular dependency with app.js
let _getState = () => ({ jobs: [] });
let _recomputeBuffer = () => {};
let _renderAll = () => {};

export function setUICallbacks(getState, recompute, render) {
  _getState = getState;
  _recomputeBuffer = recompute;
  _renderAll = render;
}

// DOM-based dropdown
function createDropdown(id, options, selected, onChange) {
  const sel = options.find(o => o.v == selected);
  const btn = el('button', { type: 'button', class: 'dropdown-btn', id, dataValue: String(selected ?? '') }, sel?.l || '');
  const menu = el('div', { class: 'dropdown-menu' });

  for (const o of options) {
    const opt = el('div', { class: 'dropdown-option' + (o.v == selected ? ' selected' : ''), dataValue: String(o.v) }, o.l);
    menu.append(opt);
  }

  const dd = el('div', { class: 'dropdown', dataFor: id }, btn, menu);

  dd.addEventListener('click', e => {
    if (e.target === btn) {
      const wasOpen = dd.classList.contains('open');
      document.querySelectorAll('.modal-content .dropdown.open').forEach(d => d.classList.remove('open'));
      if (!wasOpen) dd.classList.add('open');
      return;
    }
    const opt = e.target.closest('.dropdown-option');
    if (opt) {
      const value = opt.dataset.value;
      btn.dataset.value = value;
      btn.textContent = opt.textContent;
      menu.querySelectorAll('.dropdown-option').forEach(o => o.classList.toggle('selected', o === opt));
      dd.classList.remove('open');
      if (onChange) onChange(value);
    }
  });

  return dd;
}

export function renderSidebarHeader() {
  const header = document.getElementById('sidebar-header');
  header.replaceChildren(
    el('button', { id: 'new-job-btn', type: 'button' }, 'New Job'),
    el('div', { class: 'sidebar-search' },
      el('input', { type: 'text', id: 'search-input', placeholder: 'Search jobs...' }),
      el('button', { id: 'filter-btn', type: 'button', dataTooltip: 'Filter' }, '\u2630')
    )
  );
}

export function renderSidebarContent(jobs) {
  const content = document.getElementById('sidebar-content');
  content.replaceChildren();

  if (!jobs.length) {
    content.append(el('p', { class: 'empty-state' }, 'No jobs yet'));
    return;
  }

  const list = el('ul', { id: 'job-list' });
  const privacyMode = _getState().privacyMode;

  for (const job of jobs) {
    const displayName = privacyMode ? obfuscateName(job.name, job.id) : job.name;
    const blurClass = privacyMode ? 'privacy-blur' : null;

    let scheduleText = '';
    if (job.frequency === 'hourly') {
      const hourLabel = job.interval === 1 ? 'hour' : 'hours';
      scheduleText = `Every ${job.interval} ${hourLabel} `;
    } else if (job.time != null) {
      scheduleText = (privacyMode ? obfuscateTime(job.id) : formatTime12h(job.time)) + ' ';
    }

    list.append(
      el('li', { class: 'job-item', dataId: job.id },
        el('div', { class: 'job-info' },
          el('div', { class: blurClass ? 'job-name ' + blurClass : 'job-name' }, displayName),
          el('div', { class: 'job-schedule' }, scheduleText, el('span', { class: 'freq-badge ' + getFreqClass(job) }, getFreqCode(job)))
        ),
        el('span', { class: 'job-actions' },
          el('button', { class: 'edit-btn', dataId: job.id, dataTooltip: 'Edit' }, '\u270E'),
          el('button', { class: 'delete-btn', dataId: job.id, dataTooltip: 'Delete' }, '\u00D7')
        )
      )
    );
  }

  content.append(list);
}

// === UI: CALENDAR ===

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function renderCalendarHeader(year, month, viewMode = 'month') {
  const header = document.getElementById('calendar-header');
  const currentYear = new Date().getFullYear();

  // Month dropdown menu
  const monthMenu = el('div', { class: 'dropdown-menu' });
  MONTH_NAMES.forEach((name, i) => {
    monthMenu.append(el('div', { class: 'dropdown-option' + (i === month ? ' selected' : ''), dataValue: String(i) }, name));
  });

  // Year dropdown menu
  const yearMenu = el('div', { class: 'dropdown-menu' });
  for (let y = currentYear - 3; y <= currentYear + 3; y++) {
    yearMenu.append(el('div', { class: 'dropdown-option' + (y === year ? ' selected' : ''), dataValue: String(y) }, String(y)));
  }
  yearMenu.append(el('input', { type: 'number', class: 'year-input', id: 'year-input', placeholder: 'Year', min: '1900', max: '2500', title: 'Valid range: 1900-2500' }));

  const prevTooltip = viewMode === 'month' ? 'Previous Month' : 'Previous Week';
  const nextTooltip = viewMode === 'month' ? 'Next Month' : 'Next Week';

  header.replaceChildren(
    el('div', { class: 'mode-switcher', id: 'view-switcher' },
      el('button', { type: 'button', class: 'mode-btn' + (viewMode === 'week' ? ' active' : ''), dataView: 'week' }, 'Week'),
      el('button', { type: 'button', class: 'mode-btn' + (viewMode === 'month' ? ' active' : ''), dataView: 'month' }, 'Month')
    ),
    el('div', { class: 'calendar-nav' },
      el('button', { id: 'prev-month', type: 'button', dataTooltip: prevTooltip }, '\u25C0'),
      el('div', { class: 'dropdown', id: 'month-dropdown' },
        el('button', { type: 'button', class: 'dropdown-btn', id: 'month-dropdown-btn' }, MONTH_NAMES[month]),
        monthMenu
      ),
      el('div', { class: 'dropdown', id: 'year-dropdown' },
        el('button', { type: 'button', class: 'dropdown-btn', id: 'year-dropdown-btn' }, String(year)),
        yearMenu
      ),
      el('button', { id: 'next-month', type: 'button', dataTooltip: nextTooltip }, '\u25B6')
    ),
    el('button', { id: 'today-btn', type: 'button' }, 'Today')
  );
}

export function renderCalendarGrid(year, month, buffer, epoch, jobs, viewMode = 'month', weekStart = null) {
  const grid = document.getElementById('calendar-grid');
  const { privacyMode, firstDayOfWeek, showWeekends } = _getState();
  const isWeekend = d => d === 0 || d === 6;
  const hideWeekends = viewMode === 'week' && !showWeekends;

  // Weekday header row
  const weekdayRow = el('div', { class: 'weekday-row' });
  for (let i = 0; i < 7; i++) {
    const dow = (firstDayOfWeek + i) % 7;
    if (hideWeekends && isWeekend(dow)) continue;
    weekdayRow.append(el('div', { class: 'weekday' }, DAY_NAMES[dow]));
  }

  // Days grid
  const daysGrid = el('div', { class: 'days-grid view-' + viewMode + (hideWeekends ? ' hide-weekends' : '') });

  const jobMap = {};
  for (const job of jobs) jobMap[job.id] = job;

  // Calculate which days to render
  const days = [];
  if (viewMode === 'week' && weekStart) {
    for (let i = 0; i < 7; i++) {
      const dateInt = addDays(weekStart, i);
      if (hideWeekends && isWeekend(dayOfWeek(dateInt))) continue;
      const { month: m, day: d } = parseYMD(dateInt);
      days.push({ day: d, dateInt, isCurrentMonth: m === month });
    }
  } else {
    const dow = new Date(year, month, 1).getDay();
    const offset = (dow - firstDayOfWeek + 7) % 7;
    const dim = daysInMonth(year, month);
    const prevDim = daysInMonth(year, month === 0 ? 11 : month - 1);
    for (let i = 0; i < 42; i++) {
      let day, dateInt, isCurrentMonth = true;
      if (i < offset) {
        day = prevDim - offset + i + 1;
        dateInt = buildYMD(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1, day);
        isCurrentMonth = false;
      } else if (i >= offset + dim) {
        day = i - offset - dim + 1;
        dateInt = buildYMD(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1, day);
        isCurrentMonth = false;
      } else {
        day = i - offset + 1;
        dateInt = buildYMD(year, month, day);
      }
      days.push({ day, dateInt, isCurrentMonth });
    }
  }

  // Helper to create a job element
  const createJobEl = (job, timeContent, tooltip) => {
    const displayName = privacyMode ? obfuscateName(job.name, job.id) : job.name;
    const titleClass = 'job-title' + (privacyMode ? ' privacy-blur' : '');
    const attrs = { class: 'day-job ' + getFreqClass(job), dataId: job.id };
    if (tooltip) attrs.dataTooltip = tooltip;
    return el('div', attrs,
      el('span', { class: titleClass }, displayName),
      timeContent,
      el('span', { class: 'freq-badge ' + getFreqClass(job) }, getFreqCode(job))
    );
  };

  // Render day cells
  for (const { day, dateInt, isCurrentMonth } of days) {
    const idx = daysBetween(epoch, dateInt);
    const dayJobs = (idx >= 0 && idx < buffer.length) ? buffer[idx].map(id => jobMap[id]).filter(Boolean).sort((a, b) => (a.time ?? -1) - (b.time ?? -1)) : [];
    const isToday = dateInt === todayInt();

    const cellClass = 'day-cell' + (isCurrentMonth ? '' : ' muted') + (isToday ? ' today' : '');
    const dayCell = el('div', { class: cellClass, dataDate: dateInt });

    const dayHeader = el('div', { class: 'day-header' }, el('span', { class: 'day-num' }, String(day)));
    if (dayJobs.length > 0) {
      dayHeader.append(el('span', { class: 'day-count' }, dayJobs.length + ' task' + (dayJobs.length > 1 ? 's' : '')));
    }
    dayCell.append(dayHeader);

    if (dayJobs.length > 0) {
      const jobsContainer = el('div', { class: 'day-jobs' });

      const hourly = viewMode === 'week' ? dayJobs.filter(j => j.frequency === 'hourly') : [];
      if (hourly.length) {
        const events = [];
        for (const job of dayJobs.filter(j => j.frequency !== 'hourly')) {
          events.push({ t: job.time ?? -1, job });
        }
        for (const job of hourly) {
          for (let m = 0; m < 1440; m += job.interval * 60) events.push({ t: m, job, h: true });
        }
        events.sort((a, b) => a.t - b.t);

        for (let i = 0; i < events.length; ) {
          const e = events[i];
          const job = e.job;
          if (!e.h) {
            const timeEl = job.time != null ? el('span', { class: 'job-time' }, privacyMode ? obfuscateTime(job.id, true) : formatTimeShort(job.time)) : null;
            jobsContainer.append(createJobEl(job, timeEl, null));
            i++;
          } else {
            const times = [e.t];
            let j = i + 1;
            while (j < events.length && events[j].h && events[j].job.id === job.id) times.push(events[j++].t);
            const tooltip = times.map(t => formatTimeShort(t)).join(', ');
            const hourLabel = job.interval === 1 ? 'hour' : 'hours';
            const displayName = privacyMode ? obfuscateName(job.name, job.id) : job.name;
            const titleClass = 'job-title' + (privacyMode ? ' privacy-blur' : '');
            jobsContainer.append(
              el('div', { class: 'day-job ' + getFreqClass(job), dataId: job.id, dataTooltip: tooltip },
                el('span', { class: titleClass }, displayName + ' (x' + times.length + ')'),
                el('div', { class: 'job-subtitle' }, 'Every ' + job.interval + ' ' + hourLabel + ' ',
                  el('span', { class: 'freq-badge ' + getFreqClass(job) }, getFreqCode(job))
                )
              )
            );
            i = j;
          }
        }
      } else {
        for (const job of dayJobs) {
          let timeEl = null;
          if (job.frequency === 'hourly') {
            const hourLabel = job.interval === 1 ? 'hour' : 'hours';
            timeEl = el('span', { class: 'job-time' }, 'Every ' + job.interval + ' ' + hourLabel);
          } else if (job.time != null) {
            timeEl = el('span', { class: 'job-time' }, privacyMode ? obfuscateTime(job.id, true) : formatTimeShort(job.time));
          }
          jobsContainer.append(createJobEl(job, timeEl, null));
        }
      }
      dayCell.append(jobsContainer);
    }
    daysGrid.append(dayCell);
  }

  grid.replaceChildren(weekdayRow, daysGrid);
}

// === UI: MODAL SYSTEM ===

export function showModal(content) {
  hideModal();
  const container = document.getElementById('modal-container');
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modalContent = el('div', { class: 'modal-content' });

  modalContent.append(content);

  backdrop.append(modalContent);
  container.append(backdrop);
  container.style.display = 'flex';
  document.addEventListener('keydown', handleModalEscape);
  modalContent.addEventListener('click', handleModalAction);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) hideModal(); });
}

export function hideModal() {
  const container = document.getElementById('modal-container');
  container.style.display = 'none';
  container.replaceChildren();
  document.removeEventListener('keydown', handleModalEscape);
}

function handleModalEscape(e) {
  if (e.key === 'Escape') hideModal();
}

function handleModalAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const jobId = btn.dataset.jobId;
  const profileId = btn.dataset.profileId;
  const date = btn.dataset.date ? parseInt(btn.dataset.date, 10) : null;

  switch (action) {
    case 'edit-job':
      window.editJobWithCheck(jobId);
      break;
    case 'delete-instance':
      window.deleteInstance(jobId, date);
      break;
    case 'delete-future':
      window.deleteFuture(jobId, date);
      break;
    case 'delete-all':
      window.deleteAll(jobId);
      break;
    case 'delete-profile':
      window.confirmDeleteProfile(profileId);
      break;
    case 'export':
      window.handleExport();
      break;
    case 'import':
      window.triggerImport();
      break;
    case 'do-export':
      window.doExport();
      break;
    case 'do-import':
      window.doImport();
      break;
    case 'close':
      hideModal();
      break;
  }
}

export function showJobDetailModal(job) {
  const privacyMode = _getState().privacyMode;
  const displayName = privacyMode ? obfuscateName(job.name, job.id) : job.name;
  const blurClass = privacyMode ? 'privacy-blur' : null;
  const freqLabel = job.frequency.charAt(0).toUpperCase() + job.frequency.slice(1);
  const timeStr = job.time != null
    ? (privacyMode ? obfuscateTime(job.id) : `${String(Math.floor(job.time / 60)).padStart(2, '0')}:${String(job.time % 60).padStart(2, '0')}`)
    : 'Not set';

  const content = el('div', null,
    el('h2', { class: blurClass }, displayName),
    el('p', { class: 'divider' }, el('strong', null, 'Frequency:'), ' ', freqLabel),
    el('p', null, el('strong', null, 'Time:'), ' ', el('span', { class: blurClass }, timeStr)),
    el('p', null, el('strong', null, 'Start:'), ' ', formatDateInt(job.start_date)),
    el('p', null, el('strong', null, 'End:'), ' ', job.end_date ? formatDateInt(job.end_date) : 'None')
  );

  if (job.fixed_date) content.append(el('p', null, el('strong', null, 'Day of month:'), ' ', String(job.fixed_date)));
  if (job.rule_day != null) content.append(el('p', null, el('strong', null, 'Day of week:'), ' ', DAY_NAMES[job.rule_day] || String(job.rule_day)));
  if (job.rule_nth != null) content.append(el('p', null, el('strong', null, 'Occurrence:'), ' ', formatNth(job.rule_nth)));
  if (job.rule_month != null) content.append(el('p', null, el('strong', null, 'Month:'), ' ', MONTH_NAMES[job.rule_month] || String(job.rule_month)));
  if (job.interval > 1 || job.frequency === 'hourly') {
    const unit = job.frequency === 'hourly' ? 'hours' : job.frequency === 'daily' ? 'days' : job.frequency === 'weekly' ? 'weeks' : 'periods';
    content.append(el('p', null, el('strong', null, 'Interval:'), ' Every ', String(job.interval), ' ', unit));
  }

  content.append(
    el('div', { class: 'modal-actions divider' },
      el('button', { type: 'button', class: 'btn-secondary', dataAction: 'close' }, 'Close'),
      el('button', { type: 'button', class: 'btn-primary', dataAction: 'edit-job', dataJobId: job.id }, 'Edit')
    )
  );

  showModal(content);
}

export function formatDateInt(yyyymmdd) {
  const { year, month, day } = parseYMD(yyyymmdd);
  return `${MONTH_NAMES[month]} ${day}, ${year}`;
}

export function formatNth(n) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  if (n === -1) return 'Last';
  if (n === -2) return '2nd to last';
  return n > 0 ? `${n}th` : `${Math.abs(n)}th to last`;
}

function formatTime12h(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

function formatTimeShort(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? 'p' : 'a';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')}${period}`;
}

function getFreqCode(job) {
  const codes = { once: 'once', daily: 'D', weekly: 'W', monthly: 'MM', yearly: 'YY', hourly: 'H' };
  const prefix = job.interval > 1 && job.frequency !== 'yearly' && job.frequency !== 'once' ? job.interval : '';
  return prefix + codes[job.frequency];
}

function getFreqClass(job) {
  const classes = { once: 'freq-once', daily: 'freq-D', weekly: 'freq-W', monthly: 'freq-MM', yearly: 'freq-YY', hourly: 'freq-H' };
  return classes[job.frequency];
}

export function showJobEditorModal(job = null) {
  const isEdit = job !== null;
  const j = job || createJob();
  const privacyMode = _getState().privacyMode;
  const displayName = privacyMode ? obfuscateName(j.name, j.id) : j.name;
  const timeVal = j.time != null ? `${String(Math.floor(j.time / 60)).padStart(2, '0')}:${String(j.time % 60).padStart(2, '0')}` : '';

  const weeklyMode = j.rule_day != null ? 'explicit' : 'simple';
  const monthlyMode = j.fixed_date ? 'fixed' : (j.rule_day != null && j.rule_nth != null) ? 'nth' : 'fixed';

  // Hidden inputs for mode tracking
  const weeklyModeInput = el('input', { type: 'hidden', id: 'weekly-mode' });
  weeklyModeInput.value = weeklyMode;
  const monthlyModeInput = el('input', { type: 'hidden', id: 'monthly-mode' });
  monthlyModeInput.value = monthlyMode;

  // Form inputs
  const nameInput = el('input', { type: 'text', id: 'job-name', maxlength: '200', required: '', class: privacyMode ? 'privacy-blur' : null });
  nameInput.value = displayName;

  const timeInput = el('input', { type: 'time', id: 'job-time' });
  timeInput.value = timeVal;

  const intervalInput = el('input', { type: 'number', id: 'job-interval', min: '1', max: '365' });
  intervalInput.value = j.interval;

  const fixedDateInput = el('input', { type: 'number', id: 'job-fixed-date', min: '1', max: '31', placeholder: '1-31' });
  fixedDateInput.value = j.fixed_date || '';

  const startInput = el('input', { type: 'date', id: 'job-start', required: '' });
  startInput.value = formatDateInput(j.start_date);

  const endInput = el('input', { type: 'date', id: 'job-end' });
  endInput.value = j.end_date ? formatDateInput(j.end_date) : '';

  const saveBtn = el('button', { type: 'submit', class: 'btn-primary' }, 'Save');
  if (privacyMode) saveBtn.disabled = true;

  // Mode switcher builder
  const createModeSwitcher = (id, hiddenInput, modes, current) => {
    const switcher = el('div', { class: 'mode-switcher', id });
    for (const [mode, label] of modes) {
      const btn = el('button', { type: 'button', class: 'mode-btn' + (current === mode ? ' active' : ''), dataMode: mode }, label);
      switcher.append(btn);
    }
    switcher.addEventListener('click', e => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      hiddenInput.value = btn.dataset.mode;
      switcher.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateFormVisibility();
    });
    return switcher;
  };

  const form = el('form', { id: 'job-form' },
    el('input', { type: 'hidden', id: 'job-id', value: j.id }),
    weeklyModeInput,
    monthlyModeInput,
    el('div', { class: 'form-row divider' }, el('label', { for: 'job-name' }, 'Name'), nameInput),
    el('div', { class: 'form-row', id: 'time-row' }, el('label', { for: 'job-time' }, 'Time (optional)'), timeInput),
    el('div', { class: 'form-row' }, el('label', { for: 'job-frequency' }, 'Frequency'),
      createDropdown('job-frequency', [
        {v:'once',l:'Once'},{v:'hourly',l:'Hourly'},{v:'daily',l:'Daily'},{v:'weekly',l:'Weekly'},{v:'monthly',l:'Monthly'},{v:'yearly',l:'Yearly'}
      ], j.frequency, updateFormVisibility)
    ),
    el('div', { class: 'form-row', id: 'interval-row' }, el('label', { for: 'job-interval' }, 'Interval'), intervalInput),
    el('div', { class: 'mode-switcher-row', id: 'weekly-mode-row' },
      createModeSwitcher('weekly-mode-switcher', weeklyModeInput, [['simple', 'Date'], ['explicit', 'Day']], weeklyMode)
    ),
    el('div', { class: 'mode-switcher-row', id: 'monthly-mode-row' },
      createModeSwitcher('monthly-mode-switcher', monthlyModeInput, [['fixed', 'Date'], ['nth', 'Day']], monthlyMode)
    ),
    el('div', { class: 'form-row', id: 'day-of-week-row' }, el('label', { for: 'job-rule-day' }, 'Day'),
      createDropdown('job-rule-day', DAY_NAMES.map((d,i) => ({v:i,l:d})), j.rule_day)
    ),
    el('div', { class: 'form-row', id: 'fixed-date-row' }, el('label', { for: 'job-fixed-date' }, 'Day of month'), fixedDateInput),
    el('div', { class: 'form-row', id: 'rule-nth-row' }, el('label', { for: 'job-rule-nth' }, 'Which'),
      createDropdown('job-rule-nth', [{v:1,l:'1st'},{v:2,l:'2nd'},{v:3,l:'3rd'},{v:4,l:'4th'},{v:-1,l:'Last'},{v:-2,l:'2nd to last'}], j.rule_nth)
    ),
    el('div', { class: 'form-row', id: 'rule-month-row' }, el('label', { for: 'job-rule-month' }, 'Month'),
      createDropdown('job-rule-month', MONTH_NAMES.map((m,i) => ({v:i,l:m})), j.rule_month)
    ),
    el('div', { class: 'form-row' }, el('label', { for: 'job-start' }, 'Start date'), startInput),
    el('div', { class: 'form-row' }, el('label', { for: 'job-end' }, 'End date (optional)'), endInput),
    el('div', { class: 'modal-actions divider' },
      el('button', { type: 'button', class: 'btn-secondary', dataAction: 'close' }, 'Cancel'),
      saveBtn
    )
  );

  form.addEventListener('submit', handleJobFormSubmit);

  showModal(el('div', null, el('h2', null, isEdit ? 'Edit Job' : 'New Job'), form));

  if (privacyMode) showToast('Editing disabled in Privacy Mode', 'info', 3000);
  updateFormVisibility();
}

export function formatDateInput(yyyymmdd) {
  const { year, month, day } = parseYMD(yyyymmdd);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function updateFormVisibility() {
  const freq = document.getElementById('job-frequency').dataset.value;
  const weeklyMode = document.getElementById('weekly-mode').value;
  const monthlyMode = document.getElementById('monthly-mode').value;
  const isHourly = freq === 'hourly';

  const show = (id) => document.getElementById(id).style.display = '';
  const hide = (id) => document.getElementById(id).style.display = 'none';

  // Time row: hide for hourly (always starts at midnight)
  isHourly ? hide('time-row') : show('time-row');

  // Interval row: show for all except 'once'
  freq !== 'once' ? show('interval-row') : hide('interval-row');

  // Update interval constraints for hourly vs others
  const intervalInput = document.getElementById('job-interval');
  intervalInput.max = isHourly ? '23' : '365';

  // Update interval unit text
  const unitMap = { hourly: 'hours', daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' };
  const unit = document.getElementById('interval-unit');
  if (unit) unit.textContent = unitMap[freq] || '';

  // Mode switchers
  freq === 'weekly' ? show('weekly-mode-row') : hide('weekly-mode-row');
  freq === 'monthly' ? show('monthly-mode-row') : hide('monthly-mode-row');

  // Weekly: show day picker only in explicit mode
  const showWeeklyDay = freq === 'weekly' && weeklyMode === 'explicit';

  // Monthly: show fields based on mode
  const showMonthlyFixed = freq === 'monthly' && monthlyMode === 'fixed';
  const showMonthlyNth = freq === 'monthly' && monthlyMode === 'nth';

  // Yearly: show all options (fixed date OR nth weekday, user chooses by filling one)
  const isYearly = freq === 'yearly';

  // Day of week: weekly explicit, monthly nth, or yearly
  (showWeeklyDay || showMonthlyNth || isYearly) ? show('day-of-week-row') : hide('day-of-week-row');

  // Fixed date: monthly fixed mode, or yearly
  (showMonthlyFixed || isYearly) ? show('fixed-date-row') : hide('fixed-date-row');

  // Nth occurrence: monthly nth mode, or yearly
  (showMonthlyNth || isYearly) ? show('rule-nth-row') : hide('rule-nth-row');

  // Month selector: yearly only
  isYearly ? show('rule-month-row') : hide('rule-month-row');
}

export function clearFormErrors() {
  document.querySelectorAll('.form-row.has-error').forEach(row => row.classList.remove('has-error'));
  document.querySelectorAll('.form-error').forEach(el => el.remove());
}

export function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  const row = field.closest('.form-row');
  if (row) {
    row.classList.add('has-error');
    const err = document.createElement('div');
    err.className = 'form-error';
    err.textContent = message;
    row.appendChild(err);
  }
}

export function showInlineValidationErrors(errors) {
  clearFormErrors();
  const fieldMap = {
    'Name': 'job-name',
    'Interval': 'job-interval',
    'Time': 'job-time',
    'Start': 'job-start',
    'End': 'job-end',
    'Year': 'job-start',
    'Fixed': 'job-fixed-date',
    'Rule day': 'job-rule-day',
    'Rule nth': 'job-rule-nth',
    'Rule month': 'job-rule-month',
    'Weekly': 'job-frequency',
    'Daily': 'job-frequency',
    'Once': 'job-frequency'
  };
  for (const error of errors) {
    let shown = false;
    for (const [key, fieldId] of Object.entries(fieldMap)) {
      if (error.includes(key)) {
        showFieldError(fieldId, error);
        shown = true;
        break;
      }
    }
    if (!shown) showError(error);
  }
}

export function handleJobFormSubmit(e) {
  e.preventDefault();
  clearFormErrors();

  const id = document.getElementById('job-id').value;
  const name = document.getElementById('job-name').value.trim();
  const frequency = document.getElementById('job-frequency').dataset.value;
  const interval = parseInt(document.getElementById('job-interval').value) || 1;
  const timeVal = document.getElementById('job-time').value;
  const time = timeVal ? parseInt(timeVal.split(':')[0]) * 60 + parseInt(timeVal.split(':')[1]) : null;
  const startVal = document.getElementById('job-start').value;
  const start_date = startVal ? parseDateInput(startVal) : todayInt();
  const endVal = document.getElementById('job-end').value;
  const end_date = endVal ? parseDateInput(endVal) : null;

  const weeklyMode = document.getElementById('weekly-mode').value;
  const monthlyMode = document.getElementById('monthly-mode').value;

  // Build rule fields based on frequency and mode
  let rule_day = null;
  let fixed_date = null;
  let rule_nth = null;
  let rule_month = null;

  if (frequency === 'weekly') {
    // Simple mode: rule_day stays null (stencil derives from start_date)
    // Explicit mode: use selected day
    if (weeklyMode === 'explicit') {
      rule_day = parseInt(document.getElementById('job-rule-day').dataset.value);
    }
  }
  else if (frequency === 'monthly') {
    if (monthlyMode === 'fixed') {
      fixed_date = parseInt(document.getElementById('job-fixed-date').value) || null;
    } else {
      rule_day = parseInt(document.getElementById('job-rule-day').dataset.value);
      rule_nth = parseInt(document.getElementById('job-rule-nth').dataset.value);
    }
  }
  else if (frequency === 'yearly') {
    const ruleMonthVal = document.getElementById('job-rule-month').dataset.value;
    rule_month = ruleMonthVal !== '' ? parseInt(ruleMonthVal) : null;
    const fixedVal = document.getElementById('job-fixed-date').value;
    const ruleNthVal = document.getElementById('job-rule-nth').dataset.value;
    // Prefer fixed_date if set, otherwise use nth weekday
    if (fixedVal) {
      fixed_date = parseInt(fixedVal);
    } else if (ruleNthVal) {
      rule_day = parseInt(document.getElementById('job-rule-day').dataset.value);
      rule_nth = parseInt(ruleNthVal);
    }
  }

  const state = _getState();
  const existingJob = state.jobs.find(j => j.id === id);
  const jobData = { id, name, frequency, interval, time, start_date, end_date, rule_day, fixed_date, rule_nth, rule_month };
  const job = existingJob ? { ...existingJob, ...jobData } : createJob(jobData);

  const validation = validateJob(job);
  if (!validation.valid) {
    showInlineValidationErrors(validation.errors);
    return;
  }

  saveJobAndRender(job, !existingJob);
}

export function parseDateInput(str) {
  const [y, m, d] = str.split('-').map(Number);
  return buildYMD(y, m - 1, d);
}

export async function saveJobAndRender(job, isNew) {
  await syncJob(job);
  const state = _getState();
  if (isNew) state.jobs.push(job);
  else Object.assign(state.jobs.find(j => j.id === job.id), job);
  _recomputeBuffer();
  _renderAll();
  hideModal();
}

export function showDeleteModal(job, selectedDate = null) {
  const privacyMode = _getState().privacyMode;
  const displayName = privacyMode ? obfuscateName(job.name, job.id) : job.name;
  const isRecurring = job.frequency !== 'once';

  const nameSpan = el('span', privacyMode ? { class: 'privacy-blur' } : null, displayName);
  const actions = el('div', { class: 'modal-actions delete-options divider' });

  if (isRecurring && selectedDate) {
    actions.append(
      el('button', { type: 'button', class: 'btn-secondary', dataAction: 'delete-instance', dataJobId: job.id, dataDate: selectedDate }, 'This Instance Only'),
      el('button', { type: 'button', class: 'btn-secondary', dataAction: 'delete-future', dataJobId: job.id, dataDate: selectedDate }, 'This and Future')
    );
  }
  actions.append(
    el('button', { type: 'button', class: 'btn-danger', dataAction: 'delete-all', dataJobId: job.id }, 'Delete All'),
    el('button', { type: 'button', class: 'btn-secondary', dataAction: 'close' }, 'Cancel')
  );

  showModal(
    el('div', null,
      el('h2', null, 'Delete Job'),
      el('p', { class: 'divider' }, 'Delete "', nameSpan, '"?'),
      actions
    )
  );
}

// === PROFILE MODALS ===

export function showProfileEditorModal(profile = null) {
  const isEdit = profile !== null;
  const id = profile?.id || generateUUID();

  const nameInput = el('input', { type: 'text', id: 'profile-name', maxlength: '100', required: '' });
  nameInput.value = profile?.name || '';

  const form = el('form', { id: 'profile-form' },
    el('div', { class: 'form-row divider' },
      el('label', { for: 'profile-name' }, 'Name'),
      nameInput
    ),
    el('div', { class: 'modal-actions divider' },
      el('button', { type: 'button', class: 'btn-secondary', dataAction: 'close' }, 'Cancel'),
      el('button', { type: 'submit', class: 'btn-primary' }, 'Save')
    )
  );

  form.addEventListener('submit', e => {
    e.preventDefault();
    const formName = nameInput.value.trim();
    if (!formName) return;
    window.saveProfile({ id, name: formName }, !isEdit);
  });

  showModal(
    el('div', null,
      el('h2', null, isEdit ? 'Edit Profile' : 'New Profile'),
      form
    )
  );

  nameInput.focus();
}

export function showProfileDeleteModal(profile) {
  showModal(
    el('div', null,
      el('h2', null, 'Delete Profile'),
      el('p', { class: 'divider' }, 'Delete profile "', profile.name, '"? All jobs in this profile will be deleted.'),
      el('div', { class: 'modal-actions divider' },
        el('button', { type: 'button', class: 'btn-secondary', dataAction: 'close' }, 'Cancel'),
        el('button', { type: 'button', class: 'btn-danger', dataAction: 'delete-profile', dataProfileId: profile.id }, 'Delete')
      )
    )
  );
}

export function showSettingsModal() {
  const state = _getState();
  const themes = [
    { v: 'nord', l: 'Nord' }, { v: 'oled', l: 'OLED' }, { v: 'light', l: 'Light' },
    { v: 'synthwave', l: 'Synthwave' }, { v: 'botanical', l: 'Botanical' }
  ];
  const fdowOpts = [{ v: 1, l: 'Mon' }, { v: 0, l: 'Sun' }, { v: 6, l: 'Sat' }];

  const content = el('div', null,
    el('h2', null, 'Settings'),
    el('div', { class: 'form-row divider' },
      el('label', { for: 'settings-theme' }, 'Theme'),
      createDropdown('settings-theme', themes, state.theme, v => window.setTheme(v))
    ),
    el('div', { class: 'form-row' },
      el('label', { for: 'settings-fdow' }, 'Week starts on'),
      createDropdown('settings-fdow', fdowOpts, state.firstDayOfWeek, v => window.setFirstDayOfWeek(parseInt(v)))
    )
  );

  if (state.viewMode === 'week') {
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = state.showWeekends;
    checkbox.addEventListener('change', () => window.setShowWeekends(checkbox.checked));
    content.append(
      el('div', { class: 'form-row form-row-checkbox' },
        el('label', null, 'Show weekends', checkbox)
      )
    );
  }

  content.append(
    el('div', { class: 'modal-actions divider' },
      el('button', { type: 'button', class: 'btn-secondary', dataAction: 'close' }, 'Close')
    )
  );

  showModal(content);
}

export function showImportExportModal() {
  const isOffline = document.body.classList.contains('offline');
  const isDemoMode = _getState().demoMode;
  const importDisabled = isOffline && !isDemoMode;

  const importBtn = el('button', { type: 'button', class: 'btn-secondary', style: 'width: 100%;', dataAction: 'import' }, 'Import Data');
  if (importDisabled) {
    importBtn.disabled = true;
    importBtn.title = 'Unavailable offline';
  }

  showModal(
    el('div', null,
      el('h2', null, 'Import / Export'),
      el('div', { class: 'modal-actions divider', style: 'flex-direction: column;' },
        el('button', { type: 'button', class: 'btn-secondary', style: 'width: 100%;', dataAction: 'export' }, 'Export Data'),
        importBtn,
        el('button', { type: 'button', class: 'btn-secondary', dataAction: 'close' }, 'Cancel')
      )
    )
  );
}

export function showOfflineExportWarning() {
  const exportBtn = el('button', { type: 'button', class: 'btn-primary', dataAction: 'do-export' }, 'Export');
  exportBtn.disabled = true;

  const checkbox = el('input', { type: 'checkbox' });
  checkbox.addEventListener('change', () => { exportBtn.disabled = !checkbox.checked; });

  showModal(
    el('div', null,
      el('h2', null, 'Export Data'),
      el('p', { class: 'divider' }, 'Server unreachable. Local data may not reflect recent changes.'),
      el('div', { class: 'form-row form-row-checkbox' },
        el('label', null, checkbox, ' I understand')
      ),
      el('div', { class: 'modal-actions divider' },
        el('button', { type: 'button', class: 'btn-secondary', dataAction: 'close' }, 'Cancel'),
        exportBtn
      )
    )
  );
}

export function showHelpModal() {
  showModal(
    el('div', null,
      el('h2', null, 'Task Tracker: Help'),
      el('p', { class: 'divider' }, el('strong', null, 'New Job'), ' - Create a task.'),
      el('p', null, el('strong', null, 'Click a job'), ' - View details. Edit or delete from there.'),
      el('p', null, el('strong', null, 'Delete options'), ' - Remove the task.'),
      el('p', null, el('strong', null, 'Profiles'), ' - Separate task lists. Switch via header dropdown.'),
      el('p', null, el('strong', null, 'Privacy (eye icon)'), ' - Blurs task names for screen sharing.'),
      el('div', { class: 'modal-actions divider', style: 'justify-content: space-between; align-items: center;' },
        el('span', null, 'v0.1 (beta) - License: AGPL-3.0'),
        el('button', { type: 'button', class: 'btn-secondary', dataAction: 'close' }, 'Close')
      )
    )
  );
}
