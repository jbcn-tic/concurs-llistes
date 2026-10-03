(() => {
  'use strict';

  const API = window.PASSAR_LLISTA_API;
  const DEMO = !API || new URLSearchParams(location.search).has('demo');
  const POLL_ESTAT_MS = 3000;
  const POLL_LLISTES_MS = 120000;

  const $ = (sel) => document.querySelector(sel);
  const els = {
    llista: $('#llista'),
    cerca: $('#cerca'),
    colla: $('#filtre-colla'),
    talla: $('#filtre-talla'),
    estat: $('#filtre-estat'),
    sentit: $('#sentit'),
    progressFill: $('#progress-fill'),
    progressText: $('#progress-text'),
    sync: $('#sync'),
    syncText: $('#sync-text'),
    toast: $('#toast'),
    controls: document.querySelector('.controls'),
  };

  const guardat = llegeix('pl-ui', {});
  const ui = {
    tab: guardat.tab || 'autocars',
    sentit: guardat.sentit || 'anada',
    colla: '',
    talla: '',
    estat: '',
    cerca: '',
  };

  let llistes = null;
  let servidor = { v: -1, marques: {} };
  // Canvis fets en aquest mòbil que encara no ha confirmat el servidor.
  let pendents = llegeix('pl-pendents', {});
  let darreraSync = 0;
  let errorSync = false;
  let enviant = false;

  /* ---------- Utilitats ---------- */

  function llegeix(clau, perDefecte) {
    try {
      const v = localStorage.getItem(clau);
      return v ? JSON.parse(v) : perDefecte;
    } catch {
      return perDefecte;
    }
  }

  function desa(clau, valor) {
    try {
      localStorage.setItem(clau, JSON.stringify(valor));
    } catch {
      /* sense emmagatzematge: no passa res */
    }
  }

  const normalitza = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

  const escapa = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  function ressalta(nom, consulta) {
    if (!consulta) return escapa(nom);
    const net = normalitza(nom);
    const i = net.indexOf(consulta);
    if (i < 0) return escapa(nom);
    // La normalització NFD manté la longitud per a lletres llatines amb accent
    // un cop treiem els diacrítics, així que els índexs coincideixen.
    return (
      escapa(nom.slice(0, i)) +
      '<mark>' +
      escapa(nom.slice(i, i + consulta.length)) +
      '</mark>' +
      escapa(nom.slice(i + consulta.length))
    );
  }

  const hora = (t) =>
    t ? new Date(t).toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' }) : '';

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), 3500);
  }

  function nomPersona() {
    return llegeix('pl-nom', '');
  }

  function demanaNom() {
    const actual = nomPersona();
    const nou = prompt('Com et dius? (surt al costat de les marques que facis)', actual);
    if (nou !== null) desa('pl-nom', nou.trim().slice(0, 40));
  }

  /* ---------- Comunicació amb el servidor ---------- */

  function codi() {
    return llegeix('pl-codi', '');
  }

  async function crida(params, cos) {
    if (DEMO) return demo(params, cos);
    let res;
    if (cos) {
      // Sense capçalera Content-Type → text/plain, i així no hi ha preflight CORS.
      res = await fetch(API, { method: 'POST', body: JSON.stringify({ ...cos, codi: codi() }) });
    } else {
      const qs = new URLSearchParams({ ...params, codi: codi(), _: Date.now() });
      res = await fetch(API + '?' + qs, { cache: 'no-store' });
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error === 'codi') {
      const nou = prompt(codi() ? 'Codi incorrecte. Torna-ho a provar:' : "Introdueix el codi d'accés:");
      if (nou === null) throw new Error('Cal el codi');
      desa('pl-codi', nou.trim());
      return crida(params, cos);
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function carregaLlistes() {
    const data = await crida({ a: 'llistes' });
    llistes = data.llistes;
    omplecolles();
    render();
  }

  async function carregaEstat() {
    const data = await crida({ a: 'estat' });
    aplicaServidor(data);
  }

  function aplicaServidor(data) {
    servidor = data;
    // Treu els pendents que el servidor ja reflecteix.
    let canvi = false;
    for (const [clau, p] of Object.entries(pendents)) {
      // (o fa massa que es va enviar: algú altre ho pot haver canviat després)
      if (p.enviat && (!!servidor.marques[clau] === p.marcat || Date.now() - p.ts > 20000)) {
        delete pendents[clau];
        canvi = true;
      }
    }
    if (canvi) desa('pl-pendents', pendents);
    darreraSync = Date.now();
    errorSync = false;
    render();
    pintaSync();
  }

  async function enviaPendents() {
    if (enviant) return;
    const [clau, p] = Object.entries(pendents).find(([, p]) => !p.enviat) || [];
    if (!clau) return;
    enviant = true;
    const [llista, id] = clau.split('|');
    try {
      const data = await crida(null, { llista, id, marcat: p.marcat, per: nomPersona() });
      if (pendents[clau] === p) {
        p.enviat = true;
        p.ts = Date.now();
      }
      desa('pl-pendents', pendents);
      aplicaServidor(data);
    } catch (err) {
      errorSync = true;
      pintaSync();
      return;
    } finally {
      enviant = false;
    }
    enviaPendents();
  }

  function marca(llista, id, marcat) {
    pendents[llista + '|' + id] = { marcat, enviat: false, ts: Date.now() };
    desa('pl-pendents', pendents);
    render();
    pintaSync();
    enviaPendents();
  }

  function marcaDe(llista, id) {
    const clau = llista + '|' + id;
    if (pendents[clau]) {
      return pendents[clau].marcat ? { per: nomPersona(), t: null, pendent: true } : null;
    }
    return servidor.marques[clau] || null;
  }

  function pintaSync() {
    const n = Object.keys(pendents).length;
    let estat = 'ok';
    let text = 'Al dia';
    if (errorSync) {
      estat = 'error';
      text = n ? `Sense connexió · ${n} per enviar` : 'Sense connexió';
    } else if (n) {
      estat = 'pending';
      text = `Enviant ${n}…`;
    } else if (!darreraSync) {
      estat = '';
      text = 'Connectant…';
    }
    if (DEMO) text = 'Demo · ' + text;
    els.sync.dataset.state = estat;
    els.syncText.textContent = text;
  }

  /* ---------- Vista ---------- */

  function llistaActual() {
    if (ui.tab === 'autocars') return ui.sentit;
    return ui.tab;
  }

  function omplecolles() {
    if (!llistes) return;
    const items = llistes[llistaActual()] || [];
    const colles = [...new Set(items.map((i) => i.colla))].sort((a, b) => a.localeCompare(b, 'ca'));
    if (!colles.includes(ui.colla)) ui.colla = '';
    els.colla.innerHTML =
      '<option value="">Totes les colles</option>' +
      colles.map((c) => `<option${c === ui.colla ? ' selected' : ''}>${escapa(c)}</option>`).join('');

    const ambTalla = ui.tab === 'samarretes';
    els.talla.hidden = !ambTalla;
    if (ambTalla) {
      const ordre = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
      const talles = [...new Set(items.map((i) => i.talla))].sort(
        (a, b) => (ordre.indexOf(a) + 1 || 99) - (ordre.indexOf(b) + 1 || 99),
      );
      if (!talles.includes(ui.talla)) ui.talla = '';
      els.talla.innerHTML =
        '<option value="">Totes les talles</option>' +
        talles.map((t) => `<option${t === ui.talla ? ' selected' : ''}>${escapa(t)}</option>`).join('');
    } else {
      ui.talla = '';
    }
  }

  function render() {
    if (!llistes) return;
    const llista = llistaActual();
    const items = llistes[llista] || [];
    const consulta = normalitza(ui.cerca.trim());

    let marcats = 0;
    const grups = new Map();
    for (const it of items) {
      const m = marcaDe(llista, it.id);
      if (m) marcats++;
      if (ui.colla && it.colla !== ui.colla) continue;
      if (ui.talla && it.talla !== ui.talla) continue;
      if (ui.estat === 'pendents' && m) continue;
      if (ui.estat === 'marcats' && !m) continue;
      if (consulta && !normalitza(it.nom).includes(consulta)) continue;
      if (!grups.has(it.colla)) grups.set(it.colla, []);
      grups.get(it.colla).push({ it, m });
    }

    els.progressText.textContent = `${marcats} / ${items.length}`;
    els.progressFill.style.width = items.length ? (marcats / items.length) * 100 + '%' : '0';

    if (!grups.size) {
      els.llista.innerHTML = `<p class="empty">${
        items.length ? 'Cap nom coincideix amb la cerca.' : 'Aquesta llista és buida.'
      }</p>`;
      return;
    }

    // Comptadors de grup sobre la colla sencera (no només el que es veu filtrat).
    const totals = new Map();
    for (const it of items) {
      const t = totals.get(it.colla) || { n: 0, m: 0 };
      t.n++;
      if (marcaDe(llista, it.id)) t.m++;
      totals.set(it.colla, t);
    }

    const ambTalla = ui.tab === 'samarretes';
    const html = [];
    for (const [colla, files] of grups) {
      const t = totals.get(colla);
      html.push(
        `<section class="grup"><h2 class="grup__cap"><span>${escapa(colla)}</span><span>${t.m}/${t.n}</span></h2><ul>`,
      );
      for (const { it, m } of files) {
        const meta = m
          ? m.pendent
            ? 'Enviant…'
            : `✓ ${m.per ? escapa(m.per) + ' · ' : ''}${hora(m.t)}`
          : '';
        html.push(
          `<li><button type="button" class="fila${m ? ' is-marcat' : ''}${
            m && m.pendent ? ' is-pendent' : ''
          }" data-id="${escapa(it.id)}" aria-pressed="${!!m}">` +
            `<span class="check"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>` +
            `<span class="fila__cos"><span class="fila__nom">${ressalta(it.nom, consulta)}</span>` +
            (meta ? `<span class="fila__meta">${meta}</span>` : '') +
            `</span>` +
            (ambTalla ? `<span class="talla">${escapa(it.talla || '?')}</span>` : '') +
            `</button></li>`,
        );
      }
      html.push('</ul></section>');
    }
    els.llista.innerHTML = html.join('');
  }

  function desaUi() {
    desa('pl-ui', { tab: ui.tab, sentit: ui.sentit });
  }

  function pintaPestanyes() {
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === ui.tab);
    });
    els.sentit.hidden = ui.tab !== 'autocars';
    els.sentit.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.sentit === ui.sentit);
    });
    els.cerca.placeholder =
      ui.tab === 'autocars'
        ? `Cerca a l'autocar d'${ui.sentit}…`
        : ui.tab === 'polseres'
          ? 'Cerca qui necessita polsera…'
          : 'Cerca qui necessita samarreta…';
    ajustaAlcadaControls();
  }

  function ajustaAlcadaControls() {
    document.documentElement.style.setProperty('--controls-h', els.controls.offsetHeight + 'px');
  }

  /* ---------- Esdeveniments ---------- */

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b || b.dataset.tab === ui.tab) return;
    ui.tab = b.dataset.tab;
    desaUi();
    pintaPestanyes();
    omplecolles();
    render();
    window.scrollTo(0, 0);
  });

  els.sentit.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sentit]');
    if (!b) return;
    ui.sentit = b.dataset.sentit;
    desaUi();
    pintaPestanyes();
    omplecolles();
    render();
  });

  els.cerca.addEventListener('input', () => {
    ui.cerca = els.cerca.value;
    render();
  });

  els.colla.addEventListener('change', () => {
    ui.colla = els.colla.value;
    render();
  });

  els.talla.addEventListener('change', () => {
    ui.talla = els.talla.value;
    render();
  });

  els.estat.addEventListener('change', () => {
    ui.estat = els.estat.value;
    render();
  });

  els.llista.addEventListener('click', (e) => {
    const b = e.target.closest('.fila');
    if (!b) return;
    const llista = llistaActual();
    const id = b.dataset.id;
    const item = llistes[llista].find((i) => i.id === id);
    const actual = marcaDe(llista, id);
    if (actual) {
      // Desmarcar demana confirmació per evitar tocs accidentals mentre fas scroll.
      if (!confirm(`Desmarcar ${item.nom}?`)) return;
      marca(llista, id, false);
    } else {
      marca(llista, id, true);
      if (navigator.vibrate) navigator.vibrate(15);
      // Si estaves cercant, buida la cerca per poder buscar el següent ràpidament.
      if (ui.cerca) {
        els.cerca.value = ui.cerca = '';
        render();
        toast(`✓ ${item.nom}`);
      }
    }
  });

  $('#btn-perfil').addEventListener('click', demanaNom);

  // Refresc manual: el servidor torna a llegir el full saltant-se la memòria cau.
  const btnRefresca = $('#btn-refresca');
  btnRefresca.addEventListener('click', async () => {
    btnRefresca.disabled = true;
    btnRefresca.classList.add('is-girant');
    try {
      await enviaPendents();
      llistes = (await crida({ a: 'llistes', fresc: 1 })).llistes;
      omplecolles();
      aplicaServidor(await crida({ a: 'estat', fresc: 1 }));
      toast('Dades i marques actualitzades');
    } catch {
      errorSync = true;
      pintaSync();
      toast("No s'ha pogut refrescar. Comprova la connexió.");
    } finally {
      btnRefresca.disabled = false;
      btnRefresca.classList.remove('is-girant');
    }
  });
  els.sync.addEventListener('click', () => {
    toast(
      darreraSync
        ? `Darrera actualització: ${new Date(darreraSync).toLocaleTimeString('ca-ES')}`
        : 'Encara no s’ha pogut connectar.',
    );
    refresca();
  });
  window.addEventListener('resize', ajustaAlcadaControls);

  /* ---------- Bucle de sincronització ---------- */

  async function refresca() {
    try {
      await enviaPendents();
      await carregaEstat();
    } catch {
      errorSync = true;
      pintaSync();
    }
  }

  async function inicia() {
    pintaPestanyes();
    pintaSync();
    try {
      await carregaLlistes();
      await carregaEstat();
    } catch (err) {
      errorSync = true;
      pintaSync();
      els.llista.innerHTML = `<p class="empty">No s'han pogut carregar les llistes.<br>${escapa(
        err.message,
      )}<br><br><button type="button" onclick="location.reload()">Torna-ho a provar</button></p>`;
      return;
    }
    if (!nomPersona()) demanaNom();

    setInterval(() => {
      if (document.visibilityState === 'visible') refresca();
    }, POLL_ESTAT_MS);
    setInterval(() => {
      if (document.visibilityState === 'visible') carregaLlistes().catch(() => {});
    }, POLL_LLISTES_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresca();
    });
    window.addEventListener('online', refresca);
  }

  /* ---------- Mode demo (sense backend) ---------- */

  function demo(params, cos) {
    const estat = llegeix('pl-demo-estat', { v: 0, marques: {} });
    if (cos) {
      const clau = cos.llista + '|' + cos.id;
      if (cos.marcat) estat.marques[clau] = { per: cos.per, t: Date.now() };
      else delete estat.marques[clau];
      estat.v++;
      desa('pl-demo-estat', estat);
      return new Promise((r) => setTimeout(() => r(estat), 300));
    }
    if (params.a === 'llistes') return Promise.resolve({ llistes: dadesDemo() });
    return Promise.resolve(estat);
  }

  function dadesDemo() {
    const noms = [
      ['Jove de Barcelona', ['Adrià Ardite', 'Adriana Casas', 'Aina Ardite', 'Andreu Bachs', 'Anna Lleonart']],
      ['Castellers de Barcelona', ['Alba Gómez', 'Albert Edo', 'Berta Badiella', 'Chris Cadalzo']],
      ['Castellers de Santa Coloma', ['Clàudia Amor', 'Dani Vicente', 'Edgar Valldeperez']],
      ['No castellera', ['Adrián García', 'Ana Galindo', 'Cristina Puig', 'Marta Oliver']],
    ];
    const talles = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    const tots = noms.flatMap(([colla, ns]) => ns.map((nom) => ({ nom, colla })));
    const amb = (arr) =>
      arr.map((x) => ({ ...x, id: normalitza(x.nom).replace(/[^a-z0-9]+/g, '-') }));
    return {
      anada: amb(tots),
      tornada: amb(tots.filter((_, i) => i % 3)),
      polseres: amb(tots.filter((x) => x.colla !== 'Jove de Barcelona')),
      samarretes: amb(tots.filter((_, i) => i % 2).map((x, i) => ({ ...x, talla: talles[i % 6] }))),
    };
  }

  inicia();
})();
