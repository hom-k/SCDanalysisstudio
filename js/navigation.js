(() => {
  const button = document.getElementById('siteMenuButton');
  const panel = document.getElementById('siteMenuPanel');
  if (!button || !panel) return;
  const close = () => { panel.classList.add('hidden'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-label', 'メニューを開く'); };
  const open = () => { panel.classList.remove('hidden'); button.setAttribute('aria-expanded', 'true'); button.setAttribute('aria-label', 'メニューを閉じる'); };
  button.addEventListener('click', event => { event.stopPropagation(); panel.classList.contains('hidden') ? open() : close(); });
  panel.addEventListener('click', event => { if (event.target.closest('a')) close(); });
  document.addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
})();
