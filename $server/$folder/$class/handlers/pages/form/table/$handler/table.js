function fmtTime(t) {
    if (t == null)
        return '';
    return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function logName(row) {
    const p = row?.path || row?.logsFilePath || '';
    const seg = String(p).split('/').pop();
    if (seg && seg !== '.logs')
        return seg;
    return row?.name || String(row?.time ?? '');
}

export default {
    imports: 'oda//app-layout, oda//tree',
    template: /* html */ `
        <style>
            :host {
                @apply --horizontal;
                @apply --flex;
            }
        </style>
        <app-tabs accent-invert no-flex :items="tabItems" :horizontal="mobile" ::focused-index>
        </app-tabs>
        <oda-tree ~if="loading || logItems?.length" flex show-header :items="logItems" :columns="columns" :label="'Файл'"></oda-tree>
        <div ~if="!loading && !logItems?.length" flex style="align-items: center; justify-content: center; opacity: .5;">Нет логов выбранного типа</div>
    `,
    focusedIndex: {
        $def: 0,
        $save: true,
        set() {
            this.reload();
        },
    },
    /** Базовые колонки (Время, Автор). false — быстро убрать их в коде. */
    showBasicColumns: {
        $def: true,
        set() {
            this.reload();
        },
    },
    columns: [],
    logItems: [],
    loading: false,
    get dataTypes() {
        if (this._types)
            return this._types;
        const types = this.$item?.data_types;
        if (types instanceof Promise) {
            types.then(list => {
                this.dataTypes = Array.isArray(list) ? list : [];
            });
            return [];
        }
        return Array.isArray(types) ? types : [];
    },
    set dataTypes(list) {
        this._types = Array.isArray(list) ? list : [];
        this.reload();
    },
    get tabItems() {
        return this.dataTypes.map((el, i) => {
            const item = {};
            item.label = el.label || '';
            item.icon = el.icon || '';
            return item;
        }) || []
    },
    get mobile() {
        return ODA.states.mobileMode;
    },
    get currentType() {
        return this.dataTypes?.[this.focusedIndex];
    },
    async attached() {
        if (this.$item?.data_types instanceof Promise)
            this.dataTypes = await this.$item.data_types;
        this.reload();
    },
    reload() {
        this._reloadToken = (this._reloadToken || 0) + 1;
        this._reload(this._reloadToken);
    },
    async _reload(token) {
        const type = this.currentType;
        const $item = this.$item;
        if (!type || !$item) {
            this.columns = [];
            this.logItems = [];
            this.loading = false;
            return;
        }
        this.loading = true;
        try {
            const fields = await this._fieldsOf(type);
            if (token !== this._reloadToken)
                return;
            this.columns = this._buildColumns(fields);
            const ext = String(type.id || '').replace(/^\$/, '').toLowerCase();
            let dates = [];
            try {
                dates = await $item.logs({ mode: 'dates' }) || [];
            }
            catch { /* нет журнала */ }
            if (token !== this._reloadToken)
                return;
            const rows = [];
            for (const day of dates) {
                try {
                    const dayRows = await $item.read_log_bodies({ day, ext }) || [];
                    rows.push(...dayRows);
                }
                catch { /* skip */ }
            }
            if (token !== this._reloadToken)
                return;
            this.logItems = this._groupByDay(rows, fields);
        }
        catch (e) {
            console.warn('[table] reload:', e?.message || e);
            this.logItems = [];
        }
        finally {
            this.loading = false;
        }
    },
    async _fieldsOf(type) {
        try {
            const root = await type?.$fields;
            const list = root?.fields || (Array.isArray(root) ? root : []) || [];
            return list.filter(f => f?.id);
        }
        catch {
            return [];
        }
    },
    _buildColumns(fields) {
        const cols = [];
        if (this.showBasicColumns) {
            cols.push({ id: 'Время', template: 'form-table-cell' });
            cols.push({ id: 'Автор', template: 'form-table-cell' });
        }
        for (const f of fields || [])
            cols.push({ id: f.label || f.id, template: 'form-table-cell' });
        return cols;
    },
    _groupByDay(rows, fields) {
        const byDay = Object.create(null);
        for (const row of rows || []) {
            const arr = byDay[row.day] || (byDay[row.day] = []);
            arr.push(this._toRow(row, fields));
        }
        return Object.keys(byDay).sort((a, b) => a.localeCompare(b)).map(day => ({
            id: day,
            expanded: true,
            items: byDay[day],
        }));
    },
    _toRow(row, fields) {
        let body = {};
        if (row?.content != null) {
            if (typeof row.content === 'string') {
                try {
                    const parsed = JSON.parse(row.content);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                        body = parsed;
                }
                catch { /* не JSON */ }
            }
            else if (typeof row.content === 'object')
                body = row.content;
        }
        const out = { id: logName(row) };
        if (this.showBasicColumns) {
            out['Время'] = fmtTime(row?.time);
            out['Автор'] = row?.sender || '';
        }
        for (const f of fields || []) {
            const key = f.label || f.id;
            const v = body[f.id];
            out[key] = v ?? '';
        }
        return out;
    },
}

/** Текстовая ячейка таблицы логов: показывает value по колонке из row. */
ODA({
    is: 'form-table-cell',
    template: /* html */ `
        <style>
            :host {
                box-sizing: border-box;
                border-left: 1px solid var(--header-background);
                min-width: 10px;
                overflow: hidden;
                height: 100%;
                align-items: center;
                @apply --horizontal;
                @apply --no-flex;
            }
            span {
                margin: 4px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        </style>
        <span flex :title="String(text)">{{text}}</span>
    `,
    get text() {
        const v = this.row?.[this.col?.id];
        return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    },
    row: null,
    col: null,
});