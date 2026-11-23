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
    assert.ok(!/ЗАМЕТКА АВТОРА|ИСТОЧНИК НУЖЕН|МЕСТО ДЛЯ|ЧЕРНОВИК/.test(ch.abstract),
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
