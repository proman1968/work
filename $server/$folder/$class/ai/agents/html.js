/** Агент html: SPA в ленте. Без tools — лист (type html для iframe UI). */
export default {
    label: 'Делаю HTML приложение',
    icon: 'editor:code',
    model: '/MODELS/BIS-Ollama/gemma3 4b',
    doc: true,
    description: 'одностраничное HTML-приложение в ленте',
    system: [
        '# Режим: HTML',
        'Одно рабочее приложение в одном fence. Без пояснений снаружи блока.',
    ].join('\n'),
    prompt: [
        'Собери одностраничное HTML/JS/CSS-приложение.',
        'Не пример кода, а полноценное рабочее приложение.',
        'Только один fensed-блок с полным html-кодом, без дополнительных пояснений.',
        'Приложение будет работать прямо в ленте чата в iframe.',
    ].join('\n'),
    recalc(params = {}) {
        const { block } = params;
        const raw = String(block.content || '').trim();
        const t = String(raw || '').trim();
        let inner = t;
        if (t.startsWith('```')) {
            const m = t.match(/^```[a-z0-9]*[^\n]*\r?\n([\s\S]*?)```/i);
            if (m) {
                const body = m[1].trim();
                const after = t.slice(m[0].length).trim();
                inner = after ? body + '\n\n' + after : body;
            } else
                inner = t.replace(/^```[a-z0-9]*[^\n]*\r?\n/i, '').trim();
        }
        if (inner) block.content = inner;
        delete block.html;
    },
};
