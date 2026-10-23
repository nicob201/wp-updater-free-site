// The few things the landing does: copy buttons, the GitHub star count, the demo's version and its reset.
// Without this file every link still works and every command can be selected by hand.
const $$ = selector => document.querySelectorAll(selector);
const lang = document.documentElement.lang;

const COPIED = { en: 'Copied', es: 'Copiado' }[lang];
for (const button of $$('[data-copy]')) {
  const label = button.textContent;
  button.addEventListener('click', () => {
    navigator.clipboard.writeText(button.dataset.copy).then(() => {
      button.textContent = COPIED;
      setTimeout(() => { button.textContent = label; }, 2000);
    }, () => getSelection().selectAllChildren(button.previousElementSibling));   // no clipboard: select it to copy by hand
  });
}

// GitHub allows 60 of these an hour per visitor without a token: if it says no, the button just has no number
fetch('https://api.github.com/repos/nicob201/wp-updater-free')
  .then(res => (res.ok ? res.json() : null))
  .then(repo => {
    if (!(Number.isInteger(repo?.stargazers_count) && repo.stargazers_count > 0)) return;   // "0" asks for nothing
    for (const el of $$('[data-stars]')) el.textContent = repo.stargazers_count.toLocaleString(lang);
  })
  .catch(() => {});

fetch('/demo/version.txt')
  .then(res => (res.ok ? res.text() : ''))
  .then(version => { for (const el of $$('[data-version]')) el.textContent = version.trim(); })
  .catch(() => {});

// The demo keeps everything in memory: loading it again starts over
document.getElementById('demo-reset')?.addEventListener('click', () => document.getElementById('demo-frame').contentWindow.location.reload());
