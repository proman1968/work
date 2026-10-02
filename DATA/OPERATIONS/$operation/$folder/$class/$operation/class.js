/**
 * $operation — тип операций: факты деятельности и правила разноски по счетам.
 *
 * Класс операции описывает свои поля в METADATA.FIELDS (ссылки на справочники —
 * type: 'Link', catalog) и разноску в METADATA.POSTINGS:
 * [{ id, amount, quantity?, debit: { account, analytics: { слот: поле } },
 *    credit: { account, analytics } }].
 * Разноска — post({ id }), отмена — unpost({ id }); REPOST: 'storno' | 'replace'.
 */
export default {
    icon: 'carbon:operations',
    label: 'Операция',
    ACCESS: { post: 'write', unpost: 'write' },

    /** Класс счёта для проводки: существует, тип $account, лист. */
    async _postingAccount(accountPath) {
        let acc = await WORK.get_item(accountPath);
        if (Array.isArray(acc))
            acc = acc.at(-1);
        if (!acc || typeof acc.create_object !== 'function' || acc.type !== '$account')
            throw new Error('post: нет счёта ' + accountPath);
        if ((await acc._ownSameTypeChildren()).length)
            throw new Error('post: счёт не лист ' + accountPath);
        return acc;
    },

    /** Проверка связки «слот счёта ← поле операции»: слот задан, поле — Link на тот же справочник. */
    _checkSide(accountCls, side, opFields) {
        const slots = (accountCls.METADATA?.FIELDS || []).filter(f => f?.analytic);
        const map = (side && side.analytics) || {};
        const out = {};
        for (const slot of slots) {
            const fieldId = map[slot.id];
            if (!fieldId)
                throw new Error('post: слот «' + slot.id + '» счёта ' + accountCls.path + ' не задан в правиле');
            const field = (opFields || []).find(f => f?.id === fieldId);
            if (!field || field.type !== 'Link')
                throw new Error('post: поле «' + fieldId + '» не Link');
            if (field.catalog !== slot.catalog)
                throw new Error('post: «' + fieldId + '» ссылается на ' + field.catalog + ', а слот ждёт ' + slot.catalog);
            out[slot.id] = fieldId;
        }
        return out;
    },

    /** Значение суммы/количества: число или имя поля операции. */
    _ruleVal(spec, body, what) {
        if (spec == null || spec === '')
            throw new Error('post: нет ' + what + ' в правиле');
        if (typeof spec === 'number')
            return spec;
        const v = Number(body?.[spec]);
        if (!Number.isFinite(v))
            throw new Error('post: нет числа ' + what + ' (поле «' + spec + '»)');
        return v;
    },

    /**
     * Провести операцию: 2×N проводок по счетам.
     * @param {object} [params] {id, session}
     */
    async post(params = {}) {
        await this._assertDataWrite({ session: params.session });
        const id = String(params.id || '');
        if (!id)
            throw new Error('post: нужен id операции');
        const op = await this.read_object({ id, session: params.session });
        if (op.body.deleted)
            throw new Error('post: операция удалена');
        if (op.body.posted)
            await this.unpost({ id, session: params.session });
        const rules = this.METADATA?.POSTINGS;
        if (!Array.isArray(rules) || !rules.length)
            throw new Error('post: нет METADATA.POSTINGS');
        const opFields = this.METADATA?.FIELDS || [];
        const sys = { session: { $user: WORK } };
        const entry = Date.now() + '.' + Math.random().toString(36).slice(2, 8);
        const plan = [];
        for (const r of rules) {
            if (!r?.id || !r.debit?.account || !r.credit?.account)
                throw new Error('post: плохое правило ' + JSON.stringify(r?.id));
            const D = await this._postingAccount(r.debit.account);
            const C = await this._postingAccount(r.credit.account);
            const dSlots = this._checkSide(D, r.debit, opFields);
            const cSlots = this._checkSide(C, r.credit, opFields);
            plan.push({ r, D, C, dSlots, cSlots });
        }
        const made = [];
        try {
            for (const { r, D, C, dSlots, cSlots } of plan) {
                const sum = this._ruleVal(r.amount, op.body, 'суммы');
                const qty = r.quantity == null || r.quantity === '' ? 0 : this._ruleVal(r.quantity, op.body, 'количества');
                const base = { source: this.path + '/' + id, entry, rule: r.id, time: op.body.time, name: op.body.name };
                const fill = (slots, body) => {
                    const o = {};
                    for (const [slot, field] of Object.entries(slots)) {
                        const v = body[field];
                        if (v == null || v === '')
                            throw new Error('post: нет значения аналитики «' + slot + '»');
                        o[slot] = v;
                    }
                    return o;
                };
                const d = await D.create_object({ ...sys, post: {
                    ...base, corr_account: C.path,
                    debit: sum, credit: 0, qty_in: qty, qty_out: 0,
                    ...fill(dSlots, op.body),
                } });
                made.push({ cls: D, id: d.id, path: d.logFullPath || d.path });
                const c = await C.create_object({ ...sys, post: {
                    ...base, corr_account: D.path,
                    debit: 0, credit: sum, qty_in: 0, qty_out: qty,
                    ...fill(cSlots, op.body),
                } });
                made.push({ cls: C, id: c.id, path: c.logFullPath || c.path });
            }
        }
        catch (e) {
            for (const m of made) {
                try {
                    await m.cls.delete_object({ ...sys, id: m.id });
                }
                catch { /* уже убрано */ }
            }
            throw e;
        }
        await this.update_object({ ...sys, id, post: { posted: { entry, records: made.map(m => m.cls.path + '/' + m.id) } } });
        return this.save_message({ session: params.session, message: 'Проведено: ' + (op.body.name || id) + ' (' + made.length + ')', includes: made.map(m => m.path).filter(Boolean) });
    },

    /**
     * Отменить разноску: storno (зеркальные записи с минусом) или replace (удаление записей).
     * @param {object} [params] {id, mode?, session}
     */
    async unpost(params = {}) {
        await this._assertDataWrite({ session: params.session });
        const id = String(params.id || '');
        if (!id)
            throw new Error('unpost: нужен id операции');
        const op = await this.read_object({ id, session: params.session });
        const posted = op.body.posted;
        if (!posted)
            return { unposted: false };
        const sys = { session: { $user: WORK } };
        const mode = params.mode || this.REPOST || 'storno';
        for (const ref of posted.records || []) {
            const i = String(ref).lastIndexOf('/');
            const clsPath = String(ref).slice(0, i);
            const recId = String(ref).slice(i + 1);
            let cls = await WORK.get_item(clsPath);
            if (Array.isArray(cls))
                cls = cls.at(-1);
            if (!cls || typeof cls.read_object !== 'function')
                continue;
            if (mode === 'replace') {
                try {
                    await cls.delete_object({ ...sys, id: recId });
                }
                catch { /* уже нет */ }
                continue;
            }
            let rec;
            try {
                rec = await cls.read_object({ ...sys, id: recId });
            }
            catch { continue; }
            if (rec.body.deleted)
                continue;
            await cls.create_object({ ...sys, post: {
                ...rec.body, storno: true,
                debit: -(Number(rec.body.debit) || 0), credit: -(Number(rec.body.credit) || 0),
                qty_in: -(Number(rec.body.qty_in) || 0), qty_out: -(Number(rec.body.qty_out) || 0),
            } });
        }
        await this.update_object({ ...sys, id, post: { posted: null } });
        return { unposted: true, mode };
    },
}
