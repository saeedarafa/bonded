// /j/{code} invite fallback (W1.14-W1.16). No analytics, no network: the code and token never leave this page except into the bonded:// link.
(() => {
  // Real route: /j/BND4827?t=<token>. Prototype: ?c=BND4827&state=invalid|desktop
  const qs = new URLSearchParams(location.search);
  const raw = (location.pathname.match(/\/j\/([^/?#]+)/)||[])[1] || '';
  const m = /^BND(\d{4})$/i.exec(raw);
  if (!m) document.body.classList.add('invalid');
  else {
    const digits = m[1];
    document.getElementById('code').textContent = 'BND·' + digits;
    // never log, store or send the token; pass it straight to the app
    const t = qs.get('t');
    document.getElementById('open').href = 'bonded://j/BND' + digits + (t ? '?t=' + encodeURIComponent(t) : '');
    document.getElementById('copy').onclick = async e => { try { await navigator.clipboard.writeText('BND' + digits); e.target.textContent = 'Copied'; } catch (_) {} };
  }
  if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) document.body.classList.add('desk');
})();
