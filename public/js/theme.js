// Hell/Dunkel: ohne eigene Wahl folgt die App dem System. Eine Wahl über den
// Umschalter wird gemerkt und setzt data-theme auf <html>.
const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');

function getStoredTheme() {
  try { return localStorage.getItem('theme'); } catch (e) { return null; }
}

function getEffectiveTheme() {
  const stored = getStoredTheme();
  if (stored === 'light' || stored === 'dark') return stored;
  return themeMedia.matches ? 'dark' : 'light';
}

function syncThemeUi() {
  const dark = getEffectiveTheme() === 'dark';
  document.querySelectorAll('#sw-dark').forEach(sw => sw.setAttribute('aria-checked', dark));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || (dark ? '#0B0F1A' : '#F4F6FA'));
}

function toggleTheme() {
  const next = getEffectiveTheme() === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('theme', next); } catch (e) {}
  document.documentElement.dataset.theme = next;
  syncThemeUi();
  document.dispatchEvent(new CustomEvent('themechange'));
}

document.querySelectorAll('.theme-toggle, #sw-dark').forEach(btn => btn.addEventListener('click', toggleTheme));
themeMedia.addEventListener('change', () => {
  if (getStoredTheme()) return;
  syncThemeUi();
  document.dispatchEvent(new CustomEvent('themechange'));
});
syncThemeUi();
