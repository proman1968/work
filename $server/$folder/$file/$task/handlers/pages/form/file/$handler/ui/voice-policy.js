/**
 * Голосовой режим задачи: что и когда озвучивать (чистые функции, без DOM — тестируются в Node).
 *
 * Правила:
 *   - ответ на реплику, сказанную голосом, — озвучивается первый абзац (до 3 предложений), остальное — на экране;
 *   - ответ на набранный текст — молча (если не включено «озвучивать всё»);
 *   - вопрос агента (ask_user) и просьба о разрешении — озвучиваются всегда, пока голосовой режим включён;
 *   - подтверждать голосом нельзя: разрешения только на экране (для вопросов агента — можно ответить голосом);
 *   - код, таблицы, пути, ссылки, рассуждения и карточки действий не озвучиваются.
 */

export const LEAD_MAX_SENTENCES = 3;
export const LEAD_MAX_CHARS = 420;
export const CHUNK_MAX_CHARS = 220;
export const MORE_SUFFIX = 'Подробности на экране.';

const EMOJI = /[\p{Extended_Pictographic}\u200d\ufe0f]/gu;

/** Короткое имя из WORK-пути или ссылки: «/ORG/Отчёты/сводка.md» → «сводка.md». */
function shortName(token) {
    const clean = token.replace(/[)\].,;:!?»"']+$/g, '');
    const tail = clean.split('/').filter(Boolean).pop() || clean;
    return tail;
}

/** Markdown → текст, который приятно слушать. Код, таблицы и картинки пропускаются. */
export function speakable(md) {
    let s = String(md ?? '');
    s = s.replace(/```[\s\S]*?(?:```|$)/g, ' ');
    s = s.replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ');
    s = s.replace(/<[^>\n]+>/g, ' ');
    s = s.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ');
    s = s.replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1');
    s = s.split('\n').filter(line => !/^\s*\|.*\|\s*$/.test(line) && !/^\s*[-:| ]{3,}\s*$/.test(line)).join('\n');
    s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '');
    s = s.replace(/^\s*>\s?/gm, '');
    s = s.replace(/https?:\/\/[^\s)]+/g, 'ссылка');
    s = s.replace(/(^|[\s(«"'])((?:\/[^\s/`'"«»()\[\]<>]+){2,})/g, (m, pre, path) => pre + shortName(path));
    s = s.replace(/`([^`\n]*)`/g, '$1');
    s = s.replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/(\*|_)([^*_\n]+)\1/g, '$2');
    s = s.replace(EMOJI, '');
    s = s.replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    return s;
}

/** Предложения по знакам конца; десятичные точки, инициалы и сокращения не рвут предложение. */
export function sentencesOf(text) {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!s)
        return [];
    const out = [];
    let cur = '';
    const parts = s.split(/(?<=[.!?…])\s+(?=[«"(A-ZА-ЯЁ0-9])/);
    for (const p of parts) {
        cur = cur ? cur + ' ' + p : p;
        // «т. е.», «им. Ленина», «г. Рязань», «ул. Мира» — не конец предложения
        if (/(?:^|\s)(?:т\.е|т\.д|т\.п|напр|им|г|ул|д|стр|руб|тыс|млн|млрд|см|рис|№)\.$/i.test(cur) || /(?:^|\s)[А-ЯA-Z]\.$/.test(cur))
            continue;
        out.push(cur);
        cur = '';
    }
    if (cur)
        out.push(cur);
    return out;
}

/** Вид блока (абзаца) markdown: prose — обычный текст; heading, list, table, code, quote — остальное. */
function blockKind(block) {
    const t = block.trim();
    if (!t)
        return 'empty';
    if (t === '@@CODE@@' || /^```|^~~~/.test(t))
        return 'code';
    if (/^\s*\|.*\|/.test(t))
        return 'table';
    if (/^#{1,6}(\s|$)/.test(t))
        return 'heading';
    if (/^\s*(?:[-*+]|\d+[.)])\s/.test(t))
        return 'list';
    return 'prose';
}

/**
 * Начало ответа для озвучки: связный текст из первых прозаических абзацев (не только первого —
 * у модели он часто короткая вводная вроде «Вот что:»), до 3 предложений и 420 знаков.
 * Останавливается на списке, таблице или коде. { text, more, closed }:
 * more — на экране есть что ещё прочитать; closed — граница лида известна (для потока: можно говорить, не дожидаясь конца).
 */
export function leadOf(content, { maxSentences = LEAD_MAX_SENTENCES, maxChars = LEAD_MAX_CHARS } = {}) {
    const raw = String(content ?? '').replace(/```[\s\S]*?(?:```|$)/g, '\n\n@@CODE@@\n\n').replace(/~~~[\s\S]*?(?:~~~|$)/g, '\n\n@@CODE@@\n\n');
    const blocks = raw.split(/\n\s*\n/);
    const prose = [];
    let stopped = false;
    let rest = false;
    for (let i = 0; i < blocks.length; i++) {
        const kind = blockKind(blocks[i]);
        if (kind === 'empty')
            continue;
        if (kind === 'prose') {
            const text = speakable(blocks[i]);
            if (text)
                prose.push(text);
            continue;
        }
        if (kind === 'heading' && !prose.length)
            continue;
        stopped = true;
        rest = true;
        break;
    }
    if (!prose.length)
        return { text: '', more: false, closed: false };
    // «Вот что:» перед списком — не вопросительная вводная: двоеточие превращаем в точку
    let joined = prose.join(' ').replace(/:\s*$/, stopped ? '.' : ':');
    const all = sentencesOf(joined);
    let sentences = all.slice(0, maxSentences);
    let cut = all.length > sentences.length;
    let text = sentences.join(' ');
    if (text.length > maxChars) {
        const fit = sentences.reduce((acc, s) => (acc.join(' ').length + s.length + 1 <= maxChars ? [...acc, s] : acc), []);
        text = fit.length ? fit.join(' ') : text.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
        cut = true;
    }
    return { text, more: cut || rest, closed: cut || stopped };
}

/** Во время стрима лид можно говорить, когда его граница уже известна (4-е предложение или блок-не-проза). */
export function streamLead(streamed) {
    const lead = leadOf(streamed);
    return lead.text && lead.closed ? lead : null;
}
/** Куски для синтеза: целые предложения, не длиннее max (длинные режутся по запятым и пробелам). */
export function chunksOf(text, max = CHUNK_MAX_CHARS) {
    const out = [];
    for (const sentence of sentencesOf(text)) {
        if (sentence.length <= max) {
            out.push(sentence);
            continue;
        }
        let rest = sentence;
        while (rest.length > max) {
            let at = rest.lastIndexOf(', ', max);
            if (at < max * 0.4)
                at = rest.lastIndexOf(' ', max);
            if (at < 1)
                at = max;
            out.push(rest.slice(0, at + 1).trim());
            rest = rest.slice(at + 1).trim();
        }
        if (rest)
            out.push(rest);
    }
    return out;
}

/**
 * Склеить предложения в запросы синтеза: первый короткий (звук начинается быстро), остальные длиннее
 * (меньше запросов — меньше шансов, что очередь оборвётся посреди ответа).
 */
export function mergeChunks(chunks, first = 110, max = 260) {
    const out = [];
    let cur = '';
    for (const c of chunks) {
        const limit = out.length === 0 ? first : max;
        if (!cur)
            cur = c;
        else if ((cur + ' ' + c).length <= limit)
            cur += ' ' + c;
        else {
            out.push(cur);
            cur = c;
        }
    }
    if (cur)
        out.push(cur);
    return out;
}

/** Реплика человека, на которую отвечает ответ items[index]: ближайшая предыдущая user. */
export function userBefore(items, index) {
    for (let i = index - 1; i >= 0; i--)
        if (items[i]?.type === 'user')
            return items[i];
    return null;
}

/** Фраза-уведомление, когда агент ждёт человека. kind: question | approval | connect. */
export function attentionText(tool, kind) {
    const q = (v, max = 260) => {
        const t = speakable(String(v ?? ''));
        return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
    };
    if (kind === 'question') {
        const options = Array.isArray(tool?.args?.options) ? tool.args.options.map(String).filter(Boolean).slice(0, 5) : [];
        const question = q(tool?.args?.question);
        if (!question)
            return 'Мне нужен ваш ответ. Он выше в ленте.';
        return 'Вопрос. ' + question + (options.length && !/[?]\s*$/.test(question) ? '.' : '') + (options.length ? ' Варианты: ' + options.join(', ') + '.' : '');
    }
    if (kind === 'approval') {
        const what = q(tool?.label || tool?.name, 80);
        const target = q(tool?.target, 80);
        return 'Нужно ваше разрешение: ' + what + (target ? ', ' + target : '') + '. Подтвердите на экране.';
    }
    return 'Нужно ваше действие на экране.';
}

/** Что агент ждёт от человека сейчас: 'question' | 'approval' | 'connect' | '' (нет ожидания). */
export function waitingKind(data) {
    if (data?.status !== 'waiting')
        return '';
    const k = data?.waiting?.kind;
    return k === 'question' ? 'question' : k === 'approval' ? 'approval' : k ? 'connect' : 'approval';
}

/**
 * Решение по новой записи ленты.
 * @param {object} p
 * @param {object} p.item   запись ассистента (завершённая или стримящаяся)
 * @param {Array}  p.items  вся лента (для поиска реплики человека)
 * @param {boolean} p.readAll озвучивать ответы и на набранные реплики
 * @param {string} [p.streamed] накопленный текст стрима
 * @returns {{ text: string, key: string } | null}
 */
export function replyPlan({ item, items, readAll = false, streamed = '' } = {}) {
    if (!item || item.type !== 'assistant' || item.error)
        return null;
    const index = items.indexOf(item);
    const user = index >= 0 ? userBefore(items, index) : [...items].reverse().find(i => i.type === 'user');
    if (!user?.voice && !readAll)
        return null;
    const finished = !!item.durationMs;
    const content = String(item.content || '') || String(streamed || '');
    const lead = finished ? leadOf(content) : streamLead(content);
    if (!lead?.text)
        return null;
    return { key: 'reply:' + item.id, text: lead.more ? lead.text + ' ' + MORE_SUFFIX : lead.text };
}

/** Ошибка, остановка по лимиту — коротко, детали на экране. */
export function errorPlan(item) {
    if (!item || item.type !== 'error')
        return null;
    return { key: 'error:' + item.id, text: 'Не получилось. Подробности на экране.' };
}

/** Распознанная фраза — команда голосового управления? 'stop-speech' | 'stop-task' | ''. */
export function voiceCommand(text) {
    const t = String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (/^(стоп|хватит|замолчи|тихо|подожди|помолчи|достаточно)$/.test(t))
        return 'stop-speech';
    if (/^(останови|прекрати|отмени|прерви|стоп) (работу|задачу|выполнение|всё|все)$/.test(t))
        return 'stop-task';
    return '';
}
