// Dandy TV as a kiosk app. Called by the class TV (/tv/<gym>) and the lobby TV (/lobby/<gym>).
// - Remembers the gym, so the installed app (start_url /tv/ or /lobby/) opens straight to it.
// - Keeps the screen awake, hides the cursor when nobody is touching, and goes full screen on the first tap.
// - Shows an Install button whenever the browser offers it, so a TV becomes a full screen app in one tap.
// - Reloads itself every night at 3am so a screen that runs for weeks stays fresh.
export function install(X) {
  const KEY = k => 'dsi.kiosk.' + k;
  let wake = null, hideT = null, btn = null, nightly = null, on = false;
  const installed = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
  const lockWake = async () => { try { if (navigator.wakeLock && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch {} };
  const cursor = () => { document.body.classList.remove('kioskIdle'); clearTimeout(hideT); hideT = setTimeout(() => document.body.classList.add('kioskIdle'), 4000); };
  const full = () => { if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); };
  const showBtn = () => {
    if (!on || installed() || !window.__dsiInstall || btn) return;
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'kioskInstall';
    btn.innerHTML = '<b>Install Dandy TV</b><span>Opens full screen, every time</span>';
    btn.onclick = async () => { const e = window.__dsiInstall; if (!e) return; e.prompt(); const r = await e.userChoice.catch(() => null); window.__dsiInstall = null; btn.remove(); btn = null; if (r && r.outcome === 'accepted') X.toast && X.toast('Installed. Open Dandy TV from the home screen or app list.'); };
    document.body.appendChild(btn);
  };
  const onTap = () => { cursor(); if (installed() || localStorage.getItem(KEY('full')) !== '0') full(); };
  document.addEventListener('dsi-installable', showBtn);
  document.addEventListener('visibilitychange', () => { if (on && document.visibilityState === 'visible') lockWake(); });
  X.kiosk = {
    start(kind, key) {
      try { if (key) localStorage.setItem(KEY(kind), key); } catch {}
      if (on) return; on = true;
      document.body.classList.add('kiosk', installed() ? 'kioskApp' : 'kioskWeb');
      lockWake(); cursor(); showBtn();
      addEventListener('pointermove', cursor); addEventListener('pointerdown', onTap); addEventListener('keydown', cursor);
      if (installed()) full();
      // A nightly reload at 3am picks up new code and a new day without anyone touching the TV.
      const at3 = new Date(); at3.setHours(27, 0, 0, 0);
      nightly = setTimeout(() => location.reload(), at3 - Date.now());
    },
    stop() {
      if (!on) return; on = false;
      document.body.classList.remove('kiosk', 'kioskApp', 'kioskWeb', 'kioskIdle');
      removeEventListener('pointermove', cursor); removeEventListener('pointerdown', onTap); removeEventListener('keydown', cursor);
      clearTimeout(hideT); clearTimeout(nightly); if (btn) { btn.remove(); btn = null; }
      try { wake && wake.release(); } catch {} wake = null;
    },
    saved(kind) { try { return localStorage.getItem(KEY(kind)) || ''; } catch { return ''; } },
  };
}
