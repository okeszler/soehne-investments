function getEffectiveTheme() {
  return localStorage.getItem('theme') || 'light';
}

function updateThemeToggleIcons() {
  const theme = getEffectiveTheme();
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.textContent = theme === 'light' ? '☀️' : '🌙';
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F1F5F7' : '#2A3132');
}

function toggleTheme() {
  const next = getEffectiveTheme() === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  document.documentElement.dataset.theme = next;
  updateThemeToggleIcons();
  document.dispatchEvent(new CustomEvent('themechange'));
}

document.querySelectorAll('.theme-toggle').forEach(btn => {
  btn.addEventListener('click', toggleTheme);
});

updateThemeToggleIcons();
