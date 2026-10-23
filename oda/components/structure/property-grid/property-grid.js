/**
 * oda-property-grid — инспектор $public-свойств реактивного объекта: компактная oda-form, группы по $cat / $category.
 * Поля строятся из дескрипторов свойств ([R].props): $list → выбор, Boolean → флажок, Number → число, Date → дата,
 * icon → выбор иконки.
 *
 * Потоки данных:
 * - ЧТЕНИЕ — из данных объекта: значение свойства (`data[id]`).
 * - ЗАПИСЬ — в объект: присваивание идёт через сеттер свойства (у сущностей — `update()`, у компонентов — их сеттер).
 *
 * Только чтение (readonly):
 * - ЯВНАЯ МЕТКА: в дескрипторе свойства `$readonly: true` → всегда только чтение; `$readonly: false` → редактируемо.
 *   Метка ставится рядом с признаком дескриптора ($def/$type/$list) — иначе ядро не признает объект дескриптором.
 * - БЕЗ МЕТКИ: значение вычисляется геттером, а своего сеттера нет → записать некуда ⇒ только чтение.
 *   Правка в такое свойство иначе терялась бы молча: значение уходило в кэш реактора, а геттер возвращал своё.
 *   Свойства с собственным сеттером (в т. ч. унаследованным) редактируемы.
 */

import '/oda/components/structure/form/form.js';
import '/oda/components/structure/controls.js';
import { CONTROLS } from '/oda/components/structure/controls-map.js';
import { Reactor } from '../../../../sources/reactor.js';

const typeOf = p => p.$list ? 'select'
    : { Boolean: 'boolean', Number: 'number', Date: 'date' }[p.$type?.name]
    ?? (/^(icon|\w+Icon)$/.test(p.name) ? 'icon' : undefined);

/** только чтение: явная метка важнее умолчания */
const isReadonly = p => p.$readonly !== undefined
    ? !!p.$readonly
    : !!(p.get?.getter && !p.set?.setter);

/** варианты выбора: массив — как есть (без подписи — подпись из id); объект — пары {id, label} */
const itemsOf = p => {
    const list = p.$list;
    if (!list)
        return undefined;
    if (Array.isArray(list))
        return list.map(i => (i && typeof i === 'object' && i.label === undefined
            ? { ...i, label: String(i.id ?? i.value ?? '') }
            : i));
    if (typeof list === 'object')
        return Object.entries(list).map(([id, label]) => ({ id, label }));
};

ODA({
    is: 'oda-property-grid',
    extends: 'oda-form',
    template: /*html*/`
        <style>
            :host {
                overflow: auto;
                padding: var(--space-s);
                --form-label-width: 45%;
            }
            .title {
                font-weight: 600;
                padding: var(--space-xs) var(--space-s);
            }
        </style>
    `,
    $public: {
        /** инспектируемый объект (ODA-компонент или Reactor-сущность) */
        inspected: {
            $type: Object,
            set(n) {
                this._unwatch?.();
                this._unwatch = null;
                // внешняя правка источника истины (у сущностей `update()` пишет в DATA мимо Reactor.set):
                // значение свойства устарело — сбросить кэш и перерисовать форму
                if (n?.addEventListener) {
                    // внешняя правка источника истины (у сущностей `update()` пишет в DATA мимо Reactor.set):
                    // значение поля устарело — сбросить его кэш и перерисовать поля формы
                    const onChanged = () => {
                        for (const field of this.$$('oda-form-field')) {
                            Reactor.invalidate(field, 'value');
                            field.render?.();
                        }
                    };
                    n.addEventListener('changed', onChanged);
                    this._unwatch = () => n.removeEventListener('changed', onChanged);
                }
            }
        },
        dense: {
            $def: true,
            $attr: true
        }
    },
    controls: CONTROLS,
    get label() {
        return this.inspected?.localName || this.inspected?.label || 'properties';
    },
    /** данные формы — инспектируемый объект: запись — через его сеттеры (у сущностей сеттер ведёт в `update()` — в `DATA`) */
    get data() {
        return this.inspected;
    },
    /**
     * Значение поля: у сущности источник истины — `DATA` (`update()` пишет туда мимо `Reactor.set`, поэтому
     * свойство — кэш реактора — устаревает и отдаёт `$def`, т. е. значение по умолчанию). У ODA-компонента
     * `DATA` нет — берётся само свойство.
     */
    fieldValue(field, data) {
        const own = data?.[field?.id];
        const bag = data?.DATA;
        if (bag && typeof bag === 'object' && field?.id in bag)
            return bag[field.id];
        return own;
    },
    get fields() {
        const props = Object.values(this.inspected?.[R]?.props ?? {}).filter(p => p.$public && typeof p.$def?.() !== 'function');
        const groups = {};
        for (const p of props) {
            const cat = p.$cat || p.$category || 'main';
            (groups[cat] ??= []).push({
                id: p.name,
                label: p.name,
                type: typeOf(p),
                items: itemsOf(p),
                readonly: isReadonly(p),
                required: p.required === true,
                description: p.description,
                placeholder: p.placeholder,
                pattern: p.pattern,
                min: p.min,
                max: p.max,
                step: p.step,
                icon: p.icon
            });
        }
        const cats = Object.entries(groups);
        return cats.length === 1 ? cats[0][1] : cats.map(([id, fields]) => ({ id, label: id, fields }));
    },
    /** данные группы — тот же источник */
    dataOf(field, data) {
        return data;
    }
});
