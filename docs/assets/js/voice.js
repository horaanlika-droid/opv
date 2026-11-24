/**
 * Голос автора — постоянный плеер озвучки глав.
 *
 * Манифест content/narration.json: глава → фрагменты mp3. Фрагменты
 * звучат подряд, позиция и скорость запоминаются, главы переключаются
 * без остановки. Всё начинается только по действию пользователя.
 *
 * Правила, которые нельзя нарушать:
 *  • без автозапуска: молча читать — обычный режим книги;
 *  • плеер постоянный и компактный: не перекрывает текст и иллюстрации,
 *    на телефоне — над нижним баром, в зоне большого пальца;
 *  • голос и атмосфера — независимые слои с отдельной громкостью;
 *  • ошибка фрагмента не роняет прослушивание: следующий фрагмент,
 *    если и они не играют — честная остановка «Озвучка недоступна»;
 *  • подсветка читаемого фрагмента — по желанию и только если в
 *    манифесте записана синхронизация (sync: индексы абзацев).
 */
(function () {
  'use strict';

  var POS_KEY = 'opv.voice.position';
  var RATE_KEY = 'opv.voice.rate';
  var VOL_KEY = 'opv.voice.volume';
  var HL_KEY = 'opv.voice.highlight';
  var RATES = [0.75, 1, 1.25, 1.5];
  var RATE_LABEL = { 0.75: '0,75×', 1: '1×', 1.25: '1,25×', 1.5: '1,5×' };

  var manifest = null;
  var byId = {};
  var order = [];            // все главы в порядке чтения
  var wired = false;         // интерфейс плеера уже собран
  var durPromises = {};      // id -> Promise<[number|null]>
  var playing = null;        // { id, clip }
  var pendingSeek = null;
  var errors = 0;

  var rate = 1;
  var volume = 0.8;
  var highlight = false;
  var saved = null;          // { last, ch: { id: [clip, time] } }

  var audio = new Audio();
  audio.preload = 'none';
  var els = {};
  var gainNode = null;
  var attached = false;

  /* ——— утилиты ——— */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function say(msg) {
    if (els.status) els.status.textContent = msg;
  }

  var ICON = {
    play: '<svg viewBox="0 0 12 14" width="11" height="13" aria-hidden="true"><path d="M1 1.2v11.6L11 7z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 12 14" width="11" height="13" aria-hidden="true"><rect x="1.5" y="1.5" width="3.2" height="11" fill="currentColor"/><rect x="7.3" y="1.5" width="3.2" height="11" fill="currentColor"/></svg>',
  };

  /* ——— хранилище ——— */

  function loadStore() {
    try {
      var pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (pos && typeof pos === 'object') {
        saved = { last: pos.last || null, ch: pos.ch || {} };
      }
    } catch (e) { /* нет хранилища — не мешаем */ }
    if (!saved) saved = { last: null, ch: {} };
    try {
      var r = parseFloat(localStorage.getItem(RATE_KEY));
      if (RATES.indexOf(r) >= 0) rate = r;
    } catch (e) { /* приватный режим */ }
    try {
      var v = parseFloat(localStorage.getItem(VOL_KEY));
      if (v >= 0 && v <= 1) volume = v;
    } catch (e) { /* приватный режим */ }
    try { highlight = localStorage.getItem(HL_KEY) === '1'; } catch (e) { /* … */ }
  }

  function savePos() {
    if (!playing) return;
    var t = clipTime();
    saved.last = playing.id;
    saved.ch[playing.id] = [playing.clip, t];
    try { localStorage.setItem(POS_KEY, JSON.stringify(saved)); } catch (e) { /* … */ }
  }

  function savedFor(id) {
    var v = saved && saved.ch && saved.ch[id];
    return v && v.length === 2 ? { clip: v[0], t: v[1] } : null;
  }

  /* ——— манифест и метаданные ——— */

  function setManifest(json) {
    manifest = json && Array.isArray(json.chapters) ? json : null;
    byId = {};
    if (manifest) {
      manifest.chapters.forEach(function (ch) {
        if (ch && ch.clips && ch.clips.length) byId[ch.id] = ch;
      });
    }
  }

  function voicedList() {
    return order.filter(function (id) { return !!byId[id]; });
  }

  function srcOf(chId, clip) {
    var dir = (manifest && manifest.audioDir) || 'assets/audio/narration';
    return dir + '/' + byId[chId].clips[clip];
  }

  function loadDurations(chId) {
    if (durPromises[chId]) return durPromises[chId];
    var ch = byId[chId];
    durPromises[chId] = Promise.all(ch.clips.map(function (file, i) {
      return new Promise(function (resolve) {
        var a = new Audio();
        var done = false;
        function finish(v) { if (!done) { done = true; resolve(v); } }
        a.preload = 'metadata';
        a.addEventListener('loadedmetadata', function () {
          finish(isFinite(a.duration) && a.duration > 0 ? a.duration : null);
        });
        a.addEventListener('error', function () { finish(null); });
        setTimeout(function () { finish(null); }, 8000);
        a.src = srcOf(chId, i);
      });
    }));
    return durPromises[chId];
  }

  /** Все длительности главы известны? Тогда перемотка — по всей главе. */
  function offsetsFor(chId, dur) {
    var offs = [0];
    for (var i = 0; i < dur.length - 1; i++) offs.push(offs[i] + (dur[i] || 0));
    return offs;
  }

  function knownTotal(dur) {
    if (!dur || dur.some(function (d) { return d == null; })) return null;
    return dur.reduce(function (a, b) { return a + b; }, 0);
  }

  /* ——— граф громкости (тот же AudioContext, что у атмосферы) ——— */

  function ensureGain() {
    if (attached) return;
    attached = true;
    var ctx = window.BookAudio && window.BookAudio.ensureContext
      ? window.BookAudio.ensureContext()
      : null;
    if (ctx && !gainNode) {
      try {
        var src = ctx.createMediaElementSource(audio);
        gainNode = ctx.createGain();
        gainNode.gain.value = volume;
        src.connect(gainNode);
        gainNode.connect(ctx.destination);
      } catch (e) { gainNode = null; }
    }
    if (!gainNode) audio.volume = volume;
  }

  function applyVolume() {
    if (gainNode) gainNode.gain.value = volume;
    else audio.volume = volume;
    try { localStorage.setItem(VOL_KEY, String(volume)); } catch (e) { /* … */ }
  }

  /* ——— воспроизведение ——— */

  function setSrc(clip) {
    playing.clip = clip;
    audio.src = srcOf(playing.id, clip);
    if (pendingSeek != null) {
      var target = pendingSeek;
      pendingSeek = null;
      audio.addEventListener('loadedmetadata', function once() {
        audio.removeEventListener('loadedmetadata', once);
        if (isFinite(audio.duration)) {
          audio.currentTime = Math.min(target, Math.max(0, audio.duration - 0.25));
        }
      });
    }
    applyHighlight();
    updateAll();
  }

  function clipTime() { return audio.currentTime || 0; }

  function absTime() {
    if (!playing) return 0;
    var ch = byId[playing.id];
    var dur = durPromises[playing.id] && durCache[playing.id];
    if (!dur) return clipTime();
    var offs = offsetsFor(playing.id, dur);
    return (offs[playing.clip] || 0) + clipTime();
  }

  // Кэш завершённых метаданных (для absTime без промисов).
  var durCache = {};
  function cacheDurations(chId, promise) {
    promise.then(function (arr) { durCache[chId] = arr; updateAll(); });
    return promise;
  }

  function playChapter(id, fromAbs) {
    var ch = byId[id];
    if (!ch || !ch.clips.length) return false;
    ensureGain();
    if (window.BookAudio && window.BookAudio.ensureContext) window.BookAudio.ensureContext();
    errors = 0;
    if (!playing || playing.id !== id) {
      playing = { id: id, clip: 0 };
      if (fromAbs == null) {
        var sv = savedFor(id);
        fromAbs = sv ? sv.t : 0;
      }
      pendingSeek = fromAbs > 0 ? fromAbs : null;
      setSrc(0);
    } else if (fromAbs != null) {
      seekAbs(fromAbs);
    }
    cacheDurations(id, loadDurations(id));
    var p = audio.play();
    if (p && p.catch) {
      p.catch(function () {
        say('Нажмите «Слушать» ещё раз — браузер ждёт вашего действия.');
        updateAll();
      });
    }
    savePos();
    updateAll();
    return true;
  }

  function seekAbs(abs) {
    if (!playing) return;
    var id = playing.id;
    cacheDurations(id, loadDurations(id)).then(function (dur) {
      if (!playing || playing.id !== id) return;
      var total = knownTotal(dur);
      if (total == null) {
        // Длительности неизвестны — перематываем внутри текущего фрагмента.
        var d = dur[playing.clip];
        if (d) audio.currentTime = Math.min(Math.max(0, abs), d - 0.25);
        return;
      }
      abs = Math.min(Math.max(0, abs), total - 0.25);
      var offs = offsetsFor(id, dur);
      var k = 0;
      while (k + 1 < dur.length && abs >= offs[k + 1]) k++;
      var at = abs - offs[k];
      if (k !== playing.clip) { pendingSeek = at; setSrc(k); }
      else if (isFinite(audio.duration)) audio.currentTime = Math.min(at, Math.max(0, audio.duration - 0.25));
      else pendingSeek = at;
      updateAll();
    });
  }

  function nextClip() {
    if (!playing) return;
    var ch = byId[playing.id];
    if (playing.clip + 1 < ch.clips.length) {
      setSrc(playing.clip + 1);
      var p = audio.play();
      if (p && p.catch) p.catch(function () { say('Воспроизведение приостановлено браузером.'); });
      return;
    }
    nextChapter(true);
  }

  function nextChapter(auto) {
    var list = voicedList();
    if (!playing) return;
    var i = list.indexOf(playing.id);
    if (i >= 0 && i + 1 < list.length) {
      var nextId = list[i + 1];
      playChapter(nextId, 0);
      say((auto ? 'Дальше: «' : 'Слушаем: «') + titleOf(nextId) + '».');
    } else {
      audio.pause();
      say('Озвучка книги прослушана.');
      updateAll();
    }
  }

  function prevChapter() {
    if (!playing) return;
    if (clipTime() > 3) { seekAbs(absTime() - clipTime()); return; }
    var list = voicedList();
    var i = list.indexOf(playing.id);
    if (i > 0) {
      playChapter(list[i - 1], 0);
      say('Слушаем: «' + titleOf(list[i - 1]) + '».');
    } else {
      seekAbs(0);
    }
  }

  function titleOf(id) {
    var art = document.getElementById(id);
    var h = art && art.querySelector('.chapter__title');
    return (h && h.textContent) || (byId[id] && byId[id].title) || id;
  }

  function togglePlay() {
    if (!audio.paused && playing) {
      audio.pause();
      savePos();
      say('Пауза.');
      updateAll();
      return;
    }
    var target = currentTarget();
    if (!target) { say('Озвучка пока не добавлена.'); return; }
    if (playing && playing.id === target) {
      ensureGain();
      var p = audio.play();
      if (p && p.catch) p.catch(function () { say('Нажмите «Слушать» ещё раз.'); });
      updateAll();
      return;
    }
    var sv = savedFor(target);
    playChapter(target, sv ? sv.t : 0);
    say('Слушаем: «' + titleOf(target) + '».');
  }

  /** Что играет / что начнёт кнопка: текущая страница, иначе позиция. */
  function currentTarget() {
    if (playing) return playing.id;
    var hash = location.hash.slice(1);
    if (hash && byId[hash]) return hash;
    if (saved.last && byId[saved.last]) return saved.last;
    var list = voicedList();
    return list[0] || null;
  }

  /* ——— подсветка текста ——— */

  function clearHighlight() {
    var ps = document.querySelectorAll('.chapter__body > p.is-audible');
    for (var i = 0; i < ps.length; i++) ps[i].classList.remove('is-audible');
  }

  function applyHighlight() {
    clearHighlight();
    if (!highlight || !playing) return;
    var ch = byId[playing.id];
    if (!ch || !ch.sync) return;
    var idx = ch.sync[playing.clip];
    if (idx == null) return;
    var art = document.getElementById(playing.id);
    var body = art && art.querySelector('.chapter__body');
    if (!body) return;
    // sync считает прямые абзацы <p> тела главы — в том числе пометки.
    var ps = body.querySelectorAll(':scope > p');
    var p = ps[idx];
    if (p) p.classList.add('is-audible');
  }

  function setHighlight(on) {
    highlight = !!on;
    try { localStorage.setItem(HL_KEY, highlight ? '1' : '0'); } catch (e) { /* … */ }
    if (els.sync) {
      els.sync.setAttribute('aria-pressed', highlight ? 'true' : 'false');
      els.sync.classList.toggle('is-on', highlight);
    }
    applyHighlight();
    say(highlight ? 'Подсветка текста включена.' : 'Подсветка текста выключена.');
  }

  /* ——— обновление интерфейса ——— */

  var tick = false;
  function updateAll() {
    if (tick) return;
    tick = true;
    requestAnimationFrame(function () {
      tick = false;
      updateBar();
      updatePills();
    });
  }

  function updateBar() {
    if (!els.bar) return;
    var isPlaying = !!playing && !audio.paused;
    els.play.classList.toggle('is-playing', isPlaying);
    els.play.setAttribute('aria-label', isPlaying ? 'Пауза' : 'Слушать');
    els.play.innerHTML = isPlaying ? ICON.pause : ICON.play;

    if (playing) {
      els.title.textContent = titleOf(playing.id);
      els.title.title = els.title.textContent;
    } else if (saved && saved.last && byId[saved.last]) {
      // Позиция последнего прослушивания — без автозапуска, только метка.
      els.title.textContent = 'Продолжить: ' + titleOf(saved.last);
      els.title.title = els.title.textContent;
    } else {
      els.title.textContent = 'Озвучка книги';
      els.title.title = '';
    }

    var total = knownTotal(durCache[playing && playing.id]);
    var abs = absTime();
    var span = total || (playing ? (durCache[playing.id] || [])[playing.clip] : null) || 0;
    var pos = total != null ? abs : clipTime();
    els.time.textContent = fmt(pos) + (total != null ? ' / ' + fmt(total) : '');
    var seekable = span > 0;
    els.seek.disabled = !seekable;
    if (seekable && !els.seek.matches(':active')) {
      els.seek.value = String(Math.round((pos / span) * 1000)) || '0';
    }

    els.rate.textContent = RATE_LABEL[rate] || '1×';
    els.prev.disabled = voicedList().length < 2;
    els.next.disabled = voicedList().length < 2;

    // Подсветка — только если у текущей главы записана синхронизация.
    var syncable = !!(playing && byId[playing.id] && byId[playing.id].sync);
    els.sync.hidden = !syncable;

    // Строка состояния атмосферы в поповере.
    if (window.BookAudio && window.BookAudio.status) {
      var st = window.BookAudio.status();
      var hint = '';
      if (!st.ready) hint = 'Атмосфера: дорожки готовятся (docs/assets/audio/).';
      else if (st.missing) hint = 'Атмосфера раздела «' + (st.title || '') + '»: дорожка готовится.';
      else if (st.on) hint = 'Атмосфера: «' + (st.title || '') + '» — ' + (st.texture || '').toLowerCase() + '.';
      else hint = 'Атмосфера выключена.';
      els.hint.textContent = hint;
      els.ambToggle.disabled = !st.ready;
      els.ambToggle.setAttribute('aria-pressed', st.on ? 'true' : 'false');
      els.ambToggle.textContent = st.on ? 'вкл.' : 'выкл.';
      if (document.activeElement !== els.ambVol) els.ambVol.value = String(Math.round(st.volume * 100));
    }
    if (document.activeElement !== els.vol) els.vol.value = String(Math.round(volume * 100));
    els.sync.setAttribute('aria-pressed', highlight ? 'true' : 'false');
    els.sync.classList.toggle('is-on', highlight);
  }

  function updatePills() {
    var pills = document.querySelectorAll('.chapter__player[data-vch]');
    for (var i = 0; i < pills.length; i++) {
      var pill = pills[i];
      var id = pill.getAttribute('data-vch');
      var isCurrent = playing && playing.id === id;
      var isPlaying = isCurrent && !audio.paused;
      var btn = pill.querySelector('[data-vplay]');
      if (btn) {
        btn.innerHTML = isPlaying ? ICON.pause : ICON.play;
        btn.setAttribute('aria-label', (isPlaying ? 'Пауза: ' : 'Слушать: ') + titleOf(id));
        btn.classList.toggle('is-playing', isPlaying);
      }
      var count = pill.querySelector('.player__count');
      var ch = byId[id];
      var clip = isCurrent ? playing.clip : (savedFor(id) ? savedFor(id).clip : 0);
      if (count && ch) count.textContent = (clip + 1) + ' / ' + ch.clips.length;

      var seek = pill.querySelector('.player__seek');
      var time = pill.querySelector('.player__time');
      var dur = durCache[id];
      var total = knownTotal(dur);
      var pos = 0;
      if (isCurrent) pos = total != null ? absTime() : clipTime();
      else { var sv = savedFor(id); pos = sv ? sv.t : 0; }
      if (time) time.textContent = fmt(pos) + (total != null ? ' / ' + fmt(total) : '');
      if (seek) {
        var span = total != null ? total : (isCurrent ? (dur || [])[playing.clip] : null) || 0;
        seek.disabled = !(span > 0);
        if (span > 0 && !seek.matches(':active')) {
          seek.value = String(Math.round((pos / span) * 1000)) || '0';
        }
      }
    }
  }

  /* ——— события ——— */

  function onMeta() {
    updateAll();
  }

  function onError() {
    if (!playing) return;
    errors++;
    var ch = byId[playing.id];
    if (errors >= Math.min(3, ch.clips.length)) {
      audio.pause();
      say('Озвучка недоступна: фрагменты не загружаются.');
      updateAll();
      return;
    }
    say('Фрагмент недоступен — пробуем следующий.');
    if (playing.clip + 1 < ch.clips.length) {
      setSrc(playing.clip + 1);
      audio.play().catch(function () { /* следующий жест поможет */ });
    } else {
      nextChapter(true);
    }
  }

  function wirePills() {
    var pills = document.querySelectorAll('.chapter__player[data-vch]');
    for (var i = 0; i < pills.length; i++) {
      (function (pill) {
        var id = pill.getAttribute('data-vch');
        var btn = pill.querySelector('[data-vplay]');
        var seek = pill.querySelector('.player__seek');
        if (btn) {
          btn.addEventListener('click', function () {
            if (playing && playing.id === id && !audio.paused) {
              audio.pause(); savePos(); say('Пауза.'); updateAll(); return;
            }
            var sv = savedFor(id);
            playChapter(id, sv ? sv.t : 0);
            say('Слушаем: «' + titleOf(id) + '».');
          });
        }
        if (seek) {
          seek.addEventListener('input', function () {
            var dur = durCache[id];
            var total = knownTotal(dur);
            var frac = Number(seek.value) / 1000;
            if (total != null) {
              if (!playing || playing.id !== id) playChapter(id, frac * total);
              else seekAbs(frac * total);
            } else if (playing && playing.id === id && dur && dur[playing.clip]) {
              audio.currentTime = frac * dur[playing.clip];
            }
          });
          // Метаданные по требованию: пользователь потянул ползунок.
          seek.addEventListener('pointerdown', function once() {
            seek.removeEventListener('pointerdown', once);
            cacheDurations(id, loadDurations(id));
          });
        }
      })(pills[i]);
    }
  }

  function wire() {
    if (wired || !manifest) return;
    if (!voicedList().length) return;
    wired = true;
    loadStore();

    els.bar = $('voicebar');
    if (!els.bar) return;
    els.play = $('v-play');
    els.prev = $('v-prev');
    els.next = $('v-next');
    els.seek = $('v-seek');
    els.title = $('v-title');
    els.time = $('v-time');
    els.rate = $('v-rate');
    els.popBtn = $('v-pop-btn');
    els.pop = $('v-pop');
    els.vol = $('v-vol');
    els.ambVol = $('a-vol');
    els.ambToggle = $('a-toggle');
    els.sync = $('v-sync');
    els.hint = $('v-hint');
    els.status = $('v-status');

    els.bar.hidden = false;
    document.body.classList.add('voicebar-on');

    applyVolume();
    if (els.rate) els.rate.textContent = RATE_LABEL[rate] || '1×';

    els.play.addEventListener('click', togglePlay);
    els.prev.addEventListener('click', prevChapter);
    els.next.addEventListener('click', function () { nextChapter(false); });

    els.seek.addEventListener('input', function () {
      if (!playing) return;
      var total = knownTotal(durCache[playing.id]);
      if (total != null) seekAbs((Number(els.seek.value) / 1000) * total);
      else if (durCache[playing.id] && durCache[playing.id][playing.clip]) {
        audio.currentTime = (Number(els.seek.value) / 1000) * durCache[playing.id][playing.clip];
      }
    });

    els.rate.addEventListener('click', function () {
      var i = RATES.indexOf(rate);
      rate = RATES[(i + 1) % RATES.length];
      audio.playbackRate = rate;
      try { localStorage.setItem(RATE_KEY, String(rate)); } catch (e) { /* … */ }
      updateAll();
      say('Скорость ' + (RATE_LABEL[rate] || rate) + '.');
    });

    els.popBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = els.pop.hidden;
      els.pop.hidden = !open;
      els.popBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (els.pop.hidden) return;
      if (els.pop.contains(e.target) || els.popBtn.contains(e.target)) return;
      els.pop.hidden = true;
      els.popBtn.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.pop.hidden) {
        els.pop.hidden = true;
        els.popBtn.setAttribute('aria-expanded', 'false');
        els.popBtn.focus();
      }
    });

    els.vol.addEventListener('input', function () {
      volume = Number(els.vol.value) / 100;
      applyVolume();
    });

    if (window.BookAudio) {
      if (window.BookAudio.subscribe) {
        window.BookAudio.subscribe(function () { updateAll(); });
      }
      els.ambVol.addEventListener('input', function () {
        if (window.BookAudio.setVolume) window.BookAudio.setVolume(Number(els.ambVol.value) / 100);
      });
      els.ambToggle.addEventListener('click', function () {
        if (window.BookAudio.toggle) {
          var on = window.BookAudio.toggle();
          say(on ? 'Атмосфера включена.' : 'Атмосфера выключена.');
          updateAll();
        }
      });
    } else {
      els.ambToggle.disabled = true;
      els.ambVol.disabled = true;
    }

    els.sync.addEventListener('click', function () { setHighlight(!highlight); });

    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('canplay', function () { errors = 0; });
    audio.addEventListener('timeupdate', function () {
      updateAll();
      if (playing && !audio.paused && audio.currentTime > 1) savePosThrottled();
    });
    audio.addEventListener('play', updateAll);
    audio.addEventListener('pause', function () { savePos(); updateAll(); });
    audio.addEventListener('ended', nextClip);
    audio.addEventListener('error', onError);
    audio.playbackRate = rate;

    window.addEventListener('pagehide', savePos);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') savePos();
    });

    wirePills();
    updateAll();
  }

  var lastSave = 0;
  function savePosThrottled() {
    var now = Date.now();
    if (now - lastSave < 2000) return;
    lastSave = now;
    savePos();
  }

  /* ——— разметка пилюли главы (вызывает book.js при сборке главы) ——— */

  function render(ch, no) {
    if (!manifest || !byId[ch.id]) return '';
    var rec = byId[ch.id];
    var title = esc(ch.title || rec.title || '');
    var num = no ? 'Глава ' + (no < 10 ? '0' + no : no) + ' · ' : '';
    return '<div class="chapter__player" data-vch="' + esc(ch.id) + '">' +
      '<button type="button" class="player__btn" data-vplay aria-label="Слушать: ' + title + '">' + ICON.play + '</button>' +
      '<input class="player__seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Позиция озвучки главы">' +
      '<span class="player__time">0:00</span>' +
      '<span class="player__count" title="' + esc(num + rec.clips.length + ' фрагментов') + '">1 / ' + rec.clips.length + '</span>' +
      '</div>';
  }

  window.BookVoice = {
    setManifest: setManifest,
    wire: function (opts) {
      opts = opts || {};
      if (Array.isArray(opts.order)) order = opts.order.slice();
      wire();
    },
    render: render,
    /** Остановить голос (используется тестами и отладкой). */
    stop: function () {
      audio.pause();
      playing = null;
      clearHighlight();
      updateAll();
    },
  };
})();
