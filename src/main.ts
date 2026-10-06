import './styles.css';
import { App } from './app';

window.addEventListener('error', (e) => {
  console.error('[BlockForge] uncaught error:', e.message, e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[BlockForge] unhandled promise rejection:', e.reason);
});

const app = new App();
app.boot().catch((e) => {
  console.error('[BlockForge] boot failed', e);
  const ui = document.getElementById('ui');
  if (ui) ui.innerHTML = `<div class="screen solid"><div class="panel"><h2>BlockForge failed to start</h2><p class="muted">${String(e instanceof Error ? e.message : e)}</p></div></div>`;
});

if (!__SINGLE_FILE__ && 'serviceWorker' in navigator && import.meta.env.PROD && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[BlockForge] service worker registration failed', e));
  });
}
