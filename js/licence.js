/* ============================================================
   licence.js — Inventaire Pro
   Activation directe à l'achat. La licence "coeur" est une SIGNATURE
   ECDSA P-256 de l'E-MAIL d'achat (normalisé), vérifiée HORS-LIGNE
   avec la clé publique ci-dessous. La clé PRIVÉE n'est JAMAIS dans
   l'app.

   Deux façons d'obtenir cette licence ECDSA :
   1) Clé ECDSA directe : générée par le mode vendeur (secours) ou
      déjà distribuée. Vérifiée 100 % hors-ligne, sans serveur.
   2) Clé plateforme (Payhip / Gumroad) : envoyée automatiquement au
      client après paiement. L'app la transmet une fois au Worker
      sécurisé, qui vérifie (e-mail, produit, non remboursé) et
      renvoie une licence ECDSA équivalente, stockée puis vérifiée
      hors-ligne comme la précédente.

   Révocation remboursement : re-vérification au plus 1×/jour quand
   l'app est en ligne, avec période de grâce. Tolérante aux pannes
   (fail-open) : jamais de blocage sur une erreur réseau/Worker.
   ============================================================ */
const Licence = (() => {

  // Clé PUBLIQUE de vérification (la privée reste dans le Worker + secrets/).
  const PUB = { kty:'EC', crv:'P-256',
    x:'K6BOQgLcNTq46xDbpso2Ar3Zr6n_n9S7Ox9ym6-LWKo',
    y:'OqPGVc7_2-rQ4ipoII22UoCyYcblM5Xfy1IxG2ucSa4' };

  // Worker sécurisé (à mettre à jour avec l'URL réelle au déploiement).
  const WORKER_URL = 'https://inventaire-licence.contactweb71.workers.dev';

  const LKEY = 'inventaire.lic';
  const DAY = 24 * 60 * 60 * 1000;   // re-vérif au plus 1×/jour
  const GRACE_MS = 3 * DAY;          // grâce après remboursement confirmé

  let state = null;
  let verified = false;

  const normEmail = e => (e || '').trim().toLowerCase();

  function load(){
    try{ state = JSON.parse(localStorage.getItem(LKEY)); }catch(e){ state = null; }
    if (!state || typeof state !== 'object') state = { email:null, key:null };
    // champs additionnels (rétro-compat : absents sur les anciennes licences)
    if (!('platform' in state)) state.platform = null;
    if (!('platformKey' in state)) state.platformKey = null;
    if (!('lastCheck' in state)) state.lastCheck = 0;
    if (!('revokedSince' in state)) state.revokedSince = 0;
  }
  function save(){ try{ localStorage.setItem(LKEY, JSON.stringify(state)); }catch(e){} }

  function isLicensed(){ return verified; }
  function licensedEmail(){ return verified ? state.email : null; }

  function b64urlToBuf(s){
    s = s.replace(/-/g,'+').replace(/_/g,'/'); while (s.length % 4) s += '=';
    const bin = atob(s); const buf = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) buf[i] = bin.charCodeAt(i);
    return buf;
  }

  async function verify(keyB64, email){
    try{
      const pub = await crypto.subtle.importKey('jwk', PUB, {name:'ECDSA',namedCurve:'P-256'}, false, ['verify']);
      const sig = b64urlToBuf((keyB64||'').trim());
      const data = new TextEncoder().encode(normEmail(email));
      return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'}, pub, sig, data);
    }catch(e){ return false; }
  }

  async function init(){
    load();
    verified = (state.key && state.email) ? await verify(state.key, state.email) : false;
    // révocation : re-vérif en tâche de fond (ne bloque jamais le démarrage)
    if (verified && state.platform && state.platformKey) {
      maybeRecheck();  // async, fail-open
    }
    return verified;
  }

  // Active une licence : ECDSA hors-ligne d'abord, sinon via le Worker.
  // Renvoie { ok:true } ou { ok:false, reason }.
  async function activate(email, keyStr){
    const e = normEmail(email);
    const k = (keyStr||'').trim();
    // 1) clé ECDSA directe (vendeur / déjà distribuée) : vérif hors-ligne
    if (await verify(k, e)){
      state = { email:e, key:k, platform:null, platformKey:null, lastCheck:0, revokedSince:0 };
      save(); verified = true;
      return { ok:true, mode:'ecdsa' };
    }
    // 2) clé plateforme : on demande au Worker de vérifier + signer
    let r;
    try{
      const resp = await fetch(WORKER_URL + '/activate', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email:e, licenseKey:k })
      });
      r = await resp.json();
    }catch(err){
      return { ok:false, reason:'network' };  // le Worker est injoignable
    }
    if (!r || r.ok !== true || !r.key) return { ok:false, reason:(r && r.reason) || 'refused' };
    // double sécurité : la licence renvoyée doit vraiment vérifier
    if (!(await verify(r.key, e))) return { ok:false, reason:'bad_signature' };
    state = { email:e, key:r.key, platform:r.platform||'plateforme', platformKey:k, lastCheck:Date.now(), revokedSince:0 };
    save(); verified = true;
    return { ok:true, mode:'worker' };
  }

  // Re-vérification révocation (remboursement). Max 1×/jour, fail-open.
  async function maybeRecheck(){
    if (!state.platform || !state.platformKey) return;      // clés manuelles : jamais révoquées
    if (Date.now() - (state.lastCheck||0) < DAY) return;    // au plus 1×/jour
    if (navigator.onLine === false) return;                 // hors-ligne : on ne touche à rien
    let r;
    try{
      const resp = await fetch(WORKER_URL + '/recheck', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ platform:state.platform, licenseKey:state.platformKey, email:state.email })
      });
      r = await resp.json();
    }catch(err){
      return;  // fail-open : panne réseau/Worker => on ne bloque JAMAIS
    }
    state.lastCheck = Date.now();
    if (!r || r.ok !== true){ save(); return; }             // réponse douteuse => on laisse passer
    if (r.valid){
      state.revokedSince = 0;                                // toujours valide
      save();
      return;
    }
    // remboursement confirmé : démarre la grâce, verrouille seulement après
    if (!state.revokedSince) state.revokedSince = Date.now();
    save();
    if (Date.now() - state.revokedSince > GRACE_MS){
      verified = false; save();
      if (window.onLicenseRevoked) window.onLicenseRevoked();
    }
  }

  /* ---------- Écran d'activation (overlay bloquant) ---------- */
  const CSS = `
  .lic-back{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
    background:rgba(4,7,14,.86);backdrop-filter:blur(6px);padding:20px}
  .lic-card{width:min(460px,94vw);background:var(--panel-2,#101a2a);border:1px solid var(--line-hot,rgba(34,211,238,.5));
    border-radius:8px;padding:26px 24px;box-shadow:var(--glow-cyan,0 0 22px rgba(34,211,238,.28)),0 24px 60px rgba(0,0,0,.6);
    font-family:var(--sans,"Segoe UI",sans-serif);color:var(--txt,#e4edfa)}
  .lic-badge{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono,monospace);font-size:11px;
    letter-spacing:.14em;color:var(--cyan,#22d3ee);text-transform:uppercase;margin-bottom:12px}
  .lic-dot{width:7px;height:7px;border-radius:50%;background:var(--cyan,#22d3ee);box-shadow:0 0 8px var(--cyan,#22d3ee)}
  .lic-card h2{margin:0 0 6px;font-size:22px;font-weight:800}
  .lic-card p{margin:0 0 14px;font-size:13px;line-height:1.55;color:var(--dim,#7f95b4)}
  .lic-field{display:block;margin:0 0 12px}
  .lic-field span{display:block;font-size:11px;letter-spacing:.05em;color:var(--dim,#7f95b4);margin-bottom:5px;text-transform:uppercase}
  .lic-field input{width:100%;background:rgba(4,7,14,.7);border:1px solid var(--line,rgba(90,135,185,.28));border-radius:4px;
    color:var(--txt,#e4edfa);font-size:14px;padding:11px 12px;font-family:var(--sans,sans-serif);outline:none}
  .lic-field input:focus{border-color:var(--cyan,#22d3ee);box-shadow:0 0 0 2px var(--cyan-soft,rgba(34,211,238,.14))}
  .lic-status{min-height:18px;font-size:12.5px;margin:2px 0 12px;color:var(--dim,#7f95b4)}
  .lic-status.err{color:var(--red,#fb7185)} .lic-status.ok{color:var(--green,#34d399)}
  .lic-btn{width:100%;border:none;border-radius:4px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;
    background:linear-gradient(120deg,var(--cyan,#22d3ee),var(--blue,#3b82f6));color:#04070e;font-family:var(--sans,sans-serif)}
  .lic-btn:disabled{opacity:.55;cursor:default}
  .lic-buy{margin-top:14px;font-size:12px;color:var(--dim-2,#566b85);text-align:center}
  .lic-buy-2{margin-top:6px}
  .lic-buy a{color:var(--cyan,#22d3ee);text-decoration:none}
  .lic-ver{margin-top:16px;text-align:center;font-family:var(--mono,monospace);font-size:11px;color:var(--dim-2,#566b85);
    letter-spacing:.08em;user-select:none;cursor:default}
  `;
  function ensureCSS(){
    if (document.getElementById('lic-css')) return;
    const s = document.createElement('style'); s.id='lic-css'; s.textContent=CSS; document.head.appendChild(s);
  }

  const REASONS = {
    email_mismatch: "L'e-mail ne correspond pas à celui de l'achat.",
    refunded: "Cet achat a été remboursé ou annulé.",
    wrong_product: "Cette clé n'est pas celle d'Inventaire Pro.",
    rate_ip: "Trop de tentatives. Réessaie dans quelques minutes.",
    rate_key: "Trop de tentatives sur cette clé. Réessaie plus tard.",
    network: "Impossible de joindre le service d'activation. Vérifie ta connexion et réessaie.",
    platform_error: "Le service de la plateforme est indisponible. Réessaie dans un instant.",
    bad_signature: "Réponse d'activation invalide. Réessaie.",
    invalid: "Clé inconnue. Vérifie la clé reçue par e-mail.",
    invalid_or_refunded: "Clé invalide ou achat remboursé.",
    refused: "E-mail ou clé incorrects."
  };

  function openSheet(blocking){
    ensureCSS();
    const back = document.createElement('div'); back.className='lic-back';

    if (verified){
      back.innerHTML = `<div class="lic-card">
        <div class="lic-badge"><span class="lic-dot"></span>Licence active</div>
        <h2>✓ Version complète active</h2>
        <p>Inventaire Pro est débloqué à vie sur ce PC pour <b style="color:var(--txt)">${escHtml(state.email||'')}</b>. Merci !</p>
        <button class="lic-btn" id="lic-close">Fermer</button>
        <div class="lic-ver" id="lic-ver">Inventaire Pro v${window.APP_VERSION||'1.0'}</div>
      </div>`;
      document.body.appendChild(back);
      const close=()=>back.remove();
      back.addEventListener('click', e=>{ if(e.target===back) close(); });
      back.querySelector('#lic-close').addEventListener('click', close);
      if (window.Vendeur) Vendeur.bindLongPress(back.querySelector('#lic-ver'));
      return;
    }

    back.innerHTML = `<div class="lic-card">
      <div class="lic-badge"><span class="lic-dot"></span>Activation requise</div>
      <h2>Activer Inventaire Pro</h2>
      <p>Saisis l'e-mail de ton achat et la clé de licence qui t'a été envoyée après ton achat (par e-mail ou par message, selon la boutique). La clé est liée à ton e-mail : elle marche sur tous tes PC, même après une réinstallation.</p>
      <label class="lic-field"><span>E-mail d'achat</span>
        <input type="email" id="lic-email" placeholder="ton.email@exemple.com" autocomplete="email" autocapitalize="off" spellcheck="false"></label>
      <label class="lic-field"><span>Clé de licence</span>
        <input type="text" id="lic-key" placeholder="Colle ta clé ici" autocomplete="off" spellcheck="false"></label>
      <div class="lic-status" id="lic-st"></div>
      <button class="lic-btn" id="lic-go">Débloquer à vie</button>
      <div class="lic-buy">Pas encore de licence ? <a href="https://generationapp.fr/applications/inventaire-pro/" target="_blank" rel="noopener">Obtenir ma licence</a></div>
      <div class="lic-buy lic-buy-2">Une question avant d'acheter ? <a href="https://generationapp.fr/contact/" target="_blank" rel="noopener">Nous écrire</a></div>
      <div class="lic-ver" id="lic-ver">Inventaire Pro v${window.APP_VERSION||'1.0'}</div>
    </div>`;
    document.body.appendChild(back);
    const close=()=>back.remove();
    if (!blocking){ back.addEventListener('click', e=>{ if(e.target===back) close(); }); }
    if (window.Vendeur) Vendeur.bindLongPress(back.querySelector('#lic-ver'));

    const email = back.querySelector('#lic-email');
    const key = back.querySelector('#lic-key');
    const st = back.querySelector('#lic-st');
    const go = back.querySelector('#lic-go');
    email.focus();
    go.addEventListener('click', async ()=>{
      const e = email.value.trim(), k = key.value.trim();
      st.className='lic-status';
      if (!e){ st.classList.add('err'); st.textContent='Saisis ton e-mail d\'achat.'; return; }
      if (!k){ st.classList.add('err'); st.textContent='Colle ta clé de licence.'; return; }
      st.textContent='Vérification…'; go.disabled=true;
      const res = await activate(e, k);
      go.disabled=false;
      if (res.ok){
        st.classList.add('ok'); st.textContent='✓ Débloqué à vie, merci !';
        setTimeout(()=>{ back.remove(); if (window.onLicensed) window.onLicensed(); }, 700);
      } else {
        st.classList.add('err'); st.textContent='❌ ' + (REASONS[res.reason] || 'E-mail ou clé incorrects.');
      }
    });
    key.addEventListener('keydown', e=>{ if(e.key==='Enter') go.click(); });
  }

  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function gate(){ if (!verified) openSheet(true); }
  function openActivate(){ openSheet(false); }

  return { init, gate, isLicensed, licensedEmail, openActivate, activate, maybeRecheck };
})();
window.Licence = Licence;
