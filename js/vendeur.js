/* ============================================================
   vendeur.js — Inventaire Pro : générateur de clés de licence INTÉGRÉ.
   Caché derrière un appui long (ou 5 appuis) sur le numéro de version.
   La clé privée n'est JAMAIS dans le code : le vendeur la colle une
   fois, elle est chiffrée (AES-GCM + passphrase, PBKDF2) et gardée
   sur son seul appareil.
   ============================================================ */
const Vendeur = (() => {

  const VKEY = 'inventaire.vendeur';   // blob chiffré {salt, iv, ct}
  let privInMemory = null;             // clé privée déchiffrée, mémoire de session seulement

  const b64  = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => { const bin=atob(s); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a; };
  const b64url = buf => b64(buf).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const toast = m => { if (window.App && App.toast) App.toast(m); };

  function hasKey(){ try{ return !!localStorage.getItem(VKEY); }catch(e){ return false; } }

  async function deriveKey(pass, salt){
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'PBKDF2', salt, iterations:150000, hash:'SHA-256' },
      km, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  }
  async function storePriv(jwkStr, pass){
    JSON.parse(jwkStr);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const key  = await deriveKey(pass, salt);
    const ct   = await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, new TextEncoder().encode(jwkStr));
    localStorage.setItem(VKEY, JSON.stringify({ salt:b64(salt), iv:b64(iv), ct:b64(ct) }));
  }
  async function unlockPriv(pass){
    const blob = JSON.parse(localStorage.getItem(VKEY));
    const key  = await deriveKey(pass, unb64(blob.salt));
    const pt   = await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(blob.iv)}, key, unb64(blob.ct));
    return new TextDecoder().decode(pt); // throw si mauvaise passphrase
  }
  // signe l'e-mail normalisé — DOIT être identique à licence.js (trim + minuscules)
  async function signEmail(jwkStr, email){
    const jwk = JSON.parse(jwkStr);
    const key = await crypto.subtle.importKey('jwk', jwk, {name:'ECDSA',namedCurve:'P-256'}, false, ['sign']);
    const em = (email||'').trim().toLowerCase();
    const sig = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, key, new TextEncoder().encode(em));
    return b64url(new Uint8Array(sig));
  }

  const CSS = `
  .ven-back{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;
    background:rgba(4,7,14,.9);backdrop-filter:blur(6px);padding:20px}
  .ven-card{width:min(480px,94vw);max-height:90vh;overflow:auto;background:var(--panel-2,#101a2a);
    border:1px solid var(--line-hot,rgba(34,211,238,.5));border-radius:8px;padding:24px;
    font-family:var(--sans,"Segoe UI",sans-serif);color:var(--txt,#e4edfa)}
  .ven-card h3{margin:0 0 8px;font-size:18px}
  .ven-card p{margin:0 0 12px;font-size:12.5px;line-height:1.5;color:var(--dim,#7f95b4)}
  .ven-f{display:block;margin:0 0 12px}
  .ven-f span{display:block;font-size:11px;color:var(--dim,#7f95b4);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em}
  .ven-f input,.ven-f textarea{width:100%;background:rgba(4,7,14,.7);border:1px solid var(--line,rgba(90,135,185,.28));
    border-radius:4px;color:var(--txt,#e4edfa);font-size:13px;padding:10px;font-family:var(--mono,monospace);outline:none}
  .ven-f textarea{min-height:90px;resize:vertical}
  .ven-row{display:flex;gap:10px;margin-top:6px}
  .ven-btn{flex:1;border:none;border-radius:4px;padding:11px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--sans,sans-serif)}
  .ven-btn.p{background:linear-gradient(120deg,var(--cyan,#22d3ee),var(--blue,#3b82f6));color:#04070e}
  .ven-btn.g{background:rgba(90,135,185,.14);color:var(--txt,#e4edfa)}
  .ven-st{min-height:16px;font-size:12px;color:var(--dim,#7f95b4);margin:2px 0 8px}
  .ven-out{margin-top:12px;background:rgba(4,7,14,.7);border:1px solid var(--line-hot,rgba(34,211,238,.5));border-radius:4px;padding:12px;display:none}
  .ven-out .k{word-break:break-all;font-family:var(--mono,monospace);font-size:13px;color:var(--cyan,#22d3ee)}
  `;
  function ensureCSS(){ if(document.getElementById('ven-css'))return; const s=document.createElement('style'); s.id='ven-css'; s.textContent=CSS; document.head.appendChild(s); }

  function open(){
    ensureCSS();
    const back = document.createElement('div'); back.className='ven-back';
    back.innerHTML = `<div class="ven-card"><div id="ven-body"></div></div>`;
    document.body.appendChild(back);
    const close=()=>back.remove();
    back.addEventListener('click', e=>{ if(e.target===back) close(); });
    const body = back.querySelector('#ven-body');
    if (privInMemory) return viewGenerate(body, close);
    if (hasKey())      return viewUnlock(body, close);
    return viewSetup(body, close);
  }

  function viewSetup(body, close){
    body.innerHTML = `
      <h3>🔑 Mode vendeur — installation</h3>
      <p>Colle ta clé privée de signature (JWK, depuis secrets/inventaire-licence.json). Elle sera chiffrée et gardée sur ce seul PC, jamais en clair, jamais dans le code.</p>
      <label class="ven-f"><span>Clé privée (JWK)</span>
        <textarea id="ven-priv" placeholder='{"kty":"EC","d":"...","x":"...","y":"...","crv":"P-256"}'></textarea></label>
      <label class="ven-f"><span>Choisis une passphrase</span>
        <input type="password" id="ven-pass" placeholder="mot de passe vendeur"></label>
      <div class="ven-st" id="ven-st"></div>
      <div class="ven-row"><button class="ven-btn g" id="ven-cancel">Annuler</button><button class="ven-btn p" id="ven-save">Enregistrer (chiffré)</button></div>`;
    body.querySelector('#ven-cancel').addEventListener('click', close);
    body.querySelector('#ven-save').addEventListener('click', async ()=>{
      const priv = body.querySelector('#ven-priv').value.trim();
      const pass = body.querySelector('#ven-pass').value;
      const st = body.querySelector('#ven-st');
      if (!priv || !pass){ st.textContent='Clé privée et passphrase requises.'; return; }
      try{ await storePriv(priv, pass); privInMemory = priv; toast('Clé vendeur enregistrée 🔒'); viewGenerate(body, close); }
      catch(e){ st.textContent='Clé privée invalide (JSON incorrect).'; }
    });
  }

  function viewUnlock(body, close){
    body.innerHTML = `
      <h3>🔑 Mode vendeur</h3>
      <p>Déverrouille ta clé de signature pour générer une licence.</p>
      <label class="ven-f"><span>Passphrase vendeur</span>
        <input type="password" id="ven-pass" placeholder="mot de passe vendeur"></label>
      <div class="ven-st" id="ven-st"></div>
      <div class="ven-row"><button class="ven-btn g" id="ven-forget">Oublier la clé</button><button class="ven-btn p" id="ven-unlock">Déverrouiller</button></div>`;
    body.querySelector('#ven-forget').addEventListener('click', ()=>{
      if (confirm('Supprimer la clé vendeur de ce PC ?')){ localStorage.removeItem(VKEY); privInMemory=null; close(); toast('Clé vendeur supprimée'); }
    });
    body.querySelector('#ven-unlock').addEventListener('click', async ()=>{
      const pass = body.querySelector('#ven-pass').value; const st = body.querySelector('#ven-st');
      if (!pass){ st.textContent='Entre ta passphrase.'; return; }
      st.textContent='Déverrouillage…';
      try{ privInMemory = await unlockPriv(pass); viewGenerate(body, close); }
      catch(e){ st.textContent='❌ Passphrase incorrecte.'; }
    });
  }

  function viewGenerate(body, close){
    body.innerHTML = `
      <h3>🔑 Générer une licence</h3>
      <p>Entre l'e-mail que le client t'a communiqué à l'achat. La clé sera liée à cet e-mail (valable sur tous ses PC).</p>
      <label class="ven-f"><span>E-mail du client</span>
        <input type="email" id="ven-email" placeholder="ex. client@mail.com" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="ven-row"><button class="ven-btn p" id="ven-gen">Générer la clé</button></div>
      <div class="ven-out" id="ven-out"></div>
      <div class="ven-row" style="margin-top:12px"><button class="ven-btn g" id="ven-done">Fermer</button></div>`;
    body.querySelector('#ven-done').addEventListener('click', close);
    body.querySelector('#ven-gen').addEventListener('click', async ()=>{
      const email = body.querySelector('#ven-email').value.trim();
      const out = body.querySelector('#ven-out');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ out.style.display='block'; out.textContent='Entre un e-mail valide.'; return; }
      try{
        const licence = await signEmail(privInMemory, email);
        out.style.display='block';
        out.innerHTML = `<div style="font-size:12px;color:var(--dim);margin-bottom:6px">Clé pour <b style="color:var(--txt)">${email.toLowerCase()}</b> (copiée). Envoie e-mail + clé au client :</div><div class="k">${licence}</div>`;
        if (navigator.clipboard) navigator.clipboard.writeText(licence);
        toast('Clé générée et copiée');
      }catch(e){ out.style.display='block'; out.textContent='Erreur : '+e.message; }
    });
  }

  // Ouvre le mode vendeur : appui long (~800 ms) OU 5 clics rapides.
  function bindLongPress(el){
    if (!el) return;
    el.style.userSelect='none'; el.style.webkitUserSelect='none'; el.style.cursor='default';
    el.addEventListener('contextmenu', e=>e.preventDefault());
    let timer=null;
    const start=()=>{ clearTimeout(timer); timer=setTimeout(open, 800); };
    const cancel=()=>{ clearTimeout(timer); };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    let taps=0, tapTimer=null;
    el.addEventListener('click', ()=>{ taps++; clearTimeout(tapTimer); tapTimer=setTimeout(()=>{taps=0;},800); if(taps>=5){taps=0;clearTimeout(tapTimer);open();} });
  }

  return { open, bindLongPress, hasKey };
})();
window.Vendeur = Vendeur;
