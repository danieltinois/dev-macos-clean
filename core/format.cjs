// Human-friendly formatting. Bytes are always the source of truth internally.
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

// Format byte counts like `842 MB`, `2.4 GB`, `31.7 GB` (binary units).
function formatBytes(size) {
  if (size < 0) throw new RangeError(`negative size: ${size}`);
  let value = size, unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {value /= 1024; unit++;}
  if (unit === 0) return `${Math.trunc(value)} B`;
  return `${value.toFixed(1).replace(/\.0$/, '')} ${UNITS[unit]}`;
}

function plural(count, word) {return `${count} ${word}${count === 1 ? '' : 's'} ago`;}

// Relative time like `3 months ago` (`now` injectable for tests).
function formatAgo(when, now = new Date()) {
  const seconds = (now - when) / 1000;
  if (seconds < 0) return 'in the future';
  if (seconds < 60) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return plural(Math.trunc(minutes), 'minute');
  const hours = minutes / 60;
  if (hours < 24) return plural(Math.trunc(hours), 'hour');
  const days = hours / 24;
  if (days < 7) return plural(Math.trunc(days), 'day');
  if (days / 7 < 5) return plural(Math.trunc(days / 7), 'week');
  if (days / 30.44 < 12) return plural(Math.trunc(days / 30.44), 'month');
  return plural(Math.trunc(days / 365.25), 'year');
}

module.exports = {formatBytes, formatAgo};
