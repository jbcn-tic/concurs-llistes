# Passar llista — Concurs de Castells 2026

Web pensada per a mòbil per passar llista el dia del concurs. Diverses persones
poden marcar alhora i tothom veu els canvis en pocs segons.

- **Autocars** — anada o tornada, des de la pestanya `Llista autocar`.
- **Polseres** — totes les respostes de `Respostes al formulari 1` (la colla
  es normalitza amb la taula "Text escrit → Agrupat com a" de `Colles`).
- **Samarretes** — qui necessita samarreta i la talla, des de `Samarretes`.

A totes: cercador (sense accents), filtre per colla, filtre per estat
(pendents/marcats) i agrupació per colla amb comptadors.

## Com funciona

```
docs/          → frontend estàtic (GitHub Pages)
apps-script/   → backend (Google Apps Script, web app)
```

El backend llegeix les llistes del full de càlcul i guarda les marques a una
pestanya nova, **`Passar llista`**, del mateix full (llista, id, marcat, per qui
i a quina hora). El frontend consulta l'estat cada 3 s i les llistes cada 2 min.
Si no hi ha cobertura, les marques es guarden al mòbil i s'envien quan torna
la connexió (l'indicador de dalt ho mostra).

Desmarcar algú demana confirmació, per evitar tocs accidentals.

## Posar-ho en marxa

1. A <https://script.google.com> crea un projecte nou amb el compte que té accés
   al full, i enganxa-hi `apps-script/Codi.gs` i `apps-script/appsscript.json`
   (cal activar "Mostra el fitxer de manifest" a la configuració).
2. (Opcional, recomanat) A **Configuració del projecte → Propietats de
   l'script**, afegeix `CODI` amb una paraula clau. La web la demanarà el
   primer cop i la recordarà.
3. Executa la funció `prepara` un cop per autoritzar-la i crear la pestanya
   `Passar llista`.
4. **Implementa → Implementació nova → Aplicació web**, executa com a "Jo" i
   accés "Qualsevol persona". Copia la URL acabada en `/exec`.
5. Posa aquesta URL a `docs/config.js` i publica.

Si s'editen les llistes del full, l'app les recull sola en ≤5 min; per forçar-ho
executa `buidaCache` des de l'editor.

## Desenvolupament

Sense URL a `config.js` (o amb `?demo` a la URL) l'app funciona en mode demo
amb dades d'exemple guardades al navegador.

```bash
python3 -m http.server 8765 --directory docs
```
