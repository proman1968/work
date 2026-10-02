/**
 * Регрессия «Ничего не открывается»: страница формы грузит `~/handlers//form`,
 * тильда отдаёт массив одноимённых `form`, среди которых последним идёт
 * контейнер видов из distributive (тип $folder). Брать надо последний $handler.
 */
import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickTildeSingle } from '../sources/host/http-server.js';

const node = (path, type) => ({ path, id: 'form', type });

describe('pickTildeSingle', () => {
    it('последний $handler, а не хвостовой контейнер distributive', () => {
        const items = [
            node('/REGISTER/62/$account/$folder/handlers/pages/form', '$handler'),
            node('/REGISTER/62/$account/$folder/$class/handlers/pages/form', '$handler'),
            node('/REGISTER/62/$account/$folder/$class/$account/handlers/pages/form', '$folder'),
        ];
        assert.equal(pickTildeSingle(items), items[1]);
    });

    it('без хендлеров — как раньше (.last)', () => {
        const items = [node('/a/form', '$folder'), node('/b/form', '$folder')];
        assert.equal(pickTildeSingle(items), items[1]);
        assert.equal(pickTildeSingle([]), undefined);
    });
});
