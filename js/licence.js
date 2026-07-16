/* ============================================================
   licence.js — Inventaire Pro
   Activation directe à l'achat : l'app est verrouillée tant qu'une
   licence valide n'est pas saisie. La clé de licence est une SIGNATURE
   ECDSA P-256 de l'E-MAIL d'achat (normalisé : trim + minuscules).
   Elle marche sur n'importe quel PC et survit à une réinstallation
   (le client ressaisit son e-mail + sa clé). La clé PRIVÉE n'est
   JAMAIS dans l'app : seul le vendeur peut signer. L'app ne fait
   que vérifier avec la clé publique ci-dessous.
   ============================================================ */
const Licence = (() => {

  // Clé PUBLIQUE de vérification (la privée reste chez le vendeur, dans secrets/).
  const PUB = { kty:'EC', crv:'P-256',
    x:'K6BOQgLcNTq46xDbpso2Ar3Zr6n_n9S7Ox9ym6-LWKo',
    y:'OqPGVc7_2-rQ4ipoII22UoCyYcblM5Xfy1IxG2ucSa4' };

  const LKEY = 'inventaire.lic';   // {email, key}
  let state = null;
  let verified = false;

  const normEmail = e => (e || '').trim().toLowerCase();

  function load(){
    try{ state = JSON.parse(localStorage.getItem(LKEY)); }catch(e){ state = null; }
    if (!state || typeof state !== 'object') state = { email:null, key:null };
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
    return verified;
  }

  async function activate(email, keyStr){
    const ok = await verify(keyStr, email);
    if (ok){ state.email = normEmail(email); state.key = (keyStr||'').trim(); save(); verified = true; }
    return ok;
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
  .lic-buy a{color:var(--cyan,#22d3ee);text-decoration:none}
  .lic-ver{margin-top:16px;text-align:center;font-family:var(--mono,monospace);font-size:11px;color:var(--dim-2,#566b85);
    letter-spacing:.08em;user-select:none;cursor:default}
  `;
  function ensureCSS(){
    if (document.getElementById('lic-css')) return;
    const s = document.createElement('style'); s.id='lic-css'; s.textContent=CSS; document.head.appendChild(s);
  }

  // Overlay d'activation. blocking=true : impossible de fermer sans activer (app verrouillée).
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
      <p>Saisis l'e-mail de ton achat et la clé de licence qu'on t'a envoyée. La clé est liée à ton e-mail : elle marche sur tous tes PC, même après une réinstallation.</p>
      <label class="lic-field"><span>E-mail d'achat</span>
        <input type="email" id="lic-email" placeholder="ton.email@exemple.com" autocomplete="email" autocapitalize="off" spellcheck="false"></label>
      <label class="lic-field"><span>Clé de licence</span>
        <input type="text" id="lic-key" placeholder="Colle ta clé ici" autocomplete="off" spellcheck="false"></label>
      <div class="lic-status" id="lic-st"></div>
      <button class="lic-btn" id="lic-go">Débloquer à vie</button>
      <div class="lic-buy">Pas encore de licence ? <a href="mailto:contact@generationapp.fr?subject=Achat%20Inventaire%20Pro">Obtenir une clé</a></div>
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
      const ok = await activate(e, k);
      go.disabled=false;
      if (ok){
        st.classList.add('ok'); st.textContent='✓ Débloqué à vie, merci !';
        setTimeout(()=>{ back.remove(); if (window.onLicensed) window.onLicensed(); }, 700);
      } else {
        st.classList.add('err'); st.textContent='❌ E-mail ou clé incorrects.';
      }
    });
    key.addEventListener('keydown', e=>{ if(e.key==='Enter') go.click(); });
  }

  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // Verrouille l'app : ouvre l'overlay bloquant si pas de licence valide.
  function gate(){ if (!verified) openSheet(true); }
  // Bouton "Activer / voir ma licence" accessible à tout moment.
  function openActivate(){ openSheet(false); }

  return { init, gate, isLicensed, licensedEmail, openActivate, activate };
})();
window.Licence = Licence;
