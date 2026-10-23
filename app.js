/* Block Party NYC : application de voyage avec Google Maps */
(function () {
  'use strict';

  const CFG = window.BP_CONFIG || {};
  const CATS = {
    viral:   { label: 'Viral',    color: '#FF6319', text: '#fff' },
    typique: { label: 'Typique',  color: '#00933C', text: '#fff' },
    cafe:    { label: 'Cafés',    color: '#6CBE45', text: '#141414' },
    nuit:    { label: 'Soirées',  color: '#996633', text: '#fff' },
    shop:    { label: 'Shopping', color: '#B933AD', text: '#fff' },
    voir:    { label: 'À voir',   color: '#2F6FE0', text: '#fff' },
    mine:    { label: 'Mes ajouts', color: '#FCCC0A', text: '#141414' }
  };
  const CLAIRE_COLOR = '#D6336C';
  const ZONES = ['Manhattan', 'Brooklyn', 'Bronx', 'Queens', 'Staten Island', 'New Jersey'];
  const FOOD = ['viral', 'typique', 'cafe'];
  const NAMES = Object.assign({ a: 'Moi', b: 'Toi' }, CFG.NAMES || {});

  /* ---------- stockage local ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('bp_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bp_' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  };

  const S = {
    places: [],
    custom: store.get('custom', []),
    done: store.get('done', {}),
    votes: store.get('votes', {}),
    gcache: store.get('gcache', {}),
    filter: 'all',
    zone: 'Toutes',
    query: '',
    hungry: false,
    me: null,          // {lat,lng} position GPS
    meSource: 'hotel',
    tab: 'around',
    addCat: 'mine',
    draft: null        // lieu en cours d'ajout {name,address,lat,lng,link,gid}
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- géographie ---------- */
  function distKm(a, b) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  // Les rues new-yorkaises allongent le trajet : facteur 1,3, marche à 4,8 km/h.
  function walkMin(p) { return Math.max(1, Math.round(distKm(origin(), p) * 1.3 / 4.8 * 60)); }
  function fmtTime(min) {
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60), m = min % 60;
    return h + ' h' + (m ? ' ' + String(m).padStart(2, '0') : '');
  }
  function travelLabel(min) { return min <= 25 ? fmtTime(min) : '~' + fmtTime(Math.round(min / 3)) + ' métro'; }
  function origin() { return S.me || { lat: CFG.HOTEL ? CFG.HOTEL.lat : 40.7549, lng: CFG.HOTEL ? CFG.HOTEL.lng : -73.984 }; }

  /* ---------- dates du séjour ---------- */
  function nyNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); }
  function isoDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  function closedToday(p) {
    if (!p.closed) return false;
    const d = nyNow();
    return p.closed.includes(WD[d.getDay()]) || p.closed.includes(isoDay(d));
  }

  /* ---------- données ---------- */
  function allPlaces() { return S.places.concat(S.custom); }
  function byId(id) { return allPlaces().find((p) => p.id === id); }
  function catOf(p) { return CATS[p.cat] || CATS.mine; }
  function letter(p) { return (p.name.replace(/^(The|Le|La|Les|L')\s*/i, '')[0] || '?').toUpperCase(); }

  // Pour les chaînes (plusieurs adresses), on ne garde que l'adresse la plus proche dans les listes.
  function nearestOfGroups(list) {
    const best = {};
    const out = [];
    list.forEach((p) => {
      if (!p.group) { out.push(p); return; }
      const cur = best[p.group];
      if (!cur || distKm(origin(), p) < distKm(origin(), cur)) best[p.group] = p;
    });
    return out.concat(Object.values(best));
  }
  function claireNote(p, sec) {
    if (!p.claire) return '';
    if (sec) return p.claire.notes[sec] || '';
    return Object.values(p.claire.notes).join(' ');
  }
  function visible() {
    let list = allPlaces().filter((p) => !p.closedForGood);
    if (S.filter === 'mine') list = list.filter((p) => p.custom);
    else if (S.filter === 'claire') list = list.filter((p) => p.claire);
    else if (S.filter === 'duo') list = list.filter((p) => { const v = S.votes[p.id]; return v && v.a && v.b; });
    else if (S.filter !== 'all') list = list.filter((p) => p.cat === S.filter);
    if (S.hungry) list = list.filter((p) => FOOD.includes(p.cat) && walkMin(p) <= 15);
    return list;
  }

  /* ---------- UI : filtres ---------- */
  function renderChips() {
    const items = [['all', 'Tout', null]].concat(
      Object.keys(CATS).map((k) => [k, CATS[k].label, CATS[k].color]),
      [['claire', 'Claire', CLAIRE_COLOR], ['duo', 'Envies à deux', null]]
    );
    $('#chips').innerHTML = items.map(([k, label, color]) => {
      const n = k === 'all' ? allPlaces().length : null;
      return '<button class="chip" data-f="' + k + '" aria-pressed="' + (S.filter === k) + '">' +
        (color ? '<span class="dot" style="background:' + color + '"></span>' : '') +
        esc(label) + (n != null ? ' · ' + n : '') + '</button>';
    }).join('');
  }

  /* ---------- UI : liste autour ---------- */
  function statusTag(p) {
    if (closedToday(p)) return '<span class="tag bad">Fermé auj.</span>';
    const g = S.gcache[p.id];
    if (g && g.openNow === true) return '<span class="tag ok">Ouvert</span>';
    if (g && g.openNow === false) return '<span class="tag bad">Fermé</span>';
    if (p.closedForGood) return '<span class="tag bad">Fermé</span>';
    if (S.done[p.id]) return '<span class="tag ok">Fait</span>';
    if (p.score) return '<span class="tag warn">' + String(p.score).replace('.', ',') + '/10</span>';
    if (p.claire && p.claire.star) return '<span class="tag" style="color:' + CLAIRE_COLOR + '">★ Claire</span>';
    return '';
  }
  function rowHtml(p) {
    const c = catOf(p), min = walkMin(p);
    const sub = (p.custom ? 'Mon ajout' : c.label) + ' · ' + (p.hood || p.zone || '') + (p.verdict ? ' · ' + p.verdict : '');
    return '<button class="row" data-open="' + esc(p.id) + '">' +
      '<span class="bullet' + (p.claire ? ' cl' : '') + '" style="background:' + c.color + ';color:' + c.text + (S.done[p.id] || p.closedForGood ? ';opacity:.45' : '') + '">' + esc(letter(p)) + '</span>' +
      '<span class="row-main"><b>' + esc(p.name) + '</b><span>' + esc(sub) + '</span></span>' +
      '<span class="row-side"><b>' + travelLabel(min) + '</b>' + statusTag(p) + '</span></button>';
  }
  function renderNear() {
    const list = nearestOfGroups(visible()).map((p) => ({ p, m: walkMin(p) })).sort((a, b) => a.m - b.m);
    const close = list.filter((x) => x.m <= 15);
    const shown = (close.length >= 4 ? close : list.slice(0, 12));
    $('#near-title').textContent = S.hungry ? 'Manger tout près' : (close.length >= 4 ? 'À moins de 15 min' : 'Les plus proches');
    $('#near-sub').textContent = S.meSource === 'gps' ? 'depuis votre position' : 'depuis l\'hôtel';
    $('#near-list').innerHTML = shown.length ? shown.map((x) => rowHtml(x.p)).join('')
      : '<p class="empty">Aucun lieu dans cette catégorie ici. Changez de filtre ou ajoutez votre propre adresse dans l\'onglet Ajouter.</p>';
  }

  /* ---------- UI : liste complète ---------- */
  function renderZones() {
    const zs = ['Toutes'].concat(ZONES.filter((z) => allPlaces().some((p) => p.zone === z)));
    $('#zones').innerHTML = zs.map((z) => '<button data-z="' + z + '" aria-pressed="' + (S.zone === z) + '">' + z + '</button>').join('');
  }
  function renderAll() {
    const q = S.query.trim().toLowerCase();
    let list = nearestOfGroups(visible());
    if (S.zone !== 'Toutes') list = list.filter((p) => p.zone === S.zone);
    if (q) list = list.filter((p) => [p.name, p.hood, p.zone, p.why, p.order, p.note, claireNote(p)].join(' ').toLowerCase().includes(q));
    list.sort((a, b) => (b.score || 0) - (a.score || 0));
    $('#all-list').innerHTML = list.length ? list.map(rowHtml).join('') : '<p class="empty">Aucun résultat.</p>';
  }

  /* ---------- Fiche ---------- */
  function verdictClass(v) {
    if (!v) return '';
    if (/surcot|sans plus/i.test(v)) return 'meh';
    if (/hype|incontournable|pépite|bon plan/i.test(v)) return 'good';
    return '';
  }
  function gmapsUrl(p) {
    const g = S.gcache[p.id];
    if (g && g.url) return g.url;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name + ' ' + (p.address || (p.lat + ',' + p.lng)));
  }
  function dirUrl(p) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(p.address || (p.lat + ',' + p.lng)) +
      '&travelmode=' + (walkMin(p) <= 25 ? 'walking' : 'transit');
  }
  function starStr(r) { const f = Math.round(r); return '★★★★★'.slice(0, f) + '☆☆☆☆☆'.slice(0, 5 - f); }

  function openFiche(id) {
    const p = byId(id); if (!p) return;
    const c = catOf(p), v = S.votes[p.id] || {}, g = S.gcache[p.id];
    const min = walkMin(p);
    const pills = [];
    if (p.custom) pills.push('<span class="pill" style="background:#FFF6CC;color:#4A3E10">Mon ajout</span>');
    else pills.push('<span class="pill' + (p.cat === 'viral' ? ' hot' : '') + '">' + esc(c.label === 'Viral' ? 'Viral sur les réseaux' : c.label) + '</span>');
    if (p.price) pills.push('<span class="pill">' + esc(p.price) + '</span>');
    if (p.dates) pills.push('<span class="pill hot">' + esc(p.dates) + '</span>');
    if (closedToday(p)) pills.push('<span class="pill" style="background:#F9DEDC;color:#8C1D18">Fermé aujourd\'hui</span>');
    if (p.closedForGood) pills.push('<span class="pill" style="background:#F9DEDC;color:#8C1D18">Fermé définitivement selon Google</span>');

    let claireHtml = '';
    if (p.claire) {
      const notes = p.claire.sec.filter((s) => p.claire.notes[s]).map((s) => '<p><b>' + esc(secLabel(s)) + '</b> · ' + esc(p.claire.notes[s]) + '</p>').join('');
      claireHtml = '<div class="claire-box"><h3><span>L\'avis de Claire</span>' + (p.claire.star ? '<span class="cl-star">★ Coup de cœur</span>' : '') + '</h3>' +
        (notes || '<p>Dans sa liste, rubrique « ' + esc(p.claire.sec.map(secLabel).join(', ')) + ' ».</p>') + '</div>';
    }
    let branches = '';
    if (p.group) {
      const others = allPlaces().filter((q) => q.group === p.group && q.id !== p.id).sort((a, b) => walkMin(a) - walkMin(b));
      branches = '<div class="sec"><h3>Autres adresses</h3><div class="card" style="padding:0 12px;background:var(--ground)">' +
        others.map((q) => '<button class="row" data-open="' + esc(q.id) + '"><span class="row-main"><b>' + esc(q.address.split(',')[0]) + '</b><span>' + esc(q.hood) + '</span></span><span class="row-side"><b>' + travelLabel(walkMin(q)) + '</b></span></button>').join('') + '</div></div>';
    }

    const pros = (p.plus || []).map((t) => '<li><strong style="color:var(--ok)">+</strong> ' + esc(t) + '</li>').join('') +
      (p.minus || []).map((t) => '<li><strong style="color:var(--bad)">−</strong> ' + esc(t) + '</li>').join('');

    const googleLine = g && g.rating
      ? '<div class="gline"><b>' + String(g.rating).replace('.', ',') + '</b><span class="stars" aria-hidden="true">' + starStr(g.rating) + '</span><span>' + (g.count ? g.count.toLocaleString('fr-FR') + ' avis Google' : 'Google') + '</span></div>'
      : '<div class="gline" id="g-line"><span class="help">' + (mapsReady ? 'Chargement de la note Google…' : 'Note Google disponible une fois la clé Google Maps ajoutée.') + '</span></div>';

    const both = v.a && v.b;
    $('#modal').innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(p.name) + '">' +
        '<div class="hero" id="hero"' + (g && g.photo ? ' style="background-image:url(\'' + esc(g.photo) + '\')"' : '') + '>' + (g && g.photo ? '' : 'Photo') +
          '<button class="back" data-close aria-label="Retour"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg></button>' +
          '<div class="title-bar"><span class="bullet" style="background:' + c.color + ';color:' + c.text + '">' + esc(letter(p)) + '</span>' +
          '<div style="min-width:0"><h2>' + esc(p.name) + '</h2><small>' + esc([p.address && p.address.split(',')[0] !== p.name ? p.address.split(',')[0] : '', p.hood].filter(Boolean).join(' · ')) + '</small></div></div>' +
        '</div>' +
        '<div class="fiche">' +
          '<div class="pills">' + pills.join('') + '</div>' +
          '<div class="stats">' +
            '<div><span>Trajet</span><b>' + travelLabel(min) + '</b></div>' +
            (p.score || !(g && g.rating)
              ? '<div><span>Note BP</span><b>' + (p.score ? String(p.score).replace('.', ',') + '<small>/10</small>' : '–') + '</b></div>'
              : '<div><span>Google</span><b>' + String(g.rating).replace('.', ',') + '<small>/5</small></b></div>') +
            (p.duration ? '<div><span>Durée</span><b>' + fmtTime(p.duration) + '</b></div>' : '<div><span>Quartier</span><b style="font-size:18px">' + esc(p.zone || '–') + '</b></div>') +
          '</div>' +
          (p.why ? '<div class="sec"><h3>Pourquoi c\'est connu</h3><p>' + esc(p.why) + '</p></div>' : '') +
          claireHtml +
          (pros ? '<div class="sec"><h3><span>Ce que disent les avis</span>' + (p.verdict ? '<span class="pill ' + verdictClass(p.verdict) + '">' + esc(p.verdict) + '</span>' : '') + '</h3><ul class="pros">' + pros + '</ul>' + googleLine + '<span class="src">Synthèse des critiques, guides et avis en ligne (oct. 2026). Note Google en direct.</span></div>'
            : '<div class="sec"><h3>Avis Google</h3>' + googleLine + '</div>') +
          (p.order ? '<div class="sec"><h3>' + (FOOD.includes(p.cat) ? 'Quoi commander' : 'À faire') + '</h3><p>' + esc(p.order) + '</p></div>' : '') +
          (p.tip ? '<div class="sec"><h3>Astuce</h3><p>' + esc(p.tip) + '</p></div>' : '') +
          (p.note ? '<div class="sec"><h3>Ma note</h3><p>' + esc(p.note) + '</p></div>' : '') +
          branches +
          (p.address ? '<div class="sec"><h3>Adresse</h3><p>' + esc(p.address) + '</p></div>' : '') +
          (p.link ? '<div class="sec"><h3>Lien enregistré</h3><p><a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + esc(p.link.replace(/^https?:\/\//, '').slice(0, 48)) + '…</a></p></div>' : '') +
          '<div class="duo"><h3>Vos envies à deux</h3><div class="duo-row">' +
            '<button data-vote="a" aria-pressed="' + !!v.a + '">' + esc(NAMES.a) + (v.a ? ' : j\'adore' : ' : voter') + '</button>' +
            '<button data-vote="b" aria-pressed="' + !!v.b + '">' + esc(NAMES.b) + (v.b ? ' : j\'adore' : ' : voter') + '</button>' +
          '</div>' + (both ? '<span class="match">Envie commune ! Il apparaît dans le filtre « Envies à deux ».</span>' : '') + '</div>' +
          (p.custom ? '<button class="small-btn" data-del style="color:var(--bad)">Supprimer ce lieu</button>' : '') +
        '</div>' +
        '<div class="actions">' +
          '<a class="btn grow" href="' + esc(dirUrl(p)) + '" target="_blank" rel="noopener">ITINÉRAIRE</a>' +
          '<a class="btn ghost" href="' + esc(gmapsUrl(p)) + '" target="_blank" rel="noopener" aria-label="Voir dans Google Maps">MAPS</a>' +
          '<button class="btn ghost" data-done aria-pressed="' + !!S.done[p.id] + '"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>' + 'FAIT</button>' +
        '</div>' +
      '</div>';
    $('#modal').hidden = false;
    $('#modal').dataset.id = p.id;
    if (map) map.panTo({ lat: p.lat, lng: p.lng });
    if (!(g && g.rating) && mapsReady && !p.noGoogle) fetchGoogle(p).then(() => { if ($('#modal').dataset.id === p.id && !$('#modal').hidden) openFiche(p.id); });
  }
  function closeFiche() { $('#modal').hidden = true; $('#modal').innerHTML = ''; delete $('#modal').dataset.id; }

  /* ---------- Google Maps ---------- */
  let map = null, mapsReady = false, markers = {}, meMarker = null, draftMarker = null, libs = {};

  function loadGoogle(key) {
    // Chargeur officiel de l'API Maps JavaScript (importLibrary).
    ((g) => { let h, a, k, p = 'The Google Maps JavaScript API', c = 'google', l = 'importLibrary', q = '__ib__', m = document, b = window; b = b[c] || (b[c] = {}); const d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(), u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement('script')); e.set('libraries', [...r] + ''); for (k in g) e.set(k.replace(/[A-Z]/g, (t) => '_' + t[0].toLowerCase()), g[k]); e.set('callback', c + '.maps.' + q); a.src = 'https://maps.' + c + 'apis.com/maps/api/js?' + e; d[q] = f; a.onerror = () => h = n(Error(p + ' could not load.')); a.nonce = m.querySelector('script[nonce]')?.nonce || ''; m.head.append(a); })); d[l] ? console.warn(p + ' only loads once. Ignoring:', g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)); })({ key: key, v: 'weekly', language: 'fr', region: 'US' });
  }

  async function initGoogle() {
    if (!CFG.GOOGLE_MAPS_KEY) return false;
    try {
      loadGoogle(CFG.GOOGLE_MAPS_KEY);
      const { Map } = await google.maps.importLibrary('maps');
      libs.marker = await google.maps.importLibrary('marker');
      libs.places = await google.maps.importLibrary('places');
      map = new Map($('#map'), {
        center: origin(), zoom: 14, mapId: CFG.MAP_ID || 'DEMO_MAP_ID',
        disableDefaultUI: true, zoomControl: false, clickableIcons: true, gestureHandling: 'greedy'
      });
      map.addListener('click', onMapClick);
      // Comme dans Google Maps : on déplace la carte, la liste se range.
      map.addListener('dragstart', () => { if (S.sheet === 'half') setSheet('min'); });
      mapsReady = true;
      window.gm_authFailure = () => { mapsReady = false; showBanner('La clé Google Maps est refusée. Vérifiez-la dans config.js (voir le guide).'); renderFallback(); };
      setupAutocomplete();
      return true;
    } catch (err) {
      showBanner('Google Maps n\'a pas pu se charger. Vérifiez votre connexion et votre clé.');
      return false;
    }
  }

  function pinEl(p) {
    const c = catOf(p), el = document.createElement('div');
    const v = S.votes[p.id];
    el.className = 'pin' + (S.done[p.id] ? ' done' : '') + (v && v.a && v.b ? ' star' : '') + (p.claire ? ' cl' : '');
    el.style.background = c.color; el.style.color = c.text;
    el.textContent = letter(p);
    el.title = p.name;
    return el;
  }
  function renderMarkers() {
    if (!mapsReady) { renderFallback(); return; }
    const want = new Set(visible().map((p) => p.id));
    Object.keys(markers).forEach((id) => { if (!want.has(id)) { markers[id].map = null; delete markers[id]; } });
    visible().forEach((p) => {
      if (markers[p.id]) { markers[p.id].content = pinEl(p); return; }
      const mk = new libs.marker.AdvancedMarkerElement({ map, position: { lat: p.lat, lng: p.lng }, content: pinEl(p), title: p.name, gmpClickable: true });
      mk.addListener('click', () => openFiche(p.id));
      markers[p.id] = mk;
    });
  }
  function renderMe() {
    if (!mapsReady || !S.me) return;
    const el = document.createElement('div');
    el.className = 'me-dot'; el.style.position = 'relative'; el.style.transform = 'none';
    if (!meMarker) meMarker = new libs.marker.AdvancedMarkerElement({ map, position: S.me, content: el, title: 'Vous êtes ici', zIndex: 999 });
    else meMarker.position = S.me;
  }

  async function fetchGoogle(p) {
    try {
      const { Place } = libs.places;
      const res = await Place.searchByText({
        textQuery: p.name + ', ' + (p.address || ''),
        fields: ['rating', 'userRatingCount', 'googleMapsURI', 'photos', 'regularOpeningHours', 'utcOffsetMinutes', 'businessStatus'],
        locationBias: { lat: p.lat, lng: p.lng }, maxResultCount: 1, language: 'fr'
      });
      const pl = res.places && res.places[0];
      if (!pl) return;
      let openNow = null;
      try { openNow = await pl.isOpen(); } catch (e) { openNow = null; }
      S.gcache[p.id] = {
        rating: pl.rating || null, count: pl.userRatingCount || null, url: pl.googleMapsURI || null,
        photo: pl.photos && pl.photos[0] ? pl.photos[0].getURI({ maxWidth: 900 }) : null,
        openNow: openNow === undefined ? null : openNow, closedForGood: pl.businessStatus === 'CLOSED_PERMANENTLY', t: Date.now()
      };
      store.set('gcache', S.gcache);
      if (S.gcache[p.id].closedForGood) toast(p.name + ' est indiqué comme fermé définitivement sur Google.');
    } catch (e) { /* quota ou réseau : on garde la fiche sans note Google */ }
  }

  async function onMapClick(e) {
    if (!e.latLng) return;
    if (e.placeId) {
      e.stop();
      try {
        const pl = new libs.places.Place({ id: e.placeId, requestedLanguage: 'fr' });
        await pl.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
        setDraft({ name: pl.displayName, address: pl.formattedAddress, lat: pl.location.lat(), lng: pl.location.lng(), gid: e.placeId });
      } catch (err) { setDraft({ name: '', lat: e.latLng.lat(), lng: e.latLng.lng() }); }
    } else {
      setDraft({ name: '', lat: e.latLng.lat(), lng: e.latLng.lng() });
    }
    switchTab('add');
  }

  function setupAutocomplete() {
    const slot = $('#ac-slot');
    try {
      const ac = new libs.places.PlaceAutocompleteElement({ includedRegionCodes: ['us'], locationBias: { center: origin(), radius: 30000 } });
      ac.id = 'ac';
      slot.innerHTML = ''; slot.appendChild(ac);
      const handle = async (pred) => {
        const pl = pred.toPlace ? pred.toPlace() : pred;
        await pl.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
        setDraft({ name: pl.displayName, address: pl.formattedAddress, lat: pl.location.lat(), lng: pl.location.lng(), gid: pl.id });
      };
      ac.addEventListener('gmp-select', (ev) => handle(ev.placePrediction));
      ac.addEventListener('gmp-placeselect', (ev) => handle(ev.place));
    } catch (e) {
      slot.innerHTML = '';
    }
  }

  /* ---------- carte de secours (sans clé) ---------- */
  function renderFallback() {
    const box = $('#map');
    const list = visible();
    const pts = list.concat([origin()]);
    const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
    const o = origin();
    // Fenêtre centrée sur la position, ~3 km de rayon, élargie si peu de lieux.
    const near = list.filter((p) => distKm(o, p) < 2.5);
    const span = near.length >= 5 ? 0.022 : Math.max(0.03, Math.min(0.2, (Math.max(...lats) - Math.min(...lats)) / 1.6));
    const w = box.clientWidth || 360, h = box.clientHeight || 300;
    const latS = span, lngS = span * 1.32 * (w / h);
    const pos = (p) => ({ x: (p.lng - (o.lng - lngS / 2)) / lngS * w, y: ((o.lat + latS / 2) - p.lat) / latS * h });
    let html = '<div class="fallback-map" aria-hidden="true"></div>';
    list.forEach((p) => {
      const q = pos(p); if (q.x < -20 || q.x > w + 20 || q.y < -20 || q.y > h + 20) return;
      const c = catOf(p);
      html += '<button class="fb-pin' + (p.claire ? ' cl' : '') + '" data-open="' + esc(p.id) + '" style="left:' + q.x.toFixed(1) + 'px;top:' + q.y.toFixed(1) + 'px;background:' + c.color + ';color:' + c.text + (S.done[p.id] ? ';opacity:.45' : '') + '" aria-label="' + esc(p.name) + '">' + esc(letter(p)) + '</button>';
    });
    const me = pos(o);
    html += '<div class="me-dot" style="left:' + me.x + 'px;top:' + me.y + 'px"></div>';
    html += '<div class="map-note">Aperçu sans Google Maps. Ajoutez votre clé dans config.js pour la vraie carte.</div>';
    box.innerHTML = html;
  }

  /* ---------- GPS ---------- */
  function startGps() {
    if (!navigator.geolocation) { setWhere(); return; }
    navigator.geolocation.watchPosition((pos) => {
      const first = !S.me;
      S.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      S.meSource = 'gps';
      // Hors de New York : on garde l'hôtel comme repère.
      if (distKm(S.me, { lat: 40.758, lng: -73.9855 }) > 60) { S.me = null; S.meSource = 'hotel'; setWhere('Hors de New York · repère : ' + (CFG.HOTEL && CFG.HOTEL.name || 'hôtel')); refresh(); return; }
      setWhere();
      renderMe();
      if (first && map) map.panTo(S.me);
      renderNear(); if (!mapsReady) renderFallback();
    }, () => { S.meSource = 'hotel'; setWhere('GPS désactivé · repère : ' + (CFG.HOTEL && CFG.HOTEL.name || 'hôtel')); refresh(); }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  }
  function setWhere(txt) {
    if (txt) { $('#where').textContent = txt; return; }
    const o = origin();
    const nearest = allPlaces().filter((p) => p.hood).sort((a, b) => distKm(o, a) - distKm(o, b))[0];
    $('#where').textContent = S.meSource === 'gps' && nearest ? 'Vous êtes près de ' + nearest.hood : 'Repère : ' + (CFG.HOTEL && CFG.HOTEL.name || 'hôtel');
  }

  /* ---------- Ajouter ---------- */
  function renderAddCats() {
    $('#add-cats').innerHTML = Object.keys(CATS).map((k) =>
      '<button data-cat="' + k + '" aria-pressed="' + (S.addCat === k) + '"><span class="dot" style="width:14px;height:14px;background:' + CATS[k].color + '"></span>' + CATS[k].label + '</button>').join('');
  }
  function setDraft(d) {
    S.draft = Object.assign(S.draft || {}, d);
    if (d.name) $('#add-name').value = d.name;
    const f = $('#add-found');
    if (S.draft.lat != null) {
      f.hidden = false;
      f.innerHTML = '<span class="tag">Lieu placé sur la carte</span><b style="font-size:17px">' + esc($('#add-name').value || 'Sans nom') + '</b><span class="help">' + esc(S.draft.address || (S.draft.lat.toFixed(5) + ', ' + S.draft.lng.toFixed(5))) + ' · ' + travelLabel(walkMin(S.draft)) + '</span>';
      if (mapsReady) {
        if (!draftMarker) { const el = document.createElement('div'); el.className = 'pin'; el.style.background = CATS.mine.color; el.style.color = '#141414'; el.textContent = '+'; draftMarker = new libs.marker.AdvancedMarkerElement({ map, position: S.draft, content: el }); }
        else draftMarker.position = { lat: S.draft.lat, lng: S.draft.lng };
      }
    } else { f.hidden = true; }
  }
  function parseLink(url) {
    const out = { link: url };
    let m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) { out.lat = parseFloat(m[1]); out.lng = parseFloat(m[2]); }
    const n = url.match(/\/place\/([^/@]+)/);
    if (n) out.name = decodeURIComponent(n[1].replace(/\+/g, ' '));
    return out;
  }
  function saveDraft() {
    const name = $('#add-name').value.trim();
    const d = S.draft || {};
    if (!name) { toast('Donnez un nom au lieu.'); $('#add-name').focus(); return; }
    if (d.lat == null) { toast('Placez le lieu : cherchez-le, collez un lien Google Maps, touchez la carte ou utilisez votre position.'); return; }
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const twin = allPlaces().find((q) => distKm(q, d) < 0.15 && (norm(q.name).includes(norm(name)) || norm(name).includes(norm(q.name))));
    if (twin) { toast(twin.name + ' est déjà sur la carte.'); switchTab('around'); openFiche(twin.id); return; }
    const zone = guessZone(d);
    const p = {
      id: 'c-' + Date.now().toString(36), custom: true, name, cat: S.addCat, zone,
      hood: d.address ? d.address.split(',').slice(-3, -2)[0]?.trim() || zone : zone,
      address: d.address || '', lat: d.lat, lng: d.lng, note: $('#add-note').value.trim(), link: d.link || ''
    };
    S.custom.push(p); store.set('custom', S.custom);
    S.draft = null; $('#add-name').value = ''; $('#add-note').value = ''; $('#add-link').value = ''; $('#add-found').hidden = true;
    if (draftMarker) { draftMarker.map = null; draftMarker = null; }
    const ac = $('#ac'); if (ac) ac.value = '';
    toast('Ajouté : ' + name);
    refresh(); switchTab('around'); openFiche(p.id);
  }
  function guessZone(p) {
    if (p.address) { for (const z of ['Brooklyn', 'Bronx', 'Queens', 'Staten Island']) if (p.address.includes(z)) return z; }
    if (p.lat > 40.80 && p.lng > -73.93) return 'Bronx';
    if (p.lat < 40.70 || (p.lng > -73.97 && p.lat < 40.735)) return 'Brooklyn';
    if (p.lng > -73.94) return 'Queens';
    return 'Manhattan';
  }

  /* ---------- Liste de Claire ---------- */
  S.cSections = []; S.cTips = []; S.cTrips = ''; S.cOnly = [];
  S.cMode = 'sec';      // 'sec' = par rubrique, 'near' = autour de moi
  S.cStar = false;      // seulement ses coups de cœur
  function secLabel(id) { const s = S.cSections.find((x) => x.id === id); return s ? s.label : id; }
  function claireRow(p, sec) {
    const note = sec ? claireNote(p, sec) : '';
    return '<div class="crow">' + rowHtml(p) + (note ? '<p class="cq">« ' + esc(note) + ' »</p>' : '') + '</div>';
  }
  function renderClaire() {
    const all = allPlaces().filter((p) => p.claire);
    const groups = nearestOfGroups(all);
    const nStar = groups.filter((p) => p.claire.star).length;
    const keep = (p) => !S.cStar || p.claire.star;
    let body = '';
    if (S.cMode === 'near') {
      const list = groups.filter((p) => !p.closedForGood && keep(p)).sort((a, b) => walkMin(a) - walkMin(b));
      body = '<div class="card">' + list.map((p) => claireRow(p, p.claire.sec.find((s) => p.claire.notes[s]))).join('') + '</div>';
    } else {
      body = S.cSections.map((s) => {
        const list = groups.filter((p) => p.claire.sec.includes(s.id) && keep(p))
          .sort((a, b) => (a.closedForGood ? 1 : 0) - (b.closedForGood ? 1 : 0) || (b.claire.star ? 1 : 0) - (a.claire.star ? 1 : 0) || walkMin(a) - walkMin(b));
        const only = S.cOnly.filter((p) => p.claire.sec.includes(s.id) && keep(p));
        if (!list.length && !only.length) return '';
        return '<section class="csec"><h3 class="label">' + esc(s.label) + ' <span>' + (list.length + only.length) + '</span></h3><div class="card">' +
          list.map((p) => claireRow(p, s.id)).join('') +
          only.map((p) => '<div class="crow"><div class="row" style="cursor:default"><span class="bullet" style="background:var(--soft);color:var(--ink)">?</span><span class="row-main"><b>' + esc(p.name) + '</b><span>Adresse introuvable sur Google Maps</span></span></div>' +
            (claireNote(p, s.id) ? '<p class="cq">« ' + esc(claireNote(p, s.id)) + ' »</p>' : '') + '</div>').join('') +
          '</div></section>';
      }).join('');
    }
    $('#claire-page').innerHTML =
      '<div class="claire-hero"><span class="label" style="color:#fff">La liste de</span><b>Claire</b><span>' + groups.length + ' adresses · ' + nStar + ' coups de cœur ★</span></div>' +
      '<div class="seg" role="toolbar" aria-label="Affichage">' +
        '<button data-cmode="sec" aria-pressed="' + (S.cMode === 'sec') + '">Par rubrique</button>' +
        '<button data-cmode="near" aria-pressed="' + (S.cMode === 'near') + '">Autour de moi</button>' +
        '<button data-cstar aria-pressed="' + S.cStar + '">★ Ses coups de cœur</button>' +
      '</div>' + body +
      '<section class="csec"><h3 class="label">Les tips de Claire</h3><div class="card tips">' + S.cTips.map((t) => '<p>' + esc(t) + '</p>').join('') + '</div></section>' +
      (S.cTrips ? '<section class="csec"><h3 class="label">Ses idées de voyages hors de New York</h3><div class="card tips"><p>' + esc(S.cTrips) + '</p></div></section>' : '');
  }

  /* ---------- Carnet ---------- */
  const AGENDA = [
    { d: '2026-11-20', t: 'Arrivée. Le village de Noël de Bryant Park est ouvert, patinoire gratuite jusqu\'à minuit.' },
    { d: '2026-11-21', t: 'Ouverture des Holiday Lights du Bronx Zoo (certains soirs).' },
    { d: '2026-11-25', t: 'Gonflage des ballons de la parade autour du Muséum d\'histoire naturelle, l\'après-midi. Le Met est fermé (mercredi).' },
    { d: '2026-11-26', t: 'Thanksgiving : 100e parade Macy\'s à 8h30. Le Met et le Muséum sont fermés, beaucoup de restos ont un menu spécial, réservez.' },
    { d: '2026-11-27', t: 'Black Friday : grosses promos, magasins ouverts très tôt. Les lumières de Dyker Heights commencent à s\'allumer.' },
    { d: '2026-11-28', t: 'Départ. Dernier bagel chez Russ & Daughters ?' }
  ];
  const CHALLENGES = {
    Bronx: 'Un cannolo chez Madonia, sur Arthur Avenue.',
    Brooklyn: 'La photo du Manhattan Bridge depuis Washington Street.',
    Manhattan: 'Chuchoter un secret dans la Whispering Gallery de Grand Central.'
  };
  function renderBook() {
    const all = allPlaces();
    const doneN = all.filter((p) => S.done[p.id]).length;
    const duo = all.filter((p) => { const v = S.votes[p.id]; return v && v.a && v.b; }).length;
    const zones = ZONES.filter((z) => all.some((p) => p.zone === z));
    const zDone = zones.filter((z) => all.some((p) => p.zone === z && S.done[p.id])).length;
    const col = { Manhattan: '#2F6FE0', Brooklyn: '#FF6319', Bronx: '#00933C', Queens: '#B933AD', 'Staten Island': '#141414' };
    const today = isoDay(nyNow());
    const stamps = zones.map((z) => {
      const zs = all.filter((p) => p.zone === z), dz = zs.filter((p) => S.done[p.id]);
      const on = dz.length > 0;
      const first = dz.map((p) => S.done[p.id]).sort()[0];
      const label = on ? new Date(first).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '') : 'À débloquer';
      return '<div class="stamp-card"><div class="stamp' + (on ? ' on' : '') + '" style="' + (on ? 'border-color:' + col[z] + ';color:' + col[z] + ';transform:rotate(' + ((z.length % 3) * 6 - 6) + 'deg)' : '') + '"><b style="font-size:' + (z.length > 8 ? 13 : 16) + 'px">' + esc(z) + '</b><small>' + esc(label) + '</small></div><span style="font-weight:600;font-size:14px">' + dz.length + ' / ' + zs.length + ' lieux</span></div>';
    }).join('');
    const nearZone = (allPlaces().slice().sort((a, b) => distKm(origin(), a) - distKm(origin(), b))[0] || {}).zone || 'Manhattan';
    $('#book-page').innerHTML =
      '<div class="kpis"><div><b>' + doneN + '</b><span>lieux faits</span></div><div><b>' + duo + '</b><span>envies communes</span></div><div><b>' + zDone + '/' + zones.length + '</b><span>quartiers</span></div></div>' +
      '<div class="challenge"><span>Défi du moment · ' + esc(nearZone) + '</span><b style="font-size:15px;line-height:1.4">' + esc(CHALLENGES[nearZone] || CHALLENGES.Manhattan) + '</b></div>' +
      '<span class="label">Vos tampons</span><div class="stamps">' + stamps + '</div>' +
      '<span class="label">Votre semaine</span><div class="agenda">' + AGENDA.map((a) => {
        const dd = new Date(a.d + 'T12:00:00');
        return '<div class="ag"><time class="' + (a.d === today ? 'today' : '') + '">' + dd.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }).replace('.', '') + '</time><div>' + esc(a.t) + '</div></div>';
      }).join('') + '</div>' +
      '<span class="label">Partager avec votre partenaire</span>' +
      '<p class="help" style="margin:0">Envoyez vos ajouts, coches et votes par message. Votre partenaire colle le code dans son app et tout est fusionné.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="small-btn" id="share-copy">Copier mon code</button><button class="small-btn" id="share-paste">Coller un code</button></div>' +
      '<textarea id="share-box" rows="3" class="search" style="height:auto;padding:12px" hidden aria-label="Code de partage"></textarea>' +
      '<button class="small-btn" id="share-apply" hidden>Fusionner</button>' +
      '<span class="label">Vos prénoms</span>' +
      '<div style="display:flex;gap:8px"><input class="search" id="name-a" value="' + esc(NAMES.a) + '" aria-label="Prénom 1"><input class="search" id="name-b" value="' + esc(NAMES.b) + '" aria-label="Prénom 2"></div>';
  }
  function exportCode() { return btoa(unescape(encodeURIComponent(JSON.stringify({ c: S.custom, d: S.done, v: S.votes })))); }
  function importCode(code) {
    const o = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    (o.c || []).forEach((p) => { if (!S.custom.some((q) => q.id === p.id)) S.custom.push(p); });
    Object.assign(S.done, o.d || {});
    Object.keys(o.v || {}).forEach((id) => {
      const mine = S.votes[id] || {}, theirs = o.v[id];
      S.votes[id] = { a: !!(mine.a || theirs.a), b: !!(mine.b || theirs.b) };
    });
    store.set('custom', S.custom); store.set('done', S.done); store.set('votes', S.votes);
  }

  /* ---------- divers ---------- */
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800); }
  function showBanner(msg) { const b = $('#banner'); b.innerHTML = '<span>' + esc(msg) + '</span><button type="button" data-hide-banner>OK</button>'; b.hidden = false; }

  function switchTab(t) {
    S.tab = t;
    document.querySelectorAll('.tab').forEach((b) => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('#v-around').hidden = t !== 'around'; $('#v-list').hidden = t !== 'list'; $('#v-add').hidden = t !== 'add'; $('#v-book').hidden = t !== 'book'; $('#v-claire').hidden = t !== 'claire';
    $('#chips').hidden = t === 'add' || t === 'book' || t === 'claire';
    if (t === 'list') { renderZones(); renderAll(); }
    if (t === 'claire') renderClaire();
    if (t === 'book') renderBook();
    if (t === 'around') requestAnimationFrame(() => setSheet(S.sheet));
  }
  function refresh() { renderChips(); renderNear(); renderMarkers(); if (S.tab === 'list') renderAll(); if (S.tab === 'book') renderBook(); if (S.tab === 'claire') renderClaire(); }

  function surprise() {
    const pool = visible().filter((p) => !S.done[p.id] && !closedToday(p) && walkMin(p) <= 20);
    const list = pool.length ? pool : visible().filter((p) => !S.done[p.id]);
    if (!list.length) { toast('Tout est fait ici. Bravo !'); return; }
    const p = list[Math.floor(Math.random() * list.length)];
    toast('Et si vous alliez… ' + p.name + ' ?');
    openFiche(p.id);
  }

  /* ---------- événements ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a'); if (!t) return;
    if (t.dataset.f) { S.filter = t.dataset.f; refresh(); return; }
    if (t.dataset.z) { S.zone = t.dataset.z; renderZones(); renderAll(); return; }
    if (t.dataset.cmode) { S.cMode = t.dataset.cmode; renderClaire(); return; }
    if (t.hasAttribute('data-cstar')) { S.cStar = !S.cStar; renderClaire(); return; }
    if (t.dataset.open) { openFiche(t.dataset.open); return; }
    if (t.dataset.tab) { switchTab(t.dataset.tab); return; }
    if (t.dataset.cat) { S.addCat = t.dataset.cat; renderAddCats(); return; }
    if (t.hasAttribute('data-close')) { closeFiche(); return; }
    if (t.hasAttribute('data-hide-banner')) { $('#banner').hidden = true; return; }
    const id = $('#modal').dataset.id;
    if (t.dataset.vote && id) {
      const v = S.votes[id] || {}; v[t.dataset.vote] = !v[t.dataset.vote]; S.votes[id] = v; store.set('votes', S.votes);
      if (v.a && v.b) toast('Envie commune !');
      openFiche(id); refresh(); return;
    }
    if (t.hasAttribute('data-done') && id) {
      if (S.done[id]) delete S.done[id]; else S.done[id] = new Date().toISOString();
      store.set('done', S.done);
      const p = byId(id);
      if (S.done[id] && p) { const zDone = allPlaces().filter((q) => q.zone === p.zone && S.done[q.id]).length; if (zDone === 1) toast('Nouveau tampon : ' + p.zone + ' !'); }
      openFiche(id); refresh(); return;
    }
    if (t.hasAttribute('data-del') && id) {
      S.custom = S.custom.filter((p) => p.id !== id); store.set('custom', S.custom);
      if (markers[id]) { markers[id].map = null; delete markers[id]; }
      closeFiche(); refresh(); toast('Lieu supprimé.'); return;
    }
    if (t.id === 'surprise') { surprise(); return; }
    if (t.id === 'hungry') { S.hungry = !S.hungry; t.setAttribute('aria-pressed', S.hungry); t.style.background = S.hungry ? '#FF6319' : ''; t.style.color = S.hungry ? '#fff' : ''; refresh(); return; }
    if (t.id === 'locate') { if (S.me && map) { map.panTo(S.me); map.setZoom(15); } else startGps(); return; }
    if (t.id === 'add-save') { saveDraft(); return; }
    if (t.id === 'add-here') {
      if (S.me) setDraft({ lat: S.me.lat, lng: S.me.lng });
      else toast('Position GPS indisponible. Autorisez la localisation pour cette page.');
      return;
    }
    if (t.id === 'share-copy') {
      const code = exportCode();
      const box = $('#share-box'); box.hidden = false; box.value = code;
      (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => toast('Code copié. Envoyez-le par message.'), () => { box.select(); toast('Sélectionnez et copiez le code.'); });
      return;
    }
    if (t.id === 'share-paste') { $('#share-box').hidden = false; $('#share-box').value = ''; $('#share-apply').hidden = false; $('#share-box').focus(); return; }
    if (t.id === 'share-apply') {
      try { importCode($('#share-box').value); toast('Fusion réussie.'); refresh(); renderBook(); }
      catch (err) { toast('Code illisible. Recopiez-le en entier.'); }
    }
  });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeFiche(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeFiche(); });
  $('#q').addEventListener('input', (e) => { S.query = e.target.value; renderAll(); });
  $('#add-link').addEventListener('change', (e) => {
    const v = e.target.value.trim(); if (!v) return;
    const d = parseLink(v);
    if (d.lat == null && /maps\.app\.goo\.gl|goo\.gl\/maps/.test(v)) toast('Lien court Google Maps : ouvrez-le, puis copiez le lien complet depuis la barre d\'adresse, ou cherchez le lieu par son nom.');
    else if (d.lat == null) toast('Lien gardé. Cherchez maintenant le lieu par son nom pour le placer.');
    setDraft(d);
  });
  $('#add-name').addEventListener('input', () => { if (S.draft && S.draft.lat != null) setDraft({}); });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'name-a' || e.target.id === 'name-b') {
      NAMES[e.target.id === 'name-a' ? 'a' : 'b'] = e.target.value.trim() || (e.target.id === 'name-a' ? 'Moi' : 'Toi');
      store.set('names', NAMES);
    }
  });
  window.addEventListener('resize', () => { if (!mapsReady && S.tab === 'around') renderFallback(); });

  /* ---------- panneau glissant (liste / carte plein écran) ---------- */
  const SHEET_ORDER = ['min', 'half', 'max'];
  S.sheet = 'half';
  function sheetHeights() {
    const viewH = $('#v-around').clientHeight || window.innerHeight;
    const minH = ($('#sheet-top').offsetHeight || 70) + 6;
    return { min: minH, half: Math.round(viewH * 0.5), max: Math.max(minH, viewH - 72) };
  }
  function setSheet(state) {
    const hs = sheetHeights(), sheet = $('#sheet');
    S.sheet = state;
    sheet.style.height = hs[state] + 'px';
    sheet.dataset.state = state;
    $('#sheet-top').setAttribute('aria-expanded', state !== 'min');
    // La carte occupe tout l'espace au-dessus du panneau (le logo Google reste visible).
    $('#v-around').style.setProperty('--map-b', Math.max(0, hs[state] - 16) + 'px');
    if (!mapsReady) setTimeout(renderFallback, 30);
  }
  (function initSheet() {
    const top = $('#sheet-top'), sheet = $('#sheet');
    let drag = null;
    top.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, h: sheet.offsetHeight, t: Date.now(), moved: false, dy: 0 };
      try { top.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      sheet.classList.add('dragging');
    });
    top.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.dy = e.clientY - drag.y;
      if (Math.abs(drag.dy) > 5) drag.moved = true;
      const hs = sheetHeights();
      sheet.style.height = Math.min(hs.max, Math.max(hs.min, drag.h - drag.dy)) + 'px';
    });
    const end = () => {
      if (!drag) return;
      sheet.classList.remove('dragging');
      const d = drag; drag = null;
      const i = SHEET_ORDER.indexOf(S.sheet);
      if (!d.moved) { setSheet(S.sheet === 'min' ? 'half' : 'min'); return; }
      const v = d.dy / Math.max(1, Date.now() - d.t); // px par ms, positif = vers le bas
      if (v > 0.45) { setSheet(SHEET_ORDER[Math.max(0, i - 1)]); return; }
      if (v < -0.45) { setSheet(SHEET_ORDER[Math.min(2, i + 1)]); return; }
      const hs = sheetHeights(), h = sheet.offsetHeight;
      setSheet(SHEET_ORDER.reduce((best, s) => Math.abs(hs[s] - h) < Math.abs(hs[best] - h) ? s : best, 'half'));
    };
    top.addEventListener('pointerup', end);
    top.addEventListener('pointercancel', end);
    top.addEventListener('keydown', (e) => {
      const i = SHEET_ORDER.indexOf(S.sheet);
      if (e.key === 'ArrowUp') { e.preventDefault(); setSheet(SHEET_ORDER[Math.min(2, i + 1)]); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSheet(SHEET_ORDER[Math.max(0, i - 1)]); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(S.sheet === 'min' ? 'half' : 'min'); }
    });
    window.addEventListener('resize', () => setSheet(S.sheet));
  })();

  /* ---------- démarrage ---------- */
  async function boot() {
    Object.assign(NAMES, store.get('names', {}));
    renderAddCats();
    try {
      const res = await fetch('places.json', { cache: 'no-cache' });
      const data = await res.json();
      S.places = data.places || [];
      S.cSections = data.claireSections || [];
      S.cTips = data.claireTips || [];
      S.cTrips = data.claireTrips || '';
      S.cOnly = data.claireOnly || [];
    } catch (e) {
      S.places = (window.BP_PLACES && window.BP_PLACES.places) || [];
      if (!S.places.length) showBanner('Impossible de charger la liste des lieux. Vérifiez la connexion.');
    }
    // Lieux mis à jour par Claude : on n'écrase jamais vos ajouts.
    setWhere();
    refresh();
    setSheet('half');
    const ok = await initGoogle();
    if (ok) { renderMarkers(); }
    else {
      if (!CFG.GOOGLE_MAPS_KEY) $('#ac-help').textContent = 'La recherche Google s\'activera avec la clé. En attendant : collez un lien Google Maps ou utilisez votre position.';
      renderFallback();
    }
    startGps();
  }
  boot();
})();
