/**
 * Атмосфера книги — звуковые ландшафты разделов.
 *
 * У каждого крупного раздела своя среда (манифест content/soundscape.json):
 * «Остров» — ветер, птицы, горы и лес; «Море» — волны, прибой, чайки;
 * «Лес» — листва, насекомые, дождь; «Дичь» — лес, звери и птицы.
 * При переходе между главами дорожка меняется плавным переходом (~2,4 с):
 * два ландшафта не звучат одновременно на полной громкости.
 *
 * Правила, которые нельзя нарушать:
 *  • воспроизведение — только после действия пользователя, без автозапуска;
 *  • потоковая загрузка: <audio loop>, без полного декодирования файла;
 *  • громкость этого слоя хранится отдельно от голоса (см. voice.js);
 *  • пока файла нет или он не отвечает, книга честно показывает
 *    «Звук готовится» и не обещает звук, которого не существует;
 *  • без звука сайт работает полностью.
 *
 * Записи — реальные полевые ландшафты, предпочтительно с Сахалина,
 * лицензированные легально (требования — docs/assets/audio/README.md).
 */
(function () {
  'use strict';

  var VOL_KEY = 'opv.audio.ambience.volume';
  var DEFAULT_FADE = 2.4;

  var manifest = null;
  var byPart = {};
  var ready = false;
  var enabled = false;
  var part = 'ostrov';
  var volume = 0.55;
  var fadeSeconds = DEFAULT_FADE;

  var ctx = null;
  var master = null;
  var nodes = {};        // part -> { el, gain }
  var current = null;    // part, чья дорожка сейчас «в тишине» или звучит
  var broken = {};       // part -> true: файл недоступен после ошибки
  var subscribers = [];
  var notify = null;     // колбэк из book.js (состояние кнопки)

  try {
    var stored = parseFloat(localStorage.getItem(VOL_KEY));
    if (stored >= 0 && stored <= 1) volume = stored;
  } catch (e) { /* приватный режим — не мешаем */ }

  function snapshot() {
    return { ready: ready, on: enabled, part: part, volume: volume };
  }

  function emit() {
    var snap = snapshot();
    subscribers.forEach(function (fn) { try { fn(snap); } catch (e) { console.error(e); } });
    if (notify) notify(snap);
  }

  /** Узлы дорожек создаются, когда есть и контекст, и манифест. */
  function buildNodes() {
    if (!ctx || !manifest) return;
    manifest.tracks.forEach(function (t) {
      if (nodes[t.part]) return;
      var el = new Audio();
      el.loop = true;
      el.preload = 'none';
      el.src = 'assets/audio/' + t.file;
      var gain = ctx.createGain();
      gain.gain.value = 0;
      try {
        var src = ctx.createMediaElementSource(el);
        src.connect(gain);
        gain.connect(master);
      } catch (e) {
        // Без WebAudio (старый браузер) — запасной путь: громкость элемента.
        el.volume = 1;
        gain = null;
      }
      nodes[t.part] = { el: el, gain: gain, track: t };
    });
  }

  /** Создаём AudioContext только внутри действия пользователя. */
  function ensureContext() {
    if (ctx) { buildNodes(); return ctx; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    buildNodes();

    // iOS: контекст может «заснуть» после сворачивания — будим на жесте.
    ['pointerdown', 'keydown'].forEach(function (evt) {
      window.addEventListener(evt, function () {
        if (ctx && ctx.state === 'suspended') ctx.resume();
      }, { passive: true });
    });
    return ctx;
  }

  function fade(node, to, secs) {
    var g = node.gain;
    if (!g) { node.el.volume = to; return; }
    var now = ctx.currentTime;
    var from = g.gain.value;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(from, now);
    g.gain.linearRampToValueAtTime(to, now + secs);
  }

  function stopLater(node, secs) {
    setTimeout(function () {
      if (!node || !node.el || node.el.paused) return;
      if (!node.gain) { node.el.pause(); return; }
      if (node.gain.gain.value < 0.01) node.el.pause();
    }, (secs + 0.15) * 1000);
  }

  function trackOk(t) {
    return !!t && t.ok && !broken[t.part];
  }

  /** Плавный переход к дорожке раздела; reference/неизвестный — тишина. */
  function applyPart() {
    if (!enabled || !ctx) return;
    var to = byPart[part];
    if (to && !trackOk(to)) to = null;
    var toKey = to ? to.part : null;
    if (toKey === current) return;

    var fadeSecs = fadeSeconds;
    if (current && nodes[current]) {
      fade(nodes[current], 0, fadeSecs);
      stopLater(nodes[current], fadeSecs);
    }
    if (toKey && nodes[toKey]) {
      var node = nodes[toKey];
      var p = node.el.play();
      if (p && p.catch) {
        p.catch(function () {
          broken[toKey] = true;
          emit();
        });
      }
      fade(node, 1, fadeSecs);
      current = toKey;
    } else {
      current = null;
    }
    emit();
  }

  function probe(callback) {
    if (!manifest) { callback(); return; }
    var left = manifest.tracks.length;
    if (!left) { callback(); return; }
    manifest.tracks.forEach(function (t) {
      t.ok = false;
      fetch('assets/audio/' + t.file, { method: 'HEAD' })
        .then(function (r) { t.ok = r.ok; })
        .catch(function () { t.ok = false; })
        .then(function () { if (--left === 0) callback(); });
    });
  }

  function init(opts) {
    opts = opts || {};
    notify = opts.onChange || null;
    var url = opts.manifestUrl || 'content/soundscape.json';
    ready = false;

    fetch(url, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (!json || !Array.isArray(json.tracks)) throw new Error('нет дорожек');
        manifest = json;
        fadeSeconds = Number(json.fadeSeconds) > 0 ? Number(json.fadeSeconds) : DEFAULT_FADE;
        byPart = {};
        manifest.tracks.forEach(function (t) { byPart[t.part] = t; });
        probe(function () {
          ready = manifest.tracks.some(function (t) { return t.ok; });
          buildNodes();
          emit();
        });
      })
      .catch(function () {
        manifest = null;
        ready = false;
        emit();
      });
  }

  function toggle() {
    if (!ready) return false;
    ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume();
    enabled = !enabled;
    if (enabled) {
      applyPart();
    } else {
      Object.keys(nodes).forEach(function (k) {
        fade(nodes[k], 0, 0.6);
        stopLater(nodes[k], 0.6);
      });
      current = null;
      emit();
    }
    return enabled;
  }

  function setVolume(v) {
    volume = Math.min(1, Math.max(0, Number(v) || 0));
    if (master) master.gain.value = volume;
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      if (!n.gain && n.el) n.el.volume = volume;
    });
    try { localStorage.setItem(VOL_KEY, String(volume)); } catch (e) { /* нет хранилища */ }
    emit();
  }

  /** Раздел сейчас читается (или книга на главной) — меняем ландшафт. */
  function setPart(id) {
    part = id || 'ostrov';
    applyPart();
  }

  function status() {
    var t = byPart[part];
    return {
      title: t ? t.title : null,
      texture: t ? t.texture : null,
      missing: !!t && !trackOk(t),
      ready: ready,
      on: enabled,
      part: part,
      volume: volume,
    };
  }

  window.BookAudio = {
    init: init,
    toggle: toggle,
    setVolume: setVolume,
    setPart: setPart,
    status: status,
    ensureContext: ensureContext,
    subscribe: function (fn) { subscribers.push(fn); },
    /** Тесты и отладка: текущий манифест без чтения файла. */
    tracks: function () { return manifest ? manifest.tracks : []; },
  };
})();
