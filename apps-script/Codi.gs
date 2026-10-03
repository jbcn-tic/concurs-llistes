/**
 * Backend de "Passar llista — Concurs de Castells".
 *
 * Llegeix les llistes del full de càlcul de respostes i guarda les marques
 * (qui ja és a l'autocar, qui té polsera, qui té samarreta) a una pestanya
 * nova "Passar llista" del mateix full. El frontend (GitHub Pages) consulta
 * aquest web app cada pocs segons per veure els canvis dels altres.
 *
 * Endpoints (web app, "Qualsevol persona"):
 *   GET  ?a=llistes&codi=…   → { llistes: { anada, tornada, polseres, samarretes } }
 *   GET  ?a=estat&codi=…     → { v, marques: { "<llista>|<id>": { per, t } } }
 *   POST {codi, llista, id, marcat, per}  → igual que ?a=estat
 *
 * Si la propietat de l'script CODI té valor, totes les peticions l'han de
 * portar (protecció bàsica perquè les dades no siguin públiques).
 */

const SPREADSHEET_ID = '14kIMAwWwgW7rai5dMF3WbpIjpamP15grJQK48U1IazM';
const FULL_MARQUES = 'Passar llista';
const LLISTES_VALIDES = ['anada', 'tornada', 'polseres', 'samarretes'];
const CACHE_LLISTES_S = 300;
const CACHE_MARQUES_S = 21600;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!codiValid_(p.codi)) return json_({ error: 'codi' });
  if (p.a === 'llistes') return json_({ llistes: llistes_() });
  return json_(estat_());
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: 'json' });
  }
  if (!codiValid_(body.codi)) return json_({ error: 'codi' });
  if (LLISTES_VALIDES.indexOf(body.llista) < 0 || !body.id) {
    return json_({ error: 'parametres' });
  }
  marca_(body.llista, String(body.id), !!body.marcat, String(body.per || '').slice(0, 40));
  return json_(estat_());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function codiValid_(codi) {
  const esperat = PropertiesService.getScriptProperties().getProperty('CODI');
  return !esperat || String(codi || '').trim().toLowerCase() === esperat.trim().toLowerCase();
}

/* ---------- Llistes (des del full) ---------- */

function llistes_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('llistes');
  if (cached) return JSON.parse(cached);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const autocar = ss.getSheetByName('Llista autocar').getRange('A3:C').getValues();
  const result = {
    anada: llistaAgrupada_(autocar.map((r) => r[0])),
    tornada: llistaAgrupada_(autocar.map((r) => r[2])),
    polseres: polseres_(ss),
    samarretes: samarretes_(ss),
  };
  cache.put('llistes', JSON.stringify(result), CACHE_LLISTES_S);
  return result;
}

/** Columna amb capçaleres "▶ Colla (n)" seguides dels noms d'aquella colla. */
function llistaAgrupada_(cells) {
  const out = [];
  let colla = 'Sense colla';
  cells.forEach((c) => {
    const text = String(c || '').trim();
    if (!text) return;
    if (text.charAt(0) === '▶') {
      colla = text.replace(/^▶\s*/, '').replace(/\s*\(\d+\)\s*$/, '');
      return;
    }
    out.push({ nom: text, colla: colla });
  });
  return ambIds_(out);
}

function polseres_(ss) {
  const mapa = {};
  ss.getSheetByName('Colles')
    .getRange('D3:E')
    .getValues()
    .forEach((r) => {
      const k = String(r[0] || '').trim().toLowerCase();
      if (k) mapa[k] = String(r[1] || '').trim();
    });

  const files = ss.getSheetByName('Respostes al formulari 1').getRange('C2:H').getValues();
  const out = [];
  files.forEach((r) => {
    const nom = netejaNom_(r[0]);
    if (!nom) return;
    const esCastellera = String(r[4] || '').trim().toLowerCase() === 'sí';
    const text = String(r[5] || '').trim();
    let colla = 'No castellera';
    if (esCastellera) colla = mapa[text.toLowerCase()] || text || 'Sense colla';
    out.push({ nom: nom, colla: colla });
  });
  return ambIds_(out);
}

function samarretes_(ss) {
  const files = ss.getSheetByName('Samarretes').getRange('D3:F').getValues();
  const out = [];
  files.forEach((r) => {
    const nom = netejaNom_(r[0]);
    if (!nom) return;
    out.push({
      nom: nom,
      talla: String(r[1] || '').trim(),
      colla: String(r[2] || '').trim() || 'Sense colla',
    });
  });
  return ambIds_(out);
}

function netejaNom_(v) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Id estable per nom (independent de l'ordre); els noms repetits porten ~2, ~3… */
function ambIds_(items) {
  const vistos = {};
  items.forEach((it) => {
    const base = it.nom
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    vistos[base] = (vistos[base] || 0) + 1;
    it.id = vistos[base] > 1 ? base + '~' + vistos[base] : base;
  });
  return items;
}

/* ---------- Marques ---------- */

function fullMarques_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(FULL_MARQUES);
  if (!sh) {
    sh = ss.insertSheet(FULL_MARQUES);
    sh.getRange('A1:F1').setValues([['Llista', 'ID', 'Marcat', 'Per', 'Hora', 'Clau']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function estat_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('estat');
  if (cached) return JSON.parse(cached);
  return desaEstatACache_(llegeixEstatDelFull_());
}

function llegeixEstatDelFull_() {
  const sh = fullMarques_();
  const n = sh.getLastRow() - 1;
  const marques = {};
  if (n > 0) {
    sh.getRange(2, 1, n, 5)
      .getValues()
      .forEach((r) => {
        if (r[2] === true) {
          marques[r[0] + '|' + r[1]] = {
            per: r[3],
            t: r[4] instanceof Date ? r[4].getTime() : null,
          };
        }
      });
  }
  const v = Number(PropertiesService.getScriptProperties().getProperty('VERSIO') || 0);
  return { v: v, marques: marques };
}

function desaEstatACache_(estat) {
  CacheService.getScriptCache().put('estat', JSON.stringify(estat), CACHE_MARQUES_S);
  return estat;
}

function marca_(llista, id, marcat, per) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = fullMarques_();
    const clau = llista + '|' + id;
    const n = sh.getLastRow() - 1;
    let fila = -1;
    if (n > 0) {
      const claus = sh.getRange(2, 6, n, 1).getValues();
      for (let i = 0; i < claus.length; i++) {
        if (claus[i][0] === clau) {
          fila = i + 2;
          break;
        }
      }
    }
    const ara = new Date();
    const valors = [[llista, id, marcat, per, ara, clau]];
    if (fila > 0) sh.getRange(fila, 1, 1, 6).setValues(valors);
    else sh.appendRow(valors[0]);

    const props = PropertiesService.getScriptProperties();
    const v = Number(props.getProperty('VERSIO') || 0) + 1;
    props.setProperty('VERSIO', String(v));

    const estat = estat_();
    if (marcat) estat.marques[clau] = { per: per, t: ara.getTime() };
    else delete estat.marques[clau];
    estat.v = v;
    desaEstatACache_(estat);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Utilitats per executar des de l'editor ---------- */

/** Executa-la un cop des de l'editor per autoritzar i crear la pestanya. */
function prepara() {
  fullMarques_();
  CacheService.getScriptCache().removeAll(['llistes', 'estat']);
  Logger.log(JSON.stringify(llistes_()).slice(0, 2000));
}

/** Força tornar a llegir les llistes del full (si s'han editat). */
function buidaCache() {
  CacheService.getScriptCache().removeAll(['llistes', 'estat']);
}
