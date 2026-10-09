/**
 * Недоверенное содержимое и «заражение» контекста (защита от prompt injection).
 *
 * Инструменты, возвращающие чужой текст (веб, почта, сервисы, MCP, браузер, экран), помечены `untrusted: true`
 * (или ставят `ctx.entry.untrusted = true` в run, если содержимое чужое только иногда — например, read для .eml).
 *   1. Результат такого вызова в контексте модели оборачивается в
 *        <untrusted source="имя" id="NONCE">…</untrusted id="NONCE">
 *      NONCE случаен для каждого вызова и неизвестен автору содержимого; вхождения `<untrusted` внутри экранируются.
 *   2. Контекст «заражён» с момента такого результата и до следующей реплики человека: действия «наружу»
 *      (инструмент с `outbound`) требуют подтверждения человека каждый раз, даже в режиме auto
 *      и без «разрешить всегда» — см. permissions.js decide().
 *
 * Заражение вычисляется по ленте (без отдельного состояния): переживает рестарт, учитывает вложенные
 * ленты субагентов (task) и передаётся в субагента от родителя (opts.taintedFrom).
 */
import { randomBytes } from 'node:crypto';

/** Случайный идентификатор обёртки одного вызова. */
export function newNonce() {
    return randomBytes(4).toString('hex');
}

/** Обернуть чужое содержимое: данные, а не инструкции. */
export function wrapUntrusted(text, source, nonce = 'x') {
    const safe = String(text ?? '').replace(/<(\/?)untrusted/gi, '&lt;$1untrusted');
    const name = String(source || '?').replace(/[^\w.-]/g, '_');
    return '<untrusted source="' + name + '" id="' + nonce + '">\n' + safe + '\n</untrusted id="' + nonce + '">';
}

/** Имена инструментов с внешним содержимым во всей ленте, включая вложенные ленты субагентов. */
export function untrustedNames(items, out = new Set()) {
    for (const it of items || []) {
        if (it?.type !== 'assistant')
            continue;
        for (const t of it.tools || []) {
            if (t?.untrusted)
                out.add(t.name);
            if (Array.isArray(t?.items))
                untrustedNames(t.items, out);
        }
    }
    return out;
}

/**
 * Чем «заражён» текущий ход: внешнее содержимое после последней реплики человека (+ унаследованное от родителя).
 * @param {Array} items лента
 * @param {string[]} [inherited] источники родителя (для субагента)
 * @returns {string[]} имена инструментов; пусто — контекст чист
 */
export function taintSources(items, inherited = []) {
    const names = new Set(inherited || []);
    const tail = [];
    for (let i = (items?.length || 0) - 1; i >= 0; i--) {
        if (items[i]?.type === 'user')
            break;
        tail.push(items[i]);
    }
    untrustedNames(tail, names);
    return [...names];
}

/** Действие «наружу»: инструмент отметил `outbound` (true | (args, ctx) => boolean). Ошибка проверки = да. */
export function isOutbound(tool, args, ctx) {
    const o = tool?.outbound;
    if (typeof o === 'function') {
        try {
            return !!o(args, ctx);
        }
        catch {
            return true;
        }
    }
    return o === true;
}
