/**
 * F29 (final 8.22): экспорт CSV/vCard без экранирования (формулы Excel, поломка структуры)
 * и self-XSS в профиле/списке контактов. Чистые функции contacts.js + write_table csv.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvValue, escapeVCardValue, escapeHtml, formatContact, exportToCSV, exportToVCard } from '../sources/modules/contacts/contacts.js';

const shield = s => "'" + s; // щит-префикс формулы (Excel не исполняет строку, начинающуюся с ')

describe('F29: экранирование экспорта контактов', () => {
    it('CSV: формула из имени контакта не исполняется в Excel', () => {
        assert.equal(escapeCsvValue('=CMD(1)'), shield('"=CMD(1)"'));
        assert.equal(escapeCsvValue('=HYPERLINK("http://evil","клик")'), shield('"=HYPERLINK(""http://evil"",""клик"")"'));
        assert.equal(escapeCsvValue('+SUM(A1:A9)'), shield('"+SUM(A1:A9)"'));
        assert.equal(escapeCsvValue('-2+1'), shield('"-2+1"'));
        assert.equal(escapeCsvValue('@x.com'), shield('"@x.com"'));
        // кавычки удваиваются
        assert.equal(escapeCsvValue('Обычное "имя"'), '"Обычное ""имя"""');
        // обычное значение — просто в кавычках
        assert.equal(escapeCsvValue('Иван'), '"Иван"');
        assert.equal(escapeCsvValue(''), '""');
    });

    it('CSV: экспорт целиком — формула в первой колонке нейтрализована, обычное не тронуто', () => {
        const csv = exportToCSV([
            { name: ['=HYPERLINK("http://evil","x")'], tel: [], email: [], address: [] },
            { name: ['Мария'], tel: ['8900'], email: ['m@x.test'], address: [] },
        ]);
        const lines = csv.split('\n');
        assert.ok(/^'"/.test(lines[1]), 'формула без щита: ' + lines[1]);
        assert.ok(lines[1].includes('""http://evil""'), 'кавычки не удвоены');
        assert.ok(!/^'/.test(lines[2]), 'обычная строка зря экранирована: ' + lines[2]);
        assert.ok(lines[2].includes('"Мария"'));
    });

    it('vCard: переводы строк и разделители не ломают структуру', () => {
        const v = exportToVCard([{ name: ['Зло\nEND:VCARD'], tel: ['8900;x=1'], email: [], address: [] }]);
        // экранированный перенос — backslash-n, не настоящий перевод строки
        assert.ok(v.includes('\\nEND\\:VCARD') || v.includes('\\nEND:VCARD'), 'перенод не экранирован');
        const lines = v.split('\n');
        assert.equal(lines.filter(l => /^END:VCARD$/.test(l.trim())).length, 1, 'внедрённый END:VCARD не экранирован');
        assert.ok(v.includes('TEL:8900\\;x\\=1') || v.includes('\\;'), 'разделитель не экранирован');
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
            ] }, ctx);
            const files = [];
            const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : files.push(f); } };
            walk(path.join(tmp, 'ORG'));
            const csvFile = files.find(f => f.endsWith('.csv'));
            assert.ok(csvFile, 'csv не записан');
            const rows = fs.readFileSync(csvFile, 'utf-8').split('\n').filter(l => l.trim());
            for (const line of rows.slice(1)) {
                if (line.includes('HYPERLINK'))
                    assert.ok(/^'/.test(line), 'формула без щита: ' + line.slice(0, 60));
                if (line.includes('Обычное имя'))
                    assert.ok(!/^'/.test(line), 'обычная строка зря экранирована');
            }
        }
        finally {
            process.chdir(prev);
            await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
        }
    });
});
