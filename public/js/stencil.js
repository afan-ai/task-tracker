// === JOB SCHEMA ===
import { generateUUID, todayInt, parseYMD, daysInMonth, dayOfWeek, addDays, daysBetween, buildYMD } from './utils.js';

let _getProfileId = () => null;
export function setProfileIdGetter(fn) { _getProfileId = fn; }

export function createJob(overrides = {}) {
  return {
    id: generateUUID(),
    profile_id: overrides.profile_id || _getProfileId(),
    name: '',
    frequency: 'once',
    interval: 1,
    time: null,
    start_date: todayInt(),
    end_date: null,
    fixed_date: null,
    rule_day: null,
    rule_nth: null,
    rule_month: null,
    exceptions: [],
    ...overrides
  };
}

export function validateJob(job) {
  const errors = [];
  const name = (job.name || '').trim();
  if (!name || name.length > 200) errors.push('Name required, max 200 chars');
  if (job.interval != null && !Number.isInteger(job.interval))
    errors.push('Interval must be an integer');
  if (job.frequency === 'hourly' && (job.interval < 1 || job.interval > 23))
    errors.push('Hourly interval must be 1-23');
  if (job.frequency !== 'hourly' && job.interval != null && (job.interval < 1 || job.interval > 365))
    errors.push('Interval must be 1-365');
  if (job.time != null && (job.time < 0 || job.time > 1439))
    errors.push('Time must be 0-1439');
  if (!job.start_date) errors.push('Start date required');
  else {
    const y = Math.floor(job.start_date / 10000);
    if (y < 1970 || y > 9999) errors.push('Year must be 1970-9999');
  }
  if (job.end_date != null && job.end_date < job.start_date)
    errors.push('End date must be >= start date');
  if (job.fixed_date != null && (job.fixed_date < 1 || job.fixed_date > 31))
    errors.push('Fixed date must be 1-31');
  if (job.rule_day != null && (job.rule_day < 0 || job.rule_day > 6))
    errors.push('Rule day must be 0-6');
  if (job.rule_nth != null && (job.rule_nth < -5 || job.rule_nth > 5 || job.rule_nth === 0))
    errors.push('Rule nth must be -5 to 5, non-zero');
  if (job.rule_month != null && (job.rule_month < 0 || job.rule_month > 11))
    errors.push('Rule month must be 0-11');
  if (job.frequency === 'weekly' && job.fixed_date != null)
    errors.push('Weekly frequency cannot have fixed_date');
  if (job.frequency === 'daily' && (job.rule_day != null || job.rule_nth != null))
    errors.push('Daily frequency cannot have rule_day or rule_nth');
  if (job.frequency === 'once' && job.interval > 1)
    errors.push('Once frequency cannot have interval > 1');
  if (job.frequency === 'hourly' && (job.rule_day != null || job.rule_nth != null || job.fixed_date != null))
    errors.push('Hourly frequency cannot have rule_day, rule_nth, or fixed_date');
  return { valid: errors.length === 0, errors };
}

// === STENCIL ALGORITHM ===

const BUFFER_SIZE = 93; // Max days for 3 months (31+31+31)

export function createBuffer() {
  return Array.from({ length: BUFFER_SIZE }, () => []);
}

export function clearBuffer(buffer) {
  for (let i = 0; i < BUFFER_SIZE; i++) buffer[i] = [];
}

export function generateMonthMap(epoch) {
  const map = [0];
  const { year, month } = parseYMD(epoch);
  let y = year, m = month, idx = 0;
  for (let i = 0; i < 3; i++) {
    idx += daysInMonth(y, m);
    map.push(idx);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return map;
}

export function generateDayOfWeekMap(epoch) {
  const map = [];
  const { year, month } = parseYMD(epoch);
  let y = year, m = month;
  for (let i = 0; i < 3; i++) {
    map.push(new Date(y, m, 1).getDay());
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return map;
}

export function findNthWeekday(year, month, weekday, nth) {
  const dim = daysInMonth(year, month);
  const first = new Date(year, month, 1).getDay();
  if (nth > 0) {
    let day = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
    return day <= dim ? day : null;
  } else {
    let day = dim - ((new Date(year, month, dim).getDay() - weekday + 7) % 7) + (nth + 1) * 7;
    return day >= 1 ? day : null;
  }
}

export function stencilJob(job, buffer, epoch, monthMap) {
  const maxIdx = BUFFER_SIZE - 1;
  const startIdx = Math.max(0, daysBetween(epoch, job.start_date));
  const endIdx = job.end_date ? Math.min(maxIdx, daysBetween(epoch, job.end_date)) : maxIdx;
  if (startIdx > maxIdx || endIdx < 0) return;

  const stamp = (idx) => {
    if (idx >= 0 && idx <= maxIdx && !job.exceptions.includes(addDays(epoch, idx)))
      buffer[idx].push(job.id);
  };

  const { year: epochY, month: epochM } = parseYMD(epoch);

  if (job.frequency === 'once') {
    stamp(startIdx);
  } else if (job.frequency === 'hourly') {
    for (let i = startIdx; i <= endIdx; i++) stamp(i);
  } else if (job.frequency === 'daily') {
    for (let i = startIdx; i <= endIdx; i += job.interval) stamp(i);
  } else if (job.frequency === 'weekly') {
    const targetDay = job.rule_day ?? dayOfWeek(job.start_date);
    let firstOccur = startIdx + ((targetDay - dayOfWeek(addDays(epoch, startIdx)) + 7) % 7);
    for (let i = firstOccur; i <= endIdx; i += 7 * job.interval) stamp(i);
  } else if (job.frequency === 'monthly') {
    for (let mi = 0; mi < 3; mi++) {
      let y = epochY, m = epochM + mi;
      while (m > 11) { m -= 12; y++; }
      let day;
      if (job.fixed_date) {
        day = Math.min(job.fixed_date, daysInMonth(y, m));
      } else if (job.rule_day != null && job.rule_nth != null) {
        day = findNthWeekday(y, m, job.rule_day, job.rule_nth);
      }
      if (day) {
        const idx = monthMap[mi] + day - 1;
        if (idx >= startIdx && idx <= endIdx) stamp(idx);
      }
    }
  } else if (job.frequency === 'yearly') {
    for (let yi = 0; yi < 2; yi++) {
      const y = epochY + yi;
      const m = job.rule_month ?? 0;
      let day;
      if (job.fixed_date) {
        day = Math.min(job.fixed_date, daysInMonth(y, m));
      } else if (job.rule_day != null && job.rule_nth != null) {
        day = findNthWeekday(y, m, job.rule_day, job.rule_nth);
      } else {
        day = parseYMD(job.start_date).day;
      }
      if (day) {
        const yyyymmdd = buildYMD(y, m, day);
        const idx = daysBetween(epoch, yyyymmdd);
        if (idx >= startIdx && idx <= endIdx) stamp(idx);
      }
    }
  }
}

export function stencilAll(jobs, buffer, epoch) {
  clearBuffer(buffer);
  const monthMap = generateMonthMap(epoch);
  for (const job of jobs) stencilJob(job, buffer, epoch, monthMap);
}
