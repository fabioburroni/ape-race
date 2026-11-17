// Ape Race – modalità online (lobby, sincronizzazione, classifica comune)
// Si appoggia alle funzioni e variabili del gioco definite in index.html.
'use strict';
(function () {
  const $ = s => document.querySelector(s);
  const SEND_HZ = 12, INTERP_MS = 130;
  const NET = window.NET = {
    ws: null, you: null, code: null, host: null, players: [], setup: null, phase: 'lobby',
    offset: 0, rtt: 0, remotes: new Map(), sendT: 0, finished: false, results: null, ready: false
  };
  NET.now = () => Date.now() + NET.offset;

  // ---------- interfaccia ----------
  const css = document.createElement('style');
  css.textContent = `
  #onl .card{max-width:470px}
  #onl .code{font:44px 'Bowlby One',sans-serif;color:var(--terra);letter-spacing:6px;text-align:center;margin:6px 0}
  #onl .plist{list-style:none;margin:10px 0}
  #onl .plist li{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:12px;font-weight:800}
  #onl .plist li:nth-child(odd){background:#f3e6c8}
  #onl .plist .dot{width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 2px rgba(0,0,0,.25)}
  #onl .plist .st{margin-left:auto;font-size:13px}
  #onl .err{color:#b3261e;font-weight:800;font-size:14px;margin-top:8px}
  #onl .share{font-size:13px;word-break:break-all;background:#fff;border:2px dashed #d9c49a;border-radius:10px;padding:6px 8px;margin-top:6px}
  #netbadge{position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:7;background:rgba(43,29,20,.75);color:#fff;font:800 12px Nunito,sans-serif;padding:3px 10px;border-radius:10px;pointer-events:none}
  #emo{position:fixed;left:50%;bottom:62px;transform:translateX(-50%);z-index:7;display:flex;gap:6px}
  #emo button{border:0;background:rgba(251,243,226,.9);border-radius:10px;width:38px;height:34px;font-size:18px}
  @media (max-width:520px){#emo{bottom:180px}}`;
  document.head.appendChild(css);
  const ov = document.createElement('div'); ov.id = 'onl'; ov.className = 'overlay hidden';
  ov.innerHTML = `<div class="card"><h1 style="font-size:36px">Online</h1><p class="sub">Corri con gli amici, ognuno dal suo computer o telefono</p><div id="onlbody"></div></div>`;
  document.body.appendChild(ov);
  const badge = document.createElement('div'); badge.id = 'netbadge'; badge.className = 'hidden'; document.body.appendChild(badge);
  const emo = document.createElement('div'); emo.id = 'emo'; emo.className = 'hidden';
  emo.innerHTML = ['👋', '😂', '🔥', '😱', '🏁'].map(e => `<button data-e="${e}">${e}</button>`).join('');
  document.body.appendChild(emo);
  emo.addEventListener('click', e => { const b = e.target.closest('button'); if (b) send({ t: 'emoji', e: b.dataset.e }); });

  // pulsante nel menu principale
  const freeBtn = $('#free');
  const btn = document.createElement('button'); btn.id = 'online'; btn.className = 'sec'; btn.textContent = '🌐 Online con amici';
  btn.style.background = '#e4ecd2'; btn.style.borderColor = '#5d6b35';
  freeBtn.parentNode.insertBefore(btn, freeBtn.nextSibling);
  btn.onclick = () => openPanel();

  const esc = s => String(s).replace(/[<>&"']/g, '');
  function body(html) { $('#onlbody').innerHTML = html; }
  function openPanel(code) {
    initAudio && initAudio();
    $('#menu').classList.add('hidden'); ov.classList.remove('hidden');
    if (NET.code) return renderLobby();
    body(`<label class="lbl">Il tuo nome</label><input type="text" id="onlname" maxlength="12" value="${esc(cfg.name || 'Pilota')}">
      <p class="small" style="margin-top:6px">La tua Ape è quella del Garage: gli altri la vedranno con i tuoi colori.</p>
      <div class="row" style="margin-top:14px"><button class="big" id="onlcreate">Crea una partita</button></div>
      <label class="lbl" style="margin-top:16px">Oppure entra con il codice di un amico</label>
      <div class="row"><input type="text" id="onlcode" maxlength="6" placeholder="es. K7PX" style="flex:1;text-transform:uppercase" value="${esc(code || '')}"><button class="sec" id="onljoin">Entra</button></div>
      <div class="err" id="onlerr"></div>
      <div class="row" style="margin-top:16px"><button class="sec" id="onlback">← Torna al menù</button></div>`);
    $('#onlcreate').onclick = () => connect(() => send({ t: 'create', cfg: myCfg() }));
    $('#onljoin').onclick = () => { const c = $('#onlcode').value.trim().toUpperCase(); if (!c) return err('Scrivi il codice della partita.'); connect(() => send({ t: 'join', code: c, cfg: myCfg() })) };
    $('#onlback').onclick = closePanel;
    if (code) $('#onljoin').focus();
  }
  function closePanel() { ov.classList.add('hidden'); $('#menu').classList.remove('hidden') }
  function err(m) { const e = $('#onlerr'); if (e) e.textContent = m; else alertBox(m) }
  function alertBox(m) { flash(m, 2.5) }
  function myCfg() { const n = $('#onlname'); if (n && n.value.trim()) { cfg.name = n.value.trim().slice(0, 12); try { saveCfg() } catch (e) { } } return cfg }

  // ---------- connessione ----------
  function connect(then) {
    if (NET.ws && NET.ws.readyState === 1) return then();
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    let ws; try { ws = new WebSocket(url) } catch (e) { return err('Non riesco a collegarmi al server di gioco.') }
    NET.ws = ws; err('Mi collego…');
    ws.onopen = () => { err(''); syncClock(); then() };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data) } catch (e) { return } onMsg(m) };
    ws.onclose = () => { const was = NET.code; resetNet(); if (was) { flash('Connessione persa', 2.5); toMenuFromNet() } else err('Server non raggiungibile. Riprova tra poco: se il server era fermo, si sveglia in circa 30 secondi.') };
  }
  function send(m) { if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify(m)) }
  NET.send = send;
  function syncClock() { let n = 0; const go = () => { if (!NET.ws || NET.ws.readyState !== 1 || n++ > 5) return; send({ t: 'ping', c: Date.now() }); setTimeout(go, 400) }; go() }
  setInterval(() => { if (NET.ws && NET.ws.readyState === 1) send({ t: 'ping', c: Date.now() }) }, 5000);

  function onMsg(m) {
    switch (m.t) {
      case 'pong': { const now = Date.now(), rtt = now - m.c, off = m.s + rtt / 2 - now; NET.rtt = NET.rtt ? NET.rtt * .7 + rtt * .3 : rtt; NET.offset = NET.offset ? NET.offset * .7 + off * .3 : off; break }
      case 'error': err(m.msg); break;
      case 'joined': NET.code = m.code; NET.you = m.you; try { history.replaceState(null, '', '?room=' + m.code) } catch (e) { } break;
      case 'room': NET.host = m.host; NET.players = m.players; NET.setup = m.setup; NET.phase = m.phase; if (state === 'menu' || !ov.classList.contains('hidden')) renderLobby(); if (NET_ON) syncRemotes(); break;
      case 'hello': if (NET_ON || !ov.classList.contains('hidden')) flash(m.name + ' è entrato', 1.5); break;
      case 'left': { const r = NET.remotes.get(m.id); if (r) { flash(r.name + ' è uscito', 1.5); removeRemote(m.id) } break }
      case 'start': startRace(m); break;
      case 'state': { const r = NET.remotes.get(m.id); if (r) { r.snaps.push(m); if (r.snaps.length > 30) r.snaps.shift() } break }
      case 'push': { if (!player || player.rolled > 0) break; player.kvx = (player.kvx || 0) + m.fx; player.kvy = (player.kvy || 0) + m.fy; player.v *= .8; player.tilt += -Math.sign(m.tilt || 1) * (.35 + Math.abs(player.v) * .02); shake = Math.max(shake, .35); beep(100, .18, .18);
        const r = NET.remotes.get(m.from); flash((r ? r.name : 'Qualcuno') + ' ti ha spinto!', 1.2); if (Math.random() < .4) dropItem(player, 1); break }
      case 'finish': { const r = NET.remotes.get(m.id); if (r) { r.done = true; r.time = m.time; r.netLost = m.lost; flash(r.name + ' è arrivato!', 1.5) } if (NET.finished) renderWait(); break }
      case 'results': NET.results = m.list; showFinal(); break;
      case 'emoji': { const who = m.id === NET.you ? 'Tu' : ((NET.remotes.get(m.id) || {}).name || ''); flash(who + ' ' + m.e, 1.6); break }
    }
  }

  // ---------- lobby ----------
  function renderLobby() {
    if (!NET.code) return;
    const isHost = NET.host === NET.you, me = NET.players.find(p => p.id === NET.you);
    const link = location.origin + location.pathname + '?room=' + NET.code;
    const routes = (world.routes || []).map((r, i) => `<option value="${i}">${esc(r.n)}</option>`).join('') + `<option value="${(world.routes || []).length}">Percorso a sorpresa</option>`;
    const towns = TOWNS.map(t => `<option ${t.name === (NET.setup && NET.setup.town) ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const s = NET.setup || { town: 'Asciano', routeIdx: 0, diff: 1 };
    body(`<div class="small" style="text-align:center">Codice della partita</div><div class="code">${NET.code}</div>
      <div class="small">Manda questo link agli amici:</div><div class="share" id="onllink">${esc(link)}</div>
      <div class="row" style="margin-top:6px"><button class="sec" id="onlcopy" style="flex:1">Copia il link</button></div>
      <ul class="plist">${NET.players.map(p => `<li><span class="dot" style="background:${esc(p.cfg.body || '#4fb3d9')}"></span>${esc(p.name)}${p.id === NET.you ? ' (tu)' : ''}${p.id === NET.host ? ' 👑' : ''}<span class="st">${p.ready ? '✅ pronto' : '…'}</span></li>`).join('')}</ul>
      ${isHost ? `<div class="two"><div><label class="lbl">Paese</label><select id="onltown">${towns}</select></div><div><label class="lbl">Ostacoli</label><select id="onldiff"><option value="0">Pochi</option><option value="1">Normali</option><option value="2">Tanti</option></select></div></div>
        <label class="lbl">Percorso</label><select id="onlroute">${routes}</select>`
        : `<div class="info">Paese: <b>${esc(s.town)}</b> · Percorso: <b>${esc(routeName(s))}</b><br>Decide ${esc((NET.players.find(p => p.id === NET.host) || {}).name || 'chi ha creato la partita')} 👑</div>`}
      <div class="row" style="margin-top:12px">${isHost ? `<button class="big" id="onlstart">Parti!</button>` : `<button class="big" id="onlready">${me && me.ready ? 'Non sono pronto' : 'Sono pronto'}</button>`}</div>
      <p class="small" style="margin-top:6px">${isHost ? 'Puoi partire quando vuoi: chi non è pronto parte lo stesso.' : 'Aspetta che 👑 faccia partire la gara.'} In gara non ci sono avversari del computer, solo giocatori veri.</p>
      <div class="row" style="margin-top:10px"><button class="sec" id="onlleave">Esci dalla partita</button><button class="sec" id="onlgarage">🔧 Garage</button></div>`);
    $('#onlcopy').onclick = () => { try { navigator.clipboard.writeText(link).then(() => flash('Link copiato!', 1.2), () => selectLink()) } catch (e) { selectLink() } };
    $('#onlleave').onclick = leave;
    $('#onlgarage').onclick = () => { ov.classList.add('hidden'); $('#opengarage').click(); const done = $('#gdone'); const prev = done.onclick; done.onclick = () => { prev && prev(); $('#menu').classList.add('hidden'); send({ t: 'cfg', cfg }); ov.classList.remove('hidden'); done.onclick = prev } };
    if (isHost) {
      $('#onltown').value = s.town; $('#onldiff').value = s.diff; ensureTown(s.town); $('#onlroute').value = s.routeIdx;
      const push = () => send({ t: 'setup', town: $('#onltown').value, routeIdx: +$('#onlroute').value, diff: +$('#onldiff').value });
      $('#onltown').onchange = () => { ensureTown($('#onltown').value); $('#onlroute').value = 0; push(); renderLobby() };
      $('#onlroute').onchange = push; $('#onldiff').onchange = push;
      $('#onlstart').onclick = () => { push(); send({ t: 'start' }) };
    } else {
      $('#onlready').onclick = () => send({ t: 'ready', ready: !(me && me.ready) });
    }
  }
  function selectLink() { const el = $('#onllink'), r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); flash('Premi Ctrl+C per copiare', 1.5) }
  function routeName(s) { const R = world && world.name === s.town ? world.routes : null; return R && R[s.routeIdx] ? R[s.routeIdx].n : (s.routeIdx >= (R ? R.length : 0) ? 'a sorpresa' : '—') }
  function ensureTown(name) { if (world && world.name === name) return; const i = TOWNS.findIndex(t => t.name === name); if (i >= 0) { $('#town').value = i; loadTown(TOWNS[i]) } }
  function leave() { send({ t: 'leave' }); const ws = NET.ws; resetNet(); try { ws && ws.close() } catch (e) { } try { history.replaceState(null, '', location.pathname) } catch (e) { } ov.classList.add('hidden'); toMenuFromNet() }
  function resetNet() { NET.code = null; NET.you = null; NET.players = []; NET.finished = false; NET.results = null; NET_ON = false; for (const id of [...NET.remotes.keys()]) removeRemote(id); badge.classList.add('hidden'); emo.classList.add('hidden'); window.NET_RNG = null }
  function toMenuFromNet() { $('#pause').classList.add('hidden'); $('#results').classList.add('hidden'); if (state !== 'menu') toMenu(); else { $('#menu').classList.remove('hidden') } }

  // ---------- gara ----------
  function startRace(m) {
    ov.classList.add('hidden'); $('#results').classList.add('hidden'); $('#pause').classList.add('hidden'); $('#menu').classList.add('hidden');
    ensureTown(m.setup.town); NET.setup = m.setup; NET.players = m.players; NET.finished = false; NET.results = null;
    routeIdx = Math.min(m.setup.routeIdx, (world.routes || []).length);
    makeRoute(mulberry(m.seed + 1)); buildMinimap(); try { updateInfo() } catch (e) { }
    diff = m.setup.diff;
    NET_ON = true; window.NET_RNG = mulberry(m.seed);
    setupRace(false); window.NET_RNG = null;
    NET.startAt = m.startAt; countT = Math.max(.5, (m.startAt - NET.now()) / 1000);
    badge.textContent = 'Online · ' + NET.code; badge.classList.remove('hidden'); emo.classList.remove('hidden');
  }
  NET.onSetup = () => { // chiamata da setupRace: aggiunge le Ape degli altri giocatori sulla griglia
    for (const id of [...NET.remotes.keys()]) removeRemote(id);
    const others = NET.players.filter(p => p.id !== NET.you).sort((a, b) => a.id - b.id);
    const all = NET.players.slice().sort((a, b) => a.id - b.id);
    // posizioni di partenza uguali per tutti, in ordine di arrivo nella stanza
    const slot = id => all.findIndex(p => p.id === id);
    const place = (r, k) => { const row = Math.floor(k / 2), lat = (k % 2 ? -1.2 : 1.2); const s = 18 - row * 7; const q = routeAt(Math.max(2, s)); const nx = -Math.sin(q.h), ny = Math.cos(q.h); const l = lat * Math.min(1, q.w / 5); r.x = q.x + nx * l; r.y = q.y + ny * l; r.a = q.h };
    place(player, slot(NET.you));
    cam.x = player.x; cam.y = player.y; cam.a = player.a;
    for (const p of others) {
      const c = Object.assign({}, p.cfg);
      const r = { id: p.id, remote: true, name: p.name, col: c.body || '#4fb3d9', x: 0, y: 0, a: 0, v: 0, s: 0, lat: 0, latT: 0, w: 5, tilt: 0, cp: 0, done: false, time: 0, rolled: 0, over: 0, steer: 0, boost: 0, lost: 0, snaps: [] };
      place(r, slot(p.id));
      r.mesh = makeApe(c); scene.add(r.mesh.root); r.cargoN = r.mesh.loadItems.length;
      racers.push(r); NET.remotes.set(p.id, r);
    }
  };
  function syncRemotes() { for (const id of [...NET.remotes.keys()]) if (!NET.players.some(p => p.id === id)) removeRemote(id) }
  function removeRemote(id) { const r = NET.remotes.get(id); if (!r) return; NET.remotes.delete(id); if (r.mesh) disposeGroup(r.mesh.root); const i = racers.indexOf(r); if (i >= 0) racers.splice(i, 1) }

  NET.tick = dt => {
    if (!NET_ON || !player) return;
    // tempo di gara uguale per tutti: deciso dall'orologio del server, non dalla velocità del dispositivo
    if (state === 'countdown') countT = (NET.startAt - NET.now()) / 1000;
    else if (state === 'race' && !player.done) raceT = Math.max(0, (NET.now() - NET.startAt) / 1000);
    // invio del mio stato
    NET.sendT -= dt;
    if (NET.sendT <= 0 && (state === 'race' || state === 'countdown' || state === 'results')) {
      NET.sendT = 1 / SEND_HZ;
      send({ t: 'state', x: player.x, y: player.y, a: player.a, v: player.v, tilt: player.tilt, r: player.rolled > 0 ? (player.rollDir || 1) * player.rolled : 0, cp: player.cp, lost: player.lost || 0, b: !!player.boosting });
    }
    // posizioni degli altri, ammorbidite
    const rt = NET.now() - INTERP_MS;
    for (const r of NET.remotes.values()) {
      const S = r.snaps; if (!S.length) continue;
      let i = S.length - 1; while (i > 0 && S[i - 1].ts > rt) i--;
      const b = S[i], a = S[Math.max(0, i - 1)];
      let u = b.ts === a.ts ? 1 : (rt - a.ts) / (b.ts - a.ts); u = Math.max(0, Math.min(1.3, u));
      r.x = a.x + (b.x - a.x) * u; r.y = a.y + (b.y - a.y) * u; r.a = a.a + angDiff(a.a, b.a) * u;
      r.v = b.v; r.tilt = b.tilt; r.cp = Math.max(r.cp, b.cp); r.boosting = b.b;
      if (b.r) { if (!(r.rolled > 0)) r.rollDir = Math.sign(b.r); r.rolled = Math.abs(b.r) } else r.rolled = 0;
      const lost = b.lost | 0; if (r.mesh && r.mesh.loadItems) { const vis = r.mesh.loadItems.filter(g => g.visible).length, want = Math.max(0, r.cargoN - lost); if (vis > want && lost > (r.lost || 0)) { dropItem(r, vis - want) } } r.lost = Math.max(r.lost || 0, lost);
    }
  };
  NET.push = (r, fx, fy, lat) => send({ t: 'push', target: r.id, fx, fy, tilt: lat });

  NET.onLocalFinish = () => { // chiamata al posto della schermata risultati
    if (NET.finished) return; NET.finished = true;
    const pen = (player.lost || 0) * PENALTY, t = player.time + pen;
    send({ t: 'finish', time: t, lost: player.lost || 0 });
    state = 'results'; $('#pauseb').classList.add('hidden');
    renderWait();
  };
  function renderWait() {
    if (NET.results) return showFinal();
    const all = [{ name: (cfg.name || 'Tu') + ' (tu)', col: cfg.body, time: player ? player.time + (player.lost || 0) * PENALTY : null, lost: player ? player.lost || 0 : 0 }]
      .concat([...NET.remotes.values()].map(r => ({ name: r.name, col: r.col, time: r.done ? r.time : null, lost: r.netLost || 0 })));
    all.sort((a, b) => (a.time == null) - (b.time == null) || a.time - b.time);
    $('#restitle').textContent = 'Arrivato!'; $('#ressub').textContent = 'Aspettiamo gli altri…';
    fillList(all); $('#recbox').style.display = 'none';
    $('#again').classList.add('hidden'); $('#newroute').classList.add('hidden'); $('#tomenu').textContent = 'Esci dalla partita'; $('#tomenu').onclick = leave;
    $('#results').classList.remove('hidden'); $('#hud').classList.add('hidden'); $('#touch').classList.add('hidden');
  }
  function fillList(list) {
    $('#reslist').innerHTML = list.map((r, i) => `<li class="${/\(tu\)$/.test(r.name) || r.id === NET.you ? 'me' : ''}"><span class="n">${r.time != null ? (i + 1) + '°' : '–'}</span><span class="dot" style="background:${esc(r.col || '#ccc')}"></span>${esc(r.name)}${r.lost ? `<small style="color:#c4562b;font-weight:800;margin-left:6px">+${r.lost * PENALTY} s carico</small>` : ''}<span class="tm">${r.time != null ? fmtTime(r.time) : 'in gara…'}</span></li>`).join('');
  }
  function showFinal() {
    const list = NET.results || []; const pos = list.findIndex(r => r.id === NET.you) + 1;
    $('#restitle').textContent = pos === 1 ? 'Hai vinto!' : pos ? pos + '° posto' : 'Gara finita';
    $('#ressub').textContent = (world ? world.name : '') + ' · ' + (route ? route.name : '') + ' · online';
    fillList(list.map(r => Object.assign({}, r, { name: r.name + (r.id === NET.you ? ' (tu)' : '') })));
    $('#recbox').style.display = 'none';
    $('#again').classList.add('hidden'); $('#newroute').classList.add('hidden');
    $('#tomenu').textContent = 'Torna alla lobby'; $('#tomenu').onclick = backToLobby;
    $('#results').classList.remove('hidden'); $('#hud').classList.add('hidden'); $('#touch').classList.add('hidden');
    state = 'results';
  }
  function backToLobby() {
    $('#results').classList.add('hidden'); $('#again').classList.remove('hidden'); $('#newroute').classList.remove('hidden'); $('#tomenu').textContent = 'Menu'; $('#tomenu').onclick = toMenu;
    NET_ON = false; for (const id of [...NET.remotes.keys()]) removeRemote(id); badge.classList.add('hidden'); emo.classList.add('hidden');
    toMenu(); $('#menu').classList.add('hidden'); ov.classList.remove('hidden'); renderLobby();
  }
  NET.menu = () => { // il gioco online non si mette in pausa: si può solo uscire
    const p = $('#pause'); $('#pausesub').textContent = 'Partita online ' + NET.code + ': la gara continua anche mentre sei qui.';
    $('#resume').textContent = 'Torna in gara'; $('#restart').classList.add('hidden'); $('#quit').textContent = '⌂ Esci dalla partita';
    const q = $('#quit').onclick, rs = $('#resume').onclick;
    const restore = () => { $('#resume').textContent = 'Continua'; $('#restart').classList.remove('hidden'); $('#quit').textContent = '⌂ Esci al menù principale'; $('#quit').onclick = q; $('#resume').onclick = rs };
    $('#resume').onclick = () => { p.classList.add('hidden'); restore() };
    $('#quit').onclick = () => { p.classList.add('hidden'); restore(); leave() };
    p.classList.remove('hidden');
  };

  // link d'invito: ?room=CODICE
  const q = new URLSearchParams(location.search).get('room');
  if (q) setTimeout(() => openPanel(q.toUpperCase()), 600);
})();
