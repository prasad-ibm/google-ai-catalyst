/* ==========================================================================
 * Google AI Catalyst — shared auth UI
 * Injects the logged-in user + a Logout button into the page header, and
 * redirects to the login page if the session is invalid.
 * Include on every page:  <script src="assets/auth-ui.js" defer></script>
 * ========================================================================== */
(function () {
  'use strict';

  function redirectToLogin() {
    // Avoid a loop if we're already on the login page.
    if (!/login\.html$/.test(location.pathname)) {
      location.href = 'login.html';
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) { /* ignore network errors — still redirect */ }
    location.href = 'login.html';
  }

  function buildUi(username) {
    var right = document.querySelector('.gc-header__right');
    if (!right || document.getElementById('gc-auth-box')) return;

    var box = document.createElement('span');
    box.id = 'gc-auth-box';
    box.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:4px;';

    var who = document.createElement('span');
    who.style.cssText = 'font-size:12px;color:var(--text-muted,#9aa0a6);white-space:nowrap;';
    who.textContent = username ? ('@' + username) : '';

    var btn = document.createElement('button');
    btn.className = 'gc-iconbtn';
    btn.id = 'gc-logout-btn';
    btn.title = 'Log out';
    btn.setAttribute('aria-label', 'Log out');
    btn.style.cssText = 'display:flex;align-items:center;gap:6px;width:auto;padding:0 10px;font-size:12px;';
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Log out</span>';
    btn.addEventListener('click', logout);

    box.appendChild(who);
    box.appendChild(btn);
    right.appendChild(box);
  }

  // On load, confirm the session and populate the header. If unauthenticated,
  // bounce to login (belt-and-suspenders alongside the server-side guard).
  document.addEventListener('DOMContentLoaded', function () {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) { redirectToLogin(); return null; }
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data) return;
        var username = (data && (data.username || (data.user && data.user.username))) || '';
        buildUi(username);
      })
      .catch(function () { /* offline: leave header as-is */ });
  });
})();
