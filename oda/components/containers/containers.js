/**
 * Всплывающие окна ODA: единый стек поверх нативного popover (top layer).
 * ODA.showPopover(el, params, anchor) → Promise(result); отмена — reject(ODA.CancelError).
 * Тег оболочки — params.tag ?? ODA.popoverTag ('oda-popover'); приложение подменяет ODA.popoverTag своей оболочкой-наследником.
 */
import './popover/popover.js';


/** Типизированная ошибка отмены (отличается от реальной ошибки через instanceof). */
ODA.CancelError ??= class ODA_CancelError extends Error {};
ODA.popoverTag ??= 'oda-popover';
/** Стек открытых окон в порядке открытия. */
ODA.popovers ??= [];
/** pop → {resolve, reject} */
ODA.popoverResolvers ??= new WeakMap();

/** Единый путь закрытия: результат → resolve, пусто → reject(CancelError). Закрывает немодальные окна выше. */
ODA.closePopup = function (pop, result) {
    const idx = ODA.popovers.indexOf(pop);
    if (idx === -1)
        return;
    for (let i = ODA.popovers.length - 1; i > idx; i--) {
        if (ODA.popovers[i].popoverType === 'modal')
            break;
        ODA.closePopup(ODA.popovers[i]);
    }
    ODA.popovers.splice(idx, 1);
    const resolver = ODA.popoverResolvers.get(pop);
    ODA.popoverResolvers.delete(pop);
    pop.remove();
    if (!resolver)
        return;
    if (result)
        resolver.resolve(result);
    else
        resolver.reject(new ODA.CancelError());
};

/** Закрывает с отменой окна сверху стека до stopIdx (не включая его); модальные не трогает. */
ODA.dismissTo = function (stopIdx) {
    for (let i = ODA.popovers.length - 1; i > stopIdx; i--) {
        if (ODA.popovers[i].popoverType === 'modal')
            break;
        ODA.closePopup(ODA.popovers[i]);
    }
};

/** Закрывает с отменой все немодальные окна сверху стека. */
ODA.dismissToModal = function () {
    ODA.dismissTo(-1);
};

/** Закрывает с отменой окна поверх заданного. */
ODA.dismissAbove = function (pop) {
    const idx = ODA.popovers.indexOf(pop);
    if (idx !== -1)
        ODA.dismissTo(idx);
};

/** Окно (элемент с атрибутом popover), внутри которого находится target. */
ODA.findPopover = function (target) {
    let h = target;
    while (h && h.nodeType === 1 && !h.hasAttribute?.('popover'))
        h = h.host || h.parentElement;
    return h;
};

const closeFrames = new WeakSet();
/** Клик во вложенных фреймах закрывает немодальные окна (события фреймов не всплывают в документ). */
function bindCloseFrames() {
    for (let i = 0; i < window.frames.length; i++) {
        const frame = window.frames[i];
        if (closeFrames.has(frame))
            continue;
        closeFrames.add(frame);
        try {
            frame.addEventListener('pointerdown', () => ODA.dismissToModal());
        }
        catch { /* чужой origin — события недоступны */ }
    }
}

/** Клик вне окон закрывает немодальные окна (light dismiss для стека popover="manual"). */
window.addEventListener('pointerdown', e => {
    if (!ODA.popovers.length)
        return;
    const pop = ODA.findPopover(e.target);
    if (pop)
        ODA.dismissAbove(pop);
    else
        ODA.dismissToModal();
});

/** Во фрейме: клик в любом предке (до window.top) закрывает окна этого фрейма. */
{
    let t = window.parent;
    while (t && t !== window) {
        try {
            t.document.addEventListener('pointerdown', () => ODA.dismissToModal());
        }
        catch { /* чужой origin */ }
        if (t === window.top)
            break;
        t = t.parent;
    }
}

/** Отмены окон не считаются ошибками приложения. */
window.addEventListener('unhandledrejection', e => {
    if (e.reason instanceof ODA.CancelError)
        e.preventDefault();
});

ODA.showPopover = function (el, params = {}, e) {
    const { tag = ODA.popoverTag, ...props } = params;
    // до регистрации тега createComponent дал бы необновлённый элемент — ждём define (если уже есть — синхронно)
    if (!customElements.get(tag))
        return customElements.whenDefined(tag).then(() => ODA.showPopover(el, params, e));
    return new Promise((resolve, reject) => {
        const pop = ODA.createComponent(tag, props);
        if (params.popoverType === 'menu' || params.popoverType === 'dropdown') {
            const src = e?.target ?? (e?.nodeType === 1 ? e : undefined);
            if (!ODA.findPopover(src))
                ODA.dismissToModal();
        }
        pop.setAttribute('popover', 'manual');
        pop.position = e;
        pop.control = el;
        ODA.popovers.push(pop);
        ODA.popoverResolvers.set(pop, { resolve, reject });
        pop.addEventListener('close', ev => ODA.closePopup(pop, ev.detail?.value), { once: true });
        pop.addEventListener('beforetoggle', ev => {
            if (ev.newState === 'closed')
                ODA.closePopup(pop);
        });
        bindCloseFrames();
        document.body.appendChild(pop);
        try {
            pop.showPopover();
        }
        catch {
            // элемент отключён до показа (закрыт синхронно) — снять со стека
            ODA.closePopup(pop);
        }
        pop.async?.(() => pop._show?.());
    });
};
ODA.showModal = function (el, params = {}) {
    return ODA.showPopover(el, { ...params, popoverType: 'modal' });
};
ODA.showDialog = function (el, params = {}) {
    return ODA.showPopover(el, { ...params, popoverType: 'dialog' });
};
ODA.showDropdown = function (el, params = {}, e) {
    return ODA.showPopover(el, { ...params, popoverType: 'dropdown' }, e);
};
/** Меню: содержимое — params.menu или ODA.menuTag (по умолчанию oda-menu-list) с params; результат — выбранный пункт. */
ODA.menuTag ??= 'oda-menu-list';
ODA.showMenu = async function (params = {}, e) {
    if (!params.menu && ODA.menuTag === 'oda-menu-list')
        await import('/oda/components/menus/menu-list/menu-list.js');
    await customElements.whenDefined(ODA.menuTag);
    const menu = params.menu ?? ODA.createComponent(ODA.menuTag, params);
    return ODA.showPopover(menu, { ...params, popoverType: 'menu' }, e);
};
ODA.showConfirm = function (textContent = 'Подтвердить?', params = {}) {
    const el = ODA.createElement('p', { textContent, style: 'margin: var(--space-l);' });
    return ODA.showDialog(el, {
        allowClose: true,
        TITLE: { label: 'Подтверждение' },
        OK: { label: 'Да', icon: 'icons:check', colorMode: 'info-invert' },
        CANCEL: { label: 'Нет', icon: 'icons:close', colorMode: 'info' },
        ...params
    });
};
/** Ввод строки: результат — введённое значение (пусто → отмена). */
ODA.showPrompt = function (label = '', params = {}) {
    const input = ODA.createElement('input', { value: params.value ?? '', placeholder: params.placeholder ?? '' });
    input.style.cssText = 'margin: var(--space-l); padding: var(--control-padding); border: 1px solid var(--control-border-color); border-radius: var(--control-radius); font: inherit;';
    queueMicrotask(() => input.focus());
    return ODA.showDialog(input, {
        allowClose: true,
        TITLE: { label: label || 'Ввод' },
        ...params,
        value: undefined,
        placeholder: undefined
    }).then(() => input.value || Promise.reject(new ODA.CancelError()));
};
