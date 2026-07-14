import * as fs from 'node:fs';
import { MERGE } from '../sources/host/babel-merge.js';

const files = [
    'models/$ai/$folder/$class/$ai/class.js',
    'models/GigaChat/$ai/$folder/$class/$ai/class.js',
    'models/GigaChat/GigaChat Pro/$ai/class.js',
    'models/GigaChat/GigaChat Light/$ai/class.js',
    'models/z.ai/$ai/$folder/$class/$ai/class.js',
    'models/z.ai/GLM-5.2/$ai/class.js',
    'models/$ai/$folder/$class/$ai/methods/streamChat/$method/class.js',
];

console.log('=== Чтение файлов ===');
for (const f of files) {
    try {
        const code = fs.readFileSync(f, 'utf8');
        console.log(`OK: ${f} (${code.length} байт, ${code.split('\n').length} строк)`);
    } catch(e) {
        console.log(`MISSING: ${f}`);
    }
}

console.log('\n=== Попарное слияние ===');
for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
        try {
            const code1 = fs.readFileSync(files[i], 'utf8');
            const code2 = fs.readFileSync(files[j], 'utf8');
            const result = MERGE.mergeScripts(code1, code2);
            // Проверяем, что результат парсится
            const parser = (await import('@babel/parser')).default;
            parser.parse(result.code || result, { sourceType: 'module' });
            console.log(`OK: ${files[i]} + ${files[j]}`);
        } catch(e) {
            console.log(`FAIL: ${files[i]} + ${files[j]}`);
            console.log(`  Error: ${e.message}`);
            if (e.loc) console.log(`  Loc: ${JSON.stringify(e.loc)}`);
        }
    }
}

console.log('\n=== Цепочечное слияние (имитация наследования) ===');
// Имитация: merge(merge(ancestor, parent), child)
const chains = [
    ['models/$ai/$folder/$class/$ai/class.js', 'models/GigaChat/$ai/$folder/$class/$ai/class.js', 'models/GigaChat/GigaChat Pro/$ai/class.js'],
    ['models/$ai/$folder/$class/$ai/class.js', 'models/GigaChat/$ai/$folder/$class/$ai/class.js', 'models/GigaChat/GigaChat Light/$ai/class.js'],
    ['models/$ai/$folder/$class/$ai/class.js', 'models/z.ai/$ai/$folder/$class/$ai/class.js', 'models/z.ai/GLM-5.2/$ai/class.js'],
];

for (const chain of chains) {
    try {
        let merged = fs.readFileSync(chain[0], 'utf8');
        for (let i = 1; i < chain.length; i++) {
            const next = fs.readFileSync(chain[i], 'utf8');
            const result = MERGE.mergeScripts(next, merged); // selfData, ancestorData
            merged = result.code || result;
        }
        const parser = (await import('@babel/parser')).default;
        parser.parse(merged, { sourceType: 'module' });
        console.log(`OK chain: ${chain.map(c => c.split('/').pop()).join(' -> ')}`);
    } catch(e) {
        console.log(`FAIL chain: ${chain.map(c => c.split('/').pop()).join(' -> ')}`);
        console.log(`  Error: ${e.message}`);
        if (e.loc) console.log(`  Loc: ${JSON.stringify(e.loc)}`);
        // Показать код вокруг ошибки
        if (e.pos) {
            const merged2 = chain.slice(1).reduce((acc, f) => {
                const result = MERGE.mergeScripts(fs.readFileSync(f, 'utf8'), acc);
                return result.code || result;
            }, fs.readFileSync(chain[0], 'utf8'));
            const around = merged2.slice(Math.max(0, e.pos - 100), e.pos + 100);
            console.log(`  Around pos ${e.pos}:\n  ...${around}...`);
        }
    }
}