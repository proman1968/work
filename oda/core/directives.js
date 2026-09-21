/**
 * ODA core/directives — таблица ODA.DIRECTIVES (if/is/for/show/style/class/text/html/props).
 * Вынесено из oda/oda.js без изменений логики.
 * Фасад присваивает: ODA.DIRECTIVES = DIRECTIVES.
 * Мёртвая константа KEY (определялась рядом, нигде не использовалась) — удалена.
 */
import { Reactor } from '../../sources/reactor.js';
import { removeElement, styleToObject, objectToStyle } from './shared.js';

export const DIRECTIVES = {
    if(value) {
        if (!value && this.nodeType !== 8) {
            return this.__vnode__.replaceElement(this, '#comment')
        }
        else if (value && this.nodeType === 8) {
            return this.__vnode__.replaceElement(this)
        }
    },
    is(tag = this.__vnode__?.tag) {
        if (tag && this.nodeType === 1 && tag !== this.nodeName.toLowerCase()) {
            return this.__vnode__.replaceElement(this, tag)
        }
    },
    for(items = []) {
        if (typeof items === 'object' && !Array.isArray(items)) {
            const keys = Object.keys(items);
            const array = new Array(keys.length);
            for (let i = 0; i < keys.length; i++) {
                array[i] = { item: items[keys[i]], key: keys[i] };
            }
            items = array;
        } else if (!Number.isNaN(+items)) {
            const len = Math.floor(+items);
            items = new Array(len);
            for (let i = 0; i < len; i++) items[i] = i;
        }

        const prevFor = this.$for;
        const childs = this.childNodes;
        const itemsLen = items.length;
        const currentLen = childs.length;

        // Обновляем существующие или создаём новые
        for (let i = 0; i < itemsLen; i++) {
            const item = items[i];
            if (item === undefined || item === null) {
                while (this.firstChild) this.removeChild(this.firstChild);
                return;
            }

            let el = childs[i];
            if (!el) {
                el = this.__vnode__.isComment ? this.__vnode__.createElement('#comment') : this.__vnode__.createElement();
                this.appendChild(el);
            }

            let target = el;
            if (prevFor) {
                target = el.$for = Object.assign({}, prevFor);
                while (target.$for) {
                    target = target.$for = Object.assign({}, target.$for);
                }
            }

            const $for = { item, index: i, items /* , key: item.key ?? i*/ };
            if (!Reactor.equal(target.$for, $for, 2)) {
                target.$for = $for;
            }
            el.render();
        }

        // Удаляем лишние
        for (let i = currentLen - 1; i >= itemsLen; i--) {
            const el = childs[i];
            if (el) removeElement.call(el);
        }
    },
    show(value) {
        this.hidden = !value;
    },
    style(style) {
        if (this.nodeType !== 1 || Reactor.equal(this[R].cache.style, style, 1))
            return
        this[R].cache.style = style;
        let def_style = this[R].cache.def_style ??= styleToObject(this.getAttribute('style') || '');
        style = styleToObject(style);
        Object.assign(style, def_style);
        style = objectToStyle(style);
        this.setAttribute('style', style);
    },
    class(classes) {
        if (this.nodeType !== 1 || Reactor.equal(this[R].cache.classes, classes, 1))
            return
        this[R].cache.classes = classes;
        let def_classes = this[R].cache.def_classes ??= (this.getAttribute('class') || '').split(' ').filter(Boolean);
        if (typeof classes === 'string') {
            classes = classes.split(' ').filter(Boolean);
        }
        let list = []
        if (typeof classes === 'object') {
            if (Array.isArray(classes)) {
                list.push(...classes)
                for (let cls of def_classes) {
                    list.add(cls);
                }
            }
            else {
                for (let cls of def_classes) {
                    if (classes[cls] !== false)
                        list.add(cls);
                }
                for (let cls in classes) {
                    if (classes[cls] === true)
                        list.add(cls);
                }
            }
        }
        list = list.join(' ')
        this.setAttribute('class', list);
    },
    text(text = '') {
        if (this[R].cache.textContent === text) return;
        this[R].cache.textContent = text;
        this[R].cache.pendingText = text;
        if (!this[R].cache.textScheduled) {
            this[R].cache.textScheduled = true;
            queueMicrotask(() => {
                this.textContent = this[R].cache.pendingText;
                this[R].cache.pendingText = null;
                this[R].cache.textScheduled = false;
            });
        }
    },
    html(html = '') {
        if (this[R].cache.innerHTML === html) return;
        if (typeof html !== 'string') return;
        this[R].cache.innerHTML = html;
        this[R].cache.pendingHTML = html;
        if (!this[R].cache.htmlScheduled) {
            this[R].cache.htmlScheduled = true;
            queueMicrotask(() => {
                this.innerHTML = this[R].cache.pendingHTML;
                this[R].cache.pendingHTML = null;
                this[R].cache.htmlScheduled = false;
            });
        }
    },
    props(props) {
        if (props === undefined)
            return;
        if (Reactor.equal(this[R].cache.props, props))
            return;
        this[R].cache.props = props
        this.assignProps(props);
    }
}
