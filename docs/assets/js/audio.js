/**
 * Средовой звук книги.
 *
 * Правила, которые нельзя нарушать:
 *  • воспроизведение — только после действия пользователя;
 *  • постоянная кнопка отключения;
 *  • плавные переходы между средами, без резких звуков;
 *  • дорожки загружаются по требованию (lazy);
 *  • без звука сайт работает полностью.
 *
 * Файлы — реальные записи природных сред, а не библиотечные «эффекты».
 * Пока записей нет в репозитории, `available()` возвращает false, и кнопка
 * звука честно сообщает, что звук готовится.
 */
(function () {
  'use strict';

  var TRACKS = [
    { id: 'mountains', src: 'assets/audio/mountains.mp3', level: 0, title: 'Горы: ветер и дальние птицы' },
    { id: 'forest', src: 'assets/audio/forest.mp3', level: 1, title: 'Лес: листва, насекомые, дождь' },
    { id: 'river', src: 'assets/audio/river.mp3', level: 2, title: 'Реки: течение и птицы у воды' },
    { id: 'coast', src: 'assets/audio/coast.mp3', level: 3, title: 'Побережье: прибой и галька' },
    { id: 'sea', src: 'assets/audio/sea.mp3', level: 4, title: 'Море: подводная акустика' },
  ];

  var ctx = null;
  var master = null;
  var buffers = {};
  var voices = {};
  var enabled = false;
  var current = 0;
  var volume = 0.55;
  var loading = false;

  function probe(callback) {
    var found = 0;
    var checked = 0;
    TRACKS.forEach(function (t) {
      var req = new XMLHttpRequest();
      req.open('HEAD', t.src, true);
      req.onload = function () {
        if (req.status >= 200 && req.status < 400) found += 1;
        done();
      };
      req.onerror = done;
      req.send();
    });
    function done() {
      checked += 1;
      if (checked === TRACKS.length) callback(found === TRACKS.length);
    }
  }

  var availability = null;
  function available() {
    // Синхронная проверка невозможна; до проверки считаем недоступным,
    // чтобы не обещать звук, которого нет.
    return availability === true;
  }

  /**
   * @param {{scene?: Element, onChange?: function(boolean)}} opts
   *   onChange вызывается, когда стало известно, есть ли записи в репозитории.
   *   Интерфейс обязан обновить кнопку: обещать звук, которого нет, нельзя.
   */
  function init(opts) {
    if (opts && opts.scene) sceneEl = opts.scene;
    var onChange = opts && opts.onChange;
    probe(function (ok) {
      availability = ok;
      if (onChange) onChange(ok);
    });
  }

  var sceneEl = null;

  function ensureContext() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  }

  function loadTrack(track) {
    if (buffers[track.id]) return Promise.resolve(buffers[track.id]);
    return fetch(track.src)
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (data) { return ctx.decodeAudioData(data); })
      .then(function (buf) {
        buffers[track.id] = buf;
        return buf;
      });
  }

  function play(track) {
    if (!ctx || voices[track.id]) return;
    var buf = buffers[track.id];
    if (!buf) return;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    var gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(master);
    src.start(0, Math.random() * buf.duration * 0.5);
    voices[track.id] = { src: src, gain: gain, target: 0 };
  }

  function setLevel(level) {
    current = level;
    if (!enabled) return;
    TRACKS.forEach(function (t, i) {
      var voice = voices[t.id];
      if (!voice) return;
      var distance = Math.abs(i - level);
      var target = distance === 0 ? 1 : distance === 1 ? 0.28 : 0;
      voice.target = target;
      voice.gain.gain.cancelScheduledValues(ctx.currentTime);
      voice.gain.gain.linearRampToValueAtTime(target * volume, ctx.currentTime + 2.4);
    });
  }

  function toggle() {
    var context = ensureContext();
    if (!context) return false;
    if (context.state === 'suspended') context.resume();

    enabled = !enabled;
    if (enabled) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
      // Загружаем только текущую и соседние среды.
      var near = TRACKS.filter(function (t, i) { return Math.abs(i - current) <= 1; });
      Promise.all(near.map(function (t) {
        return loadTrack(t).then(function () { play(t); });
      })).then(function () { setLevel(current); });
    } else {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
      Object.keys(voices).forEach(function (id) {
        var v = voices[id];
        setTimeout(function () {
          try { v.src.stop(); } catch (e) { /* уже остановлен */ }
          delete voices[id];
        }, 1400);
      });
    }
    return enabled;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (enabled) setLevel(current);
  }

  function step() {
    if (!enabled || !sceneEl) return;
    var rect = sceneEl.getBoundingClientRect();
    var span = sceneEl.offsetHeight - window.innerHeight;
    if (span <= 0) return;
    var p = Math.min(1, Math.max(0, -rect.top / span));
    var level = Math.min(TRACKS.length - 1, Math.floor(p * TRACKS.length));
    if (level !== current) setLevel(level);
  }

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      step();
    });
  }, { passive: true });

  window.BookAudio = {
    init: init,
    toggle: toggle,
    setVolume: setVolume,
    available: available,
    tracks: TRACKS,
  };
})();
