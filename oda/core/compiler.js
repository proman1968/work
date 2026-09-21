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

/** Разбор текстового шаблона `a{{b}}c` в JS-выражение — было inline в VNode */
export function textTemplateToExpr(value) {
    return value.replace(/^|$/g, "'").replace(/{{/g, "'+(").replace(/}}/g, ")+'").replace(/\n/g, "\\n").replace(/\+\'\'/g, "").replace(/\'\'\+/g, "");
}
