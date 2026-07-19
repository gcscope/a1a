document.documentElement.classList.add('no-transition');
const btn = document.getElementById('themeToggle');
const html = document.documentElement;

function setTheme(theme) {
  html.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  btn.textContent = theme === 'dark' ? 'light mode' : 'dark mode';
}

setTheme(localStorage.getItem('theme') || 'light');
requestAnimationFrame(() => requestAnimationFrame(() => {
  html.classList.remove('no-transition');
}));
btn.addEventListener('click', () => {
  setTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

const acctToggle = document.getElementById('acct-toggle');
const acctPanel = document.getElementById('acct-panel');
acctToggle.addEventListener('click', () => {
  const isOpen = acctPanel.classList.toggle('open');
  acctToggle.setAttribute('aria-expanded', isOpen);
});
document.addEventListener('click', (e) => {
  if (!document.getElementById('acct-widget').contains(e.target)) {
    acctPanel.classList.remove('open');
    acctToggle.setAttribute('aria-expanded', 'false');
  }
});

document.querySelectorAll('.acct-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.acct-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('acct-signup-form').style.display = target === 'signup' ? 'flex' : 'none';
    document.getElementById('acct-login-form').style.display = target === 'login' ? 'flex' : 'none';
  });
});
