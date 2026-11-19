/**
 * oda-tabs: список открытых вкладок (шеврон в правом углу полосы вкладок) и контекстное меню вкладки.
 * В приложении ODA.menuTag подменён на item-menu (контекстное меню WORK), которое плоский
 * список items не рисует — окно открывалось пустым (затемнялся только фон). Поэтому меню
 * вкладок обязано само создавать oda-menu-list.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '../oda/components/layouts/tabs/tabs.js');
const defs = [];
const fakeODA = (d) => { defs.push(d); return d; };
new Function('ODA', fs.readFileSync(SRC, 'utf-8'))(fakeODA);

const host = defs.find(d => d.is === 'oda-tabs');

function mountTabs(items = [{ label: 'Журнал' }, { label: 'Qwen3.8-Flash-Next', dirty: true }]) {
    const inst = Object.create(host);
    Object.assign(inst, {
        items: items.map(i => ({ ...i })),
        focusedIndex: 1,
        allowList: true,
        allowClose: false,
        allowContextMenu: true,
    });
    return inst;
}

function withMenuSpies(fn) {
    const created = [];
    let shown = null;
    fakeODA.menuTag = 'item-menu';
    fakeODA.createComponent = (id, props) => { const el = { id, ...props }; created.push(el); return el; };
    fakeODA.showMenu = async (params, anchor) => { shown = { params, anchor }; };
    return Promise.resolve()
        .then(() => fn(created, () => shown))
        .finally(() => {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
            delete fakeODA.menuTag;
        });
}

describe('oda-tabs: меню открытых вкладок', () => {
    it('шеврон открывает явный oda-menu-list, а не item-menu (иначе пустое окно)', async () => {
        const inst = mountTabs();
        const anchor = { tagName: 'ODA-BUTTON' };
        let shown;
        await withMenuSpies((created, getShown) => inst.openTabsMenu({ currentTarget: anchor }).then(() => {
            shown = getShown();
            assert.equal(created.length, 1, 'меню создано один раз');
            assert.equal(created[0].id, 'oda-menu-list');
        }));
        assert.deepEqual(shown.params.menu.items.map(i => i.label), ['Журнал', '● Qwen3.8-Flash-Next']);
        assert.equal(shown.params.menu.value, 1, 'текущая вкладка отмечена');
        assert.equal(shown.anchor, anchor);
    });

    it('пункт меню выбирает вкладку, а «Закрыть все» виден только при закрываемых вкладках', async () => {
        const inst = mountTabs();
        const selected = [];
        inst.selectTab = (idx) => selected.push(idx);
        inst.closeAll = () => selected.push('all');
        await withMenuSpies(async (created) => {
            await inst.openTabsMenu({ currentTarget: { tagName: 'ODA-BUTTON' } });
            const items = created[0].items;
            assert.equal(items.length, 2, 'без closable — только сами вкладки');
            items[0].execute();
            assert.deepEqual(selected, [0]);
        });

        const closableTabs = mountTabs();
        closableTabs.items.forEach(i => { i.closable = true; });
        closableTabs.selectTab = () => {};
        let closedAll = false;
        closableTabs.closeAll = () => { closedAll = true; };
        await withMenuSpies(async (created) => {
            await closableTabs.openTabsMenu({ currentTarget: { tagName: 'ODA-BUTTON' } });
            const items = created[0].items;
            const all = items.find(i => i.value === '__close_all__');
            assert.ok(all, 'пункт «Закрыть все»');
            all.execute();
            assert.equal(closedAll, true);
        });
    });

    it('контекстное меню вкладки тоже рисуется oda-menu-list', async () => {
        const inst = mountTabs();
        inst.items.forEach(i => { i.closable = true; });
        const e = { clientX: 10, clientY: 20, preventDefault() {}, stopPropagation() {} };
        let shown;
        await withMenuSpies(async (created, getShown) => {
            await inst._openTabContextMenu(1, e);
            shown = getShown();
            assert.equal(created[0].id, 'oda-menu-list');
        });
        const values = shown.params.menu.items.map(i => i.value);
        assert.deepEqual(values, ['close', 'others', 'right', 'all']);
    });
});
