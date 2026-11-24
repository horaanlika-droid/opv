const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'book-proof.pdf');
const cover = path.join(root, '1.png');
const illustration = path.join(root, 'assets/illustrations/korushka-01.png');
const regular = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

for (const file of [cover, illustration, regular, bold]) {
  if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
}

const W = 760;
const H = W * 1545 / 2000;
const paper = '#f8f3e4';
const ink = '#171715';
const muted = '#77766f';
const doc = new PDFDocument({ size: [W, H], margin: 0, compress: true, info: {
  Title: 'Остров. Продукт. Вкус — цифровая проба макета',
  Author: 'Егор Тарасенко',
  Subject: 'Рабочая цифровая проба; не финальная книга'
}});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
doc.registerFont('Body', regular);
doc.registerFont('Bold', bold);

// Existing cover, preserved as supplied while editable cover design is pending.
doc.image(cover, 0, 0, { width: W, height: H });

// First designed interior proof page using the current editable Korushka draft.
doc.addPage({ size: [W, H], margin: 0 });
doc.rect(0, 0, W, H).fill(paper);
const m = 48;
doc.font('Body').fontSize(8).fillColor(muted)
  .text('ОСТРОВ · ПРОДУКТ · ВКУС', m, 29, { characterSpacing: 1.3 })
  .text('РАБОЧАЯ ПРОБА · 01', W - 165, 29, { width: 117, align: 'right', characterSpacing: 1 });
doc.font('Bold').fontSize(42).fillColor(ink)
  .text('КОРЮШКА', m, 68, { width: 310, lineBreak: false, characterSpacing: -1.5 });

const leftX = m;
const leftW = 310;
let y = 137;
doc.font('Bold').fontSize(14).fillColor(ink).text(
  'На Сахалине корюшка — не деликатес и не редкость. Она — часть зимнего ритма.',
  leftX, y, { width: leftW, lineGap: 3 }
);
y = doc.y + 18;
doc.font('Body').fontSize(10.5).fillColor(ink).text(
  'Когда температура держится ниже нуля и море берёт под себя лёд, на горизонте появляются первые тёмные точки — рыбаки. Потом точки становятся линиями, линии — целыми улицами палаток. И уже трудно понять: люди пришли за рыбой или за той особенной тишиной, которой больше нигде нет.',
  leftX, y, { width: leftW, lineGap: 4, paragraphGap: 8 }
);
y = doc.y + 13;
doc.font('Body').fontSize(10.5).fillColor(ink).text(
  'Лёд редко бывает стеклянным. Чаще он белый, сбитый, присыпанный ветром, как будто кто-то провёл по нему жёсткой кистью. Среди глухого эха есть ещё один звук — лёгкий, металлический, частый: корюшка бьёт по снасти.',
  leftX, y, { width: leftW, lineGap: 4 }
);
y = doc.y + 11;
doc.font('Body').fontSize(9).fillColor('#87573f').text(
  '[Добавить авторскую заметку: место, год, погода и личная сцена. Не выдавать этот черновик за воспоминание автора до его сверки.]',
  leftX, y, { width: leftW, lineGap: 3 }
);

const rightX = 395;
const rightW = W - m - rightX;
doc.image(illustration, rightX, 137, { fit: [rightW, 264], align: 'center', valign: 'center' });
doc.font('Body').fontSize(8).fillColor(muted)
  .text('Корюшка · рабочая иллюстрация', rightX, 407, { width: rightW, align: 'center' });

const ruleY = H - 89;
doc.moveTo(m, ruleY).lineTo(W - m, ruleY).lineWidth(0.6).stroke('#d8d5ca');
doc.font('Bold').fontSize(8).fillColor(ink).text('СЕЗОН / СВЕРИТЬ', m, ruleY + 12, { width: 145, characterSpacing: .7 });
doc.font('Body').fontSize(8.5).fillColor('#44433e').text(
  'В исходной странице: зима — ранняя весна, январь–март. Уточнить по виду и району.',
  m, ruleY + 27, { width: 290, lineGap: 2 }
);
doc.font('Bold').fontSize(8).fillColor(ink).text('РЕЦЕПТ / ДОБАВИТ АВТОР', 390, ruleY + 12, { width: 250, characterSpacing: .7 });
doc.font('Body').fontSize(8.5).fillColor('#44433e').text(
  'Поля для точных ингредиентов, выхода, оборудования, времени, температуры и авторского рассказа.',
  390, ruleY + 27, { width: 300, lineGap: 2 }
);
doc.font('Bold').fontSize(9).fillColor(ink).text('06', W - m - 18, H - 24, { width: 18, align: 'right' });

doc.end();
stream.on('finish', () => console.log(`Wrote ${out}`));
