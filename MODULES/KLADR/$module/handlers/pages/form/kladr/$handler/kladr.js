export default {
    imports: 'oda//button, oda//icon',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                padding: 16px 20px;
                gap: 14px;
                overflow-y: auto;
                background: var(--content-background);
                color: var(--content-color);
                font-size: 13px;
            }
            .card {
                padding: 14px 16px;
                border: 1px solid var(--subtle-border);
                border-radius: 8px;
                background: var(--subtle-background);
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .row {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            input, select {
                padding: 6px 10px;
                border: 1px solid var(--control-border-color);
                border-radius: 6px;
                background: var(--control-background);
                color: var(--control-color);
                font: inherit;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
            }
            th, td {
                border: 1px solid var(--subtle-border);
                padding: 6px 10px;
                text-align: left;
            }
            th {
                background: var(--subtle-background);
            }
            .ok { color: #15803d; font-weight: 600; }
            .err { color: var(--error-color, #dc2626); }
        </style>

        <div class="card">
            <div class="row" style="justify-content:space-between;">
                <div class="row">
                    <oda-icon icon="carbon:map-boundary" icon-size="22"></oda-icon>
                    <b style="font-size:15px;">Адресный классификатор РФ (КЛАДР) и подразделения МВД</b>
                </div>
                <div class="row">
                    <oda-button icon="icons:cloud-download" :disabled="busy" @tap="seedBase()">{{busy ? 'Загрузка…' : 'Загрузить 89 регионов и МВД в БД'}}</oda-button>
                </div>
            </div>
            <div ~if="statusMsg" class="ok">{{statusMsg}}</div>
            <div ~if="errMsg" class="err">{{errMsg}}</div>
        </div>

        <div class="card">
            <div class="row">
                <select ::value="kind" @change="search()">
                    <option value="region">Регионы РФ (89 субъектов)</option>
                    <option value="city">Административные центры и города</option>
                    <option value="mvd">Подразделения МВД (код XXX-XXX)</option>
                </select>
                <input type="text" placeholder="Поиск по коду (770-001, 62) или названию…" ::value="query" @input="search()" style="flex:1;min-width:240px;">
                <oda-button icon="icons:search" @tap="search()">Найти</oda-button>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width:120px;">Код</th>
                        <th>Наименование</th>
                        <th style="width:180px;">Доп. сведения</th>
                    </tr>
                </thead>
                <tbody>
                    <tr ~for="rows">
                        <td><code>{{$for.item.code || $for.item.region_code}}</code></td>
                        <td>{{$for.item.name}}</td>
                        <td>{{$for.item.capital || $for.item.regionName || ($for.item.region_code ? 'Регион ' + $for.item.region_code : '')}} {{$for.item.postcode || ''}}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `,
    kind: 'mvd',
    query: '',
    rows: [],
    busy: false,
    statusMsg: '',
    errMsg: '',
    attached() {
        this.search();
    },
    async search() {
        this.errMsg = '';
        try {
            const res = await this.$item.fetch('kladr_search', { kind: this.kind, query: this.query, limit: 100 });
            this.rows = Array.isArray(res?.items) ? res.items : [];
        }
        catch (e) {
            this.errMsg = String(e?.message || e);
        }
    },
    async seedBase() {
        if (this.busy)
            return;
        this.busy = true;
        this.statusMsg = '';
        this.errMsg = '';
        try {
            const res = await this.$item.fetch('kladr_seed_base', {});
            this.statusMsg = `Загружено в БД (${res.prefix}): регионов +${res.regionsAdded}, городов +${res.citiesAdded}, подразделений МВД +${res.mvdAdded}.`;
        }
        catch (e) {
            this.errMsg = String(e?.message || e);
        }
        finally {
            this.busy = false;
        }
    },
};
