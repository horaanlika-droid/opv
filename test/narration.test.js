/**
 * Озвучка глав: манифест content/narration.json согласован с книгой и файлами.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const narration = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/content/narration.json'), 'utf8'));
const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/content/book.json'), 'utf8'));
const byId = new Map(book.chapters.map((c) => [c.id, c]));

test('озвучка: манифест согласован с книгой', () => {
  assert.ok(narration.voice, 'голос в манифесте записан');
  assert.ok(Array.isArray(narration.chapters) && narration.chapters.length > 0, 'главы перечислены');

  const ids = narration.chapters.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'главы в манифесте не повторяются');

  for (const ch of narration.chapters) {
    assert.ok(byId.has(ch.id), `${ch.id}: глава есть в book.json`);
    assert.equal(ch.title, byId.get(ch.id).title, `${ch.id}: заголовок совпадает с книгой`);
    assert.ok(Array.isArray(ch.clips) && ch.clips.length > 0, `${ch.id}: фрагменты перечислены`);

    const dir = path.join(ROOT, 'docs', narration.audioDir || 'assets/audio/narration');
    for (const f of ch.clips) {
      const p = path.join(dir, f);
      assert.ok(fs.existsSync(p), `${f}: файл озвучки на месте`);
      assert.ok(fs.statSync(p).size > 1000, `${f}: файл не пустой`);
    }
  }
});

test('озвучка: вводные главы озвучены целиком', () => {
  const ids = ['filosofiya', 'kuhnya-kotoruyu-sformirovali-more-les-i-vremya', 'ostrov-kak-sostoyanie'];
  for (const id of ids) {
    const ch = narration.chapters.find((c) => c.id === id);
    assert.ok(ch, `${id}: глава есть в манифесте`);
    assert.ok(ch.clips.length >= 2, `${id}: фрагменты на месте`);
  }
  const filosofiya = narration.chapters.find((c) => c.id === 'filosofiya');
  assert.equal(filosofiya.clips.length, 9, 'у «Философии» девять фрагментов — без пропусков');
});
