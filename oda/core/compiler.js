/**
 * ODA core/compiler — компиляция выражений шаблонов.
 * Вынесено из конструктора VNode (oda/oda.js), семантика та же:
 * `new Function / new AsyncFunction + with(this)`, CSP-unsafe как и было.
 * Все функции чистые: на вход строка выражения, на выход функция.
 * Привязка к host/$pdp/$for происходит у вызывателя, не здесь.
 */
import { AsyncFunction } from './shared.js';

/** `~directive="expr"` — было: new Function('$this, $for', `with(this){ return (...) }`) */
export function compileDirective(expr, fallbackName) {
    return new Function('$this, $for', `with(this){  return (${expr || fallbackName})}`);
}

/** `:prop="expr"` — чтение значения биндинга */
export function compileBinding(expr, propName) {
    return new AsyncFunction('$this, $for', `with(this){return (${expr || propName})}`);
}

/** `::prop="expr"` — запись при two-way (`-changed`/`input`) */
export function compileTwoWay(expr, propName) {
    return new Function('$this, $for, $value', `with(this){ return (${expr || propName.toCamelCase()} = $value)}`);
}

/** `@event.mod="expr"` — обработчик события */
export function compileEvent(expr, fallbackExpr) {
    return new Function('$event, $this, $for', `with(this){return (${expr || fallbackExpr})}`);
}

/** `attr="{{expr}}"` — биндинг атрибута в фигурных скобках */
export function compileAttrBinding(expr) {
    return new AsyncFunction('$this, $for', `with(this){return (${expr})}`);
}

/** Текст `{{...}}` внутри text-ноды — было inline в VNode */
export function compileText(expr) {
    return new AsyncFunction('$this, $for', `with(this){ return ((${expr}) ?? '')}`);
}

/** Разбор текстового шаблона `a{{b}}c` в JS-выражение с экранированием кавычек */
export function textTemplateToExpr(value) {
    const s = String(value ?? '');
    if (!s.includes('{{') || !s.includes('}}'))
        return JSON.stringify(s);
    const parts = [];
    let idx = 0;
    while (idx < s.length) {
        const open = s.indexOf('{{', idx);
        if (open === -1) {
            if (idx < s.length) parts.push(JSON.stringify(s.slice(idx)));
            break;
        }
        if (open > idx) parts.push(JSON.stringify(s.slice(idx, open)));
        const close = s.indexOf('}}', open + 2);
        if (close === -1) {
            parts.push(JSON.stringify(s.slice(open)));
            break;
        }
        const inner = s.slice(open + 2, close).trim();
        parts.push(`(${inner || "''"})`);
        idx = close + 2;
    }
    return parts.length ? parts.join('+') : "''";
}
