/**
 * $virtual — виртуальный справочник: представление объектов реестра, отобранных
 * состоянием счёта на дату. Своих объектов нет (METADATA.FIELDS пусто), местные поля —
 * в OVERLAY, значения — в overlay.json. Принадлежность определяется только журналом.
 * SOURCE: { registry, account, slot, in?, out?, condition? }.
 */
export default {
    icon: 'carbon:filter',
    label: 'Виртуальный справочник',
    ACCESS: { browse: 'read', overlay_save: 'write' },

    /** Проверенное описание источника из DATA.SOURCE. */
    _sourceDef() {
        const s = this.DATA?.SOURCE || {};
        const registry = String(s.registry || '').trim();
        const account = String(s.account || '').trim();
        const slot = String(s.slot || '').trim();
        if (!registry.startsWith('/') || !account.startsWith('/') || !slot)
            throw new Error('virtual: SOURCE = { registry, account, slot }');
        const condition = String(s.condition || 'positive');
        if (!['positive', 'negative', 'nonzero'].includes(condition))
            throw new Error('virtual: condition — positive|negative|nonzero');
        return { registry, account, slot, in: String(s.in || 'qty_in'), out: String(s.out || 'qty_out'), condition };
    },

    /** День YYYY-MM-DD из входа ('' — не задан). */
    _day(v) {
        const s = String(v ?? '').trim();
        if (!s)
            return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(s))
            return s;
        const t = new Date(/^\d+$/.test(s) ? Number(s) : s);
        if (!Number.isFinite(t.getTime()))
            throw new Error('virtual: плохая дата «' + s + '»');
        return t.toISOString().slice(0, 10);
    },

    /** Класс по пути или null (массив — последний). */
    async _cls(p) {
        let t = null;
        try { t = await WORK.get_item(p); } catch { t = null; }
        if (Array.isArray(t))
            t = t.at(-1);
        return t;
    },

    /**
     * Строки справочника на дату: id реестра с ненулевым сальдо счёта по слоту
     * + объекты реестра + местные расширения.
     * @param {object} [params] {at?, limit?, session}
     * @returns {Promise<Array<{id, name, body, overlay}>>}
     */
    async browse(params = {}) {
        const src = this._sourceDef();
        const at = params.at ? this._day(params.at) : '';
        const limit = Math.max(1, Math.min(2000, Number(params.limit) || 200));
        const reg = await this._cls(src.registry);
        if (!reg || typeof reg.read_object !== 'function' || reg.type !== '$registry')
            throw new Error('virtual: реестр — класс $registry (' + src.registry + ')');
        const acc = await this._cls(src.account);
        if (!acc || typeof acc.index !== 'function' || acc.type !== '$account')
            throw new Error('virtual: счёт — класс $account (' + src.account + ')');
        const slotDef = (acc.METADATA?.FIELDS || []).find(f => f?.id === src.slot && f?.analytic);
        if (!slotDef)
            throw new Error('virtual: слот «' + src.slot + '» не аналитический');
        const idx = (acc.METADATA?.INDEXES || []).find(d => d?.kind === 'turnover' && (d.by || []).includes(src.slot));
        if (!idx)
            throw new Error('virtual: нет оборота по слоту «' + src.slot + '»');
        const q = { id: idx.id, limit, session: params.session };
        if (at)
            q.to = at + 'T12:00:00';
        const res = await acc.index(q);
        const ids = [];
        for (const r of res?.rows || []) {
            const id = r.fields?.[src.slot];
            if (!id || ids.includes(id))
                continue;
            const net = (Number(r[src.in]) || 0) - (Number(r[src.out]) || 0);
            if (src.condition === 'positive' && !(net > 0))
                continue;
            if (src.condition === 'negative' && !(net < 0))
                continue;
            if (src.condition === 'nonzero' && !net)
                continue;
            ids.push(id);
            if (ids.length >= limit)
                break;
        }
        let over = {};
        try { over = await this.overlay_read(params); } catch { over = {}; }
        const rows = [];
        for (const id of ids) {
            let rec = null;
            try { rec = await reg.read_object({ id, session: params.session }); }
            catch { continue; }
            if (!rec?.body || rec.body.deleted)
                continue;
            rows.push({ id, name: rec.body.name ?? id, body: rec.body, overlay: over[id] || {} });
        }
        return rows;
    },

    /**
     * Сохранить местные расширения объекта ({id, fields}): ключи — только из OVERLAY схемы.
     * @param {object} [params]
     * @param {object} [post] {id, fields}
     */
    async overlay_save(params = {}, post) {
        let body = post ?? params.post;
        if (typeof body === 'string')
            body = JSON.parse(body || '{}');
        const fields = body?.fields;
        if (!body?.id || !fields || typeof fields !== 'object' || Array.isArray(fields))
            throw new Error('overlay_save: нужно {id, fields}');
        const schema = Array.isArray(this.DATA?.OVERLAY) ? this.DATA.OVERLAY : [];
        const known = new Set(schema.map(f => f?.id));
        for (const k of Object.keys(fields)) {
            if (!known.has(k))
                throw new Error('overlay_save: нет поля «' + k + '»');
        }
        return this.overlay_write(params, { id: body.id, fields });
    },
}
