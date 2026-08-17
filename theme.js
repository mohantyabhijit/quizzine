const themeStorageKey = 'quizzine-theme';
const themeToggle = document.querySelector('.theme-toggle');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function currentTheme() {
  return document.documentElement.dataset.theme || (prefersDark.matches ? 'dark' : 'light');
}

function updateToggle() {
  const dark = currentTheme() === 'dark';
  themeToggle.setAttribute('aria-checked', String(dark));
  themeToggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
  themeToggle.querySelector('.theme-toggle-label').textContent = dark ? 'Light mode' : 'Dark mode';
}

themeToggle.addEventListener('click', () => {
  const theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(themeStorageKey, theme); } catch {}
  updateToggle();
});

prefersDark.addEventListener('change', () => {
  if (!document.documentElement.dataset.theme) updateToggle();
});

updateToggle();
