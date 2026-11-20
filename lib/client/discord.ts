/* Open Discord message links in the desktop app.
   discord:// is picked up by the installed client; if nothing handles it we
   fall back to the web URL after a short delay. */

export function discordAppLink(url: string): string {
  const m = /^https?:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/(.+)$/i.exec(url || '');
  return m ? `discord://-/channels/${m[1]}` : (url || '');
}

export function openDiscord(url: string): void {
  if (!url) return;
  const app = discordAppLink(url);

  if (app === url) {
    window.open(url, '_blank', 'noopener');
    return;
  }

  let left = false;
  const onLeave = () => { left = true; };
  window.addEventListener('blur', onLeave, { once: true });
  document.addEventListener('visibilitychange', onLeave, { once: true });

  try { location.href = app; } catch { /* ignore */ }

  window.setTimeout(() => {
    window.removeEventListener('blur', onLeave);
    document.removeEventListener('visibilitychange', onLeave);
    if (!left && document.visibilityState === 'visible') {
      window.open(url, '_blank', 'noopener');
    }
  }, 1600);
}
