/**
 * Локальный офисный пакет WORK (`oda-office-editor`):
 *  - Таблицы (`.xlsx`, `.xls`, `.csv`, `.ods`) — мультилистовая электронная таблица с формулами, стилями и объединением ячеек;
 *  - Документы (`.docx`, `.doc`, `.rtf`, `.odt`) — страничный редактор формата А4 с таблицами, стилями и печатью;
 *  - Презентации (`.pptx`, `.ppt`, `.odp`) — двухпанельный редактор слайдов 16:9 с перетаскиванием блоков и полноэкранным показом;
 *  - Интеграция с десктопным Office на ПК через протоколы `ms-word:ofe|u|...`, `ms-excel:ofe|u|...`, `ms-powerpoint:ofe|u|...` (WebDAV).
 */

function colIndexToLetters(col) {
    let n = Number(col) + 1;
    let s = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s || 'A';
}

function lettersToColIndex(letters) {
    const clean = String(letters || '').toUpperCase().replace(/[^A-Z]/g, '');
    let n = 0;
    for (let i = 0; i < clean.length; i++)
        n = n * 26 + (clean.charCodeAt(i) - 64);
    return Math.max(0, n - 1);
}

function parseCellRef(refStr) {
    const m = String(refStr || '').trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!m)
        return null;
    return { c: lettersToColIndex(m[1]), r: Math.max(0, parseInt(m[2], 10) - 1) };
}

/** Вычислить формулу ячейки Excel (`=SUM(A1:B3)`, `=AVERAGE(...)`, `=IF(...)`, `=A1*B1+10`). */
export function evaluateSheetFormula(rawFormula, cells = {}, depth = 0) {
    if (depth > 8)
        return '#ЦИКЛ!';
    const expr = String(rawFormula || '').replace(/^=/, '').trim();
    if (!expr)
        return '';

    const numVal = (r, c) => {
        const cell = cells[`${r}:${c}`];
        if (!cell)
            return 0;
        if (cell.f) {
            const v = evaluateSheetFormula(cell.f, cells, depth + 1);
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        }
        const raw = typeof cell.v === 'string' ? cell.v.replace(/\s+/g, '').replace(',', '.') : cell.v;
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    };

    const expandRange = (aRef, bRef) => {
        const a = parseCellRef(aRef);
        const b = parseCellRef(bRef);
        if (!a || !b)
            return [];
        const r1 = Math.min(a.r, b.r), r2 = Math.max(a.r, b.r);
        const c1 = Math.min(a.c, b.c), c2 = Math.max(a.c, b.c);
        const vals = [];
        for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++)
                vals.push(numVal(r, c));
        }
        return vals;
    };

    const collectArgs = (argsStr) => {
        const parts = String(argsStr || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
        const nums = [];
        for (const p of parts) {
            const rm = p.match(/^([A-Za-z]+\d+)\s*:\s*([A-Za-z]+\d+)$/);
            if (rm) {
                nums.push(...expandRange(rm[1], rm[2]));
                continue;
            }
            const cm = parseCellRef(p);
            if (cm) {
                nums.push(numVal(cm.r, cm.c));
                continue;
            }
            const n = Number(p.replace(',', '.'));
            if (Number.isFinite(n))
                nums.push(n);
        }
        return nums;
    };

    // Функции SUM / СУММ, AVERAGE / СРЗНАЧ, MIN / МИН, MAX / МАКС, COUNT / СЧЁТ, ROUND / ОКРУГЛ
    const withFuncs = expr.replace(/\b(SUM|СУММ|AVERAGE|СРЗНАЧ|AVG|MIN|МИН|MAX|МАКС|COUNT|СЧЁТ|СЧЕТ|ROUND|ОКРУГЛ)\s*\(([^()]*)\)/gi, (_, fnRaw, argsStr) => {
        const fn = fnRaw.toUpperCase();
        const vals = collectArgs(argsStr);
        if (fn === 'SUM' || fn === 'СУММ')
            return String(vals.reduce((a, b) => a + b, 0));
        if (fn === 'AVERAGE' || fn === 'СРЗНАЧ' || fn === 'AVG')
            return String(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
        if (fn === 'MIN' || fn === 'МИН')
            return String(vals.length ? Math.min(...vals) : 0);
        if (fn === 'MAX' || fn === 'МАКС')
            return String(vals.length ? Math.max(...vals) : 0);
        if (fn === 'COUNT' || fn === 'СЧЁТ' || fn === 'СЧЕТ')
            return String(vals.length);
        if (fn === 'ROUND' || fn === 'ОКРУГЛ') {
            const v = vals[0] || 0;
            const digits = Math.max(0, Math.min(10, Math.round(vals[1] ?? 0)));
            const factor = 10 ** digits;
            return String(Math.round(v * factor) / factor);
        }
        return '0';
    });

    // Подстановка одиночных ссылок на ячейки (A1, B12, ...)
    const withRefs = withFuncs.replace(/\b([A-Za-z]{1,2}\d{1,4})\b/g, (ref) => {
        const pos = parseCellRef(ref);
        if (!pos)
            return '0';
        return String(numVal(pos.r, pos.c));
    });

    // Безопасное вычисление арифметики (+, -, *, /, скобки, числа)
    if (!/^[0-9.+\-*/()\s]+$/.test(withRefs))
        return '#ЗНАЧ!';
    try {
        const res = Function(`"use strict"; return (${withRefs});`)();
        if (typeof res === 'number' && Number.isFinite(res))
            return Math.round(res * 1e6) / 1e6;
        return '#ЧИСЛО!';
    }
    catch {
        return '#ОШИБКА!';
    }
}

export default {
    allowSave: true,
    isChanged: false,
    fileControl: 'oda-office-editor',
    attached() {
        this.async(() => {
            const ed = this.$?.('oda-office-editor');
            if (ed)
                ed.hostView = this;
        }, 20);
    },
    async save() {
        const ed = this.$?.('oda-office-editor');
        if (ed && typeof ed.save === 'function')
            return ed.save();
    },
};

ODA({
    is: 'oda-office-editor',
    imports: 'oda//button, oda//icon',
    template: /*html*/`
        <style>
            :host {
                @apply --flex;
                @apply --vertical;
                @apply --content;
                overflow: hidden;
                position: relative;
                font-size: 13px;
                outline: none;
            }
            .office-toolbar {
                @apply --horizontal;
                @apply --light;
                align-items: center;
                flex-wrap: wrap;
                gap: 4px;
                min-height: 36px;
                padding: 4px 10px;
                border-bottom: 1px solid var(--border-color);
                flex-shrink: 0;
                user-select: none;
            }
            .kind-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                border-radius: var(--radius-xs, 3px);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.03em;
                color: #fff;
                margin-right: 4px;
            }
            .kind-badge[data-kind="document"] { background: #2563eb; }
            .kind-badge[data-kind="spreadsheet"] { background: #16a34a; }
            .kind-badge[data-kind="presentation"] { background: #ea580c; }
            .tb-sep {
                width: 1px;
                height: 20px;
                background: var(--border-color);
                margin: 0 4px;
            }
            .tb-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                min-width: 26px;
                height: 26px;
                padding: 0 6px;
                border: 1px solid transparent;
                border-radius: var(--radius-xs, 3px);
                background: transparent;
                color: var(--content-color);
                font-size: 12px;
                font-family: inherit;
                cursor: pointer;
            }
            .tb-btn:hover {
                background: var(--subtle-background);
                border-color: var(--border-color);
            }
            .tb-btn[active] {
                background: var(--selected-background);
                color: var(--selected-color);
                border-color: var(--accent-color);
                font-weight: 600;
            }
            .tb-select {
                height: 26px;
                padding: 0 6px;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-xs, 3px);
                background: var(--content-background);
                color: var(--content-color);
                font-size: 12px;
                outline: none;
            }
            .tb-color {
                width: 24px;
                height: 24px;
                padding: 1px;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-xs, 3px);
                background: var(--content-background);
                cursor: pointer;
            }
            .status-pill {
                font-size: 11.5px;
                color: var(--muted-color);
                margin-right: 6px;
            }
            .status-pill[dirty] {
                color: var(--accent-color);
                font-weight: 600;
            }

            /* --- ТАБЛИЦА (.xlsx) --- */
            .formula-bar {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                height: 28px;
                padding: 2px 10px;
                background: var(--content-background);
                border-bottom: 1px solid var(--border-color);
                flex-shrink: 0;
            }
            .cell-addr-box {
                min-width: 64px;
                text-align: center;
                padding: 2px 6px;
                border: 1px solid var(--border-color);
                border-radius: 2px;
                background: var(--subtle-background);
                font-weight: 600;
                font-size: 12px;
            }
            .fx-label {
                font-style: italic;
                font-weight: 700;
                color: var(--muted-color);
                padding: 0 4px;
            }
            .formula-input {
                @apply --flex;
                height: 22px;
                padding: 0 8px;
                border: 1px solid var(--border-color);
                border-radius: 2px;
                background: var(--content-background);
                color: var(--content-color);
                font-family: var(--font-mono, monospace);
                font-size: 12.5px;
                outline: none;
            }
            .formula-input:focus {
                border-color: var(--accent-color);
            }
            .sheet-scroller {
                @apply --flex;
                overflow: auto;
                background: var(--content-background);
                position: relative;
            }
            table.xlsx-grid {
                border-collapse: collapse;
                table-layout: fixed;
                user-select: none;
            }
            table.xlsx-grid th,
            table.xlsx-grid td {
                border: 1px solid var(--subtle-border, #d4d4d8);
                height: 24px;
                padding: 0 6px;
                font-size: 12.5px;
                box-sizing: border-box;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            table.xlsx-grid thead th {
                position: sticky;
                top: 0;
                z-index: 2;
                background: var(--subtle-background);
                color: var(--content-color);
                font-weight: 600;
                text-align: center;
            }
            table.xlsx-grid tbody th.row-num {
                position: sticky;
                left: 0;
                z-index: 1;
                width: 42px;
                min-width: 42px;
                background: var(--subtle-background);
                color: var(--muted-color);
                font-weight: 500;
                text-align: center;
            }
            table.xlsx-grid td.xlsx-cell {
                background: var(--content-background);
                color: var(--content-color);
                cursor: cell;
                position: relative;
            }
            table.xlsx-grid td.xlsx-cell[in-range] {
                background: color-mix(in oklch, var(--accent-color) 12%, var(--content-background));
            }
            table.xlsx-grid td.xlsx-cell[active] {
                outline: 2px solid var(--accent-color);
                outline-offset: -2px;
                z-index: 1;
            }
            .cell-inline-editor {
                width: 100%;
                height: 100%;
                border: none;
                padding: 0;
                margin: 0;
                background: transparent;
                color: inherit;
                font: inherit;
                outline: none;
            }
            .sheet-footer {
                @apply --horizontal;
                @apply --light;
                align-items: center;
                justify-content: space-between;
                min-height: 28px;
                padding: 0 10px;
                border-top: 1px solid var(--border-color);
                flex-shrink: 0;
                user-select: none;
            }
            .sheet-tabs {
                @apply --horizontal;
                align-items: center;
                gap: 2px;
            }
            .sheet-tab {
                padding: 4px 12px;
                border: 1px solid var(--border-color);
                border-bottom: none;
                border-radius: 4px 4px 0 0;
                background: var(--subtle-background);
                color: var(--content-color);
                font-size: 12px;
                cursor: pointer;
            }
            .sheet-tab[active] {
                background: var(--content-background);
                color: var(--accent-color);
                font-weight: 700;
                border-top: 2px solid var(--accent-color);
            }
            .sheet-stats {
                font-size: 12px;
                color: var(--muted-color);
                display: flex;
                gap: 14px;
            }

            /* --- ДОКУМЕНТ WORD (.docx) --- */
            .docx-workspace {
                @apply --flex;
                overflow: auto;
                background: var(--subtle-background);
                padding: 24px 16px;
                display: flex;
                justify-content: center;
                align-items: flex-start;
            }
            .docx-page {
                width: 794px;
                min-height: 1123px;
                padding: 64px 72px;
                background: #ffffff;
                color: #111827;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
                border: 1px solid var(--border-color);
                box-sizing: border-box;
                outline: none;
                line-height: 1.55;
                font-size: 12pt;
                font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
            }
            .docx-page h1 { font-size: 20pt; margin: 12pt 0 6pt; }
            .docx-page h2 { font-size: 16pt; margin: 10pt 0 5pt; }
            .docx-page h3 { font-size: 13.5pt; margin: 8pt 0 4pt; }
            .docx-page p { margin: 0 0 8pt; }
            .docx-page table {
                width: 100%;
                border-collapse: collapse;
                margin: 8pt 0;
            }
            .docx-page table td,
            .docx-page table th {
                border: 1px solid #9ca3af;
                padding: 6px 8px;
                min-width: 40px;
            }
            .docx-page hr.page-break {
                border: none;
                border-top: 2px dashed #9ca3af;
                margin: 24px 0;
            }

            /* --- ПРЕЗЕНТАЦИЯ POWERPOINT (.pptx) --- */
            .pptx-workspace {
                @apply --flex;
                @apply --horizontal;
                overflow: hidden;
                background: var(--subtle-background);
            }
            .pptx-sidebar {
                width: 200px;
                border-right: 1px solid var(--border-color);
                background: var(--content-background);
                overflow-y: auto;
                padding: 10px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                flex-shrink: 0;
            }
            .slide-thumb {
                border: 2px solid var(--border-color);
                border-radius: 4px;
                padding: 6px;
                background: #fff;
                color: #1e293b;
                cursor: pointer;
                user-select: none;
                min-height: 92px;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
            }
            .slide-thumb[active] {
                border-color: var(--accent-color);
                box-shadow: 0 0 0 2px var(--accent-soft);
            }
            .slide-thumb-num {
                font-size: 11px;
                font-weight: 700;
                color: #64748b;
            }
            .slide-thumb-title {
                font-size: 12px;
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .pptx-stage-wrap {
                @apply --flex;
                overflow: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
            }
            .pptx-canvas {
                width: 960px;
                height: 540px;
                position: relative;
                background: #ffffff;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
                border: 1px solid var(--border-color);
                overflow: hidden;
                flex-shrink: 0;
            }
            .pptx-presentation-fullscreen {
                position: fixed;
                inset: 0;
                z-index: 9999;
                background: #000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .pptx-el {
                position: absolute;
                box-sizing: border-box;
                padding: 8px 10px;
                border: 1px solid transparent;
                cursor: move;
                outline: none;
                white-space: pre-wrap;
                overflow: hidden;
            }
            .pptx-el:hover {
                border-color: #94a3b8;
            }
            .pptx-el[selected] {
                border: 2px solid var(--accent-color);
            }
            @media print {
                .office-toolbar, .formula-bar, .sheet-footer, .pptx-sidebar {
                    display: none !important;
                }
                .docx-workspace {
                    padding: 0 !important;
                    background: #fff !important;
                }
                .docx-page {
                    box-shadow: none !important;
                    border: none !important;
                    width: 100% !important;
                    padding: 0 !important;
                }
            }
        </style>

        <!-- Единая панель инструментов -->
        <div class="office-toolbar">
            <span class="kind-badge" :data-kind="kind">{{kindLabel}}</span>

            <!-- Инструменты документа Word -->
            <template ~if="kind === 'document'">
                <select class="tb-select" @change="execDocFormatBlock($event.target.value); $event.target.value = ''">
                    <option value="">Стиль абзаца…</option>
                    <option value="P">Обычный текст</option>
                    <option value="H1">Заголовок 1</option>
                    <option value="H2">Заголовок 2</option>
                    <option value="H3">Заголовок 3</option>
                </select>
                <select class="tb-select" @change="execDocCmd('fontName', $event.target.value)">
                    <option value="Inter, Segoe UI, Arial, sans-serif">Sans-serif (Inter / Arial)</option>
                    <option value="Times New Roman, serif">Times New Roman</option>
                    <option value="Georgia, serif">Georgia</option>
                    <option value="Courier New, monospace">Courier New</option>
                </select>
                <div class="tb-sep"></div>
                <button class="tb-btn" title="Жирный (Ctrl+B)" @click="execDocCmd('bold')"><b>Ж</b></button>
                <button class="tb-btn" title="Курсив (Ctrl+I)" @click="execDocCmd('italic')"><i>К</i></button>
                <button class="tb-btn" title="Подчёркнутый (Ctrl+U)" @click="execDocCmd('underline')"><u>Ч</u></button>
                <button class="tb-btn" title="Зачёркнутый" @click="execDocCmd('strikeThrough')"><s>S</s></button>
                <input type="color" class="tb-color" title="Цвет текста" value="#111827" @input="execDocCmd('foreColor', $event.target.value)">
                <div class="tb-sep"></div>
                <button class="tb-btn" title="По левому краю" @click="execDocCmd('justifyLeft')">⇤</button>
                <button class="tb-btn" title="По центру" @click="execDocCmd('justifyCenter')">↔</button>
                <button class="tb-btn" title="По правому краю" @click="execDocCmd('justifyRight')">⇥</button>
                <button class="tb-btn" title="По ширине" @click="execDocCmd('justifyFull')">≡</button>
                <div class="tb-sep"></div>
                <button class="tb-btn" title="Маркированный список" @click="execDocCmd('insertUnorderedList')">• Список</button>
                <button class="tb-btn" title="Нумерованный список" @click="execDocCmd('insertOrderedList')">1. Список</button>
                <button class="tb-btn" title="Вставить таблицу 3×3" @click="insertDocTable()">⊞ Таблица</button>
                <button class="tb-btn" title="Разрыв страницы" @click="insertDocPageBreak()">⎯ Страница</button>
            </template>

            <!-- Инструменты таблицы Excel -->
            <template ~if="kind === 'spreadsheet'">
                <button class="tb-btn" :active="activeCellObj?.bold" title="Жирный" @click="toggleCellStyle('bold')"><b>Ж</b></button>
                <button class="tb-btn" :active="activeCellObj?.italic" title="Курсив" @click="toggleCellStyle('italic')"><i>К</i></button>
                <div class="tb-sep"></div>
                <button class="tb-btn" :active="activeCellObj?.align === 'left'" title="По левому краю" @click="setCellStyle('align', 'left')">⇤</button>
                <button class="tb-btn" :active="activeCellObj?.align === 'center'" title="По центру" @click="setCellStyle('align', 'center')">↔</button>
                <button class="tb-btn" :active="activeCellObj?.align === 'right'" title="По правому краю" @click="setCellStyle('align', 'right')">⇥</button>
                <div class="tb-sep"></div>
                <select class="tb-select" title="Формат чисел" :value="activeCellObj?.numFmt || ''" @change="setCellStyle('numFmt', $event.target.value)">
                    <option value="">Общий формат</option>
                    <option value="number">1 234,56</option>
                    <option value="currency">1 234,56 ₽</option>
                    <option value="percent">12,3%</option>
                </select>
                <input type="color" class="tb-color" title="Цвет текста ячейки" :value="activeCellObj?.color || '#111827'" @input="setCellStyle('color', $event.target.value)">
                <input type="color" class="tb-color" title="Цвет фона ячейки" :value="activeCellObj?.bg || '#ffffff'" @input="setCellStyle('bg', $event.target.value)">
                <div class="tb-sep"></div>
                <button class="tb-btn" title="Объединить / разъединить выделенные ячейки" @click="toggleMergeSelected()">⊞ Объединить</button>
                <button class="tb-btn" title="Автосумма (SUM)" @click="insertAutoSum()">Σ Сумма</button>
                <div class="tb-sep"></div>
                <button class="tb-btn" title="Вставить строку ниже" @click="insertSheetRow()">+ Строка</button>
                <button class="tb-btn" title="Удалить текущую строку" @click="deleteSheetRow()">− Строка</button>
                <button class="tb-btn" title="Вставить колонку справа" @click="insertSheetCol()">+ Колонка</button>
            </template>

            <!-- Инструменты презентации PowerPoint -->
            <template ~if="kind === 'presentation'">
                <button class="tb-btn" @click="addSlide()">+ Слайд</button>
                <button class="tb-btn" @click="duplicateSlide()">⧉ Дублировать</button>
                <button class="tb-btn" @click="deleteSlide()">✕ Удалить слайд</button>
                <div class="tb-sep"></div>
                <button class="tb-btn" @click="addSlideTextElement()">+ Текстовый блок</button>
                <button class="tb-btn" ~if="selectedSlideEl" @click="deleteSlideElement()">− Удалить блок</button>
                <template ~if="selectedSlideEl">
                    <div class="tb-sep"></div>
                    <button class="tb-btn" :active="selectedSlideEl.bold" @click="toggleSlideElProp('bold')"><b>Ж</b></button>
                    <button class="tb-btn" :active="selectedSlideEl.italic" @click="toggleSlideElProp('italic')"><i>К</i></button>
                    <select class="tb-select" :value="String(selectedSlideEl.fontSize || 22)" @change="setSlideElProp('fontSize', Number($event.target.value))">
                        <option value="14">14 px</option>
                        <option value="18">18 px</option>
                        <option value="22">22 px</option>
                        <option value="28">28 px</option>
                        <option value="36">36 px</option>
                        <option value="48">48 px</option>
                    </select>
                    <button class="tb-btn" :active="selectedSlideEl.align === 'left'" @click="setSlideElProp('align', 'left')">⇤</button>
                    <button class="tb-btn" :active="selectedSlideEl.align === 'center'" @click="setSlideElProp('align', 'center')">↔</button>
                    <button class="tb-btn" :active="selectedSlideEl.align === 'right'" @click="setSlideElProp('align', 'right')">⇥</button>
                    <input type="color" class="tb-color" title="Цвет текста" :value="selectedSlideEl.color || '#1e293b'" @input="setSlideElProp('color', $event.target.value)">
                    <input type="color" class="tb-color" title="Заливка блока" :value="selectedSlideEl.fill && selectedSlideEl.fill !== 'transparent' ? selectedSlideEl.fill : '#ffffff'" @input="setSlideElProp('fill', $event.target.value)">
                </template>
                <div class="tb-sep"></div>
                <button class="tb-btn" @click="startSlideShow()">▶ Показ слайдов</button>
            </template>

            <div flex></div>

            <span class="status-pill" :dirty="isChanged">{{statusText}}</span>
            <button class="tb-btn" title="Открыть напрямую в установленном на ПК Office (Word / Excel / PowerPoint / LibreOffice)" @click="openInDesktopOffice()">↗ В системном Office</button>
            <button class="tb-btn" title="Печать документа" @click="printDocument()">🖨 Печать</button>
            <button class="tb-btn" title="Скачать файл" @click="downloadDocument()">⬇ Скачать</button>
        </div>

        <!-- 1. РЕЖИМ ТАБЛИЦЫ (.xlsx / .xls / .csv) -->
        <template ~if="kind === 'spreadsheet'">
            <div class="formula-bar">
                <div class="cell-addr-box">{{activeCellAddr}}</div>
                <span class="fx-label">fx</span>
                <input class="formula-input" type="text" placeholder="Значение или формула (=SUM(A1:A10), =A1*B1)..." :value="formulaInputValue" @input="onFormulaInput($event)" @keydown="onFormulaKeyDown($event)">
            </div>
            <div class="sheet-scroller">
                <table class="xlsx-grid">
                    <thead>
                        <tr>
                            <th style="width:42px;min-width:42px;"></th>
                            <th ~for="colHeaders" ~style="{width: $for.item.width + 'px', minWidth: $for.item.width + 'px'}">{{$for.item.label}}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr ~for="gridRows" ~style="{height: '24px'}">
                            <th class="row-num">{{$for.item.rowNum}}</th>
                            <td ~for="$for.item.cells"
                                class="xlsx-cell"
                                ~if="!$for.item.hiddenByMerge"
                                :colspan="$for.item.colSpan"
                                :rowspan="$for.item.rowSpan"
                                :active="$for.item.isActive"
                                :in-range="$for.item.inRange"
                                ~style="$for.item.styleStr"
                                @mousedown="onCellMouseDown($for.item, $event)"
                                @mouseenter="onCellMouseEnter($for.item, $event)"
                                @dblclick="startInlineEdit($for.item)">
                                <template ~if="editingCoord === $for.item.coord">
                                    <input class="cell-inline-editor" type="text" :value="formulaInputValue" @input="onFormulaInput($event)" @blur="commitInlineEdit()" @keydown="onInlineEditorKeyDown($event)">
                                </template>
                                <template ~if="editingCoord !== $for.item.coord">
                                    <span>{{$for.item.display}}</span>
                                </template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="sheet-footer">
                <div class="sheet-tabs">
                    <div class="sheet-tab" ~for="sheets" :active="$for.index === activeSheetIdx" @click="selectSheet($for.index)" @dblclick="renameSheet($for.index)">
                        {{$for.item.name}}
                    </div>
                    <button class="tb-btn" title="Добавить лист" @click="addSheet()">+</button>
                </div>
                <div class="sheet-stats">
                    <span>Кол-во: <b>{{selectionStats.count}}</b></span>
                    <span ~if="selectionStats.numCount">Среднее: <b>{{selectionStats.avg}}</b></span>
                    <span ~if="selectionStats.numCount">Сумма: <b>{{selectionStats.sum}}</b></span>
                </div>
            </div>
        </template>

        <!-- 2. РЕЖИМ ДОКУМЕНТА (.docx / .rtf) -->
        <template ~if="kind === 'document'">
            <div class="docx-workspace">
                <div id="docxPage" class="docx-page" contenteditable="true" spellcheck="true" @input="onDocxInput($event)"></div>
            </div>
        </template>

        <!-- 3. РЕЖИМ ПРЕЗЕНТАЦИИ (.pptx) -->
        <template ~if="kind === 'presentation'">
            <div class="pptx-workspace">
                <div class="pptx-sidebar">
                    <div class="slide-thumb" ~for="slides" :active="$for.index === activeSlideIdx" @click="selectSlide($for.index)">
                        <div class="slide-thumb-num">Слайд {{$for.index + 1}}</div>
                        <div class="slide-thumb-title">{{$for.item.title || ('Слайд ' + ($for.index + 1))}}</div>
                        <div style="font-size:10px;color:#94a3b8;">Элементов: {{$for.item.elements?.length || 0}}</div>
                    </div>
                </div>
                <div class="pptx-stage-wrap" @mousedown="onStageBackgroundClick($event)">
                    <div class="pptx-canvas" ~style="{background: currentSlide?.background || '#ffffff'}" @mousemove="onSlideMouseMove($event)" @mouseup="onSlideMouseUp()">
                        <div class="pptx-el"
                            ~for="currentSlideElements"
                            :selected="selectedSlideElId === $for.item.id"
                            ~style="slideElStyle($for.item)"
                            contenteditable="true"
                            @mousedown.stop="onSlideElMouseDown($for.item, $event)"
                            @input="onSlideElInput($for.item, $event)">{{$for.item.text}}</div>
                    </div>
                </div>
            </div>
            <div class="pptx-presentation-fullscreen" ~if="slideshowActive" @click="nextSlideShow()" @contextmenu.prevent="exitSlideShow()">
                <div class="pptx-canvas" ~style="{background: currentSlide?.background || '#ffffff', transform: 'scale(1.35)'}">
                    <div class="pptx-el" ~for="currentSlideElements" ~style="slideElStyle($for.item)" style="cursor:default;">{{$for.item.text}}</div>
                </div>
            </div>
        </template>
    `,
    hostView: null,
    kind: 'document',
    ext: 'docx',
    isChanged: false,
    saving: false,
    statusMessage: '',

    // Состояние таблиц (.xlsx)
    sheets: [],
    activeSheetIdx: 0,
    activeRow: 0,
    activeCol: 0,
    selStartRow: 0,
    selStartCol: 0,
    selEndRow: 0,
    selEndCol: 0,
    _isSelectingCells: false,
    editingCoord: '',
    formulaInputValue: '',
    _gridTick: 0,

    // Состояние документа (.docx)
    docHtml: '<p><br></p>',
    pageSetup: null,

    // Состояние презентации (.pptx)
    slides: [],
    activeSlideIdx: 0,
    selectedSlideElId: '',
    slideshowActive: false,
    _dragState: null,

    $item: {
        $def: null,
        set(n) {
            if (n)
                this.loadOfficeItem(n);
        },
    },

    $listeners: {
        keydown(e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы')) {
                e.preventDefault();
                e.stopPropagation();
                this.save();
                return;
            }
            if (this.slideshowActive) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.exitSlideShow();
                }
                else if (e.key === 'ArrowRight' || e.key === ' ') {
                    e.preventDefault();
                    this.nextSlideShow();
                }
                else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.prevSlideShow();
                }
                return;
            }
            if (this.kind === 'spreadsheet' && !this.editingCoord && e.target?.tagName !== 'INPUT' && e.target?.tagName !== 'SELECT') {
                if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    e.preventDefault();
                    this.moveActiveCell(1, 0, e.shiftKey);
                }
                else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.moveActiveCell(-1, 0, e.shiftKey);
                }
                else if (e.key === 'ArrowRight' || e.key === 'Tab') {
                    e.preventDefault();
                    this.moveActiveCell(0, 1, e.shiftKey);
                }
                else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.moveActiveCell(0, -1, e.shiftKey);
                }
                else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    this.clearSelectedCells();
                }
                else if (e.key === 'F2') {
                    e.preventDefault();
                    this.startInlineEdit({ r: this.activeRow, c: this.activeCol, coord: `${this.activeRow}:${this.activeCol}` });
                }
            }
        },
    },

    get kindLabel() {
        if (this.kind === 'spreadsheet')
            return 'ТАБЛИЦА EXCEL';
        if (this.kind === 'presentation')
            return 'ПРЕЗЕНТАЦИЯ';
        return 'ДОКУМЕНТ WORD';
    },

    get statusText() {
        if (this.saving)
            return 'Сохранение…';
        if (this.statusMessage)
            return this.statusMessage;
        return this.isChanged ? '● Есть несохранённые изменения' : '✓ Сохранено';
    },

    markDirty(dirty = true) {
        this.isChanged = Boolean(dirty);
        if (this.isChanged)
            this.statusMessage = '';
        if (this.$item)
            this.$item.isChanged = this.isChanged;
        if (this.hostView)
            this.hostView.isChanged = this.isChanged;
        const formHost = this._findFormHost();
        if (formHost)
            formHost.focusedStateVersion = (formHost.focusedStateVersion || 0) + 1;
    },

    _findFormHost() {
        for (let p = this.parentElement || this.domHost || this.getRootNode?.()?.host; p; p = p.parentElement || p.domHost || p.getRootNode?.()?.host) {
            if (p.localName === 'work-form' || typeof p.syncFromView === 'function')
                return p;
        }
        return null;
    },

    async loadOfficeItem(item) {
        if (!item)
            return;
        const ext = String(item.ext || item.id?.split('.').pop() || 'docx').toLowerCase();
        this.ext = ext;
        try {
            const res = await item.fetch('office_load');
            this.applyLoadedModel(res || {});
        }
        catch (err) {
            console.warn('[office-editor] load error:', err);
            this.applyLoadedModel({ kind: 'document', ext, html: '<p><br></p>' });
        }
    },

    applyLoadedModel(data = {}) {
        this.kind = data.kind || 'document';
        if (this.kind === 'spreadsheet') {
            this.sheets = Array.isArray(data.sheets) && data.sheets.length
                ? data.sheets
                : [{ name: 'Лист1', rowCount: 30, colCount: 12, colWidths: Array(12).fill(110), merges: [], cells: {} }];
            this.activeSheetIdx = 0;
            this.setActiveCell(0, 0);
            this._gridTick++;
        }
        else if (this.kind === 'presentation') {
            this.slides = Array.isArray(data.slides) && data.slides.length
                ? data.slides
                : [{ id: 'slide_1', title: 'Слайд 1', background: '#ffffff', elements: [] }];
            this.activeSlideIdx = 0;
            this.selectedSlideElId = this.slides[0]?.elements?.[0]?.id || '';
        }
        else {
            this.docHtml = String(data.html || '<p><br></p>');
            this.pageSetup = data.pageSetup || { widthMm: 210, heightMm: 297, marginMm: 20 };
            this.async(() => {
                const page = this.$?.('#docxPage');
                if (page && page.innerHTML !== this.docHtml)
                    page.innerHTML = this.docHtml;
            }, 10);
        }
        this.markDirty(false);
    },

    buildSavePayload() {
        if (this.kind === 'spreadsheet') {
            return {
                kind: 'spreadsheet',
                ext: this.ext,
                sheets: this.sheets,
            };
        }
        if (this.kind === 'presentation') {
            return {
                kind: 'presentation',
                ext: this.ext,
                slides: this.slides,
            };
        }
        const page = this.$?.('#docxPage');
        const html = page ? page.innerHTML : this.docHtml;
        this.docHtml = html;
        return {
            kind: 'document',
            ext: this.ext,
            html,
            pageSetup: this.pageSetup,
        };
    },

    async save() {
        if (!this.$item || this.saving)
            return false;
        if (this.editingCoord)
            this.commitInlineEdit();
        this.saving = true;
        try {
            const payload = this.buildSavePayload();
            await this.$item.fetch('office_save', {}, JSON.stringify(payload));
            this.markDirty(false);
            this.statusMessage = '✓ Сохранено';
            return true;
        }
        catch (err) {
            this.statusMessage = 'Ошибка сохранения: ' + (err?.message || err);
            throw err;
        }
        finally {
            this.saving = false;
        }
    },

    // ========================================================================
    // Методы табличного редактора (.xlsx)
    // ========================================================================

    get currentSheet() {
        void this._gridTick;
        return this.sheets?.[this.activeSheetIdx] || null;
    },

    get activeCellAddr() {
        const r1 = Math.min(this.selStartRow, this.selEndRow);
        const r2 = Math.max(this.selStartRow, this.selEndRow);
        const c1 = Math.min(this.selStartCol, this.selEndCol);
        const c2 = Math.max(this.selStartCol, this.selEndCol);
        const a = `${colIndexToLetters(c1)}${r1 + 1}`;
        if (r1 === r2 && c1 === c2)
            return a;
        return `${a}:${colIndexToLetters(c2)}${r2 + 1}`;
    },

    get activeCellObj() {
        void this._gridTick;
        const sh = this.currentSheet;
        return sh?.cells?.[`${this.activeRow}:${this.activeCol}`] || null;
    },

    get colHeaders() {
        void this._gridTick;
        const sh = this.currentSheet;
        const count = sh?.colCount || 12;
        const widths = sh?.colWidths || [];
        const cols = [];
        for (let c = 0; c < count; c++) {
            cols.push({
                col: c,
                label: colIndexToLetters(c),
                width: widths[c] || 110,
            });
        }
        return cols;
    },

    formatCellDisplay(cell, cellsMap) {
        if (!cell)
            return '';
        let val = cell.f ? evaluateSheetFormula(cell.f, cellsMap) : (cell.v ?? '');
        if (val === '' || val === null || val === undefined)
            return '';
        const num = typeof val === 'number' ? val : (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim()) ? Number(val) : NaN);
        if (Number.isFinite(num)) {
            if (cell.numFmt === 'currency')
                return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
            if (cell.numFmt === 'number')
                return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            if (cell.numFmt === 'percent')
                return (num * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
        }
        return String(val);
    },

    get gridRows() {
        void this._gridTick;
        const sh = this.currentSheet;
        if (!sh)
            return [];
        const rCount = sh.rowCount || 30;
        const cCount = sh.colCount || 12;
        const cellsMap = sh.cells || {};
        const merges = sh.merges || [];

        const mergeMap = new Map();
        const hiddenSet = new Set();
        for (const m of merges) {
            const rs = m.e.r - m.s.r + 1;
            const cs = m.e.c - m.s.c + 1;
            if (rs > 1 || cs > 1) {
                mergeMap.set(`${m.s.r}:${m.s.c}`, { rowSpan: rs, colSpan: cs });
                for (let r = m.s.r; r <= m.e.r; r++) {
                    for (let c = m.s.c; c <= m.e.c; c++) {
                        if (r !== m.s.r || c !== m.s.c)
                            hiddenSet.add(`${r}:${c}`);
                    }
                }
            }
        }

        const rMin = Math.min(this.selStartRow, this.selEndRow);
        const rMax = Math.max(this.selStartRow, this.selEndRow);
        const cMin = Math.min(this.selStartCol, this.selEndCol);
        const cMax = Math.max(this.selStartCol, this.selEndCol);

        const rows = [];
        for (let r = 0; r < rCount; r++) {
            const rowCells = [];
            for (let c = 0; c < cCount; c++) {
                const coord = `${r}:${c}`;
                const cell = cellsMap[coord] || null;
                const mInfo = mergeMap.get(coord);
                const isActive = r === this.activeRow && c === this.activeCol;
                const inRange = r >= rMin && r <= rMax && c >= cMin && c <= cMax;

                const styles = [];
                if (cell?.bold)
                    styles.push('font-weight:700');
                if (cell?.italic)
                    styles.push('font-style:italic');
                if (cell?.align)
                    styles.push(`text-align:${cell.align}`);
                else if (cell && (cell.t === 'n' || typeof cell.v === 'number'))
                    styles.push('text-align:right');
                if (cell?.color)
                    styles.push(`color:${cell.color}`);
                if (cell?.bg && !inRange)
                    styles.push(`background-color:${cell.bg}`);

                rowCells.push({
                    r,
                    c,
                    coord,
                    hiddenByMerge: hiddenSet.has(coord),
                    rowSpan: mInfo?.rowSpan || 1,
                    colSpan: mInfo?.colSpan || 1,
                    isActive,
                    inRange,
                    styleStr: styles.join(';'),
                    display: this.formatCellDisplay(cell, cellsMap),
                });
            }
            rows.push({ r, rowNum: r + 1, cells: rowCells });
        }
        return rows;
    },

    get selectionStats() {
        void this._gridTick;
        const sh = this.currentSheet;
        if (!sh)
            return { count: 0, numCount: 0, sum: '0', avg: '0' };
        const cellsMap = sh.cells || {};
        const rMin = Math.min(this.selStartRow, this.selEndRow);
        const rMax = Math.max(this.selStartRow, this.selEndRow);
        const cMin = Math.min(this.selStartCol, this.selEndCol);
        const cMax = Math.max(this.selStartCol, this.selEndCol);

        let count = 0;
        let numCount = 0;
        let sum = 0;
        for (let r = rMin; r <= rMax; r++) {
            for (let c = cMin; c <= cMax; c++) {
                const cell = cellsMap[`${r}:${c}`];
                if (!cell)
                    continue;
                const val = cell.f ? evaluateSheetFormula(cell.f, cellsMap) : cell.v;
                if (val === '' || val === null || val === undefined)
                    continue;
                count++;
                const n = typeof val === 'number' ? val : Number(String(val).replace(/\s+/g, '').replace(',', '.'));
                if (Number.isFinite(n)) {
                    numCount++;
                    sum += n;
                }
            }
        }
        return {
            count,
            numCount,
            sum: sum.toLocaleString('ru-RU', { maximumFractionDigits: 2 }),
            avg: numCount ? (sum / numCount).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '0',
        };
    },

    setActiveCell(r, c, extendSelection = false) {
        const sh = this.currentSheet;
        const maxR = (sh?.rowCount || 30) - 1;
        const maxC = (sh?.colCount || 12) - 1;
        const nr = Math.max(0, Math.min(maxR, r));
        const nc = Math.max(0, Math.min(maxC, c));
        this.activeRow = nr;
        this.activeCol = nc;
        if (!extendSelection) {
            this.selStartRow = nr;
            this.selStartCol = nc;
        }
        this.selEndRow = nr;
        this.selEndCol = nc;

        const cell = sh?.cells?.[`${nr}:${nc}`];
        this.formulaInputValue = cell?.f ? `=${cell.f}` : String(cell?.v ?? '');
        this._gridTick++;
    },

    moveActiveCell(dr, dc, extend = false) {
        if (extend)
            this.setActiveCell(this.selEndRow + dr, this.selEndCol + dc, true);
        else
            this.setActiveCell(this.activeRow + dr, this.activeCol + dc, false);
    },

    onCellMouseDown(cellItem, e) {
        if (this.editingCoord && this.editingCoord !== cellItem.coord)
            this.commitInlineEdit();
        this.setActiveCell(cellItem.r, cellItem.c, e?.shiftKey);
        this._isSelectingCells = true;
        const up = () => {
            this._isSelectingCells = false;
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mouseup', up);
    },

    onCellMouseEnter(cellItem) {
        if (!this._isSelectingCells)
            return;
        this.selEndRow = cellItem.r;
        this.selEndCol = cellItem.c;
        this._gridTick++;
    },

    startInlineEdit(cellItem) {
        this.setActiveCell(cellItem.r, cellItem.c);
        this.editingCoord = cellItem.coord;
        this._gridTick++;
        this.async(() => {
            const inp = this.$?.('.cell-inline-editor');
            inp?.focus?.();
        }, 10);
    },

    commitInlineEdit() {
        if (!this.editingCoord)
            return;
        this.applyFormulaValueToCell(this.activeRow, this.activeCol, this.formulaInputValue);
        this.editingCoord = '';
        this._gridTick++;
    },

    onInlineEditorKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.commitInlineEdit();
            this.moveActiveCell(1, 0);
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            this.editingCoord = '';
            this.setActiveCell(this.activeRow, this.activeCol);
        }
    },

    onFormulaInput(e) {
        const val = e?.target?.value ?? '';
        this.formulaInputValue = val;
        if (!this.editingCoord)
            this.applyFormulaValueToCell(this.activeRow, this.activeCol, val);
    },

    onFormulaKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.applyFormulaValueToCell(this.activeRow, this.activeCol, this.formulaInputValue);
            this.moveActiveCell(1, 0);
        }
    },

    applyFormulaValueToCell(r, c, rawVal) {
        const sh = this.currentSheet;
        if (!sh)
            return;
        sh.cells ??= {};
        const coord = `${r}:${c}`;
        const existing = sh.cells[coord] || {};
        const str = String(rawVal ?? '');

        if (str.startsWith('=')) {
            const f = str.slice(1).trim();
            const computed = evaluateSheetFormula(f, sh.cells);
            sh.cells[coord] = {
                ...existing,
                f,
                v: computed,
                t: typeof computed === 'number' ? 'n' : 's',
            };
        }
        else {
            const trimmed = str.trim();
            const num = trimmed !== '' && /^-?\d+([.,]\d+)?$/.test(trimmed) ? Number(trimmed.replace(',', '.')) : NaN;
            const next = { ...existing };
            delete next.f;
            delete next.w;
            if (Number.isFinite(num)) {
                next.v = num;
                next.t = 'n';
            }
            else {
                next.v = str;
                next.t = 's';
            }
            sh.cells[coord] = next;
        }
        this.markDirty(true);
        this._gridTick++;
    },

    clearSelectedCells() {
        const sh = this.currentSheet;
        if (!sh?.cells)
            return;
        const rMin = Math.min(this.selStartRow, this.selEndRow);
        const rMax = Math.max(this.selStartRow, this.selEndRow);
        const cMin = Math.min(this.selStartCol, this.selEndCol);
        const cMax = Math.max(this.selStartCol, this.selEndCol);
        for (let r = rMin; r <= rMax; r++) {
            for (let c = cMin; c <= cMax; c++) {
                const cell = sh.cells[`${r}:${c}`];
                if (cell) {
                    delete cell.v;
                    delete cell.f;
                    delete cell.w;
                }
            }
        }
        this.formulaInputValue = '';
        this.markDirty(true);
        this._gridTick++;
    },

    toggleCellStyle(prop) {
        const cur = Boolean(this.activeCellObj?.[prop]);
        this.setCellStyle(prop, !cur);
    },

    setCellStyle(prop, val) {
        const sh = this.currentSheet;
        if (!sh)
            return;
        sh.cells ??= {};
        const rMin = Math.min(this.selStartRow, this.selEndRow);
        const rMax = Math.max(this.selStartRow, this.selEndRow);
        const cMin = Math.min(this.selStartCol, this.selEndCol);
        const cMax = Math.max(this.selStartCol, this.selEndCol);
        for (let r = rMin; r <= rMax; r++) {
            for (let c = cMin; c <= cMax; c++) {
                const coord = `${r}:${c}`;
                sh.cells[coord] = { ...(sh.cells[coord] || { v: '' }), [prop]: val };
            }
        }
        this.markDirty(true);
        this._gridTick++;
    },

    toggleMergeSelected() {
        const sh = this.currentSheet;
        if (!sh)
            return;
        sh.merges ??= [];
        const r1 = Math.min(this.selStartRow, this.selEndRow);
        const r2 = Math.max(this.selStartRow, this.selEndRow);
        const c1 = Math.min(this.selStartCol, this.selEndCol);
        const c2 = Math.max(this.selStartCol, this.selEndCol);

        const existingIdx = sh.merges.findIndex(m => m.s.r === r1 && m.s.c === c1 && m.e.r === r2 && m.e.c === c2);
        if (existingIdx >= 0) {
            sh.merges.splice(existingIdx, 1);
        }
        else if (r1 !== r2 || c1 !== c2) {
            sh.merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
        }
        this.markDirty(true);
        this._gridTick++;
    },

    insertAutoSum() {
        const sh = this.currentSheet;
        if (!sh)
            return;
        const c = this.activeCol;
        const r = this.activeRow;
        const colLet = colIndexToLetters(c);
        const targetRow = r > 0 ? r : 1;
        const formula = `=SUM(${colLet}1:${colLet}${targetRow})`;
        this.formulaInputValue = formula;
        this.applyFormulaValueToCell(r, c, formula);
    },

    insertSheetRow() {
        const sh = this.currentSheet;
        if (!sh)
            return;
        sh.rowCount = (sh.rowCount || 30) + 1;
        this.markDirty(true);
        this._gridTick++;
    },

    deleteSheetRow() {
        const sh = this.currentSheet;
        if (!sh?.cells)
            return;
        const targetR = this.activeRow;
        const nextCells = {};
        for (const [coord, val] of Object.entries(sh.cells)) {
            const [rStr, cStr] = coord.split(':');
            const r = Number(rStr);
            const c = Number(cStr);
            if (r === targetR)
                continue;
            const nr = r > targetR ? r - 1 : r;
            nextCells[`${nr}:${c}`] = val;
        }
        sh.cells = nextCells;
        this.markDirty(true);
        this._gridTick++;
    },

    insertSheetCol() {
        const sh = this.currentSheet;
        if (!sh)
            return;
        sh.colCount = (sh.colCount || 12) + 1;
        sh.colWidths ??= [];
        sh.colWidths.push(110);
        this.markDirty(true);
        this._gridTick++;
    },

    selectSheet(idx) {
        if (this.editingCoord)
            this.commitInlineEdit();
        this.activeSheetIdx = idx;
        this.setActiveCell(0, 0);
    },

    addSheet() {
        const num = (this.sheets?.length || 0) + 1;
        this.sheets.push({
            name: `Лист${num}`,
            rowCount: 30,
            colCount: 12,
            colWidths: Array(12).fill(110),
            merges: [],
            cells: {},
        });
        this.activeSheetIdx = this.sheets.length - 1;
        this.setActiveCell(0, 0);
        this.markDirty(true);
    },

    renameSheet(idx) {
        const sh = this.sheets?.[idx];
        if (!sh)
            return;
        const next = typeof window.prompt === 'function' ? window.prompt('Название листа:', sh.name) : sh.name;
        if (next && next.trim()) {
            sh.name = next.trim().slice(0, 31);
            this.markDirty(true);
            this._gridTick++;
        }
    },

    // ========================================================================
    // Методы редактора документов Word (.docx)
    // ========================================================================

    onDocxInput(e) {
        this.docHtml = e?.target?.innerHTML || '';
        this.markDirty(true);
    },

    execDocCmd(cmd, value = null) {
        const page = this.$?.('#docxPage');
        page?.focus?.();
        try {
            document.execCommand(cmd, false, value);
        }
        catch { /* ignore */ }
        if (page)
            this.docHtml = page.innerHTML;
        this.markDirty(true);
    },

    execDocFormatBlock(tag) {
        if (!tag)
            return;
        this.execDocCmd('formatBlock', tag);
    },

    insertDocTable() {
        const tblHtml = `<table class="docx-table"><tbody>
            <tr><td>Ячейка 1</td><td>Ячейка 2</td><td>Ячейка 3</td></tr>
            <tr><td><br></td><td><br></td><td><br></td></tr>
            <tr><td><br></td><td><br></td><td><br></td></tr>
        </tbody></table><p><br></p>`;
        this.execDocCmd('insertHTML', tblHtml);
    },

    insertDocPageBreak() {
        this.execDocCmd('insertHTML', '<hr class="page-break"><p><br></p>');
    },

    // ========================================================================
    // Методы редактора презентаций PowerPoint (.pptx)
    // ========================================================================

    get currentSlide() {
        return this.slides?.[this.activeSlideIdx] || null;
    },

    get currentSlideElements() {
        return this.currentSlide?.elements || [];
    },

    get selectedSlideEl() {
        return this.currentSlideElements.find(el => el.id === this.selectedSlideElId) || null;
    },

    slideElStyle(el) {
        if (!el)
            return {};
        return {
            left: (el.x || 0) + 'px',
            top: (el.y || 0) + 'px',
            width: (el.w || 300) + 'px',
            minHeight: (el.h || 60) + 'px',
            fontSize: (el.fontSize || 22) + 'px',
            fontWeight: el.bold ? '700' : '400',
            fontStyle: el.italic ? 'italic' : 'normal',
            textAlign: el.align || 'left',
            color: el.color || '#1e293b',
            background: el.fill || 'transparent',
        };
    },

    selectSlide(idx) {
        this.activeSlideIdx = idx;
        this.selectedSlideElId = this.slides?.[idx]?.elements?.[0]?.id || '';
    },

    addSlide() {
        const n = (this.slides?.length || 0) + 1;
        const slide = {
            id: `slide_${Date.now()}`,
            title: `Слайд ${n}`,
            background: '#ffffff',
            elements: [
                {
                    id: `el_${Date.now()}_1`,
                    type: 'text',
                    x: 80,
                    y: 70,
                    w: 800,
                    h: 70,
                    text: `Заголовок слайда ${n}`,
                    fontSize: 32,
                    bold: true,
                    italic: false,
                    align: 'left',
                    color: '#1e293b',
                    fill: 'transparent',
                },
                {
                    id: `el_${Date.now()}_2`,
                    type: 'text',
                    x: 80,
                    y: 170,
                    w: 800,
                    h: 260,
                    text: '• Ключевой тезис 1\n• Ключевой тезис 2',
                    fontSize: 22,
                    bold: false,
                    italic: false,
                    align: 'left',
                    color: '#334155',
                    fill: 'transparent',
                },
            ],
        };
        this.slides = [...(this.slides || []), slide];
        this.activeSlideIdx = this.slides.length - 1;
        this.selectedSlideElId = slide.elements[0].id;
        this.markDirty(true);
    },

    duplicateSlide() {
        const cur = this.currentSlide;
        if (!cur)
            return;
        const copy = JSON.parse(JSON.stringify(cur));
        copy.id = `slide_${Date.now()}`;
        copy.title = (copy.title || 'Слайд') + ' (копия)';
        copy.elements = (copy.elements || []).map((el, i) => ({ ...el, id: `el_${Date.now()}_${i}` }));
        const next = [...this.slides];
        next.splice(this.activeSlideIdx + 1, 0, copy);
        this.slides = next;
        this.activeSlideIdx++;
        this.markDirty(true);
    },

    deleteSlide() {
        if ((this.slides?.length || 0) <= 1)
            return;
        const next = this.slides.filter((_, idx) => idx !== this.activeSlideIdx);
        this.slides = next;
        this.activeSlideIdx = Math.max(0, Math.min(this.activeSlideIdx, next.length - 1));
        this.markDirty(true);
    },

    addSlideTextElement() {
        const cur = this.currentSlide;
        if (!cur)
            return;
        cur.elements ??= [];
        const newEl = {
            id: `el_${Date.now()}`,
            type: 'text',
            x: 120,
            y: 140,
            w: 500,
            h: 80,
            text: 'Новый текстовый блок',
            fontSize: 22,
            bold: false,
            italic: false,
            align: 'left',
            color: '#1e293b',
            fill: 'transparent',
        };
        cur.elements = [...cur.elements, newEl];
        this.selectedSlideElId = newEl.id;
        this.markDirty(true);
        this.render();
    },

    deleteSlideElement() {
        const cur = this.currentSlide;
        if (!cur || !this.selectedSlideElId)
            return;
        cur.elements = (cur.elements || []).filter(el => el.id !== this.selectedSlideElId);
        this.selectedSlideElId = cur.elements[0]?.id || '';
        this.markDirty(true);
        this.render();
    },

    toggleSlideElProp(prop) {
        const el = this.selectedSlideEl;
        if (!el)
            return;
        this.setSlideElProp(prop, !el[prop]);
    },

    setSlideElProp(prop, val) {
        const el = this.selectedSlideEl;
        if (!el)
            return;
        el[prop] = val;
        this.markDirty(true);
        this.render();
    },

    onStageBackgroundClick(e) {
        if (e?.target?.classList?.contains('pptx-canvas') || e?.target?.classList?.contains('pptx-stage-wrap'))
            this.selectedSlideElId = '';
    },

    onSlideElMouseDown(el, e) {
        this.selectedSlideElId = el.id;
        this._dragState = {
            el,
            startX: e.clientX,
            startY: e.clientY,
            origX: Number(el.x) || 0,
            origY: Number(el.y) || 0,
        };
    },

    onSlideMouseMove(e) {
        const d = this._dragState;
        if (!d)
            return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3)
            return;
        d.el.x = Math.max(0, Math.min(900, Math.round(d.origX + dx)));
        d.el.y = Math.max(0, Math.min(500, Math.round(d.origY + dy)));
        this.markDirty(true);
        this.render();
    },

    onSlideMouseUp() {
        this._dragState = null;
    },

    onSlideElInput(el, e) {
        el.text = e?.target?.innerText ?? '';
        const cur = this.currentSlide;
        if (cur && cur.elements?.[0]?.id === el.id)
            cur.title = el.text.split('\n')[0]?.slice(0, 40) || cur.title;
        this.markDirty(true);
    },

    startSlideShow() {
        this.slideshowActive = true;
    },

    exitSlideShow() {
        this.slideshowActive = false;
    },

    nextSlideShow() {
        if (this.activeSlideIdx < (this.slides?.length || 1) - 1)
            this.activeSlideIdx++;
        else
            this.slideshowActive = false;
    },

    prevSlideShow() {
        if (this.activeSlideIdx > 0)
            this.activeSlideIdx--;
    },

    // ========================================================================
    // Интеграция с десктопным Office, печать и скачивание
    // ========================================================================

    openInDesktopOffice() {
        const url = this.$item?.url ? new URL(this.$item.url, location.origin).href : '';
        if (!url)
            return;
        let proto = 'ms-word:ofe|u|';
        if (this.kind === 'spreadsheet')
            proto = 'ms-excel:ofe|u|';
        else if (this.kind === 'presentation')
            proto = 'ms-powerpoint:ofe|u|';
        window.location.href = proto + url;
    },

    printDocument() {
        window.print?.();
    },

    downloadDocument() {
        const url = this.$item?.url;
        if (!url)
            return;
        const a = document.createElement('a');
        a.href = url + (url.includes('?') ? '&download' : '?download');
        a.download = this.$item?.id || ('document.' + this.ext);
        document.body.appendChild(a);
        a.click();
        a.remove();
    },
});
