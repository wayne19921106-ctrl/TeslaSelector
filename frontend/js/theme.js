// 主題：auto（依系統深淺色設定）/ light / dark。在 <head> 同步載入，避免載入時閃爍。
(function () {
  const AV = (window.AV = window.AV || {});
  const KEY = 'av.theme';
  const MODES = ['auto', 'light', 'dark'];
  const mq = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'auto';
  try { const s = localStorage.getItem(KEY); if (MODES.includes(s)) mode = s; } catch (e) { /* 預設 auto */ }

  const listeners = [];
  const effective = () => (mode === 'auto' ? (mq.matches ? 'dark' : 'light') : mode);
  function apply() {
    const root = document.documentElement;
    if (mode === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = effective() === 'dark' ? '#0d1013' : '#e7eaee';
    listeners.forEach((fn) => fn(effective(), mode));
  }
  mq.addEventListener ? mq.addEventListener('change', () => mode === 'auto' && apply()) : mq.addListener(() => mode === 'auto' && apply());

  AV.theme = {
    modes: MODES,
    get mode() { return mode; },
    get effective() { return effective(); },
    set(next) {
      if (!MODES.includes(next)) return;
      mode = next;
      try { localStorage.setItem(KEY, next); } catch (e) { /* 只在本頁有效 */ }
      apply();
    },
    /** auto → light → dark → auto */
    cycle() { this.set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]); },
    onChange(fn) { listeners.push(fn); }
  };
  apply();
})();
