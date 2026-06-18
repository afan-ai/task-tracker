// === PRIVACY MODE ===
// Seeded PRNG for consistent per-job obfuscation

function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h = (h * 1103515245 + 12345) | 0;
    return (h >>> 16) / 65536;
  };
}

export function obfuscateName(name, jobId) {
  const rand = seededRandom(jobId);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  let result = '';
  for (let i = 0; i < name.length; i++) {
    if (name[i] === ' ') result += ' ';
    else result += chars[Math.floor(rand() * chars.length)];
  }
  return result;
}

export function obfuscateTime(jobId, short = false) {
  const rand = seededRandom(jobId + '-time');
  const hour = Math.floor(rand() * 12) + 1;
  const mins = [0, 15, 30, 45][Math.floor(rand() * 4)];
  const p = rand() > 0.5;
  if (short) return `${hour}:${String(mins).padStart(2, '0')}${p ? 'p' : 'a'}`;
  return `${hour}:${String(mins).padStart(2, '0')} ${p ? 'PM' : 'AM'}`;
}

// === STATUS TOASTS ===

function showStatusToast(content, className, onDismiss, replace = false) {
  if (replace) hideStatusToast(className);
  else if (document.querySelector(`.${className}`)) return;
  const toast = document.createElement('div');
  toast.className = className;
  const span = document.createElement('span');
  if (typeof content === 'string') {
    span.textContent = content;
  } else {
    span.append(...content);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Dismiss');
  btn.textContent = '\u00D7';
  btn.onclick = () => { toast.remove(); if (onDismiss) onDismiss(); };
  toast.append(span, btn);
  document.body.appendChild(toast);
}

function hideStatusToast(className) {
  document.querySelector(`.${className}`)?.remove();
}

export function showPrivacyToast(onDismiss) { showStatusToast('Privacy Mode Enabled', 'privacy-toast', onDismiss); }
export function hidePrivacyToast() { hideStatusToast('privacy-toast'); }
export function showOfflineToast(seconds, onDismiss) {
  const b = document.createElement('b');
  b.textContent = String(seconds);
  showStatusToast(['Offline... retrying in ', b, 's'], 'offline-toast', onDismiss, true);
}
export function hideOfflineToast() { hideStatusToast('offline-toast'); }
export function showDemoToast() { showStatusToast('Demo Mode', 'demo-toast'); }
export function showPortToast(message) {
  showStatusToast(message, 'port-toast', null, true);
  setTimeout(() => hideStatusToast('port-toast'), 3000);
}
