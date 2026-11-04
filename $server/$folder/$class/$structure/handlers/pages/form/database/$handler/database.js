export default {
    imports: 'oda//button, oda//icon',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
                background: var(--content-background);
                color: var(--content-color);
                font-size: 13px;
                box-sizing: border-box;
            }
            .top-bar {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 8px 14px;
                border-bottom: 1px solid var(--border-color);
                background: var(--subtle-background);
                flex-wrap: wrap;
                flex-shrink: 0;
            }
            .top-left, .top-right {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .db-select {
                padding: 5px 10px;
                border-radius: 6px;
                border: 1px solid var(--control-border-color, var(--border-color));
                background: var(--content-background);
                color: var(--content-color);
                font: inherit;
                font-weight: 600;
                min-width: 240px;
            }
            .db-badge {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 4px 10px;
                border-radius: 6px;
                background: var(--content-background);
                border: 1px solid var(--border-color);
                font-size: 12px;
            }
            .db-badge b {
                font-weight: 600;
            }
            .mode-tabs {
                @apply --horizontal;
                gap: 4px;
                background: var(--content-background);
                padding: 2px;
                border-radius: 8px;
                border: 1px solid var(--border-color);
            }
            .mode-tab {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 4px 10px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                user-select: none;
                color: var(--content-color);
            }
            .mode-tab:hover {
                background: var(--subtle-background);
            }
            .mode-tab.active {
                background: var(--accent-color);
                color: var(--accent-back);
                fill: var(--accent-back);
            }
            .workspace {
                @apply --horizontal;
                @apply --flex;
                overflow: hidden;
                min-height: 0;
            }
            .sidebar {
                @apply --vertical;
                width: 260px;
                min-width: 220px;
                max-width: 320px;
                border-right: 1px solid var(--border-color);
                background: var(--subtle-background);
                flex-shrink: 0;
                overflow: hidden;
            }
            .sidebar-head {
                @apply --vertical;
                gap: 6px;
                padding: 8px 10px;
                border-bottom: 1px solid var(--border-color);
            }
            .sidebar-search {
                width: 100%;
                box-sizing: border-box;
                padding: 5px 8px;
                border: 1px solid var(--border-color);
                border-radius: 6px;
                background: var(--content-background);
                color: var(--content-color);
                font: inherit;
                font-size: 12px;
            }
            .table-list {
                @apply --vertical;
                @apply --flex;
                overflow-y: auto;
                padding: 6px;
                gap: 3px;
            }
            .table-item {
                @apply --vertical;
                gap: 2px;
                padding: 7px 9px;
                border-radius: 6px;
                cursor: pointer;
                border: 1px solid transparent;
                transition: background .12s;
            }
            .table-item:hover {
                background: var(--content-background);
                border-color: var(--border-color);
            }
            .table-item.active {
                background: var(--accent-soft);
                border-color: var(--accent-color);
            }
            .table-item-top {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
            }
            .table-name {
                font-weight: 700;
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 12.5px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .table-count {
                font-size: 11px;
                font-weight: 600;
                padding: 1px 6px;
                border-radius: 10px;
                background: var(--content-background);
                border: 1px solid var(--border-color);
                flex-shrink: 0;
            }
            .table-desc {
                font-size: 11px;
                opacity: 0.72;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .main-area {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
                min-width: 0;
            }
            .table-toolbar {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 8px 12px;
                border-bottom: 1px solid var(--border-color);
                background: var(--content-background);
                flex-wrap: wrap;
                flex-shrink: 0;
            }
            .table-title-wrap {
                @apply --vertical;
                gap: 2px;
                min-width: 0;
            }
            .table-title-row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .table-title {
                font-size: 15px;
                font-weight: 700;
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            }
            .chip {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 7px;
                border-radius: 10px;
                font-size: 11px;
                font-weight: 600;
                background: var(--subtle-background);
                border: 1px solid var(--border-color);
            }
            .chip.pk {
                border-color: var(--accent-color);
                color: var(--accent-color);
                background: var(--accent-soft);
            }
            .chip.filter-chip {
                background: var(--accent-soft);
                border-color: var(--accent-color);
                cursor: pointer;
            }
            .search-input {
                padding: 5px 10px;
                border: 1px solid var(--border-color);
                border-radius: 6px;
                background: var(--subtle-background);
                color: var(--content-color);
                font: inherit;
                min-width: 210px;
            }
            .btn {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 5px 10px;
                border-radius: 6px;
                border: 1px solid var(--border-color);
                background: var(--subtle-background);
                color: var(--content-color);
                font: inherit;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                user-select: none;
            }
            .btn:hover:not([disabled]) {
                border-color: var(--accent-color);
                background: var(--accent-soft);
            }
            .btn.primary {
                background: var(--accent-color);
                border-color: var(--accent-color);
                color: var(--accent-back);
            }
            .btn.danger {
                color: var(--error-color, #dc2626);
                border-color: var(--error-color, #dc2626);
            }
            .btn[disabled] {
                opacity: 0.45;
                cursor: default;
            }
            .content-split {
                @apply --horizontal;
                @apply --flex;
                overflow: hidden;
                min-height: 0;
            }
            .grid-wrap {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
                min-width: 0;
            }
            table.sql-grid {
                width: 100%;
                border-collapse: collapse;
                font-size: 12.5px;
            }
            table.sql-grid th {
                position: sticky;
                top: 0;
                z-index: 2;
                background: var(--subtle-background);
                border-bottom: 1px solid var(--border-color);
                border-right: 1px solid var(--border-color);
                padding: 6px 8px;
                text-align: left;
                white-space: nowrap;
                user-select: none;
            }
            table.sql-grid tr.filter-row th {
                top: 31px;
                z-index: 2;
                padding: 3px 5px;
                background: var(--subtle-background);
            }
            .col-filter-input {
                width: 100%;
                min-width: 60px;
                box-sizing: border-box;
                padding: 2px 5px;
                border: 1px solid var(--border-color);
                border-radius: 4px;
                background: var(--content-background);
                color: var(--content-color);
                font: inherit;
                font-size: 11px;
                font-weight: 400;
            }
            .th-head {
                @apply --horizontal;
                align-items: center;
                gap: 4px;
                cursor: pointer;
            }
            .th-type {
                font-size: 10px;
                font-weight: 400;
                opacity: 0.65;
                margin-left: 3px;
            }
            table.sql-grid td {
                border-bottom: 1px solid var(--border-color);
                border-right: 1px solid var(--border-color);
                padding: 5px 8px;
                max-width: 320px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                vertical-align: middle;
            }
            table.sql-grid tbody tr {
                cursor: pointer;
            }
            table.sql-grid tbody tr:hover {
                background: var(--subtle-background);
            }
            table.sql-grid tbody tr.selected {
                background: var(--accent-soft);
            }
            .null-val {
                opacity: 0.45;
                font-style: italic;
            }
            .fk-link {
                color: var(--accent-color);
                text-decoration: underline;
                cursor: pointer;
                font-weight: 500;
            }
            .fk-link:hover {
                opacity: 0.85;
            }
            .time-hint {
                font-size: 10.5px;
                opacity: 0.65;
                margin-left: 5px;
            }
            .pager-bar {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                padding: 6px 12px;
                border-top: 1px solid var(--border-color);
                background: var(--subtle-background);
                font-size: 12px;
                flex-shrink: 0;
                flex-wrap: wrap;
                gap: 8px;
            }
            .inspector {
                @apply --vertical;
                width: 410px;
                min-width: 340px;
                max-width: 480px;
                border-left: 1px solid var(--border-color);
                background: var(--subtle-background);
                flex-shrink: 0;
                overflow: hidden;
            }
            .inspector-head {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                border-bottom: 1px solid var(--border-color);
                background: var(--content-background);
                font-weight: 700;
            }
            .inspector-body {
                @apply --vertical;
                @apply --flex;
                overflow-y: auto;
                padding: 10px 12px;
                gap: 10px;
            }
            .inspector-foot {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                border-top: 1px solid var(--border-color);
                background: var(--content-background);
                gap: 8px;
            }
            .field-box {
                @apply --vertical;
                gap: 4px;
                padding: 7px 9px;
                border-radius: 6px;
                background: var(--content-background);
                border: 1px solid var(--border-color);
            }
            .field-head {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
            }
            .field-name {
                font-weight: 700;
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 12px;
            }
            .field-input, .field-textarea {
                width: 100%;
                box-sizing: border-box;
                padding: 5px 7px;
                border: 1px solid var(--border-color);
                border-radius: 5px;
                background: var(--subtle-background);
                color: var(--content-color);
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 12px;
            }
            .field-textarea {
                min-height: 92px;
                resize: vertical;
            }
            .rel-section {
                @apply --vertical;
                gap: 6px;
                padding: 8px 10px;
                border-radius: 6px;
                background: var(--content-background);
                border: 1px solid var(--border-color);
            }
            .rel-btn-list {
                @apply --horizontal;
                flex-wrap: wrap;
                gap: 5px;
            }
            .er-wrap {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
                padding: 16px;
                gap: 18px;
            }
            .er-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
                gap: 14px;
            }
            .er-card {
                @apply --vertical;
                border: 1px solid var(--border-color);
                border-radius: 8px;
                background: var(--content-background);
                overflow: hidden;
                cursor: pointer;
                transition: border-color .15s, box-shadow .15s;
            }
            .er-card.active, .er-card:hover {
                border-color: var(--accent-color);
                box-shadow: 0 0 0 2px var(--accent-soft);
            }
            .er-card.related {
                border-color: var(--accent-color);
            }
            .er-card-head {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                padding: 7px 10px;
                background: var(--subtle-background);
                border-bottom: 1px solid var(--border-color);
                font-weight: 700;
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            }
            .er-col-row {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                padding: 4px 10px;
                font-size: 11.5px;
                border-bottom: 1px dashed var(--border-color);
            }
            .er-col-row:last-child {
                border-bottom: none;
            }
            .ddl-pre {
                margin: 0;
                padding: 12px;
                border-radius: 8px;
                background: var(--subtle-background);
                border: 1px solid var(--border-color);
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 12px;
                white-space: pre-wrap;
                overflow-x: auto;
            }
            .status-banner {
                padding: 6px 12px;
                font-size: 12px;
                font-weight: 600;
                border-bottom: 1px solid var(--border-color);
                background: var(--accent-soft);
                color: var(--content-color);
            }
            .status-banner.error {
                color: var(--error-color, #dc2626);
            }
        </style>

        <!-- Верхняя панель выбора БД и режима -->
        <div class="top-bar">
            <div class="top-left">
                <oda-icon icon="carbon:data-base" :icon-size="20"></oda-icon>
                <select class="db-select" ~if="databases.length > 1" @change="onSelectDatabase($event)">
                    <option ~for="databases" :value="$for.item.id" :selected="$for.item.id === activeDbId">{{$for.item.label}}</option>
                </select>
                <div class="db-badge" ~if="databases.length === 1 && currentDbInfo">
                    <b>{{currentDbInfo.label}}</b>
                </div>
                <div class="db-badge" ~if="schemaInfo">
                    <span>Файл: <b>{{schemaInfo.file}}</b></span>
                    <span>•</span>
                    <span>Размер: <b>{{formatBytes(schemaInfo.totalBytes)}}</b></span>
                    <span>•</span>
                    <span>Схема: <b>v{{schemaInfo.userVersion}} ({{schemaInfo.journalMode}})</b></span>
                    <span>•</span>
                    <span>Таблиц: <b>{{visibleTables.length}}</b></span>
                    <span>•</span>
                    <span>Связей: <b>{{relations.length}}</b></span>
                </div>
            </div>
            <div class="top-right">
                <div class="mode-tabs">
                    <div class="mode-tab" ~class="{ active: viewMode === 'rows' }" @tap="setViewMode('rows')">
                        <oda-icon icon="carbon:table-split" :icon-size="16"></oda-icon>
                        <span>Таблицы и записи</span>
                    </div>
                    <div class="mode-tab" ~class="{ active: viewMode === 'er' }" @tap="setViewMode('er')">
                        <oda-icon icon="carbon:network-3" :icon-size="16"></oda-icon>
                        <span>Схема и связи (ER)</span>
                    </div>
                    <div class="mode-tab" ~class="{ active: viewMode === 'ddl' }" @tap="setViewMode('ddl')">
                        <oda-icon icon="carbon:code" :icon-size="16"></oda-icon>
                        <span>Структура и DDL</span>
                    </div>
                </div>
                <button class="btn" @tap="reloadAll()" :disabled="loading">
                    <oda-icon icon="icons:refresh" :icon-size="16"></oda-icon>
                    <span>Обновить</span>
                </button>
            </div>
        </div>

        <div class="status-banner" ~if="statusMessage" ~class="{ error: statusError }">
            {{statusMessage}}
        </div>

        <!-- Рабочая область -->
        <div class="workspace">
            <!-- Левая панель списка таблиц -->
            <div class="sidebar">
                <div class="sidebar-head">
                    <input class="sidebar-search" type="text" placeholder="Фильтр таблиц…" :value="tableFilter" @input="tableFilter = $event.target.value">
                    <label style="display:flex; align-items:center; gap:6px; font-size:11px; cursor:pointer; opacity:0.8;">
                        <input type="checkbox" :checked="showShadowTables" @change="showShadowTables = $event.target.checked">
                        <span>Показать служебные FTS-таблицы</span>
                    </label>
                </div>
                <div class="table-list">
                    <div class="table-item" ~for="visibleTables"
                        ~class="{ active: activeTableName === $for.item.name }"
                        @tap="selectTable($for.item.name)">
                        <div class="table-item-top">
                            <span class="table-name">{{$for.item.name}}</span>
                            <span class="table-count">{{formatNumber($for.item.rowCount)}}</span>
                        </div>
                        <div class="table-desc" ~if="$for.item.description" :title="$for.item.description">{{$for.item.description}}</div>
                    </div>
                </div>
            </div>

            <!-- Правая основная область -->
            <div class="main-area">
                <!-- РЕЖИМ 1: Таблицы и записи -->
                <div class="main-area" ~if="viewMode === 'rows' && currentTable">
                    <div class="table-toolbar">
                        <div class="table-title-wrap">
                            <div class="table-title-row">
                                <span class="table-title">{{currentTable.name}}</span>
                                <span class="chip pk" ~if="currentTable.pkColumns?.length">PK: {{currentTable.pkColumns.join(', ')}}</span>
                                <span class="chip" ~if="!currentTable.pkColumns?.length && currentTable.hasRowid">PK: rowid</span>
                                <span class="chip" ~if="currentTable.withoutRowid">WITHOUT ROWID</span>
                                <span class="chip" ~if="currentTable.isVirtual">FTS5 VIRTUAL</span>
                                <span class="chip filter-chip" ~for="activeFilterChips" @tap="clearColumnFilter($for.item.col)" title="Нажмите, чтобы сбросить фильтр">
                                    <span>{{$for.item.col}} = {{$for.item.val}}</span>
                                    <b>✕</b>
                                </span>
                                <button class="btn" ~if="activeFilterChips.length > 0 || rowSearch" @tap="resetAllRowFilters()">Сбросить фильтры</button>
                            </div>
                            <div class="table-desc" ~if="currentTable.description">{{currentTable.description}}</div>
                        </div>
                        <div class="top-right">
                            <input class="search-input" type="text" placeholder="Поиск по всем полям таблицы…" :value="rowSearch" @input="onRowSearchInput($event)">
                            <button class="btn primary" ~if="!currentTable.isVirtual && currentTable.objectType === 'table'" @tap="startCreateRow()">
                                <oda-icon icon="icons:add" :icon-size="16"></oda-icon>
                                <span>Добавить запись</span>
                            </button>
                        </div>
                    </div>

                    <div class="content-split">
                        <!-- Таблица строк -->
                        <div class="grid-wrap">
                            <table class="sql-grid">
                                <thead>
                                    <tr>
                                        <th ~if="showRowidColumn" @tap="toggleSort('__rowid__')">
                                            <div class="th-head">
                                                <span>rowid</span>
                                                <span class="th-type">PK</span>
                                                <span ~if="sortCol === '__rowid__'">{{sortDir === 'ASC' ? '▲' : '▼'}}</span>
                                            </div>
                                        </th>
                                        <th ~for="headerColumns" @tap="toggleSort($for.item.name)">
                                            <div class="th-head">
                                                <span>{{$for.item.name}}</span>
                                                <span class="th-type">{{$for.item.colType}}</span>
                                                <span class="chip pk" ~if="$for.item.pk > 0" style="padding:0 4px; font-size:9px;">PK</span>
                                                <span class="chip" ~if="$for.item.fkTarget" style="padding:0 4px; font-size:9px;" :title="'Связь: ' + $for.item.fkTarget.toTable + '.' + $for.item.fkTarget.toColumn">
                                                    → {{$for.item.fkTarget.toTable}}
                                                </span>
                                                <span ~if="sortCol === $for.item.name">{{sortDir === 'ASC' ? '▲' : '▼'}}</span>
                                            </div>
                                        </th>
                                    </tr>
                                    <tr class="filter-row">
                                        <th ~if="showRowidColumn">
                                            <input class="col-filter-input" type="text" placeholder="rowid…" :value="columnFilters.__rowid__ || ''" @input="onColumnFilterInput('__rowid__', $event)">
                                        </th>
                                        <th ~for="headerColumns">
                                            <input class="col-filter-input" type="text" :placeholder="'Фильтр ' + $for.item.name + '…'" :value="columnFilters[$for.item.name] || ''" @input="onColumnFilterInput($for.item.name, $event)">
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr ~for="displayRows" ~class="{ selected: $for.item.selected }" @tap="selectRow($for.item.raw)">
                                        <td ~if="showRowidColumn">
                                            <b>{{$for.item.rowid}}</b>
                                        </td>
                                        <td ~for="$for.item.cells" :title="$for.$for.item.tooltip">
                                            <span class="null-val" ~if="$for.$for.item.isNull">NULL</span>
                                            <span class="fk-link" ~if="!$for.$for.item.isNull && $for.$for.item.fkTarget"
                                                @tap.stop="jumpToRelated($for.$for.item.fkTarget.toTable, $for.$for.item.fkTarget.toColumn, $for.$for.item.value)"
                                                :title="'Перейти в ' + $for.$for.item.fkTarget.toTable + '.' + $for.$for.item.fkTarget.toColumn + ' = ' + $for.$for.item.value">
                                                {{$for.$for.item.display}} ↗
                                            </span>
                                            <span ~if="!$for.$for.item.isNull && !$for.$for.item.fkTarget">
                                                {{$for.$for.item.display}}
                                            </span>
                                            <span class="time-hint" ~if="$for.$for.item.timeHint">
                                                ({{$for.$for.item.timeHint}})
                                            </span>
                                        </td>
                                    </tr>
                                    <tr ~if="!displayRows.length && !loading">
                                        <td :colspan="(headerColumns.length || 1) + (showRowidColumn ? 1 : 0)" style="text-align:center; padding:24px; opacity:0.65;">
                                            Записей не найдено
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Правый инспектор / редактор выбранной или создаваемой записи -->
                        <div class="inspector" ~if="selectedRow || creatingNew">
                            <div class="inspector-head">
                                <span>{{creatingNew ? ('Новая запись в «' + currentTable.name + '»') : ('Запись: ' + selectedRowLabel)}}</span>
                                <button class="btn" style="padding:2px 6px;" @tap="closeInspector()">✕</button>
                            </div>
                            <div class="inspector-body">
                                <!-- Блок связей записи с другими таблицами -->
                                <div class="rel-section" ~if="!creatingNew && (selectedOutgoingLinks.length || selectedIncomingLinks.length)">
                                    <div style="font-weight:700; font-size:12px;">Связанные записи в других таблицами</div>
                                    <div ~if="selectedOutgoingLinks.length" style="font-size:11px; opacity:0.75;">Исходящие ссылки (FK →):</div>
                                    <div class="rel-btn-list" ~if="selectedOutgoingLinks.length">
                                        <button class="btn" ~for="selectedOutgoingLinks" @tap="jumpToRelated($for.item.table, $for.item.column, $for.item.value)">
                                            <span>{{$for.item.fromColumn}} → <b>{{$for.item.table}}.{{$for.item.column}}</b> ({{$for.item.value}})</span>
                                        </button>
                                    </div>
                                    <div ~if="selectedIncomingLinks.length" style="font-size:11px; opacity:0.75; margin-top:4px;">Где используется (← входящие связи):</div>
                                    <div class="rel-btn-list" ~if="selectedIncomingLinks.length">
                                        <button class="btn" ~for="selectedIncomingLinks" @tap="jumpToRelated($for.item.table, $for.item.column, $for.item.value)">
                                            <span>← <b>{{$for.item.table}}</b>.{{$for.item.column}}</span>
                                        </button>
                                    </div>
                                </div>

                                <!-- Редакторы колонок -->
                                <div class="field-box" ~for="editorFields">
                                    <div class="field-head">
                                        <span class="field-name">{{$for.item.name}}</span>
                                        <div style="display:flex; align-items:center; gap:4px;">
                                            <span class="chip pk" ~if="$for.item.pk > 0" style="padding:0 5px; font-size:10px;">PK</span>
                                            <span class="chip" style="padding:0 5px; font-size:10px;">{{$for.item.colType || 'TEXT'}}</span>
                                            <button class="btn" ~if="$for.item.isJson" style="padding:1px 6px; font-size:10px;" @tap="prettifyJsonField($for.item.name)">JSON</button>
                                            <button class="btn" ~if="!$for.item.notnull && $for.item.pk === 0" style="padding:1px 6px; font-size:10px;" @tap="setFieldNull($for.item.name)">NULL</button>
                                        </div>
                                    </div>
                                    <textarea class="field-textarea" ~if="$for.item.multiline"
                                        :value="$for.item.value"
                                        :placeholder="$for.item.isNull ? 'NULL' : ''"
                                        @input="onEditorFieldInput($for.item.name, $event.target.value)"></textarea>
                                    <input class="field-input" ~if="!$for.item.multiline"
                                        type="text"
                                        :value="$for.item.value"
                                        :placeholder="$for.item.isNull ? 'NULL' : ($for.item.dfltValue !== null ? ('По умолч.: ' + $for.item.dfltValue) : '')"
                                        @input="onEditorFieldInput($for.item.name, $event.target.value)">
                                </div>
                            </div>
                            <div class="inspector-foot">
                                <button class="btn danger" ~if="!creatingNew" :disabled="saving" @tap="deleteSelectedRow()">
                                    <oda-icon icon="icons:delete" :icon-size="16"></oda-icon>
                                    <span>Удалить</span>
                                </button>
                                <div style="flex:1;"></div>
                                <button class="btn" @tap="closeInspector()">Отмена</button>
                                <button class="btn primary" :disabled="saving || (!editorDirty && !creatingNew)" @tap="saveSelectedRow()">
                                    <oda-icon icon="icons:save" :icon-size="16"></oda-icon>
                                    <span>{{creatingNew ? 'Создать' : 'Сохранить'}}</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Нижняя панель пагинации -->
                    <div class="pager-bar">
                        <div>
                            <span>Записи: <b>{{rowsRangeLabel}}</b> из <b>{{formatNumber(totalRows)}}</b></span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span>На странице:</span>
                            <select class="col-filter-input" style="width:auto; padding:3px 6px;" @change="onLimitChange($event)">
                                <option value="50" :selected="pageSize === 50">50</option>
                                <option value="100" :selected="pageSize === 100">100</option>
                                <option value="250" :selected="pageSize === 250">250</option>
                                <option value="500" :selected="pageSize === 500">500</option>
                            </select>
                            <button class="btn" :disabled="pageOffset <= 0" @tap="goToPage(0)">«</button>
                            <button class="btn" :disabled="pageOffset <= 0" @tap="goToPage(pageOffset - pageSize)">‹ Пред.</button>
                            <span>Стр. <b>{{currentPageNumber}}</b> / <b>{{totalPages}}</b></span>
                            <button class="btn" :disabled="pageOffset + pageSize >= totalRows" @tap="goToPage(pageOffset + pageSize)">След. ›</button>
                            <button class="btn" :disabled="pageOffset + pageSize >= totalRows" @tap="goToPage((totalPages - 1) * pageSize)">»</button>
                        </div>
                    </div>
                </div>

                <!-- РЕЖИМ 2: Схема и связи (ER) -->
                <div class="er-wrap" ~if="viewMode === 'er'">
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                        <div>
                            <div style="font-size:15px; font-weight:700;">Карта таблиц и связей базы данных ({{visibleTables.length}} таблиц, {{relations.length}} связей)</div>
                            <div style="font-size:12px; opacity:0.72;">Нажмите на карточку таблицы, чтобы отфильтровать её связи; двойной клик — перейти к записям таблицы.</div>
                        </div>
                        <button class="btn" ~if="erSelectedTable" @tap="erSelectedTable = ''">Показать все связи</button>
                    </div>

                    <div class="er-grid">
                        <div class="er-card" ~for="erTables"
                            ~class="{ active: activeTableName === $for.item.name, related: $for.item.isRelated }"
                            @tap="onErCardTap($for.item.name)"
                            @dblclick="openTableRowsFromEr($for.item.name)">
                            <div class="er-card-head">
                                <span>{{$for.item.name}}</span>
                                <span class="table-count">{{formatNumber($for.item.rowCount)}} зап.</span>
                            </div>
                            <div style="padding:4px 10px; font-size:11px; opacity:0.75; border-bottom:1px solid var(--border-color);" ~if="$for.item.description">
                                {{$for.item.description}}
                            </div>
                            <div>
                                <div class="er-col-row" ~for="$for.item.colItems">
                                    <div style="display:flex; align-items:center; gap:5px;">
                                        <span class="chip pk" ~if="$for.$for.item.pk > 0" style="padding:0 4px; font-size:9px;">PK</span>
                                        <span style="font-family:ui-monospace, monospace; font-weight:600;">{{$for.$for.item.name}}</span>
                                    </div>
                                    <div style="display:flex; align-items:center; gap:5px;">
                                        <span class="fk-link" ~if="$for.$for.item.fkTarget"
                                            @tap.stop="openTableRowsFromEr($for.$for.item.fkTarget.toTable)"
                                            style="font-size:10.5px;">
                                            → {{$for.$for.item.fkTarget.toTable}}.{{$for.$for.item.fkTarget.toColumn}}
                                        </span>
                                        <span style="font-size:10.5px; opacity:0.6;">{{$for.$for.item.colType}}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Реестр всех связей -->
                    <div style="margin-top:8px;">
                        <div style="font-size:14px; font-weight:700; margin-bottom:8px;">
                            Реестр связей между таблицами {{erSelectedTable ? ('(для «' + erSelectedTable + '»)') : ''}}
                        </div>
                        <table class="sql-grid">
                            <thead>
                                <tr>
                                    <th>Исходная таблица</th>
                                    <th>Колонка (FK)</th>
                                    <th>Целевая таблица</th>
                                    <th>Ключ (PK)</th>
                                    <th>Тип связи</th>
                                    <th>Назначение связи</th>
                                    <th>Действие</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr ~for="filteredRelations">
                                    <td><b style="font-family:ui-monospace, monospace;">{{$for.item.fromTable}}</b></td>
                                    <td><span style="font-family:ui-monospace, monospace;">{{$for.item.fromColumn}}</span></td>
                                    <td><b style="font-family:ui-monospace, monospace;">{{$for.item.toTable}}</b></td>
                                    <td><span style="font-family:ui-monospace, monospace;">{{$for.item.toColumn}}</span></td>
                                    <td><span class="chip">{{$for.item.kind === 'fk' ? 'FOREIGN KEY' : 'Логическая связь WORK'}}</span></td>
                                    <td>{{$for.item.label}}</td>
                                    <td>
                                        <button class="btn" style="padding:2px 8px;" @tap="openTableRowsFromEr($for.item.fromTable)">Открыть {{$for.item.fromTable}}</button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- РЕЖИМ 3: Структура и DDL -->
                <div class="er-wrap" ~if="viewMode === 'ddl' && currentTable">
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                        <div>
                            <div style="font-size:16px; font-weight:700; font-family:ui-monospace, monospace;">Таблица: {{currentTable.name}}</div>
                            <div style="font-size:12px; opacity:0.75;" ~if="currentTable.description">{{currentTable.description}}</div>
                        </div>
                        <button class="btn primary" @tap="setViewMode('rows')">Перейти к записям ({{formatNumber(currentTable.rowCount)}})</button>
                    </div>

                    <div>
                        <div style="font-weight:700; margin-bottom:6px;">Колонки ({{headerColumns.length}})</div>
                        <table class="sql-grid">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Имя колонки</th>
                                    <th>Тип SQL</th>
                                    <th>NOT NULL</th>
                                    <th>По умолчанию</th>
                                    <th>Первичный ключ (PK)</th>
                                    <th>Связь (FK)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr ~for="headerColumns">
                                    <td>{{$for.item.cid}}</td>
                                    <td><b style="font-family:ui-monospace, monospace;">{{$for.item.name}}</b></td>
                                    <td>{{$for.item.colType || 'TEXT'}}</td>
                                    <td>{{$for.item.notnull ? 'Да' : 'Нет'}}</td>
                                    <td>{{$for.item.dfltValue !== null ? $for.item.dfltValue : '—'}}</td>
                                    <td>{{$for.item.pk > 0 ? ('PK #' + $for.item.pk) : '—'}}</td>
                                    <td>
                                        <span class="fk-link" ~if="$for.item.fkTarget"
                                            @tap="openTableRowsFromEr($for.item.fkTarget.toTable)">
                                            → {{$for.item.fkTarget.toTable}}.{{$for.item.fkTarget.toColumn}} ({{$for.item.fkTarget.label}})
                                        </span>
                                        <span ~if="!$for.item.fkTarget">—</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div ~if="currentTable.indexes?.length">
                        <div style="font-weight:700; margin-bottom:6px;">Индексы ({{currentTable.indexes.length}})</div>
                        <table class="sql-grid">
                            <thead>
                                <tr>
                                    <th>Имя индекса</th>
                                    <th>Уникальный</th>
                                    <th>Тип</th>
                                    <th>Колонки</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr ~for="currentTable.indexes">
                                    <td><b style="font-family:ui-monospace, monospace;">{{$for.item.name}}</b></td>
                                    <td>{{$for.item.unique ? 'UNIQUE' : 'Обычный'}}</td>
                                    <td>{{$for.item.origin}}</td>
                                    <td><span style="font-family:ui-monospace, monospace;">{{($for.item.columns || []).join(', ')}}</span></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div>
                        <div style="font-weight:700; margin-bottom:6px;">SQL-определение (DDL)</div>
                        <pre class="ddl-pre">{{currentTable.sql || '-- DDL отсутствует'}}</pre>
                    </div>
                </div>
            </div>
        </div>
    `,

    $public: {
        $item: {
            $def: null,
            set(n) {
                if (n)
                    this.initForItem();
            },
        },
        databases: { $def: [] },
        activeDbId: '',
        schemaInfo: null,
        tables: { $def: [] },
        relations: { $def: [] },
        tableFilter: '',
        showShadowTables: false,
        activeTableName: '',
        viewMode: 'rows', // 'rows' | 'er' | 'ddl'
        erSelectedTable: '',

        rows: { $def: [] },
        totalRows: 0,
        pageSize: 50,
        pageOffset: 0,
        sortCol: '',
        sortDir: 'ASC',
        rowSearch: '',
        columnFilters: { $def: {} },
        keyColumns: { $def: [] },

        selectedRow: null,
        creatingNew: false,
        editorValues: { $def: {} },
        editorNulls: { $def: {} },
        editorDirty: false,

        loading: false,
        saving: false,
        statusMessage: '',
        statusError: false,
    },

    attached() {
        if (this.$item)
            this.initForItem();
    },

    get currentDbInfo() {
        return (this.databases || []).find(d => d.id === this.activeDbId) || this.databases?.[0] || null;
    },

    get visibleTables() {
        const q = String(this.tableFilter || '').trim().toLowerCase();
        return (this.tables || []).filter(t => {
            if (!this.showShadowTables && t.isShadow)
                return false;
            if (!q)
                return true;
            return t.name.toLowerCase().includes(q) || String(t.description || '').toLowerCase().includes(q);
        });
    },

    get currentTable() {
        return (this.tables || []).find(t => t.name === this.activeTableName) || null;
    },

    get headerColumns() {
        const tbl = this.currentTable;
        if (!tbl || !Array.isArray(tbl.columns))
            return [];
        return tbl.columns.map(col => ({
            ...col,
            fkTarget: this.fkTargetFor(tbl.name, col.name),
        }));
    },

    get displayRows() {
        const tbl = this.currentTable;
        const cols = this.headerColumns;
        const rawRows = Array.isArray(this.rows) ? this.rows : [];
        return rawRows.map(row => ({
            raw: row,
            rowid: row.__rowid__,
            selected: this.isRowSelected(row),
            cells: cols.map(col => {
                const val = row[col.name];
                const isNull = val === null || val === undefined;
                return {
                    colName: col.name,
                    value: val,
                    isNull,
                    display: this.formatCellValue(val),
                    tooltip: this.formatCellTooltip(val, col.name),
                    fkTarget: col.fkTarget,
                    timeHint: isNull ? '' : this.formatTimeHint(val, col.name),
                };
            }),
        }));
    },

    get erTables() {
        return (this.visibleTables || []).map(tbl => ({
            ...tbl,
            isRelated: this.isTableRelatedToSelected(tbl.name),
            colItems: (tbl.columns || []).map(col => ({
                ...col,
                fkTarget: this.fkTargetFor(tbl.name, col.name),
            })),
        }));
    },

    get showRowidColumn() {
        const t = this.currentTable;
        return Boolean(t && t.pkColumns?.length === 0 && t.hasRowid);
    },

    get activeFilterChips() {
        const filters = this.columnFilters || {};
        return Object.entries(filters)
            .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
            .map(([col, val]) => ({ col, val: String(val) }));
    },

    get rowsRangeLabel() {
        if (!this.totalRows || !this.rows?.length)
            return '0';
        const start = this.pageOffset + 1;
        const end = Math.min(this.pageOffset + this.rows.length, this.totalRows);
        return `${start}–${end}`;
    },

    get currentPageNumber() {
        if (!this.totalRows)
            return 1;
        return Math.floor(this.pageOffset / (this.pageSize || 50)) + 1;
    },

    get totalPages() {
        if (!this.totalRows)
            return 1;
        return Math.max(1, Math.ceil(this.totalRows / (this.pageSize || 50)));
    },

    get selectedRowLabel() {
        if (!this.selectedRow)
            return '';
        const keys = this.keyColumns?.length ? this.keyColumns : ['id'];
        return keys.map(k => `${k}=${this.selectedRow[k]}`).join(', ');
    },

    get editorFields() {
        const tbl = this.currentTable;
        if (!tbl)
            return [];
        const vals = this.editorValues || {};
        const nulls = this.editorNulls || {};
        return (tbl.columns || []).map(col => {
            const raw = vals[col.name] ?? '';
            const isNull = Boolean(nulls[col.name]);
            const isJson = ['body', 'own', 'analytics'].includes(col.name)
                || (typeof raw === 'string' && /^\s*[\[{]/.test(raw));
            const multiline = isJson || col.name === 'text' || col.name === 'sql' || String(raw).length > 100;
            return {
                ...col,
                value: isNull ? '' : String(raw),
                isNull,
                isJson,
                multiline,
            };
        });
    },

    get selectedOutgoingLinks() {
        const tbl = this.currentTable;
        const row = this.selectedRow;
        if (!tbl || !row)
            return [];
        return (this.relations || [])
            .filter(r => r.fromTable === tbl.name && row[r.fromColumn] !== null && row[r.fromColumn] !== undefined && row[r.fromColumn] !== '')
            .map(r => ({
                fromColumn: r.fromColumn,
                table: r.toTable,
                column: r.toColumn,
                value: row[r.fromColumn],
                label: r.label,
            }));
    },

    get selectedIncomingLinks() {
        const tbl = this.currentTable;
        const row = this.selectedRow;
        if (!tbl || !row)
            return [];
        return (this.relations || [])
            .filter(r => r.toTable === tbl.name && row[r.toColumn] !== null && row[r.toColumn] !== undefined && row[r.toColumn] !== '')
            .map(r => ({
                table: r.fromTable,
                column: r.fromColumn,
                value: row[r.toColumn],
                label: r.label,
            }));
    },

    get filteredRelations() {
        const sel = this.erSelectedTable;
        if (!sel)
            return this.relations || [];
        return (this.relations || []).filter(r => r.fromTable === sel || r.toTable === sel);
    },

    setStatus(msg, isError = false) {
        this.statusMessage = msg || '';
        this.statusError = Boolean(isError);
        if (msg && !isError) {
            clearTimeout(this._statusTimer);
            this._statusTimer = setTimeout(() => {
                if (!this.statusError)
                    this.statusMessage = '';
            }, 3500);
        }
    },

    async initForItem() {
        if (!this.$item || this._initializing)
            return;
        this._initializing = true;
        this.loading = true;
        this.statusMessage = '';
        try {
            const res = await this.$item.fetch('sql_databases');
            const list = Array.isArray(res?.databases) ? res.databases : [];
            this.databases = list;
            if (!this.activeDbId || !list.some(d => d.id === this.activeDbId)) {
                this.activeDbId = list[0]?.id || 'data';
            }
            await this.loadSchema(this.activeDbId);
        }
        catch (err) {
            this.setStatus(err?.message || String(err), true);
        }
        finally {
            this.loading = false;
            this._initializing = false;
        }
    },

    async reloadAll() {
        await this.initForItem();
    },

    async onSelectDatabase(e) {
        const nextId = e?.target?.value;
        if (!nextId || nextId === this.activeDbId)
            return;
        this.activeDbId = nextId;
        this.activeTableName = '';
        this.selectedRow = null;
        this.creatingNew = false;
        await this.loadSchema(nextId);
    },

    async loadSchema(dbId = this.activeDbId) {
        if (!this.$item)
            return;
        this.loading = true;
        try {
            const info = await this.$item.fetch('sql_schema', { dbId });
            this.schemaInfo = info;
            this.tables = Array.isArray(info?.tables) ? info.tables : [];
            this.relations = Array.isArray(info?.relations) ? info.relations : [];

            const vis = this.visibleTables;
            if (!this.activeTableName || !this.tables.some(t => t.name === this.activeTableName)) {
                const preferred = vis.find(t => t.name === 'objects') || vis[0] || this.tables[0];
                this.activeTableName = preferred?.name || '';
            }
            if (this.activeTableName) {
                await this.loadRows();
            }
            else {
                this.rows = [];
                this.totalRows = 0;
            }
        }
        catch (err) {
            this.setStatus(err?.message || String(err), true);
        }
        finally {
            this.loading = false;
        }
    },

    async selectTable(tableName, initialFilters = null) {
        if (!tableName)
            return;
        this.activeTableName = tableName;
        this.pageOffset = 0;
        this.sortCol = '';
        this.sortDir = 'ASC';
        this.rowSearch = '';
        this.columnFilters = initialFilters && typeof initialFilters === 'object' ? { ...initialFilters } : {};
        this.selectedRow = null;
        this.creatingNew = false;
        await this.loadRows();
    },

    async loadRows() {
        if (!this.$item || !this.activeTableName)
            return;
        this.loading = true;
        try {
            const res = await this.$item.fetch('sql_rows', {
                dbId: this.activeDbId,
                table: this.activeTableName,
                offset: this.pageOffset,
                limit: this.pageSize,
                sortCol: this.sortCol,
                sortDir: this.sortDir,
                search: this.rowSearch,
                filters: JSON.stringify(this.columnFilters || {}),
            });
            this.rows = Array.isArray(res?.rows) ? res.rows : [];
            this.totalRows = Number(res?.total) || 0;
            this.keyColumns = Array.isArray(res?.keyColumns) ? res.keyColumns : [];
            if (!this.rowSearch && !this.activeFilterChips.length) {
                const tbl = (this.tables || []).find(t => t.name === this.activeTableName);
                if (tbl)
                    tbl.rowCount = this.totalRows;
            }
        }
        catch (err) {
            this.setStatus(err?.message || String(err), true);
        }
        finally {
            this.loading = false;
        }
    },

    setViewMode(mode) {
        this.viewMode = mode;
    },

    toggleSort(colName) {
        if (this.sortCol === colName) {
            this.sortDir = this.sortDir === 'ASC' ? 'DESC' : 'ASC';
        }
        else {
            this.sortCol = colName;
            this.sortDir = 'ASC';
        }
        this.pageOffset = 0;
        this.loadRows();
    },

    onRowSearchInput(e) {
        this.rowSearch = e?.target?.value ?? '';
        this.pageOffset = 0;
        clearTimeout(this._searchDebounce);
        this._searchDebounce = setTimeout(() => this.loadRows(), 220);
    },

    onColumnFilterInput(colName, e) {
        const val = e?.target?.value ?? '';
        this.columnFilters = { ...(this.columnFilters || {}), [colName]: val };
        this.pageOffset = 0;
        clearTimeout(this._colFilterDebounce);
        this._colFilterDebounce = setTimeout(() => this.loadRows(), 220);
    },

    clearColumnFilter(colName) {
        const next = { ...(this.columnFilters || {}) };
        delete next[colName];
        this.columnFilters = next;
        this.pageOffset = 0;
        this.loadRows();
    },

    resetAllRowFilters() {
        this.rowSearch = '';
        this.columnFilters = {};
        this.pageOffset = 0;
        this.loadRows();
    },

    onLimitChange(e) {
        this.pageSize = Number(e?.target?.value) || 50;
        this.pageOffset = 0;
        this.loadRows();
    },

    goToPage(nextOffset) {
        const maxOffset = Math.max(0, (this.totalPages - 1) * this.pageSize);
        this.pageOffset = Math.min(Math.max(0, nextOffset), maxOffset);
        this.loadRows();
    },

    fkTargetFor(tableName, colName) {
        return (this.relations || []).find(r => r.fromTable === tableName && r.fromColumn === colName) || null;
    },

    async jumpToRelated(targetTable, targetCol, value) {
        this.viewMode = 'rows';
        await this.selectTable(targetTable, { [targetCol]: `exact:${value}` });
        if (this.rows?.length === 1) {
            this.selectRow(this.rows[0]);
        }
    },

    extractRowPk(row) {
        if (!row)
            return null;
        const tbl = this.currentTable;
        const pk = {};
        if (tbl?.pkColumns?.length) {
            for (const c of tbl.pkColumns)
                pk[c] = row[c];
        }
        else if (row.__rowid__ !== undefined) {
            pk.__rowid__ = row.__rowid__;
        }
        else if (tbl?.columns?.length) {
            for (const c of tbl.columns)
                pk[c.name] = row[c.name];
        }
        return pk;
    },

    isRowSelected(row) {
        if (!this.selectedRow || !row)
            return false;
        const keys = this.keyColumns?.length ? this.keyColumns : ['__rowid__'];
        return keys.every(k => this.selectedRow[k] === row[k]);
    },

    selectRow(row) {
        if (!row)
            return;
        this.creatingNew = false;
        this.selectedRow = row;
        const vals = {};
        const nulls = {};
        for (const col of this.currentTable?.columns || []) {
            const v = row[col.name];
            if (v === null || v === undefined) {
                vals[col.name] = '';
                nulls[col.name] = true;
            }
            else {
                vals[col.name] = String(v);
                nulls[col.name] = false;
            }
        }
        this.editorValues = vals;
        this.editorNulls = nulls;
        this.editorDirty = false;
    },

    startCreateRow() {
        const tbl = this.currentTable;
        if (!tbl)
            return;
        this.selectedRow = null;
        this.creatingNew = true;
        const vals = {};
        const nulls = {};
        for (const col of tbl.columns || []) {
            if (['body', 'own', 'analytics'].includes(col.name)) {
                vals[col.name] = '{}';
                nulls[col.name] = false;
            }
            else {
                vals[col.name] = '';
                nulls[col.name] = !col.notnull && col.dfltValue === null && col.pk === 0;
            }
        }
        this.editorValues = vals;
        this.editorNulls = nulls;
        this.editorDirty = true;
    },

    closeInspector() {
        this.selectedRow = null;
        this.creatingNew = false;
        this.editorDirty = false;
    },

    onEditorFieldInput(colName, val) {
        this.editorValues = { ...(this.editorValues || {}), [colName]: val };
        this.editorNulls = { ...(this.editorNulls || {}), [colName]: false };
        this.editorDirty = true;
    },

    setFieldNull(colName) {
        this.editorValues = { ...(this.editorValues || {}), [colName]: '' };
        this.editorNulls = { ...(this.editorNulls || {}), [colName]: true };
        this.editorDirty = true;
    },

    prettifyJsonField(colName) {
        const raw = this.editorValues?.[colName];
        if (!raw)
            return;
        try {
            const parsed = JSON.parse(raw);
            this.editorValues = { ...(this.editorValues || {}), [colName]: JSON.stringify(parsed, null, 2) };
            this.editorDirty = true;
        }
        catch (err) {
            this.setStatus(`Ошибка JSON в поле «${colName}»: ${err.message}`, true);
        }
    },

    async saveSelectedRow() {
        const tbl = this.currentTable;
        if (!this.$item || !tbl)
            return;
        this.saving = true;
        try {
            const values = {};
            for (const col of tbl.columns || []) {
                if (this.editorNulls?.[col.name]) {
                    values[col.name] = null;
                }
                else {
                    values[col.name] = this.editorValues?.[col.name] ?? '';
                }
            }

            if (this.creatingNew) {
                await this.$item.fetch('sql_insert_row', {
                    dbId: this.activeDbId,
                    table: tbl.name,
                }, {
                    dbId: this.activeDbId,
                    table: tbl.name,
                    values,
                });
                this.setStatus(`Запись добавлена в таблицу «${tbl.name}»`);
                this.creatingNew = false;
            }
            else if (this.selectedRow) {
                const pk = this.extractRowPk(this.selectedRow);
                await this.$item.fetch('sql_update_row', {
                    dbId: this.activeDbId,
                    table: tbl.name,
                }, {
                    dbId: this.activeDbId,
                    table: tbl.name,
                    pk,
                    values,
                });
                this.setStatus(`Запись в таблице «${tbl.name}» сохранена`);
                this.editorDirty = false;
            }
            await this.loadRows();
            if (this.selectedRow) {
                const updated = (this.rows || []).find(r => this.isRowSelected(r));
                if (updated)
                    this.selectRow(updated);
            }
        }
        catch (err) {
            this.setStatus(err?.message || String(err), true);
        }
        finally {
            this.saving = false;
        }
    },

    async deleteSelectedRow() {
        const tbl = this.currentTable;
        if (!this.$item || !tbl || !this.selectedRow)
            return;
        const label = this.selectedRowLabel;
        let confirmed = true;
        if (typeof globalThis.WORK?.showConfirm === 'function') {
            try {
                const res = await globalThis.WORK.showConfirm(`Удалить запись (${label}) из таблицы «${tbl.name}»?`);
                confirmed = Boolean(res && res !== 'cancel' && res !== 'no');
            }
            catch {
                confirmed = false;
            }
        }
        else if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            confirmed = window.confirm(`Удалить запись (${label}) из таблицы «${tbl.name}»?`);
        }
        if (!confirmed)
            return;

        this.saving = true;
        try {
            const pk = this.extractRowPk(this.selectedRow);
            await this.$item.fetch('sql_delete_row', {
                dbId: this.activeDbId,
                table: tbl.name,
            }, {
                dbId: this.activeDbId,
                table: tbl.name,
                pks: [pk],
            });
            this.setStatus(`Запись (${label}) удалена из «${tbl.name}»`);
            this.selectedRow = null;
            await this.loadRows();
        }
        catch (err) {
            this.setStatus(err?.message || String(err), true);
        }
        finally {
            this.saving = false;
        }
    },

    onErCardTap(tableName) {
        this.activeTableName = tableName;
        this.erSelectedTable = this.erSelectedTable === tableName ? '' : tableName;
    },

    async openTableRowsFromEr(tableName) {
        this.viewMode = 'rows';
        await this.selectTable(tableName);
    },

    isTableRelatedToSelected(tableName) {
        const sel = this.erSelectedTable || this.activeTableName;
        if (!sel || sel === tableName)
            return false;
        return (this.relations || []).some(r =>
            (r.fromTable === sel && r.toTable === tableName)
            || (r.toTable === sel && r.fromTable === tableName)
        );
    },

    formatNumber(n) {
        const num = Number(n) || 0;
        return num.toLocaleString('ru-RU');
    },

    formatBytes(bytes) {
        const b = Number(bytes) || 0;
        if (b < 1024)
            return `${b} Б`;
        if (b < 1024 * 1024)
            return `${(b / 1024).toFixed(1)} КБ`;
        return `${(b / (1024 * 1024)).toFixed(2)} МБ`;
    },

    formatCellValue(val) {
        if (val === null || val === undefined)
            return 'NULL';
        const str = String(val);
        return str.length > 120 ? str.slice(0, 117) + '…' : str;
    },

    formatCellTooltip(val, colName) {
        if (val === null || val === undefined)
            return `${colName}: NULL`;
        return String(val);
    },

    formatTimeHint(val, colName) {
        if (!['time', 'created', 'updated', 'valid_from', 'last_run', 'next_run'].includes(colName))
            return '';
        const n = Number(val);
        if (!Number.isFinite(n) || n < 946684800000 || n > 4102444800000)
            return '';
        try {
            const d = new Date(n);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }
        catch {
            return '';
        }
    },
};
