'use strict';

/**
 * Проверки редакционной архитектуры:
 *  • повествование и практическая часть разведены;
 *  • рецепты не выдуманы: отсутствующее обозначено как отсутствующее;
 *  • запрет на рецепт (охраняемый вид) сильнее структуры;
 *  • фильтры поиска и сезонные дорожки не обещают того, чего нет в рукописи.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BOOK_PATH = path.join(ROOT, 'docs', 'content', 'book.json');
const SEASONS_PATH = path.join(ROOT, 'docs', 'content', 'seasons.json');
const SPLIT = require(path.join(ROOT, 'tools', 'chapter-split.js'));

const book = JSON.parse(fs.readFileSync(BOOK_PATH, 'utf8'));
const seasons = JSON.parse(fs.readFileSync(SEASONS_PATH, 'utf8'));
const byId = new Map(book.chapters.map((c) => [c.id, c]));

test('практическая часть: «На кухне» и «Рецепт» не остаются в повествовании', () => {
  for (const ch of book.chapters) {
    if (!ch.practical) continue;
    assert.ok(typeof ch.story === 'string' && ch.story.length > 0, `${ch.id}: повествование не пусто`);
    assert.ok(!/^###\s*(На кухне|Рецепт|Выбрать, сохранить, приготовить)\s*$/m.test(ch.story),
      `${ch.id}: практический раздел не должен оставаться в тексте главы`);
  }
});

test('повествование сохраняет аппарат главы: вопросы автору и источники', () => {
  const koryushka = byId.get('koryushka');
  assert.match(koryushka.story, /Редакторские вопросы автору/, 'вопросы автору остаются при тексте');
  assert.match(koryushka.story, /Источники и пометки/, 'источники остаются при тексте');
});

test('«Заметка шефа» есть только там, где в рукописи есть практический материал', () => {
  for (const ch of book.chapters) {
    const split = SPLIT.splitChapter(ch);
    assert.equal(!!ch.practical, split.hasPractical, `${ch.id}: признак заметки совпадает с разбором`);
    if (ch.practical) {
      assert.ok(Array.isArray(ch.practical.sections), `${ch.id}: разделы заметки перечислены`);
    }
  }
  const withNotes = book.chapters.filter((c) => c.practical).length;
  assert.ok(withNotes > 20, `заметок шефа достаточно много для книги: ${withNotes}`);
});

test('рецепты не выдуманы: пустое место помечено, а не заполнено', () => {
  let awaiting = 0;
  for (const ch of book.chapters) {
    if (!ch.practical) continue;
    if (ch.recipeState === 'awaiting-author') awaiting += 1;
    if (ch.recipeState === 'awaiting-author' || ch.recipeState === 'blocked') {
      // Либо место под рецепт помечено в тексте, либо в заметке прямо сказано,
      // почему рецепта нет. Тихо пустого рецепта быть не может.
      const explicit = ch.practical.placeholders.length > 0 ||
        /рецепт/i.test(ch.practical.markdown);
      assert.ok(explicit, `${ch.id}: отсутствие рецепта должно быть обозначено в тексте`);
    }
  }
  assert.ok(awaiting > 0, 'часть рецептов честно ждёт автора');
  const ready = book.chapters.filter((c) => c.recipeState === 'ready');
  assert.equal(ready.length, 0, 'готовых авторских рецептов в рукописи пока нет — и не должно появиться само');
});

test('охраняемый вид: заметка не даёт рецепта, даже если он «ожидается»', () => {
  const taymen = byId.get('taymen');
  assert.ok(taymen.practical, 'у тайменя есть практическая часть — о правовом статусе');
  assert.equal(taymen.recipeState, 'blocked', 'статус «без рецепта»');
  assert.equal(taymen.practical.hasRecipe, false, 'рецепта нет');
  assert.ok(taymen.practical.isRecipeDeclined, 'рецепт отклонён редакционно, а не «ждёт»');
  assert.match(taymen.practical.markdown + taymen.practical.placeholders.join(' '), /не публиковать рецепт/i);
});

test('метаданные поиска: среда и категория только из известных значений', () => {
  const envs = new Set(['more', 'river', 'les', 'les_dich']);
  const cats = new Set(['fish', 'shellfish', 'seaweed', 'plants', 'berries', 'game']);
  for (const ch of book.chapters) {
    if (ch.environment) assert.ok(envs.has(ch.environment), `${ch.id}: среда ${ch.environment}`);
    if (ch.category) assert.ok(cats.has(ch.category), `${ch.id}: категория ${ch.category}`);
    assert.ok(/^(more|les|dich|ostrov|spravochnoe)$/.test(ch.part), `${ch.id}: раздел ${ch.part}`);
  }
  // У каждой продуктовой главы должна быть среда: иначе сцена и поиск её не увидят.
  const products = book.chapters.filter((c) => c.part === 'more' || c.part === 'les' || c.part === 'dich');
  for (const ch of products) {
    assert.ok(ch.environment, `${ch.id}: не размечена природная среда`);
    // Единственное законное исключение — глава, где сам продукт ещё не установлен.
    if (ch.id === 'nazvanie-utochnit-stranitsa-108') continue;
    assert.ok(ch.category, `${ch.id}: не размечена категория`);
  }
});

test('география не выдумана: район только там, где он есть в рукописи', () => {
  for (const ch of book.chapters) {
    if (!ch.region) continue;
    const words = ch.region.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 4);
    const text = ch.markdown.toLowerCase();
    const supported = words.some((w) => text.includes(w.slice(0, 5)));
    assert.ok(supported, `${ch.id}: район «${ch.region}» должен опираться на текст главы`);
  }
});

test('сезонный календарь различает природный сезон, промысел и рынок', () => {
  assert.deepEqual(seasons.tracks.map((t) => t.id), ['nature', 'harvest', 'market']);
  assert.ok(seasons.marketNote.length > 40, 'про рынок сказано прямо, что данных нет');
  for (const block of seasons.blocks) {
    assert.ok(block.tracks && block.tracks.nature && block.tracks.harvest && block.tracks.market,
      `${block.id}: три дорожки`);
    assert.equal(block.tracks.market.state, 'unknown', `${block.id}: рынок не выдаётся за подтверждённый`);
    assert.equal(block.tracks.market.text, '', `${block.id}: без выдуманных дат продажи`);
  }
  assert.ok(seasons.notScheduled.chapters.length > 5, 'главы без сезона перечислены отдельно');
});

test('сезонные ссылки ведут на существующие главы', () => {
  const ids = new Set(book.chapters.map((c) => c.id));
  for (const block of seasons.blocks) {
    for (const id of block.chapters) assert.ok(ids.has(id), `сезонная ссылка ${id}`);
  }
  for (const id of seasons.notScheduled.chapters) assert.ok(ids.has(id), `ссылка «сезон не установлен»: ${id}`);
});

test('абстракт для поиска не содержит редакционных пометок', () => {
  for (const ch of book.chapters) {
    if (!ch.abstract) continue;
    assert.ok(!/\[[^\]]{2,}\]/.test(ch.abstract), `${ch.id}: пометки не попадают в карточку поиска`);
    assert.ok(!/ЗАМЕТКА АВТОРА|ИСТОЧНИК НУЖЕН|МЕСТО ДЛЯ|ЧЕРНОВИК|РЕДАКТОРСКАЯ ПОМЕТКА/.test(ch.abstract),
      `${ch.id}: служебные слова не попадают в карточку`);
    assert.ok(!/\|/.test(ch.abstract), `${ch.id}: таблица не попадает в карточку поиска`);
    assert.ok(ch.abstract.length <= 300, `${ch.id}: абстракт короткий`);
  }
});

test('служебная шапка главы не теряется, а выносится отдельно', () => {
  const keep = book.chapters.filter((c) => c.serviceNote);
  assert.ok(keep.length > 5, 'редакционные статусы глав сохранены при сборке');
  for (const ch of keep) {
    assert.ok(!ch.story.startsWith(ch.serviceNote), `${ch.id}: шапка вынесена из повествования`);
  }
});

test('служебные главы рабочего документа не публикуются', () => {
  const titles = book.chapters.map((c) => c.title);
  assert.ok(!titles.includes('Как читать этот документ'), 'инструкция к рабочему документу — служебная');
  assert.ok(!titles.includes('Редакторская карта: что ещё нужно сделать'), 'редакторская карта — служебная');
  // А текст вводных глав — авторский, из рабочей редакции 24.11.2026.
  const filosofiya = byId.get('filosofiya');
  assert.match(filosofiya.markdown, /Я вырос в Долинске/, 'новая авторская редакция «Философии» интегрирована');
  assert.ok(!/Транскрипция страницы/.test(filosofiya.markdown), 'старая транскрипция заменена');
});

test('«Островные сцены»: каждый маркер в рукописи имеет сцену в манифесте', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'content', 'scenes.json'), 'utf8'));
  const byScene = new Map(manifest.scenes.map((s) => [s.id, s]));
  const manuscript = fs.readFileSync(path.join(ROOT, 'MANUSCRIPT.md'), 'utf8');
  const markers = [...manuscript.matchAll(/\[ИЛЛЮСТРАЦИЯ:\s*([\w-]+)\s*\]/g)].map((m) => m[1]);
  assert.ok(markers.length >= 7, `маркеров размещения достаточно: ${markers.length}`);
  for (const id of markers) {
    assert.ok(byScene.has(id), `маркер ${id} описан в docs/content/scenes.json`);
    assert.equal(byScene.get(id).place.mode, 'marker', `${id}: маркерный способ привязки`);
  }
  for (const s of manifest.scenes) {
    if (s.place.mode !== 'marker') continue;
    const count = markers.filter((id) => id === s.id).length;
    assert.equal(count, 1, `${s.id}: ровно один маркер в тексте`);
    assert.ok(s.place.anchor, `${s.id}: точка размещения описана словами`);
  }
});

test('«Островные сцены»: метаданные полные, статусы честные', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'content', 'scenes.json'), 'utf8'));
  const statuses = new Set(['concept', 'test', 'ready', 'needs-check']);
  for (const s of manifest.scenes) {
    assert.ok(s.id && /^[a-z0-9-]+$/.test(s.id), `${s.id}: id в нижнем регистре`);
    assert.ok(s.title, `${s.id}: название сцены`);
    assert.ok(s.description && s.description.length > 30, `${s.id}: описание сюжета`);
    assert.ok(s.source && s.source.length > 10, `${s.id}: источник визуальной информации`);
    assert.ok(statuses.has(s.status), `${s.id}: статус «${s.status}» из допустимых`);
    assert.ok(s.kind, `${s.id}: тип изображения`);
    assert.ok(s.chapter || s.part, `${s.id}: привязка к главе или разделу`);
    if (s.files && s.files.web) {
      assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'assets', 'scenes', s.files.web)), `${s.id}: web-файл на месте`);
    }
    if (s.status === 'concept') {
      assert.ok(!s.files || !s.files.web, `${s.id}: концепт без готового изображения`);
    }
  }
  const ready = manifest.scenes.filter((s) => s.files && s.files.web && s.place.mode !== 'opener').length;
  assert.equal(ready, 12, 'все двенадцать бытовых сцен раскадровки в книге');
});

test('открытия глав: копия авторская (из макета), изображения на месте', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'content', 'scenes.json'), 'utf8'));
  const openers = manifest.scenes.filter((s) => s.place && s.place.mode === 'opener');
  assert.ok(openers.length >= 1, 'есть хотя бы одно открытие главы');
  for (const s of openers) {
    assert.ok(s.chapter, `${s.id}: привязано к главе`);
    assert.ok(s.files && s.files.web, `${s.id}: изображение открытия на месте`);
  }
  // Текст открытия — только из макета автора; других глав с выдуманной копией нет.
  const leads = book.chapters.filter((c) => c.lead || c.quote);
  assert.equal(leads.length, 1, 'пока только «Философия» несёт копию макета');
  assert.equal(leads[0].id, 'filosofiya');
  assert.equal(leads[0].lead, 'Сахалинская кухня — это не про единственный рецепт, а про людей, море и остров.');
  assert.equal(leads[0].quote, 'Здесь пересекаются разные культуры, меняются рецепты, а привычные продукты обретают новый смысл.');
});
