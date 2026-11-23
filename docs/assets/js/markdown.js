/**
 * Небольшой Markdown-рендерер для сайта книги.
 * Поддерживает: заголовки, абзацы, списки, цитаты, таблицы, hr,
 * жирный/курсив, код, ссылки, автоссылки, изображения и редакционные
 * маркеры [в квадратных скобках].
 *
 * Работает и в браузере (window.MD), и в Node (module.exports) — для тестов.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MD = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeUrl(url) {
    var u = String(url).trim();
    if (/^(https?:|mailto:|#|\.|\/|[\w.-]+\/)/i.test(u)) return u;
    if (/^javascript:/i.test(u)) return '#';
    return u;
  }

  /** Инлайн-разметка одного фрагмента (без переводов строк). */
  function inline(text) {
    var slots = [];
    function slot(html) {
      slots.push(html);
      return '\u0000' + (slots.length - 1) + '\u0000';
    }

    var s = String(text);

    // 1. Код в обратных кавычках — извлекаем до экранирования.
    s = s.replace(/`([^`]+)`/g, function (_, code) {
      return slot('<code>' + escapeHtml(code) + '</code>');
    });

    // 2. Экранируем весь оставшийся текст.
    s = escapeHtml(s);

    // 3. Картинки. src уже экранирован на шаге 2 — повторно не экранируем.
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (_, alt, src, title) {
      var t = title ? ' title="' + title + '"' : '';
      return slot('<img src="' + safeUrl(src) + '" alt="' + alt + '"' + t + ' loading="lazy">');
    });

    // 4. Ссылки.
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
      var inner = label
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      return slot(
        '<a href="' + safeUrl(href) + '" target="_blank" rel="noopener">' + inner + '</a>'
      );
    });

    // 5. Жирный / курсив.
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

    // 6. Автоссылки.
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>"']+)/g, function (_, pre, url) {
      var clean = url.replace(/[.,;:!?)]+$/, '');
      var tail = url.slice(clean.length);
      return pre + slot('<a href="' + clean + '" target="_blank" rel="noopener">' + clean + '</a>') + tail;
    });

    // 7. Редакционные маркеры […] (ссылки и картинки уже извлечены).
    s = s.replace(/\[([^\[\]]{1,400})\]/g, function (_, body) {
      return slot('<span class="ed">[' + body + ']</span>');
    });

    // 8. Возвращаем вставки (вложенные — итеративно).
    var out = s;
    for (var i = 0; i < 10; i++) {
      var next = out.replace(/\u0000(\d+)\u0000/g, function (_, n) {
        return slots[Number(n)];
      });
      if (next === out) break;
      out = next;
    }
    return out;
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.indexOf('-') >= 0;
  }

  function splitRow(row) {
    var r = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    return r.split('|').map(function (c) { return c.trim(); });
  }

  function renderList(lines) {
    var html = '';
    var stack = []; // { tag, indent }
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^(\s*)(?:([-*])|(\d+)\.)\s+(.*)$/);
      if (!m) continue;
      var indent = m[1].replace(/\t/g, '  ').length;
      var ordered = Boolean(m[3]);
      var tag = ordered ? 'ol' : 'ul';
      var content = inline(m[4]);

      while (stack.length && stack[stack.length - 1].indent > indent) {
        html += '</li></' + stack.pop().tag + '>';
      }
      if (!stack.length) {
        html += '<' + tag + '>';
        stack.push({ tag: tag, indent: indent });
      } else if (stack[stack.length - 1].indent === indent) {
        if (stack[stack.length - 1].tag !== tag) {
          html += '</li></' + stack.pop().tag + '><' + tag + '>';
          stack.push({ tag: tag, indent: indent });
        } else {
          html += '</li>';
        }
      } else {
        html += '<' + tag + '>';
        stack.push({ tag: tag, indent: indent });
      }
      html += '<li>' + content;
    }
    while (stack.length) {
      html += '</li></' + stack.pop().tag + '>';
    }
    return html;
  }

  function renderTable(lines) {
    var head = splitRow(lines[0]);
    var body = [];
    for (var i = 2; i < lines.length; i++) {
      if (lines[i].indexOf('|') < 0) continue;
      body.push(splitRow(lines[i]));
    }
    var html = '<div class="table-wrap"><table><thead><tr>';
    head.forEach(function (c) { html += '<th>' + inline(c) + '</th>'; });
    html += '</tr></thead><tbody>';
    body.forEach(function (row) {
      html += '<tr>';
      for (var j = 0; j < head.length; j++) {
        html += '<td>' + inline(row[j] || '') + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function renderBlock(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var html = '';
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      // Горизонтальный разделитель.
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html += '<hr>';
        i++;
        continue;
      }

      // Заголовок.
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        var lvl = h[1].length;
        html += '<h' + lvl + '>' + inline(h[2].trim()) + '</h' + lvl + '>';
        i++;
        continue;
      }

      // Таблица.
      if (line.indexOf('|') === 0 && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        var tlines = [line, lines[i + 1]];
        i += 2;
        while (i < lines.length && lines[i].indexOf('|') >= 0) {
          tlines.push(lines[i]);
          i++;
        }
        html += renderTable(tlines);
        continue;
      }

      // Цитата: подряд идущие строки с «>».
      if (/^\s*>/.test(line)) {
        var qlines = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          qlines.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html += '<blockquote>' + renderBlock(qlines.join('\n')) + '</blockquote>';
        continue;
      }

      // Список.
      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
        var llines = [];
        while (i < lines.length && lines[i].trim() && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          llines.push(lines[i]);
          i++;
        }
        html += renderList(llines);
        continue;
      }

      // Абзац: пустая строка — граница, одиночный перевод строки — <br>.
      var plines = [];
      while (i < lines.length && lines[i].trim()) {
        if (
          /^(#{1,6})\s/.test(lines[i]) ||
          /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) ||
          /^\s*>/.test(lines[i]) ||
          /^\s*([-*]|\d+\.)\s+/.test(lines[i])
        ) break;
        plines.push(lines[i]);
        i++;
      }
      if (plines.length) {
        html += '<p>' + plines.map(inline).join('<br>') + '</p>';
      }
    }
    return html;
  }

  function render(src) {
    if (src == null) return '';
    return renderBlock(src);
  }

  return { render: render, inline: inline, escapeHtml: escapeHtml };
});
