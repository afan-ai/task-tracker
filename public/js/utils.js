// === UUID ===

export function generateUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// === DATE UTILITIES ===

export function dateToInt(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function intToDate(yyyymmdd) {
  const y = Math.floor(yyyymmdd / 10000);
  const m = Math.floor((yyyymmdd % 10000) / 100) - 1;
  const d = yyyymmdd % 100;
  return new Date(y, m, d);
}

export function todayInt() {
  return dateToInt(new Date());
}

export function dayOfWeek(yyyymmdd) {
  return intToDate(yyyymmdd).getDay();
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

export function daysInMonth(year, month) {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 1 && isLeapYear(year)) return 29;
  return days[month];
}

export function parseYMD(yyyymmdd) {
  return {
    year: Math.floor(yyyymmdd / 10000),
    month: Math.floor((yyyymmdd % 10000) / 100) - 1,
    day: yyyymmdd % 100
  };
}

export function buildYMD(year, month, day) {
  return year * 10000 + (month + 1) * 100 + day;
}

export function addDays(yyyymmdd, n) {
  const date = intToDate(yyyymmdd);
  date.setDate(date.getDate() + n);
  return dateToInt(date);
}

export function daysBetween(from, to) {
  const d1 = intToDate(from);
  const d2 = intToDate(to);
  return Math.round((d2 - d1) / 86400000);
}

export function getSunday(yyyymmdd) {
  const dow = dayOfWeek(yyyymmdd);
  return addDays(yyyymmdd, -dow);
}

export function getWeekStart(yyyymmdd, firstDayOfWeek) {
  const dow = dayOfWeek(yyyymmdd);
  const diff = (dow - firstDayOfWeek + 7) % 7;
  return addDays(yyyymmdd, -diff);
}

// === DOM BUILDER (safe by construction) ===

export function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('data')) {
        // dataProfileId -> profileId -> dataset.profileId
        e.dataset[k.charAt(4).toLowerCase() + k.slice(5)] = v;
      }
      else e.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c != null) e.append(c);
  }
  return e;
}
