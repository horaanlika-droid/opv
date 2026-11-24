/**
 * Книга «Остров. Продукт. Вкус» — поведение страницы.
 *
 * Задачи:
 *  1) собрать разделы и главы из docs/content/book.json (единственный источник);
 *  2) держать разделение: повествование в главе, практика — в отдельной
 *     «Заметке шефа», которая не прерывает чтение;
 *  3) вести прокрутку сцены «Сахалин в разрезе» с параллаксом;
 *  4) дать доступ к оглавлению, поиску продукта и сезонному календарю;
 *  5) включить средовой звук только после действия пользователя.
 *
 * Ничего не выдумывает: метаданные (раздел, среда, категория, район, сезон)
 * приходят из сборки контента, где они размечены по рукописи; отсутствующие
 * сведения остаются отсутствующими.
 */
(function () {
  'use strict';

  var CONFIG = window.BOOK_CONFIG || {};
  var doc = document;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var $ = function (id) { return doc.getElementById(id); };

  /* ——— Разделы книги. Порядок и состав — редакционные. ——— */

  var PARTS = [
    {
      id: 'ostrov',
      title: 'Остров',
      lead: 'Пролог: география, природа, история, климат, люди и культура Сахалина.',
      chapters: ['filosofiya', 'kuhnya-kotoruyu-sformirovali-more-les-i-vremya', 'ostrov-kak-sostoyanie'],
    },
    {
      id: 'more',
      title: 'Море',
      lead: 'Продукты моря и истории, связанные с ними.',
      chapters: [
        'koryushka', 'navaga', 'taymen', 'seld', 'cheka', 'zherih-i-krasnoperka', 'sima-vishnevyy-losos',
        'uek', 'ryba-lapsha', 'kunzha', 'galets', 'gorbusha', 'keta', 'kizhuch', 'harius',
        'krab', 'krevetka', 'morskoy-ezh', 'grebeshok', 'trepang', 'spizula', 'karbikula',
        'nazvanie-utochnit-stranitsa-108', 'morskaya-kapusta', 'rakushka',
      ],
    },
    {
      id: 'les',
      title: 'Лес',
      lead: 'Дикоросы, папоротники, травы и ягоды.',
      chapters: [
        'paporotniki-orlyak-i-osmund', 'lapuh', 'kaluzhnitsa', 'krapiva',
        'cheremsha', 'moroshka', 'klopovka-krasnika', 'brusnika',
      ],
    },
    {
      id: 'dich',
      title: 'Дичь',
      lead: 'Мясо, животные и дикая птица — с оговорками о виде и законности.',
      chapters: ['gus-i-utka', 'dikiy-golub', 'zayats-belyak', 'olen'],
    },
    {
      id: 'spravochnoe',
      title: 'Справочное',
      lead: 'Сезонная карта, заключение и реестр источников.',
      chapters: ['sezonnaya-karta-produktov', 'zaklyuchenie', 'reestr-istochnikov'],
      reference: true,
    },
  ];

  /** Семь остановок спуска: небо с главой-открытием → зоны → дно. */
  var LEVELS = [
    { n: '—', title: 'Философия', target: 'filosofiya' },
    { n: 'I', title: 'Горы и сопки', target: 'ostrov' },
    { n: 'II', title: 'Лес', target: 'les' },
    { n: 'III', title: 'Реки и долины', target: 'more' },
    { n: 'IV', title: 'Побережье', target: 'more' },
    { n: 'V', title: 'Море', target: 'more' },
    { n: 'VI', title: 'Глубина', target: 'more' },
  ];

  /** Человеческие подписи для фильтров. Пустых категорий не бывает: их нет в данных. */
  var ENV_LABEL = {
    more: 'Море',
    river: 'Реки и долины',
    les: 'Лес',
    les_dich: 'Лес и побережье',
  };
  var CAT_LABEL = {
    fish: 'Рыба',
    shellfish: 'Морские беспозвоночные',
    seaweed: 'Водоросли',
    plants: 'Травы и папоротники',
    berries: 'Ягоды',
    game: 'Дичь и птица',
  };

  /** Среда продукта → уровень центральной сцены. */
  var ENV_LEVEL = {
    mountains: 2,
    les: 3,
    les_dich: 3,
    river: 4,
    coast: 5,
    more: 6,
  };

  var NOTE_LABEL = {
    'awaiting-author': 'рецепт ждёт автора',
    blocked: 'без рецепта — вид под охраной',
    ready: 'с авторским рецептом',
  };

  var state = {
    book: null,
    chapters: {},
    seasons: null,
    scenes: null,
    sceneFrame: 0,
    lastScroll: 0,
    noteChapter: null,
    lastFocus: null,
  };

  var els = {
    veil: $('veil'),
    veilSkip: $('veil-skip'),
    bar: $('bar'),
    contents: $('contents'),
    contentsList: $('contents-list'),
    find: $('find'),
    findInput: $('find-input'),
    findGroups: $('find-groups'),
    findEnvs: $('find-envs'),
    findCats: $('find-cats'),
    findSeasons: $('find-seasons'),
    findReset: $('find-reset'),
    findResults: $('find-results'),
    findCount: $('find-count'),
    season: $('season'),
    seasonCal: $('season-cal'),
    scrim: $('scrim'),
    live: $('live'),
    scene: $('scene'),
    sceneText: $('scene-text'),
    sceneDots: $('scene-dots'),
    footLine: $('foot-line'),
    referenceSeason: $('reference-season'),
    referenceSources: $('reference-sources'),
    readFill: $('readout-fill'),
    readLabel: $('readout-label'),
    note: $('note'),
    notePanel: $('note-panel'),
    noteScroll: $('note-scroll'),
    noteKicker: $('note-kicker'),
    noteTitle: $('note-title'),
    noteLead: $('note-lead'),
    noteToc: $('note-toc'),
    noteBody: $('note-body'),
    notePending: $('note-pending'),
    noteBack: $('note-back'),
    noteState: $('note-state'),
  };

  /* ——— Утилиты ——— */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /** Прокрутка к элементу; молча выходит там, где API нет. */
  function scrollToEl(el, smooth) {
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: smooth && !reduceMotion.matches ? 'smooth' : 'auto', block: 'start' });
    } else if (typeof window.scrollTo === 'function') {
      var top = el.getBoundingClientRect().top + (window.scrollY || 0);
      window.scrollTo(0, top);
    }
  }
  function href(id) { return '#' + id; }

  function chapterMeta(ch) {
    var md = ch.markdown || '';
    // Маркеры привязки иллюстраций — служебная разметка, а не редакционный долг.
    var editorial = md.replace(/\[ИЛЛЮСТРАЦИЯ:[^\]]*\]/g, '');
    var isDraft = /\[[^\]]{3,}\]/.test(editorial);
    return { isDraft: isDraft };
  }

  /** Метка продукта и сезонная отметка — тихий информационный слой у заголовка. */
  function productMetaHtml(ch) {
    if (!ch || !(ch.category || ch.environment)) return '';
    var bits = [];
    if (ch.category && CAT_LABEL[ch.category]) bits.push(CAT_LABEL[ch.category]);
    if (ch.environment && ENV_LABEL[ch.environment]) bits.push(ENV_LABEL[ch.environment]);
    var html = bits.length
      ? '<p class="chapter__product">' + esc(bits.join(' · ')) + '</p>'
      : '';
    if (window.SeasonLabels && state.seasons) {
      var m = window.SeasonLabels.markFor(state.seasons, ch.id);
      if (m.state === 'scheduled') {
        html += '<p class="season-mark">' +
          '<a href="' + esc(m.href) + '" title="' + esc(m.title) + '">' + esc(m.label) + '</a>' +
          (m.months ? '<span class="season-mark__months">' + esc(m.months) + '</span>' : '') +
          '</p>';
      } else if (m.state === 'unscheduled') {
        html += '<p class="season-mark season-mark--unknown">' +
          '<a href="' + esc(m.href) + '" title="' + esc(m.title) + '">' + esc(m.label) + '</a>' +
          '</p>';
      }
    }
    return html;
  }

  function announce(message) {
    if (!els.live) return;
    els.live.textContent = message;
    els.live.classList.add('is-on');
    clearTimeout(announce.t);
    announce.t = setTimeout(function () { els.live.classList.remove('is-on'); }, 2600);
  }

  /**
   * Догружаем главу тем, чего может не быть в book.json: так книгу не сломает
   * ни правка через редакцию, ни старый файл контента. Правило деления одно —
   * docs/assets/js/chapter-split.js, тот же файл использует сборка.
   */
  function prepareChapter(ch) {
    if (ch.__prepared) return ch;
    ch.__prepared = true;
    var splitter = window.ChapterSplit;
    if (splitter && typeof ch.markdown === 'string' && typeof ch.story !== 'string') {
      var res = splitter.splitChapter(ch);
      if (res.hasPractical && res.practical) {
        ch.story = res.story;
        ch.practical = {
          markdown: res.practical.markdown,
          sections: res.practical.sections,
          placeholders: res.practical.placeholders,
          hasRecipe: res.practical.hasRecipe,
          isBlocked: res.practical.isBlocked,
          isEmpty: res.practical.isEmpty,
        };
        if (!ch.recipeState) ch.recipeState = res.flags.blocked ? 'blocked' : (res.practical.isEmpty && !res.practical.hasRecipe ? 'none' : 'awaiting-author');
      }
    }
    if (!ch.recipeState) ch.recipeState = ch.practical ? 'awaiting-author' : 'none';
    return ch;
  }

  /** Есть ли у главы практическая часть, достойная отдельной страницы. */
  function hasNote(ch) {
    if (!ch) return false;
    if (!ch.practical && ch.markdown) prepareChapter(ch);
    return !!(ch.practical && ch.recipeState !== 'none');
  }

  /** Все id глав, где есть «Заметка шефа». */
  function noteIds() {
    return Object.keys(state.chapters).filter(function (id) { return hasNote(state.chapters[id]); });
  }

  /* ——— Оглавление ——— */

  function renderContents() {
    var chapterIndex = 0;
    var html = '';
    PARTS.forEach(function (part) {
      var ids = part.chapters.filter(function (id) { return state.chapters[id]; });
      if (!ids.length) return;
      html += '<section class="cgroup">';
      html += '<h3 class="cgroup__title"><span>' + esc(part.title) + '</span><span class="cgroup__count">' +
        pad2(ids.length) + '</span></h3>';
      html += '<ol class="cgroup__list">';
      ids.forEach(function (id) {
        var ch = state.chapters[id];
        var meta = chapterMeta(ch);
        chapterIndex += 1;
        var cls = [meta.isDraft ? 'is-draft' : '', hasNote(ch) ? 'has-note' : ''].filter(Boolean).join(' ');
        html += '<li><a href="' + href(id) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' +
          '<span class="n">' + pad2(chapterIndex) + '</span>' +
          '<span class="t">' + esc(ch.title) + '</span>' +
          (hasNote(ch) ? '<span class="note-mark" aria-label="есть заметка шефа" title="Есть заметка шефа">↗</span>' : '') +
          '</a></li>';
      });
      html += '</ol></section>';
    });
    els.contentsList.innerHTML = html;
  }

  /* ——— Главы ——— */

  function noteLinkHtml(ch) {
    if (!hasNote(ch)) return '';
    var caption = ch.recipeState === 'blocked'
      ? 'Выбор · Происхождение · Позиция редакции'
      : 'Выбор · Обработка · Авторский рецепт';
    return '<a class="note-link" href="#note-' + esc(ch.id) + '" data-note="' + esc(ch.id) + '">' +
      '<span class="note-link__t">Заметка шефа <span aria-hidden="true">↗</span></span>' +
      '<span class="note-link__d">' + caption + '</span>' +
      '<span class="note-link__s">' + esc(NOTE_LABEL[ch.recipeState] || '') + '</span>' +
      '</a>';
  }

  function renderChapter(ch, index, partIds) {
    var meta = chapterMeta(ch);
    var fig = ch.illustration
      ? '<figure class="chapter__fig"><img src="assets/illustrations/' + esc(ch.illustration) +
        '" alt="Иллюстрация к главе «' + esc(ch.title) + '»" loading="lazy" decoding="async" width="1000" height="750">' +
        '<figcaption>Иллюстрация к главе «' + esc(ch.title) + '». Выцветшая акварель.</figcaption></figure>'
      : '';

    // Открытие главы по макету мобильной книги: номер, заголовок, авторский
    // лид, крупная сцена и вынесенная цитата. Нет авторской копии — нет блока.
    var opener = openerFor(ch);
    var lead = ch.lead ? '<p class="chapter__lead">' + esc(ch.lead) + '</p>' : '';

    var prevId = partIds[index - 1];
    var nextId = partIds[index + 1];
    var nav = '<nav class="chapter__nav" aria-label="Главы раздела">';
    nav += prevId && state.chapters[prevId]
      ? '<a class="prev" href="' + href(prevId) + '"><span class="dir">Предыдущая</span><span class="lbl">' +
        esc(state.chapters[prevId].title) + '</span></a>'
      : '<span></span>';
    nav += nextId && state.chapters[nextId]
      ? '<a class="next" href="' + href(nextId) + '"><span class="dir">Следующая</span><span class="lbl">' +
        esc(state.chapters[nextId].title) + '</span></a>'
      : '<span></span>';
    nav += '</nav>';

    // Повествование: ch.story (без практики). Если сборка ещё не разделила
    // главу, показываем полный текст — книга не должна ломаться.
    var story = typeof ch.story === 'string' ? ch.story : ch.markdown;

    return '' +
      '<article class="chapter' + (fig ? ' chapter--has-fig' : '') + '" id="' + esc(ch.id) + '" data-chapter="' + esc(ch.id) + '">' +
        '<header class="chapter__head">' +
          '<p class="chapter__num">Глава ' + pad2(chapterNo[ch.id] || (index + 1)) + '</p>' +
          '<h2 class="chapter__title">' + esc(ch.title) + '</h2>' +
          lead +
          productMetaHtml(ch) +
          (meta.isDraft ? '<p class="chapter__meta">Рабочий черновик · редакционные пометки сохранены</p>' : '') +
          noteLinkHtml(ch) +
        '</header>' +
        opener +
        playerFor(ch) +
        '<div class="chapter__layout">' +
          fig +
          '<div class="chapter__body">' + window.MD.render(story) + '</div>' +
        '</div>' +
        nav +
      '</article>';
  }

  function partTitleFor(id) {
    for (var i = 0; i < PARTS.length; i++) {
      if (PARTS[i].chapters.indexOf(id) >= 0) return PARTS[i].title;
    }
    return 'Книга';
  }

  /** Сквозная нумерация глав в порядке чтения (как в «Содержании»). */
  var chapterNo = {};
  function numberChapters() {
    var n = 0;
    chapterNo = {};
    PARTS.forEach(function (p) {
      p.chapters.forEach(function (id) {
        if (state.chapters[id]) chapterNo[id] = ++n;
      });
    });
  }

  /**
   * Открытие главы по макету мобильной книги: крупная сцена и авторская
   * цитата. Копия (лид и цитата) — только из макета автора; без неё блока нет.
   */
  function openerFor(ch) {
    if (!state.scenes) return '';
    var scene = null;
    state.scenes.forEach(function (s) {
      if (s.place && s.place.mode === 'opener' && s.place.chapter === ch.id && s.files && s.files.web) scene = s;
    });
    if (!scene) return '';
    var quote = ch.quote
      ? '<blockquote class="chapter__quote">' + esc(ch.quote) + '</blockquote>'
      : '';
    return '<div class="chapter__opener">' +
      '<figure class="scene-fig scene-fig--opener" data-scene="' + esc(scene.id) + '">' +
        '<img src="assets/scenes/' + esc(scene.files.web) + '" alt="' + esc(scene.title) + '" loading="lazy" decoding="async">' +
      '</figure>' +
      quote +
      '</div>';
  }

  /** Манифест озвучки: content/narration.json. Нет манифеста — нет плеера. */
  function loadNarration() {
    var url = (window.BOOK_CONFIG && window.BOOK_CONFIG.narrationUrl) || 'content/narration.json';
    return fetch(url, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /**
   * Пилюля озвучки под открытием главы. Рисует BookVoice (voice.js);
   * у нечёсаных глав пилюли нет — книга не обещает голоса, которого нет.
   */
  function playerFor(ch) {
    if (!window.BookVoice || !state.narration) return '';
    return window.BookVoice.render(ch, chapterNo[ch.id] || 0);
  }

  /** Порядок глав для плеера — тот же, что в «Содержании». */
  function readingOrder() {
    var ids = [];
    PARTS.forEach(function (p) {
      p.chapters.forEach(function (id) { if (state.chapters[id]) ids.push(id); });
    });
    return ids;
  }

  /** Раздел, в котором лежит глава (для звукового ландшафта). */
  function partIdFor(id) {
    for (var i = 0; i < PARTS.length; i++) {
      if (PARTS[i].chapters.indexOf(id) >= 0) return PARTS[i].reference ? 'reference' : PARTS[i].id;
    }
    return 'ostrov';
  }

  /**
   * Куда попадает каждая часть. Справочные главы стоят в своих разделах:
   * сезонная карта — рядом с календарём, заключение и реестр источников —
   * в разделе источников. Так у каждой главы есть живой якорь, а не ссылка
   * в пустоту.
   */
  var HOSTS = {
    ostrov: 'chapters-ostrov',
    more: 'chapters-more',
    les: 'chapters-les',
    dich: 'chapters-dich',
    'sezonnaya-karta-produktov': 'chapters-season-map',
    zaklyuchenie: 'chapters-sources',
    'reestr-istochnikov': 'chapters-sources',
  };

  function renderChapters() {
    numberChapters();
    var reference = PARTS.filter(function (p) { return p.reference; })[0];
    var refIds = reference
      ? reference.chapters.filter(function (id) { return state.chapters[id]; })
      : [];

    PARTS.filter(function (p) { return !p.reference; }).forEach(function (part) {
      var host = $(HOSTS[part.id]);
      if (!host) return;
      var ids = part.chapters.filter(function (id) { return state.chapters[id]; });
      host.innerHTML = ids.map(function (id, i) {
        return renderChapter(state.chapters[id], i, ids);
      }).join('');
    });

    // Справочные главы — те же статьи, но в своих разделах и со своей
    // навигацией «предыдущая/следующая» внутри справочной части.
    refIds.forEach(function (id) {
      var host = $(HOSTS[id]);
      if (!host) return;
      var i = refIds.indexOf(id);
      host.insertAdjacentHTML('beforeend', renderChapter(state.chapters[id], i, refIds));
    });

    suppressDropCapOnMarkers();
    enhanceReference();
  }

  /**
   * Буквица — знак начала литературного текста. Если глава начинается с
   * редакционной пометки, буквица на скобке выглядела бы опечаткой.
   */
  function suppressDropCapOnMarkers() {
    doc.querySelectorAll('.chapter__body').forEach(function (body) {
      var first = body.querySelector(':scope > p');
      if (!first) return;
      if (/^\s*\[/.test(first.textContent || '')) body.classList.add('chapter__body--nomark');
    });
  }

  /* ——— «Островные сцены»: иллюстрации внутри повествования ——— */

  function sceneMap() {
    var map = {};
    (state.scenes || []).forEach(function (s) { map[s.id] = s; });
    return map;
  }

  /** HTML фигуры сцены; если изображение ещё не готово — тихий слот-заглушка. */
  function sceneFigHtml(scene) {
    var img = scene.files && scene.files.web;
    var caption = scene.caption || scene.title;
    if (!img) {
      return '<figure class="scene-fig scene-fig--pending" data-scene="' + esc(scene.id) + '">' +
        '<div class="scene-fig__slot" aria-hidden="true"></div>' +
        '<figcaption>Иллюстрация готовится: «' + esc(scene.title) + '»</figcaption>' +
        '</figure>';
    }
    return '<figure class="scene-fig scene-fig--' + esc(scene.kind || 'byt') + '" data-scene="' + esc(scene.id) + '">' +
      '<img src="assets/scenes/' + esc(img) + '" alt="' + esc(scene.title) + '" loading="lazy" decoding="async">' +
      '<figcaption>' + esc(caption) + '</figcaption>' +
      '</figure>';
  }

  /**
   * Маркеры [ИЛЛЮСТРАЦИЯ: id] в тексте главы превращаются в фигуры.
   * Маркер без известной сцены остаётся редакционной пометкой — ничего не теряется.
   */
  function enhanceSceneFigures() {
    if (!state.scenes || !state.scenes.length) return;
    var map = sceneMap();
    doc.querySelectorAll('.chapter__body .ed').forEach(function (span) {
      var m = /^\[ИЛЛЮСТРАЦИЯ:\s*([\w-]+)\s*\]$/.exec(span.textContent || '');
      if (!m) return;
      var scene = map[m[1]];
      if (!scene) return;
      var holder = doc.createElement('div');
      holder.innerHTML = sceneFigHtml(scene);
      var fig = holder.firstElementChild;
      var p = span.parentNode;
      if (p && p.tagName === 'P' && p.children.length === 1 && (p.textContent || '').trim() === span.textContent.trim()) {
        p.parentNode.replaceChild(fig, p);
      } else {
        p.replaceChild(fig, span);
      }
    });
  }

  /**
   * Сцены с привязкой к разделу или к соседней главе (без маркера в тексте):
   * вставляются в заданную точку и никогда не дублируются.
   */
  function placeManifestFigures() {
    (state.scenes || []).forEach(function (scene) {
      var place = scene.place || {};
      if (place.mode !== 'part' && place.mode !== 'chapter') return;
      if (doc.querySelector('[data-scene="' + scene.id + '"]')) return;
      var html = sceneFigHtml(scene);
      if (place.mode === 'part' && place.position === 'open') {
        var host = $(HOSTS[place.part]);
        if (host) host.insertAdjacentHTML('afterbegin', html);
        return;
      }
      var el = place.chapter && doc.getElementById(place.chapter);
      if (!el) return;
      if (place.position === 'before') el.insertAdjacentHTML('beforebegin', html);
      else if (place.position === 'after') el.insertAdjacentHTML('afterend', html);
    });
  }

  /* ——— Карточки-тизеры (телефон) ——— */

  /**
   * Остановки спуска ведут в главы книги: карточка в каждой зоне —
   * та же глава, что и в «Содержании», с её вводным абзацем из book.json.
   * Новых сущностей не появляется: заголовок, раздел и абзац — из данных.
   */
  function renderSceneChapters() {
    doc.querySelectorAll('.level__chapter[data-chapter]').forEach(function (card) {
      var ch = state.chapters[card.getAttribute('data-chapter')];
      if (!ch) return;
      card.setAttribute('href', '#' + ch.id);
      var art = card.querySelector('.level__chapter-art');
      if (art) {
        if (ch.illustration) {
          art.hidden = false;
          var img = art.querySelector('img');
          img.setAttribute('src', 'assets/illustrations/' + ch.illustration);
        } else {
          art.hidden = true;
        }
      }
      var kicker = card.querySelector('.level__chapter-kicker');
      if (kicker) {
        kicker.textContent = ch.id === 'filosofiya' ? 'С чего начинается' : partTitleFor(ch.id);
      }
      var title = card.querySelector('.level__chapter-title');
      if (title) title.textContent = ch.title;
      var text = card.querySelector('.level__chapter-text');
      if (text) text.textContent = shorten(ch.abstract, 110);
      card.hidden = false;
    });
  }

  function shorten(text, max) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
  }

  /** Подсветка активного раздела в нижнем баре. */
  function markActiveTab() {
    var tabs = doc.querySelectorAll('#tabbar .tab');
    if (!tabs.length) return;
    var active = 'ostrov';
    var probe = window.innerHeight * 0.45;
    ['ostrov', 'more', 'les', 'dich'].forEach(function (id) {
      var el = doc.getElementById(id);
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (r.top <= probe && r.bottom > probe) active = id;
    });
    tabs.forEach(function (t) {
      var isOn = t.getAttribute('data-tab') === active;
      t.classList.toggle('is-on', isOn);
      if (t.tagName === 'A') {
        if (isOn) t.setAttribute('aria-current', 'true');
        else t.removeAttribute('aria-current');
      }
    });
  }

  /**
   * Тихий индикатор чтения над нижним баром: полоса прокрутки и
   * «глава N / всего» — как «1 / 12» в макете мобильной книги.
   */
  function updateReadout() {
    if (!els.readFill) return;
    // На странице главы прогресс — позиция главы в книге.
    if (doc.body.classList.contains('is-reading') && state.pageId && chapterNo[state.pageId]) {
      var total = Object.keys(chapterNo).length;
      els.readFill.style.transform = 'scaleX(' + (chapterNo[state.pageId] / total).toFixed(4) + ')';
      if (els.readLabel) els.readLabel.textContent = pad2(chapterNo[state.pageId]) + ' / ' + pad2(total);
      return;
    }
    var docH = (doc.documentElement.scrollHeight - window.innerHeight) || 1;
    var p = Math.min(1, Math.max(0, (window.scrollY || 0) / docH));
    els.readFill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    if (!els.readLabel) return;
    var total = Object.keys(chapterNo).length;
    var probe = window.innerHeight * 0.45;
    var current = null;
    doc.querySelectorAll('article.chapter').forEach(function (art) {
      if (art.getBoundingClientRect().top <= probe) current = art;
    });
    els.readLabel.textContent = (current && chapterNo[current.id])
      ? pad2(chapterNo[current.id]) + ' / ' + pad2(total)
      : '— / ' + pad2(total);
  }

  /* ——— «Заметка шефа» ——— */

  function sectionTitle(s) {
    if (s.heading) return s.heading;
    return s.group === 'recipe' ? 'Рецепт' : 'Практика';
  }

  function openNote(id, opts) {
    var ch = state.chapters[id];
    if (!ch || !hasNote(ch)) return;
    opts = opts || {};

    state.noteChapter = id;
    state.lastFocus = doc.activeElement;

    els.noteTitle.textContent = ch.title;
    els.noteKicker.textContent = ch.recipeState === 'blocked'
      ? 'Практическая часть · без рецепта'
      : 'Заметка шефа';

    els.noteLead.textContent = ch.recipeState === 'blocked'
      ? 'Эта заметка — о границе, а не о способе приготовления. Вид под охраной, и книга не превращает его в меню.'
      : 'Практическая часть главы: выбор продукта, обработка, техника и авторский рецепт. Повествование главы остаётся отдельно.';

    var sections = ch.practical.sections || [];
    var bodyHtml = ch.practical.markdown ? window.MD.render(ch.practical.markdown) : '';

    // Рецепт без авторского текста — не пустая дыра, а обозначенное место.
    var recipeSection = sections.filter(function (s) { return s.group === 'recipe'; })[0];
    if (recipeSection && recipeSection.chars < 80 && ch.recipeState !== 'blocked') {
      bodyHtml += '<div class="note-recipe-empty" id="note-recipe">' +
        '<p class="note-recipe-empty__k">Рецепт</p>' +
        '<p class="note-recipe-empty__t">Здесь будет авторский рецепт: точные ингредиенты и массы, состояние продукта, ' +
        'посуда и оборудование, время и температура, последовательность действий, признаки готовности и выход.</p>' +
        '<p class="note-recipe-empty__n">Пока этих данных нет, книга не публикует выдуманный рецепт. ' +
        'Практическая часть работает как справочник по выбору и обработке продукта.</p>' +
        '</div>';
    }
    els.noteBody.innerHTML = bodyHtml;

    // Оглавление заметки — по её разделам.
    var toc = sections.map(function (s, i) {
      var anchor = 'note-s-' + i;
      return { title: sectionTitle(s), anchor: anchor };
    });
    // Привязываем якоря к фактическим заголовкам в отрендеренном тексте.
    var heads = els.noteBody.querySelectorAll('h3');
    heads.forEach(function (h, i) {
      if (toc[i]) h.id = toc[i].anchor;
    });

    els.noteToc.innerHTML = toc.length > 1
      ? toc.map(function (t) {
        return '<a href="#' + t.anchor + '" data-note-jump="' + t.anchor + '">' + esc(t.title) + '</a>';
      }).join('')
      : '';
    els.noteToc.hidden = toc.length < 2;

    renderPending(ch);
    els.noteState.textContent = NOTE_LABEL[ch.recipeState] || '';
    els.noteBack.setAttribute('href', '#' + ch.id);

    els.note.hidden = false;
    doc.body.classList.add('is-sheet');
    els.note.classList.add('is-open');
    requestAnimationFrame(function () { els.noteScroll.scrollTop = 0; });
    if (!opts.silent) els.notePanel.focus();
    if (!opts.noHistory) {
      try { history.replaceState(null, '', '#note-' + id); } catch (e) { /* file:// */ }
    }
    announce('Открыта заметка шефа: ' + ch.title);
  }

  /** Чего в заметке ещё нет: показываем честно, а не заполняем. */
  function renderPending(ch) {
    var items = (ch.practical.placeholders || []).filter(function (p) {
      // «Рецепт: [добавит автор]» уже объяснён отдельным блоком.
      return !/^\*\*Рецепт/i.test(p);
    });
    if (!items.length) {
      els.notePending.hidden = true;
      els.notePending.innerHTML = '';
      return;
    }
    var blocked = ch.recipeState === 'blocked';
    els.notePending.hidden = false;
    els.notePending.innerHTML =
      '<h3 class="note-pending__title">' + (blocked ? 'Позиция редакции' : 'Что здесь ещё не написано') + '</h3>' +
      '<p class="note-pending__lead">' + (blocked
        ? 'Практическая часть этой главы сознательно не даёт инструкций: сначала проходит правовая и этическая граница.'
        : 'Эти места в рукописи обозначены, но не заполнены. Мы оставляем их видимыми, чтобы пробел нельзя было принять за готовый текст.') +
      '</p>' +
      '<ul class="note-pending__list">' + items.map(function (p) {
        var text = p.replace(/^\*\*|\*\*$/g, '').trim();
        return '<li><span class="ed">' + esc(text) + '</span></li>';
      }).join('') + '</ul>';
  }

  function closeNote(opts) {
    if (!state.noteChapter) return;
    opts = opts || {};
    var id = state.noteChapter;
    state.noteChapter = null;
    els.note.classList.remove('is-open');
    els.note.hidden = true;
    doc.body.classList.remove('is-sheet');
    if (!opts.noHistory) {
      try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// */ }
    }
    if (state.lastFocus && state.lastFocus.isConnected) {
      try { state.lastFocus.focus({ preventScroll: true }); } catch (e) { state.lastFocus.focus(); }
    }
    state.lastFocus = null;
    if (opts.restore) scrollToChapter(id);
  }

  function scrollToChapter(id) {
    scrollToEl(doc.getElementById(id), true);
  }

  function wireNote() {
    doc.addEventListener('click', function (e) {
      var opener = e.target.closest('[data-note]');
      if (opener) {
        e.preventDefault();
        openNote(opener.getAttribute('data-note'));
        return;
      }
      if (e.target.closest('[data-note-close]')) {
        e.preventDefault();
        closeNote({ restore: true });
        return;
      }
      var jump = e.target.closest('[data-note-jump]');
      if (jump) {
        e.preventDefault();
        scrollToEl(doc.getElementById(jump.getAttribute('data-note-jump')), true);
        return;
      }
      // Клик по затемнению вокруг панели закрывает заметку.
      if (e.target === els.note) closeNote({ restore: true });
    });

    // Возврат к главе — это ссылка на якорь, но панель надо закрыть.
    els.noteBack.addEventListener('click', function () { closeNote({}); });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.noteChapter) {
        closeNote({ restore: true });
        return;
      }
      if (e.key !== 'Tab' || !state.noteChapter) return;
      // Простая ловушка фокуса внутри панели.
      var focusables = els.notePanel.querySelectorAll('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ——— Справочные разделы ——— */

  function tracksHtml(tracks) {
    var order = ['nature', 'harvest', 'market'];
    var defs = (state.seasons && state.seasons.tracks) || [];
    var out = '<dl class="tracks">';
    order.forEach(function (key) {
      var def = defs.filter(function (t) { return t.id === key; })[0] || { title: key, hint: '' };
      var data = (tracks && tracks[key]) || { state: 'unknown', text: '' };
      var stateLabel = (state.seasons && state.seasons.states && state.seasons.states[data.state]) || data.state;
      out += '<div class="tracks__row tracks__row--' + esc(data.state) + '">' +
        '<dt>' + esc(def.title) +
        '<span class="tracks__hint">' + esc(def.hint) + '</span></dt>' +
        '<dd>' + (data.text ? esc(data.text) : 'Данных в рукописи нет.') +
        '<span class="tracks__state">' + esc(stateLabel) + '</span></dd></div>';
    });
    return out + '</dl>';
  }

  function seasonBlockHtml(b, compact, idPrefix) {
    var on = {};
    (b.range || []).forEach(function (m) { on[m] = true; });
    var idAttr = idPrefix ? ' id="' + esc(idPrefix + b.id) + '"' : '';
    return '<div class="season-block"' + idAttr + '>' +
      '<h3>' + esc(b.title) + '</h3>' +
      '<p class="months">' + esc(b.months) + '</p>' +
      (compact ? '' :
        '<div class="month-strip" aria-hidden="true">' +
        MONTHS.map(function (m, i) { return '<span class="' + (on[i] ? 'on' : '') + '">' + m + '</span>'; }).join('') +
        '</div>') +
      '<p class="season-block__lead">' + esc(b.lead) + '</p>' +
      tracksHtml(b.tracks) +
      '<ul class="season-block__chapters">' + (b.chapters || []).filter(function (id) { return state.chapters[id]; })
        .map(function (id) {
          return '<li><a href="' + href(id) + '">' + esc(state.chapters[id].title) + '</a></li>';
        }).join('') + '</ul>' +
      '<p class="panel__note">' + esc(b.caution) + '</p>' +
      '</div>';
  }

  // Сезонная карта в основном тексте уже есть отдельной главой; здесь —
  // короткая справка со ссылками, без дублирования её таблицы.
  function enhanceReference() {
    var src = state.chapters['reestr-istochnikov'];
    var zakl = state.chapters['zaklyuchenie'];
    var html = '';

    if (state.seasons) {
      html += '<p class="reference__note">' + esc(state.seasons.note) + '</p>';
      html += '<p class="reference__note">' + esc(state.seasons.marketNote) + '</p>';
      html += '<div class="season-list">' + state.seasons.blocks.map(function (b) {
        return seasonBlockHtml(b, true, 'season-block-');
      }).join('') + '</div>';
      if (state.seasons.notScheduled) {
        var ns = state.seasons.notScheduled;
        html += '<div class="season-block" id="season-block-not-scheduled">' +
          '<h3>' + esc(ns.title) + '</h3>' +
          '<p class="season-block__lead">' + esc(ns.note) + '</p>' +
          '<ul class="season-block__chapters">' + ns.chapters.filter(function (id) { return state.chapters[id]; })
            .map(function (id) {
              return '<li><a href="' + href(id) + '">' + esc(state.chapters[id].title) + '</a></li>';
            }).join('') + '</ul></div>';
      }
      html += '<p class="panel__note"><a href="#sezonnaya-karta-produktov">Рабочая сезонная карта в тексте книги →</a></p>';
    }
    if (els.referenceSeason) els.referenceSeason.innerHTML = html;

    var sources = '';
    if (src) sources += '<div class="chapter__body reference__src">' + window.MD.render(src.story || src.markdown) + '</div>';
    if (zakl) sources += '<p class="panel__note"><a href="' + href('zaklyuchenie') + '">Заключение →</a></p>';
    if (els.referenceSources) els.referenceSources.innerHTML = sources;
  }

  /* ——— Поиск продукта ——— */

  var findState = { query: '', part: null, env: null, cat: null, season: null };

  /** Карта «глава → сезоны, где она упомянута». */
  function seasonMap() {
    var map = {};
    if (!state.seasons) return map;
    state.seasons.blocks.forEach(function (b) {
      (b.chapters || []).forEach(function (id) {
        (map[id] = map[id] || []).push(b.id);
      });
    });
    return map;
  }

  function productChapters() {
    var rows = [];
    PARTS.forEach(function (part) {
      if (part.reference) return;
      part.chapters.forEach(function (id) {
        var ch = state.chapters[id];
        if (ch) rows.push({ ch: ch, part: part.title });
      });
    });
    return rows;
  }

  function chipHtml(value, label, active, attr) {
    return '<button class="chip" type="button" ' + attr + '="' + esc(value) + '" aria-pressed="' +
      (active === value ? 'true' : 'false') + '">' + esc(label) + '</button>';
  }

  function renderFilters() {
    var rows = productChapters();

    var parts = [{ id: null, title: 'Все' }].concat(
      PARTS.filter(function (p) { return !p.reference; }).map(function (p) { return { id: p.id, title: p.title }; })
    );
    els.findGroups.innerHTML = parts.map(function (p) {
      return chipHtml(p.id || '', p.title, findState.part || '', 'data-part');
    }).join('');

    var envs = {};
    var cats = {};
    rows.forEach(function (r) {
      if (r.ch.environment) envs[r.ch.environment] = true;
      if (r.ch.category) cats[r.ch.category] = true;
    });
    els.findEnvs.innerHTML = chipHtml('', 'Все', findState.env || '', 'data-env') +
      Object.keys(envs).map(function (k) { return chipHtml(k, ENV_LABEL[k] || k, findState.env || '', 'data-env'); }).join('');
    els.findCats.innerHTML = chipHtml('', 'Все', findState.cat || '', 'data-cat') +
      Object.keys(cats).map(function (k) { return chipHtml(k, CAT_LABEL[k] || k, findState.cat || '', 'data-cat'); }).join('');

    if (state.seasons) {
      els.findSeasons.innerHTML = chipHtml('', 'Все', findState.season || '', 'data-season') +
        state.seasons.blocks.map(function (b) {
          return chipHtml(b.id, b.title, findState.season || '', 'data-season');
        }).join('') +
        chipHtml('none', 'не установлен', findState.season || '', 'data-season');
    } else {
      els.findSeasons.innerHTML = '';
    }

    els.findReset.hidden = !(findState.part || findState.env || findState.cat || findState.season || findState.query);
  }

  function renderFind() {
    renderFilters();

    var q = findState.query.trim().toLowerCase();
    var map = seasonMap();
    var rows = productChapters().filter(function (r) {
      var ch = r.ch;
      if (findState.part === '__all') return false;
      if (findState.part && ch.part !== findState.part) return false;
      if (findState.env && ch.environment !== findState.env) return false;
      if (findState.cat && ch.category !== findState.cat) return false;
      if (findState.season) {
        var seasons = map[ch.id] || [];
        if (findState.season === 'none') { if (seasons.length) return false; }
        else if (seasons.indexOf(findState.season) < 0) return false;
      }
      if (q) {
        var hay = [ch.title, ch.region || '', ch.abstract || '', ch.markdown || ''].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    if (!rows.length) {
      els.findResults.innerHTML = '<li class="r-empty"><p class="r-none">Ничего не нашлось. ' +
        'Попробуйте местное название — «чека», «уёк», «галец» — или снимите фильтр по сезону: ' +
        'у части глав сезон в рукописи ещё не установлен.</p></li>';
    } else {
      els.findResults.innerHTML = rows.map(function (r) {
        var meta = [r.part];
        if (r.ch.category && CAT_LABEL[r.ch.category]) meta.push(CAT_LABEL[r.ch.category]);
        if (r.ch.region) meta.push(r.ch.region);
        if (window.SeasonLabels && state.seasons) {
          var s = window.SeasonLabels.shortLabel(state.seasons, r.ch.id);
          if (s) meta.push(s);
        }
        return '<li><a href="' + href(r.ch.id) + '">' +
          '<span class="r-title">' + esc(r.ch.title) +
          (hasNote(r.ch) ? ' <span class="r-note" title="есть заметка шефа">↗</span>' : '') + '</span>' +
          '<span class="r-group">' + esc(meta.join(' · ')) + '</span>' +
          (r.ch.abstract ? '<span class="r-abs">' + esc(r.ch.abstract) + '</span>' : '') +
          '</a></li>';
      }).join('');
    }

    els.findCount.textContent = rows.length
      ? 'Глав: ' + rows.length + '. Каждая открывается целиком — с историей, а не карточкой товара.'
      : '';
  }

  /* ——— Сезонный календарь ——— */

  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function renderSeason() {
    if (!state.seasons) {
      els.seasonCal.innerHTML = '<p class="panel__hint">Сезонные данные не загрузились. Откройте раздел «Сезонный календарь» в книге.</p>';
      return;
    }
    var html = '';
    html += '<div class="cal__legend">' + (state.seasons.tracks || []).map(function (t) {
      return '<span class="cal__legend-row"><b>' + esc(t.title) + '</b>' + esc(t.hint) + '</span>';
    }).join('') + '</div>';
    state.seasons.blocks.forEach(function (b) { html += seasonBlockHtml(b, false, 'cal-block-'); });
    els.seasonCal.innerHTML = html;
  }

  /* ——— Панели ——— */

  var openPanel = null;

  function setPanel(name) {
    var panels = { contents: els.contents, find: els.find, season: els.season };
    var buttons = { contents: $('btn-contents'), find: $('btn-find'), season: $('btn-season') };
    Object.keys(panels).forEach(function (key) {
      var panel = panels[key];
      if (!panel) return;
      var isOpen = key === name;
      panel.hidden = !isOpen;
      if (buttons[key]) buttons[key].setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    openPanel = name || null;
    els.scrim.hidden = !name;
    if (name === 'find') setTimeout(function () { els.findInput.focus(); }, 40);
  }

  function closePanels() { setPanel(null); }

  /* ——— Сцена: параллакс по семи остановкам ——— */

  function setupScene() {
    if (!els.scene) return;
    var layers = Array.prototype.slice.call(els.scene.querySelectorAll('.layer[data-depth]'));
    var levels = Array.prototype.slice.call(els.sceneText.querySelectorAll('.level'));

    els.sceneDots.innerHTML = LEVELS.map(function (l, i) {
      return '<button class="dot" type="button" role="tab" aria-selected="' + (i === 0 ? 'true' : 'false') +
        '" data-level="' + (i + 1) + '" aria-label="Остановка ' + (i + 1) + ' из ' + LEVELS.length + ': ' + esc(l.title) + '">' +
        '<span class="dot__label">' + esc(l.title) + '</span><span class="dot__mark"></span></button>';
    }).join('');

    els.sceneDots.addEventListener('click', function (e) {
      var btn = e.target.closest('.dot');
      if (!btn) return;
      scrollToLevel(Number(btn.getAttribute('data-level')));
    });

    // Навигация может попросить сцену показать нужную зону.
    state.scrollToLevel = scrollToLevel;

    function scrollToLevel(n) {
      var rect = els.scene.getBoundingClientRect();
      var top = window.scrollY + rect.top;
      var span = els.scene.offsetHeight - window.innerHeight;
      var target = top + (span * (n - 1)) / (LEVELS.length - 1) + 8;
      if (typeof window.scrollTo === 'function') {
        window.scrollTo({ top: target, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      }
    }

    function onScroll() {
      if (state.sceneFrame) return;
      state.sceneFrame = requestAnimationFrame(function () {
        state.sceneFrame = 0;
        update();
      });
    }

    /**
     * Параметры камеры заданы в CSS (--start-top, --stop-space) — свои для
     * десктопа и телефона. Здесь только движение: за один уровень камера
     * опускается на одну «остановку», а близкие планы уходят чуть быстрее —
     * отсюда ощущение глубины без каши из слоёв.
     */
    function sceneVars() {
      var cs = window.getComputedStyle(els.scene);
      var start = parseFloat(cs.getPropertyValue('--start-top'));
      var space = parseFloat(cs.getPropertyValue('--stop-space'));
      return {
        start: isFinite(start) ? start : 26,
        space: isFinite(space) ? space : 92,
        // Камера опускается на столько остановок, сколько уровней у рассказа.
        stops: levels.length || 5,
      };
    }

    function update() {
      var rect = els.scene.getBoundingClientRect();
      var vh = window.innerHeight;
      var span = els.scene.offsetHeight - vh;
      if (span <= 0) return;
      var progress = Math.min(1, Math.max(0, -rect.top / span));
      var cam = sceneVars();
      var unit = vh / 100; // 1vh в пикселях

      // Спуск = (уровни - 1) остановок за весь проход сцены. Каждый пояс
      // приезжает в кадр ровно на своей остановке; ближние планы идут чуть
      // быстрее дальних — это и даёт глубину.
      var travel = (cam.stops - 1) * cam.space;
      layers.forEach(function (layer) {
        var depth = parseFloat(layer.getAttribute('data-depth')) || 0.5;
        var parallax = 1 + (depth - 0.5) * 0.3;
        var shift = progress * travel * parallax;
        var y = -shift * unit;
        layer.style.transform = 'translate3d(-50%, ' + y.toFixed(1) + 'px, 0)';
      });

      var idx = Math.min(LEVELS.length - 1, Math.floor(progress * LEVELS.length));
      levels.forEach(function (el, i) { el.classList.toggle('is-on', i === idx); });
      var dots = els.sceneDots.querySelectorAll('.dot');
      dots.forEach(function (d, i) { d.setAttribute('aria-selected', i === idx ? 'true' : 'false'); });

      els.scene.style.setProperty('--depth', progress.toFixed(3));

      // Панель с оглавлением всегда видна: вход в книгу возможен из любой точки.

      if (!markActiveTab.t) {
        markActiveTab.t = requestAnimationFrame(function () {
          markActiveTab.t = 0;
          markActiveTab();
          updateReadout();
        });
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /* ——— Титул: туман реагирует на мышь ——— */

  function setupFog() {
    if (reduceMotion.matches) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    var stage = $('front-stage');
    if (!stage) return;
    var fogs = stage.querySelectorAll('[data-fog]');
    var raf = 0;
    stage.addEventListener('pointermove', function (e) {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var cx = (e.clientX / window.innerWidth - 0.5) * 2;
        var cy = (e.clientY / window.innerHeight - 0.5) * 2;
        fogs.forEach(function (f, i) {
          var k = (i + 1) * 8;
          f.style.transform = 'translate3d(' + (cx * k).toFixed(1) + 'px,' + (cy * k * 0.6).toFixed(1) + 'px,0)';
        });
      });
    });
  }

  /* ——— Прелоадинг ——— */

  function endVeil() {
    if (!els.veil || els.veil.classList.contains('is-gone')) return;
    els.veil.classList.add('is-gone');
    doc.body.classList.remove('is-opening');
    try { sessionStorage.setItem('opv_visited', '1'); } catch (e) { /* приватный режим */ }
    setTimeout(function () {
      if (els.veil && els.veil.parentNode) els.veil.setAttribute('aria-hidden', 'true');
    }, 1700);
  }

  /**
   * Туман исчезает, как только сцена готова. Медленная сеть — не повод
   * держать читателя: если через 2,5 секунды картинки ещё идут, туман уходит
   * сам, а остров дорисовывается уже в титуле.
   */
  function veilOnSceneReady() {
    if (!els.veil || reduceMotion.matches) return;
    var started = Date.now();
    var release = function () {
      var wait = Math.max(0, 900 - (Date.now() - started));
      setTimeout(endVeil, wait);
    };
    var stage = doc.getElementById('front-stage');
    var img = stage && stage.querySelector('img');
    if (img && !img.complete) {
      img.addEventListener('load', release, { once: true });
      img.addEventListener('error', release, { once: true });
    } else {
      release();
    }
  }

  function setupVeil() {
    if (reduceMotion.matches) {
      if (els.veil) els.veil.remove();
      doc.body.classList.remove('is-opening');
      return;
    }
    veilOnSceneReady();
    var visited = false;
    try { visited = sessionStorage.getItem('opv_visited') === '1'; } catch (e) { visited = false; }

    // Верхняя граница, даже если картинка так и не пришла.
    var delay = visited ? (CONFIG.veilRepeat || 1100) : (CONFIG.veilMax || 5200);
    var timer = setTimeout(endVeil, delay);

    function skip() {
      clearTimeout(timer);
      endVeil();
    }
    if (els.veilSkip) els.veilSkip.addEventListener('click', skip);
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && doc.body.classList.contains('is-opening')) skip();
    });
    if (els.veil) {
      els.veil.addEventListener('pointerdown', function (e) {
        if (e.target === els.veilSkip) return;
        skip();
      });
    }
    doc.addEventListener('click', function (e) {
      if (doc.body.classList.contains('is-opening') && e.target.closest('a[href^="#"]')) skip();
    });
  }

  /* ——— Звук ——— */

  /**
   * Атмосфера: кнопка в верхней панели включает ландшафт текущего раздела
   * (манифест content/soundscape.json). Доступность дорожек выясняется
   * асинхронно: пока файлов нет, кнопка честно заблокирована и подписана
   * «Звук готовится» — книга не обещает звук, которого не существует.
   */
  function setupSound() {
    if (!window.BookAudio) return;
    var btn = $('btn-sound');
    var label = $('sound-label');
    if (!btn) return;

    function applyState(st) {
      btn.disabled = !st.ready;
      if (!st.ready) {
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'Звуковые дорожки пока не добавлены в репозиторий (docs/assets/audio/)';
        if (label) label.textContent = 'Звук готовится';
        var off = $('sound-vol');
        if (off) off.hidden = true;
        return;
      }
      btn.title = 'Атмосфера: звуковой ландшафт раздела';
      btn.setAttribute('aria-pressed', st.on ? 'true' : 'false');
      if (label) label.textContent = st.on ? 'Атмосфера вкл.' : 'Атмосфера выкл.';
      var volEl = $('sound-vol');
      if (volEl) volEl.hidden = !st.on;
      var range = $('volume');
      if (range && document.activeElement !== range) {
        range.value = String(Math.round(st.volume * 100));
      }
    }

    window.BookAudio.init({
      manifestUrl: (window.BOOK_CONFIG && window.BOOK_CONFIG.soundscapeUrl) || 'content/soundscape.json',
    });
    window.BookAudio.subscribe(applyState);

    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      var on = window.BookAudio.toggle();
      announce(on
        ? 'Атмосфера включена: ландшафт раздела меняется плавно, вместе с переходами между главами.'
        : 'Атмосфера выключена.');
    });

    var vol = $('sound-vol');
    var range = $('volume');
    if (vol && range) {
      range.addEventListener('input', function () {
        window.BookAudio.setVolume(Number(range.value) / 100);
      });
      vol.hidden = true; // ползунок появляется только при включённом звуке
    }

    // На время проверки кнопка заблокирована: щелчок не должен включать тишину.
    btn.disabled = true;
    btn.title = 'Проверяем, есть ли звуковые дорожки…';
  }

  /* ——— Поддержка проекта ——— */

  function setupDonate() {
    if (!CONFIG.donateUrl) return;
    var wrap = doc.querySelector('[data-donate]');
    var link = $('donate-link');
    if (!wrap || !link) return;
    link.href = CONFIG.donateUrl;
    wrap.hidden = false;
  }

  /* ——— Запуск ——— */

  function wirePanels() {
    $('btn-contents').addEventListener('click', function () {
      setPanel(openPanel === 'contents' ? null : 'contents');
    });
    $('btn-find').addEventListener('click', function () {
      setPanel(openPanel === 'find' ? null : 'find');
      renderFind();
    });
    $('btn-season').addEventListener('click', function () {
      setPanel(openPanel === 'season' ? null : 'season');
      renderSeason();
    });
    var tabSeason = $('tab-season');
    if (tabSeason) {
      tabSeason.addEventListener('click', function () {
        setPanel(openPanel === 'season' ? null : 'season');
        renderSeason();
      });
    }
    els.scrim.addEventListener('click', closePanels);
    doc.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', closePanels);
    });
    doc.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { setPanel(b.getAttribute('data-open')); });
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openPanel) closePanels();
    });
    doc.addEventListener('click', function (e) {
      if (e.target.closest('.panel a[href^="#"]')) closePanels();
    });

    els.findInput.addEventListener('input', function () {
      findState.query = els.findInput.value;
      renderFind();
      els.findInput.focus();
    });

    function onChip(e, attr, key) {
      var chip = e.target.closest('.chip');
      if (!chip || !chip.hasAttribute(attr)) return;
      var value = chip.getAttribute(attr) || null;
      findState[key] = findState[key] === value ? null : value;
      renderFind();
    }
    els.findGroups.addEventListener('click', function (e) { onChip(e, 'data-part', 'part'); });
    els.findEnvs.addEventListener('click', function (e) { onChip(e, 'data-env', 'env'); });
    els.findCats.addEventListener('click', function (e) { onChip(e, 'data-cat', 'cat'); });
    els.findSeasons.addEventListener('click', function (e) { onChip(e, 'data-season', 'season'); });
    els.findReset.addEventListener('click', function () {
      findState.query = '';
      findState.part = findState.env = findState.cat = findState.season = null;
      els.findInput.value = '';
      renderFind();
    });
  }

  /** Читатель уже в том разделе, где стоит глава? */
  function inSamePart(id) {
    var el = doc.getElementById(id);
    var part = el && el.closest('.part');
    if (!part) return true;
    var rect = part.getBoundingClientRect();
    return rect.top <= 0 && rect.bottom > window.innerHeight * 0.5;
  }

  /* ——— Страницы: одна глава — одна страница, переходы вместо скролла ——— */

  function showChapter(id) {
    var art = doc.getElementById(id);
    if (!art) return;
    state.pageId = id;
    doc.body.classList.add('is-reading');
    doc.querySelectorAll('article.chapter').forEach(function (c) {
      c.classList.toggle('is-current', c.id === id);
    });
    doc.querySelectorAll('main .part').forEach(function (p) {
      p.classList.toggle('is-current-part', p.contains(art));
    });
    // Ландшафт раздела меняется плавно, вместе со страницей главы.
    if (window.BookAudio) window.BookAudio.setPart(partIdFor(id));
    window.scrollTo(0, 0);
    updateReadout();
  }

  function showHome(raw) {
    state.pageId = null;
    doc.body.classList.remove('is-reading');
    doc.querySelectorAll('article.chapter.is-current').forEach(function (c) {
      c.classList.remove('is-current');
    });
    doc.querySelectorAll('main .part.is-current-part').forEach(function (p) {
      p.classList.remove('is-current-part');
    });
    if (window.BookAudio) window.BookAudio.setPart('ostrov');
    if (raw && raw !== 'top') {
      var target = doc.getElementById(raw);
      if (target) { scrollToEl(target, false); return; }
    }
    window.scrollTo(0, 0);
    updateReadout();
  }

  /** Единая точка маршрута: хеш ведёт либо на страницу главы, либо на главную. */
  function route() {
    var raw = location.hash.slice(1);
    if (raw.indexOf('note-') === 0) return;
    if (state.chapters[raw]) {
      if (state.pageId !== raw) showChapter(raw);
    } else if (state.pageId || raw) {
      showHome(raw);
    }
  }

  function setupAnchors() {
    doc.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var raw = a.getAttribute('href').slice(1);
      if (!raw) return;

      // Ссылка на заметку шефа обрабатывается отдельно.
      if (raw.indexOf('note-') === 0) return;

      var target = doc.getElementById(raw);
      if (!target) return;
      e.preventDefault();
      closePanels();

      // Глава — отдельная страница: открываем её переходом, а не скроллом.
      // Карта «спуска по острову» остаётся на главной со своими точками уровней.
      if (state.chapters[raw]) {
        if (state.pageId === raw) return;
        try { history.pushState(null, '', '#' + raw); } catch (err) { /* file:// */ }
        showChapter(raw);
        return;
      }

      // Секция главной: если читали главу — сначала возвращаемся на главную.
      if (state.pageId) {
        try { history.pushState(null, '', '#' + raw); } catch (err2) { /* file:// */ }
        showHome(raw);
        return;
      }
      scrollToEl(target, true);
      try { history.replaceState(null, '', '#' + raw); } catch (e2) { /* file:// */ }
    });
  }

  function loadSeasons() {
    return fetch(CONFIG.seasonsUrl || 'content/seasons.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function loadScenes() {
    return fetch(CONFIG.scenesUrl || 'content/scenes.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function openFromHash() {
    var hash = location.hash.slice(1);
    if (hash.indexOf('note-') === 0) {
      var id = hash.slice(5);
      if (state.chapters[id] && hasNote(state.chapters[id])) {
        setTimeout(function () { openNote(id, { noHistory: true, silent: true }); }, 80);
      }
      return;
    }
    if (hash) {
      if (state.chapters[hash]) {
        setTimeout(function () { showChapter(hash); }, 60);
      } else {
        var target = doc.getElementById(hash);
        if (target) setTimeout(function () { scrollToEl(target, false); }, 60);
      }
    }
  }

  function boot() {
    setupVeil();
    setupFog();
    wirePanels();
    setupAnchors();
    wireNote();
    setupDonate();
    window.addEventListener('popstate', route);

    Promise.all([
      fetch('content/book.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }),
      loadSeasons(),
      loadScenes(),
      loadNarration(),
    ])
      .then(function (res) {
        state.book = res[0];
        state.seasons = res[1];
        state.scenes = (res[2] && res[2].scenes) || null;
        state.narration = res[3] || null;
        if (window.BookVoice) window.BookVoice.setManifest(state.narration);
        (state.book.chapters || []).forEach(function (ch) {
          state.chapters[ch.id] = ch;
          if (ch.story || ch.practical) ch.__prepared = true;
        });

        renderContents();
        renderChapters();
        placeManifestFigures();
        enhanceSceneFigures();
        renderSceneChapters();
        renderFind();
        renderSeason();
        setupScene();
        setupSound();
        // Постоянный плеер: порядок глав — как в «Содержании».
        if (window.BookVoice) window.BookVoice.wire({ order: readingOrder() });

        var meta = state.book.meta || {};
        els.footLine.textContent = (meta.title || 'Книга') +
          (meta.author ? ' · ' + meta.author : '') +
          (meta.updated ? ' · редакция ' + meta.updated : '');
        if (meta.subtitle) {
          var md = doc.querySelector('meta[name="description"]');
          if (md) md.setAttribute('content', meta.subtitle);
        }

        openFromHash();
      })
      .catch(function (err) {
        if (els.contentsList) {
          els.contentsList.innerHTML = '<p class="panel__note">Не удалось загрузить книгу (' +
            esc(err.message) + '). Если страница открыта как файл с диска, нужен локальный сервер: ' +
            '<code>npm run serve:docs</code>.</p>';
        }
        console.error(err);
      });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
