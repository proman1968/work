/**
 * $register — журнал проводок: записи по entry из листьев $account поддерева.
 * journal собирает пары Дт/Кт (общий entry + rule), фильтры — период, счёт,
 * операция. Источник правды — файлы записей, нового хранения нет.
 */
export default {
    ACCESS: { journal: 'read', sheet: 'read' },

    /** Прямые дочерние классы (любой тип) — опора обхода, не API. */
    async _childClasses(cls) {
        let items = [];
        try { items = (await cls.items) || []; } catch { items = []; }
        return (Array.isArray(items) ? items : []).filter(k => k && typeof k.query === 'function' && k.type);
    },

    /** Листья $account под журналом, видимые пользователю. */
    async _accountLeaves(params = {}) {
        const leaves = [];
        const visit = async (cls) => {
            const kids = (await this._childClasses(cls)).filter(k => k.type === '$account');
            if (!kids.length) {
                if (cls.type === '$account') {
                    let see = false;
                    try { see = await cls.canSee(cls, params); } catch { see = false; }
                    if (see)
                        leaves.push(cls);
                }
                return;
            }
            for (const k of kids)
                await visit(k);
        };
        for (const k of await this._childClasses(this)) {
            if (k.type === '$account')
                await visit(k);
        }
        return leaves;
    },

    /** Имя операции по source `/ОПЕРАЦИИ/…/<id>` — без прав виден id. */
    async _sourceName(source, params = {}) {
        const id = String(source || '').split('/').pop() || '';
        const i = String(source || '').lastIndexOf('/');
        if (i <= 0)
            return id;
        try {
            let cls = await WORK.get_item(String(source).slice(0, i));
            if (Array.isArray(cls))
                cls = cls.at(-1);
            if (!cls || typeof cls.read_object !== 'function')
                return id;
            const rec = await cls.read_object({ id, session: params.session });
            return rec?.body?.name || id;
        }
        catch { return id; }
    },

    /**
     * Журнал проводок: по одной строке на пару (entry, rule).
     * @param {object} [params] {from?, to?, account?, source?, limit?, session}
     * @returns {Promise<Array>} [{entry, rule, time, source, op, debit_account, debit_label,
     * credit_account, credit_label, sum, storno, n}]
     */
    async journal(params = {}) {
        const limit = Math.max(1, Math.min(2000, Number(params.limit) || 200));
        const account = String(params.account || '').trim();
        const source = String(params.source || '').trim();
        const q = { order: 'desc', limit: 500 };
        if (params.session)
            q.session = params.session;
        if (params.from != null && params.from !== '')
            q.from = params.from;
        if (params.to != null && params.to !== '')
            q.to = params.to;
        const groups = new Map();
        const labels = new Map();
        for (const leaf of await this._accountLeaves(params)) {
            if (account && !(leaf.path === account || leaf.path.startsWith(account + '/')))
                continue;
            try {
                await leaf.init;
                labels.set(leaf.path, leaf.DATA?.label || leaf.id);
            }
            catch { labels.set(leaf.path, leaf.id); }
            let found = [];
            try { found = await leaf.query(q); }
            catch { continue; }
            for (const r of found || []) {
                const b = r.body || {};
                if (source && !String(b.source || '').includes(source))
                    continue;
                const key = (b.entry || r.path) + '¦' + (b.rule || '');
                let g = groups.get(key);
                if (!g) {
                    g = { entry: b.entry || '', rule: b.rule || '', time: 0, source: b.source || '',
                        sum: 0, storno: false, n: 0, debit_account: '', credit_account: '' };
                    groups.set(key, g);
                }
                g.n++;
                const t = Number(b.time) || 0;
                if (t > g.time)
                    g.time = t;
                if (b.storno) {
                    g.storno = true;
                    continue;
                }
                if (Number(b.debit) > 0) {
                    g.debit_account = leaf.path;
                    g.sum = Number(b.debit);
                }
                if (Number(b.credit) > 0) {
                    g.credit_account = leaf.path;
                    g.sum = Number(b.credit);
                }
            }
        }
        const names = {};
        for (const g of groups.values()) {
            if (!g.source || names[g.source] !== undefined)
                continue;
            names[g.source] = await this._sourceName(g.source, params);
        }
        const rows = [...groups.values()].map(g => ({
            entry: g.entry, rule: g.rule, time: g.time, source: g.source,
            op: names[g.source] ?? g.source,
            debit_account: g.debit_account,
            debit_label: labels.get(g.debit_account) || g.debit_account,
            credit_account: g.credit_account,
            credit_label: labels.get(g.credit_account) || g.credit_account,
            sum: g.sum, storno: g.storno, n: g.n,
        }));
        rows.sort((a, b) => (b.time - a.time) || String(b.entry).localeCompare(String(a.entry)));
        return rows.slice(0, limit);
    },

    /** День YYYY-MM-DD → локальный полдень (одинаково режется индексом и сканом в любом поясе). */
    _noon(day) {
        return day ? day + 'T12:00:00' : undefined;
    },

    /** Нормализовать вход в день YYYY-MM-DD ('' — не задан). */
    _day(v) {
        const s = String(v ?? '').trim();
        if (!s)
            return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(s))
            return s;
        const t = new Date(/^\d+$/.test(s) ? Number(s) : s);
        if (!Number.isFinite(t.getTime()))
            throw new Error('sheet: плохая дата «' + s + '»');
        return t.toISOString().slice(0, 10);
    },

    _dayBefore(day) {
        const [y, m, d] = day.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    },

    /** Обороты листа за период: из turnover-индекса, иначе (или при устаревшем) — из файлов. */
    async _leafSum(leaf, from, to) {
        const sys = { session: { $user: WORK } };
        const def = (leaf.METADATA?.INDEXES || []).find(d => d?.kind === 'turnover' && !d.off
            && d.measures?.debit && d.measures?.credit);
        const range = { from: this._noon(from), to: this._noon(to) };
        if (def) {
            try {
                const r = await leaf.index({ ...sys, id: def.id, ...range });
                return { debit: Number(r.total?.debit) || 0, credit: Number(r.total?.credit) || 0 };
            }
            catch { /* устарел — читаем файлы */ }
        }
        const s = await leaf._sumData(range);
        return { debit: s.debit, credit: s.credit };
    },

    /**
     * Оборотно-сальдовая ведомость: по счетам (листья и их предки до журнала)
     * сальдо на начало, обороты Дт/Кт, сальдо на конец. Сальдо узла — сумма сальдо листьев
     * (свёрнуто, знак — сторона). Видны только доступные счета; пустые строки скрыты (all: true — показать).
     * @param {object} [params] {from?, to?, account?, all?, session}
     * @returns {Promise<{from, to, rows: Array, total: object}>}
     */
    async sheet(params = {}) {
        const from = this._day(params.from);
        const to = this._day(params.to);
        const account = String(params.account || '').trim();
        const nodes = new Map();
        const labelOf = async (p) => {
            try {
                let t = await WORK.get_item(p);
                if (Array.isArray(t))
                    t = t.at(-1);
                await t.init;
                return t.DATA?.label || t.id;
            }
            catch { return p.split('/').pop(); }
        };
        const node = async (p, level) => {
            let n = nodes.get(p);
            if (!n) {
                n = { path: p, label: await labelOf(p), level, leaf: false, open: 0, debit: 0, credit: 0 };
                nodes.set(p, n);
            }
            return n;
        };
        for (const leaf of await this._accountLeaves(params)) {
            if (account && !(leaf.path === account || leaf.path.startsWith(account + '/')))
                continue;
            const opening = from ? await this._leafSum(leaf, '', this._dayBefore(from)) : { debit: 0, credit: 0 };
            const period = await this._leafSum(leaf, from, to);
            const open = opening.debit - opening.credit;
            const own = await node(leaf.path, leaf.path.split('/').length - this.path.split('/').length - 1);
            own.leaf = true;
            let p = leaf.path;
            while (p && p !== this.path) {
                const n = p === leaf.path ? own : await node(p, p.split('/').length - this.path.split('/').length - 1);
                n.open += open;
                n.debit += period.debit;
                n.credit += period.credit;
                p = p.slice(0, p.lastIndexOf('/'));
            }
        }
        const split = (net) => ({ debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
        const segs = (p) => p.split('/');
        const cmp = (a, b) => {
            const x = segs(a.path), y = segs(b.path);
            for (let i = 0; i < Math.min(x.length, y.length); i++) {
                const c = x[i].localeCompare(y[i], 'ru', { numeric: true });
                if (c)
                    return c;
            }
            return x.length - y.length;
        };
        const rows = [];
        const total = { open: 0, debit: 0, credit: 0 };
        for (const n of [...nodes.values()].sort(cmp)) {
            const close = n.open + n.debit - n.credit;
            if (!params.all && !n.open && !n.debit && !n.credit && !close)
                continue;
            const o = split(n.open), c = split(close);
            rows.push({
                path: n.path, label: n.label, level: n.level, leaf: n.leaf,
                open_debit: o.debit, open_credit: o.credit,
                debit: n.debit, credit: n.credit,
                close_debit: c.debit, close_credit: c.credit,
            });
            if (n.level === 0) {
                total.open += n.open;
                total.debit += n.debit;
                total.credit += n.credit;
            }
        }
        const to0 = split(total.open), tc = split(total.open + total.debit - total.credit);
        return {
            from, to, rows,
            total: {
                open_debit: to0.debit, open_credit: to0.credit,
                debit: total.debit, credit: total.credit,
                close_debit: tc.debit, close_credit: tc.credit,
            },
        };
    },
}
