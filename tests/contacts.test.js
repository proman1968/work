/**
 * F29 (final 8.22): экспорт CSV/vCard без экранирования (формулы Excel, поломка структуры)
 * и self-XSS в профиле/списке контактов. Чистые функции contacts.js + write_table csv.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvValue, escapeVCardValue, escapeHtml, formatContact, exportToCSV, exportToVCard } from '../sources/modules/contacts/contacts.js';

// щит формулы: апостроф ВНУТРИ кавычек (R4/8.32) — Excel видит текст, строгий парсер — одно поле
const shield = s => '"' + "'" + s.replace(/^"|"$/g, '').replace(/"/g, '""') + '"';

describe('F29: экранирование экспорта контактов', () => {
    it('CSV: формула из имени контакта не исполняется; апостроф — ВНУТРИ кавычек (одно поле для парсера)', () => {
        assert.equal(escapeCsvValue('=CMD(1)'), '"\'=CMD(1)"');
        assert.equal(escapeCsvValue('=HYPERLINK("http://evil","клик")'), '"\'=HYPERLINK(""http://evil"",""клик"")"');
        assert.equal(escapeCsvValue('+SUM(A1:A9)'), '"\'+SUM(A1:A9)"');
        assert.equal(escapeCsvValue('-2+1'), '"\'-2+1"');
        assert.equal(escapeCsvValue('@x.com'), '"\'@x.com"');
        // телефон с плюсом — щит (данные меняются на текст; цена нейтрализации формул)
        assert.equal(escapeCsvValue('+79161234567'), '"\'+79161234567"');
        // кавычки удваиваются
        assert.equal(escapeCsvValue('Обычное "имя"'), '"Обычное ""имя"""');
        // обычное значение — просто в кавычках
        assert.equal(escapeCsvValue('Иван'), '"Иван"');
        assert.equal(escapeCsvValue(''), '""');
        // опасное значение с запятой — ОДНО поле: запятая ВНУТРИ кавычек, апостроф — первым после кавычки
        const sum = escapeCsvValue('=SUM(1,2)');
        assert.ok(sum.startsWith("\"'") && sum.endsWith('"'), 'значение не в кавычках: ' + sum);
        assert.ok(sum.slice(1, -1).includes(','), 'запятая не внутри кавычек: ' + sum);
    });

    it('CSV: экспорт целиком — формулы в ЛЮБОЙ колонке нейтрализованы, обычное не тронуто', () => {
        const csv = exportToCSV([
            { name: ['=HYPERLINK("http://evil","x")'], tel: [], email: [], address: [] },
            // формула во ВТОРОЙ и последующих колонках (R4/8.32 — раньше экранировалась только первая)
            { name: ['Пётр'], tel: ['+SUM(A1:A9)'], email: ['=HYPERLINK("http://evil2","y")'], address: [{ city: '-2+cmd' }] },
            { name: ['Мария'], tel: ['8900'], email: ['m@x.test'], address: [] },
        ]);
        const lines = csv.split('\n');
        assert.ok(lines[1].includes(`"'=HYPERLINK`), 'формула первой колонки без щита: ' + lines[1]);
        assert.ok(lines[1].includes('""http://evil""'), 'кавычки не удвоены');
        // вторая строка: формулы в tel/email/address — каждая с апострофом ВНУТРИ кавычек
        assert.ok(lines[2].includes(`"'+SUM`), 'формула tel без щита: ' + lines[2]);
        assert.ok(lines[2].includes(`"'=HYPERLINK`), 'формула email без щита: ' + lines[2]);
        assert.ok(lines[2].includes(`"'-2+cmd`), 'формула address без щита: ' + lines[2]);
        // обычная строка — без апострофов-щитов
        assert.ok(!lines[3].includes("'"), 'обычная строка зря экранирована: ' + lines[3]);
        assert.ok(lines[3].includes('"Мария"'));
    });

    it('vCard: переводы строк (в т.ч. одиночный \\r) и разделители не ломают структуру', () => {
        const v = exportToVCard([{ name: ['Зло\nEND:VCARD'], tel: ['8900;x=1'], email: [], address: [] }]);
        // экранированный перенос — backslash-n, не настоящий перевод строки
        assert.ok(v.includes('\\nEND\\:VCARD') || v.includes('\\nEND:VCARD'), 'перенод не экранирован');
        const lines = v.split('\n');
        assert.equal(lines.filter(l => /^END:VCARD$/.test(l.trim())).length, 1, 'внедрённый END:VCARD не экранирован');
        assert.ok(v.includes('TEL:8900\\;x\\=1') || v.includes('\\;'), 'разделитель не экранирован');
        // одиночный \\r (CRLF-хвост из чужих данных) — экранируется, не режет структуру
        assert.ok(escapeVCardValue('а\rб').includes('\\r'), 'одиночный \\r не экранирован');
        assert.equal(exportToVCard([{ name: ['x\ry'], tel: [], email: [], address: [] }]).split('\n').length,
            exportToVCard([{ name: ['xy'], tel: [], email: [], address: [] }]).split('\n').length,
            'одиночный \\r добавил строку в vCard');
    });

    it('HTML: имя контакта — данные, не разметка (self-XSS в списке)', () => {
        const f = formatContact({ name: ['<img src=x onerror=alert(1)>Иван'], tel: [], email: [], address: [] });
        assert.ok(!f.includes('<img'), 'HTML из имени контакта прошёл в разметку');
        assert.match(f, /&lt;img/);
        assert.equal(escapeHtml('a<b>&"\''), 'a&lt;b&gt;&amp;&quot;&#39;');
    });
});

describe('F29: write_table csv — формулы из чужих данных нейтрализуются', () => {
    it('строка-формула получает щит-префикс; обычные данные не трогаются', async () => {
        const fs = await import('node:fs');
        const fsp = await import('node:fs/promises');
        const os = await import('node:os');
        const path = await import('node:path');
        await import('../sources/reactor.js');
        const { $server } = await import('../sources/server/server.js');
        const { writeTable } = await import('../sources/modules/agent/tools/work/data.js');
        const prev = process.cwd();
        const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-f29-'));
        const write = (rel, data) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), data); };
        write('$server/class.js', `export default { label: 'F29' }`);
        write('ORG/$class/class.js', `export default { label: 'ORG', '#security': { USER: ['u1'] } }`);
        for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file']) write(p + '/class.js', 'export default {}');
        process.chdir(tmp);
        globalThis.WORK = new $server();
        try {
            const ctx = { session: { uid: 'u1' }, place: null, entry: {} };
            await writeTable.run({ path: '/ORG/таблица.csv', rows: [
                { 'Имя': '=HYPERLINK("http://evil","клик")', 'Сумма': 100 },
                { 'Имя': 'Обычное имя', 'Сумма': 200 },
                // R4 (8.32): формула во ВТОРОЙ колонке и отрицательное ЧИСЛО (не строка)
                { 'Имя': 'Анна', 'Сумма': '=SUM(1,2)' },
                { 'Имя': 'Борис', 'Сумма': -5 },
            ] }, ctx);
            const files = [];
            const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : files.push(f); } };
            walk(path.join(tmp, 'ORG'));
            const csvFile = files.find(f => f.endsWith('.csv'));
            assert.ok(csvFile, 'csv не записан');
            const rows = fs.readFileSync(csvFile, 'utf-8').split('\n').filter(l => l.trim());
            // каждая ячейка-формула — с апострофом ВНУТРИ кавычек; число (в т.ч. отрицательное) — без щита
            assert.ok(rows[1].includes(`"'=HYPERLINK`), 'формула первой колонки без щита: ' + rows[1].slice(0, 60));
            assert.ok(!rows[2].includes(`"'`), 'обычная строка зря экранирована: ' + rows[2]);
            assert.ok(rows[3].includes(`"'=SUM`), 'формула ВТОРОЙ колонки без щита: ' + rows[3]);
            assert.ok(rows[4].endsWith(',-5'), 'отрицательное число тронуто: ' + rows[4]);
        }
        finally {
            process.chdir(prev);
            await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
        }
    });
});
