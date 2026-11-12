// 導購連結、Google Analytics 與廣告版位。設定都在 js/config.js。
(function () {
  const AV = (window.AV = window.AV || {});
  const cfg = window.APP_CONFIG || {};
  const t = (k, v) => (AV.i18n ? AV.i18n.t(k, v) : k);

  /* ---------- Google Analytics 4 ---------- */
  const gaId = ((cfg.analytics || {}).gaMeasurementId || '').trim();
  if (/^G-[A-Z0-9]+$/i.test(gaId)) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', gaId);
    const s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(gaId);
    document.head.appendChild(s);
  }
  /** 送出 GA 事件；沒有設定 GA 時不做任何事。 */
  function track(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  }

  /* ---------- 導購連結 ---------- */
  const refs = cfg.referrals || {};
  const usable = (u) => !!u && u !== '#';
  function wireReferrals(root) {
    (root || document).querySelectorAll('a[data-ref]').forEach((a) => {
      if (a.dataset.wired) return;
      a.dataset.wired = '1';
      const url = (refs[a.dataset.ref] || {}).url || '#';
      a.href = url;
      if (usable(url)) { a.target = '_blank'; a.rel = 'sponsored noopener'; }
      a.addEventListener('click', (e) => {
        if (!usable(url)) e.preventDefault();
        track('referral_click', { partner: a.dataset.ref, placement: a.dataset.place || '' });
      });
    });
  }

  /* ---------- 廣告版位 ---------- */
  const adsCfg = cfg.ads || {};
  let preview = false;
  try { preview = new URLSearchParams(location.search).get('ads') === 'preview'; } catch (e) { /* 忽略 */ }
  const adOn = (slot) => (adsCfg.enabled || preview) && (adsCfg.slots || []).includes(slot);

  /** 填入版位內容。目前只有預覽佔位框；接上廣告聯播網時在這裡渲染實際廣告。 */
  function renderAd(el) {
    const slot = el.dataset.ad;
    el.hidden = !adOn(slot);
    if (el.hidden) return;
    el.setAttribute('aria-label', t('ad'));
    if (preview && !el.dataset.filled) {
      el.classList.add('preview');
      el.innerHTML = `<b>${t('ad.slot')} · ${slot}</b><span class="size"></span>`;
    }
    el.dataset.filled = '1';
  }

  // banner 版位：網頁版在 3D 區底部，平板／手機在抽屜底部
  const wide = matchMedia('(min-width: 1025px)');
  function placeBanner() {
    const b = document.querySelector('[data-ad="banner"]');
    const host = document.querySelector(wide.matches ? '#bannerWide' : '#bannerSheet');
    if (b && host && b.parentNode !== host) host.appendChild(b);
    document.querySelectorAll('#bannerWide, #bannerSheet').forEach((h) => (h.hidden = !h.querySelector('[data-ad]:not([hidden])')));
  }

  function init() {
    wireReferrals();
    document.querySelectorAll('[data-ad]').forEach(renderAd);
    placeBanner();
    wide.addEventListener ? wide.addEventListener('change', placeBanner) : wide.addListener(placeBanner);
  }

  AV.site = { track, adOn, renderAd, wireReferrals, init, adPreview: preview };
})();
