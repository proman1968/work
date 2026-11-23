/**
 * Представление «Карта» (form/map) для классов с миксином /MODULES/Geo/Карта (coords + shape).
 * Поддерживает подложки OpenStreetMap, 2GIS, Yandex (EPSG:3395), Google (EPSG:3857),
 * отображение объектов и шейпов, а также интерактивное задание координат и полигонов.
 */
const PROVIDERS = {
    osm: {
        id: 'osm',
        label: 'OpenStreetMap',
        tileUrl: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
        yandexProj: false,
    },
    '2gis': {
        id: '2gis',
        label: '2GIS',
        tileUrl: (x, y, z) => `https://tile2.maps.2gis.com/tiles?x=${x}&y=${y}&z=${z}&v=1`,
        yandexProj: false,
    },
    yandex: {
        id: 'yandex',
        label: 'Яндекс',
        tileUrl: (x, y, z) => `https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x=${x}&y=${y}&z=${z}&scale=1&lang=ru_RU`,
        yandexProj: true,
    },
    google: {
        id: 'google',
        label: 'Google',
        tileUrl: (x, y, z) => `https://mt1.google.com/vt/lyrs=m&x=${x}&y=${y}&z=${z}&hl=ru`,
        yandexProj: false,
    },
};

const RAD = Math.PI / 180;
const E_WGS84 = 0.08181919084262149;

function latLonToPixel(lat, lon, zoom, yandexProj = false) {
    const scale = 256 * Math.pow(2, zoom);
    const clampedLat = Math.max(-85.0511, Math.min(85.0511, Number(lat) || 0));
    const x = ((Number(lon) || 0) + 180) / 360 * scale;
    const phi = clampedLat * RAD;
    let mercY;
    if (yandexProj) {
        const esin = E_WGS84 * Math.sin(phi);
        const ts = Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - esin) / (1 + esin), E_WGS84 / 2);
        mercY = Math.log(ts);
    }
    else {
        mercY = Math.log(Math.tan(Math.PI / 4 + phi / 2));
    }
    const y = (0.5 - mercY / (2 * Math.PI)) * scale;
    return { x, y };
}

function pixelToLatLon(px, py, zoom, yandexProj = false) {
    const scale = 256 * Math.pow(2, zoom);
    const lon = (px / scale) * 360 - 180;
    const mercY = (0.5 - py / scale) * 2 * Math.PI;
    let lat;
    if (yandexProj) {
        const expY = Math.exp(-mercY);
        let phi = Math.PI / 2 - 2 * Math.atan(expY);
        for (let i = 0; i < 6; i++) {
            const esin = E_WGS84 * Math.sin(phi);
            phi = Math.PI / 2 - 2 * Math.atan(expY * Math.pow((1 - esin) / (1 + esin), E_WGS84 / 2));
        }
        lat = phi / RAD;
    }
    else {
        lat = (2 * Math.atan(Math.exp(mercY)) - Math.PI / 2) / RAD;
    }
    return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

function parseShapeCoords(shape) {
    if (!shape || !shape.geojson)
        return [];
    try {
        const parsed = typeof shape.geojson === 'string' ? JSON.parse(shape.geojson) : shape.geojson;
        if (Array.isArray(parsed)) {
            return parsed.map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.lat), Number(p.lon)])
                .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));
        }
        if (parsed?.type === 'Polygon' && Array.isArray(parsed.coordinates?.[0])) {
            return parsed.coordinates[0].map(([lo, la]) => [Number(la), Number(lo)]);
        }
        if (parsed?.type === 'LineString' && Array.isArray(parsed.coordinates)) {
            return parsed.coordinates.map(([lo, la]) => [Number(la), Number(lo)]);
        }
        if (parsed?.type === 'Point' && Array.isArray(parsed.coordinates)) {
            return [[Number(parsed.coordinates[1]), Number(parsed.coordinates[0])]];
        }
    }
    catch { /* ignore */ }
    return [];
}

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
            }
            .toolbar {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                border-bottom: 1px solid var(--subtle-border);
                background: var(--subtle-background);
                flex-wrap: wrap;
            }
            .provider-group {
                @apply --horizontal;
                gap: 4px;
                background: var(--content-background);
                padding: 2px;
                border-radius: 8px;
                border: 1px solid var(--subtle-border);
            }
            .chip {
                padding: 4px 10px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                border: none;
                background: transparent;
                color: var(--content-color);
            }
            .chip.active {
                background: var(--accent-color, #1d63dc);
                color: #fff;
            }
            .main {
                @apply --horizontal;
                @apply --flex;
                min-height: 0;
                overflow: hidden;
            }
            .sidebar {
                width: 280px;
                flex-shrink: 0;
                border-right: 1px solid var(--subtle-border);
                @apply --vertical;
                overflow: hidden;
            }
            .sidebar-search {
                padding: 8px;
                border-bottom: 1px solid var(--subtle-border);
            }
            .sidebar-search input {
                width: 100%;
                box-sizing: border-box;
                padding: 6px 8px;
                border: 1px solid var(--control-border-color);
                border-radius: 6px;
                background: var(--control-background);
                color: var(--control-color);
                font: inherit;
            }
            .obj-list {
                @apply --flex;
                overflow-y: auto;
                padding: 6px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .obj-item {
                padding: 8px 10px;
                border-radius: 8px;
                border: 1px solid transparent;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .obj-item:hover {
                background: var(--subtle-background);
            }
            .obj-item.selected {
                border-color: var(--accent-color, #1d63dc);
                background: var(--accent-soft, rgba(29, 99, 220, 0.1));
            }
            .obj-title {
                font-weight: 600;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .obj-meta {
                font-size: 11.5px;
                color: var(--muted-color);
            }
            .viewport {
                @apply --flex;
                position: relative;
                overflow: hidden;
                background: #dbe6f2;
                user-select: none;
                cursor: grab;
            }
            .viewport.picking {
                cursor: crosshair;
            }
            .viewport:active:not(.picking) {
                cursor: grabbing;
            }
            .tiles-layer, .svg-layer, .markers-layer {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
            }
            .tiles-layer img {
                position: absolute;
                width: 256px;
                height: 256px;
                image-rendering: auto;
            }
            .marker {
                position: absolute;
                transform: translate(-50%, -100%);
                pointer-events: auto;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .marker-pin {
                width: 24px;
                height: 24px;
                border-radius: 50% 50% 50% 0;
                background: #1d63dc;
                border: 2px solid #fff;
                transform: rotate(-45deg);
                box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
            }
            .marker.selected .marker-pin {
                background: #ef4444;
                transform: rotate(-45deg) scale(1.18);
            }
            .marker-lbl {
                margin-top: 3px;
                background: rgba(15, 23, 42, 0.85);
                color: #fff;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 600;
                white-space: nowrap;
                max-width: 160px;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .zoom-controls {
                position: absolute;
                right: 12px;
                top: 12px;
                display: flex;
                flex-direction: column;
                gap: 4px;
                z-index: 5;
            }
            .zoom-btn {
                width: 32px;
                height: 32px;
                border-radius: 8px;
                border: 1px solid var(--subtle-border);
                background: var(--content-background);
                color: var(--content-color);
                font-size: 18px;
                font-weight: 700;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(0,0,0,0.18);
            }
            .coords-bar {
                position: absolute;
                left: 12px;
                bottom: 10px;
                background: rgba(15, 23, 42, 0.8);
                color: #f8fafc;
                padding: 4px 10px;
                border-radius: 6px;
                font-family: monospace;
                font-size: 11.5px;
                z-index: 5;
            }
        </style>

        <div class="toolbar">
            <div class="provider-group">
                <button ~for="providerList" class="chip" ~class="{active: provider === $for.item.id}" @tap="setProvider($for.item.id)">{{$for.item.label}}</button>
            </div>
            <oda-button icon="icons:refresh" @tap="reload()">Обновить</oda-button>
            <div ~if="selectedObj" class="horizontal" style="gap:6px;align-items:center;margin-left:auto;flex-wrap:wrap;">
                <oda-button icon="carbon:location" :light="editMode === 'point'" @tap="toggleEditMode('point')">
                    {{editMode === 'point' ? 'Кликните на карту…' : 'Указать точку'}}
                </oda-button>
                <oda-button icon="carbon:area" :light="editMode === 'polygon'" @tap="toggleEditMode('polygon')">
                    {{editMode === 'polygon' ? 'Рисование (' + draftPoints.length + ' т.)' : 'Нарисовать шейп'}}
                </oda-button>
                <oda-button ~if="editMode === 'polygon' && draftPoints.length >= 3" icon="icons:check" @tap="saveDraftPolygon()">Сохранить шейп</oda-button>
                <oda-button ~if="editMode" icon="icons:close" @tap="cancelEdit()">Отмена</oda-button>
                <oda-button icon="icons:open-in-new" @tap="openObject(selectedObj)">Карточка</oda-button>
            </div>
        </div>

        <div class="main">
            <div class="sidebar">
                <div class="sidebar-search">
                    <input type="text" placeholder="Поиск на карте…" :value="filter" @input="filter = $event.target.value">
                </div>
                <div class="obj-list">
                    <div ~if="!filteredItems.length" style="padding:12px;color:var(--muted-color);text-align:center;">
                        Объекты не найдены
                    </div>
                    <div ~for="filteredItems" class="obj-item" ~class="{selected: selectedId === $for.item.id}"
                        @tap="selectObject($for.item)" @dblclick="openObject($for.item)">
                        <div class="obj-title">{{$for.item.title || $for.item.id}}</div>
                        <div class="obj-meta">{{formatObjMeta($for.item)}}</div>
                    </div>
                </div>
            </div>

            <div id="viewport" class="viewport" ~class="{picking: Boolean(editMode)}"
                @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
                @wheel.prevent="onWheel" @dblclick="onViewportDblClick">
                <div class="tiles-layer">
                    <img ~for="visibleTiles" :src="$for.item.src" :style="'left:' + $for.item.left + 'px;top:' + $for.item.top + 'px;'"
                        @error="$event.target.style.opacity='0.08'">
                </div>
                <svg class="svg-layer" :viewBox="'0 0 ' + viewW + ' ' + viewH">
                    <g ~for="renderedShapes">
                        <polygon ~if="$for.item.kind === 'polygon'" :points="$for.item.pointsAttr"
                            :fill="$for.item.fill" :stroke="$for.item.color" stroke-width="2.5"></polygon>
                        <polyline ~if="$for.item.kind === 'line'" :points="$for.item.pointsAttr"
                            fill="none" :stroke="$for.item.color" stroke-width="3"></polyline>
                        <circle ~if="$for.item.kind === 'circle'" :cx="$for.item.cx" :cy="$for.item.cy" :r="$for.item.r"
                            :fill="$for.item.fill" :stroke="$for.item.color" stroke-width="2"></circle>
                    </g>
                    <polyline ~if="draftPolylineAttr" :points="draftPolylineAttr" fill="rgba(239,68,68,0.18)" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="5,4"></polyline>
                </svg>
                <div class="markers-layer">
                    <div ~for="renderedMarkers" class="marker" ~class="{selected: selectedId === $for.item.id}"
                        :style="'left:' + $for.item.x + 'px;top:' + $for.item.y + 'px;'"
                        @pointerdown.stop @tap.stop="selectObject($for.item.raw)" @dblclick.stop="openObject($for.item.raw)">
                        <div class="marker-pin"></div>
                        <div class="marker-lbl">{{$for.item.title}}</div>
                    </div>
                </div>
                <div class="zoom-controls" @pointerdown.stop>
                    <button class="zoom-btn" @tap="zoomBy(1)">+</button>
                    <button class="zoom-btn" @tap="zoomBy(-1)">−</button>
                </div>
                <div class="coords-bar">
                    {{providerLabel}} · z{{zoom}} · {{centerLat.toFixed(5)}}, {{centerLon.toFixed(5)}} · объектов: {{renderedMarkers.length}}
                </div>
            </div>
        </div>
    `,
    provider: 'osm',
    centerLat: 55.7558,
    centerLon: 37.6173,
    zoom: 11,
    viewW: 800,
    viewH: 520,
    items: [],
    filter: '',
    selectedId: '',
    editMode: '',
    draftPoints: [],
    _drag: null,
    _resizeObs: null,
    get providerList() {
        return Object.values(PROVIDERS);
    },
    get providerLabel() {
        return PROVIDERS[this.provider]?.label || 'OSM';
    },
    get selectedObj() {
        return (this.items || []).find(x => x.id === this.selectedId) || null;
    },
    get filteredItems() {
        const q = String(this.filter || '').trim().toLowerCase();
        if (!q)
            return this.items || [];
        return (this.items || []).filter(o =>
            String(o.title || '').toLowerCase().includes(q)
            || String(o.body?.address || '').toLowerCase().includes(q)
        );
    },
    get visibleTiles() {
        const prov = PROVIDERS[this.provider] || PROVIDERS.osm;
        const maxTile = Math.pow(2, this.zoom);
        const centerPx = latLonToPixel(this.centerLat, this.centerLon, this.zoom, prov.yandexProj);
        const topLeftX = centerPx.x - this.viewW / 2;
        const topLeftY = centerPx.y - this.viewH / 2;
        const startX = Math.floor(topLeftX / 256);
        const endX = Math.floor((topLeftX + this.viewW) / 256);
        const startY = Math.floor(topLeftY / 256);
        const endY = Math.floor((topLeftY + this.viewH) / 256);
        const out = [];
        for (let tx = startX; tx <= endX; tx++) {
            for (let ty = startY; ty <= endY; ty++) {
                if (ty < 0 || ty >= maxTile)
                    continue;
                const wx = ((tx % maxTile) + maxTile) % maxTile;
                out.push({
                    src: prov.tileUrl(wx, ty, this.zoom),
                    left: Math.round(tx * 256 - topLeftX),
                    top: Math.round(ty * 256 - topLeftY),
                });
            }
        }
        return out;
    },
    _latLonToScreen(lat, lon) {
        const prov = PROVIDERS[this.provider] || PROVIDERS.osm;
        const centerPx = latLonToPixel(this.centerLat, this.centerLon, this.zoom, prov.yandexProj);
        const pt = latLonToPixel(lat, lon, this.zoom, prov.yandexProj);
        return {
            x: Math.round(pt.x - (centerPx.x - this.viewW / 2)),
            y: Math.round(pt.y - (centerPx.y - this.viewH / 2)),
        };
    },
    get renderedMarkers() {
        const out = [];
        for (const o of this.filteredItems) {
            const c = o.body?.coords;
            if (!c || !Number.isFinite(Number(c.lat)) || !Number.isFinite(Number(c.lon)))
                continue;
            const pos = this._latLonToScreen(Number(c.lat), Number(c.lon));
            out.push({ id: o.id, title: o.title || o.id, x: pos.x, y: pos.y, raw: o });
        }
        return out;
    },
    get renderedShapes() {
        const out = [];
        for (const o of this.filteredItems) {
            const sh = o.body?.shape;
            if (!sh)
                continue;
            const color = sh.color || '#1d63dc';
            const fill = color.startsWith('#') && color.length === 7 ? `${color}33` : 'rgba(29,99,220,0.2)';
            const pts = parseShapeCoords(sh);
            if (sh.kind === 'circle' && o.body?.coords) {
                const pos = this._latLonToScreen(Number(o.body.coords.lat), Number(o.body.coords.lon));
                const mPerPx = 156543.03 * Math.cos((Number(o.body.coords.lat) || 0) * RAD) / Math.pow(2, this.zoom);
                const r = Math.max(6, Math.round((Number(sh.radius) || 200) / Math.max(0.1, mPerPx)));
                out.push({ kind: 'circle', cx: pos.x, cy: pos.y, r, color, fill });
            }
            else if (pts.length >= 2) {
                const screenPts = pts.map(([la, lo]) => {
                    const p = this._latLonToScreen(la, lo);
                    return `${p.x},${p.y}`;
                }).join(' ');
                out.push({ kind: sh.kind === 'line' ? 'line' : 'polygon', pointsAttr: screenPts, color, fill });
            }
        }
        return out;
    },
    get draftPolylineAttr() {
        if (this.editMode !== 'polygon' || !this.draftPoints.length)
            return '';
        return this.draftPoints.map(([la, lo]) => {
            const p = this._latLonToScreen(la, lo);
            return `${p.x},${p.y}`;
        }).join(' ');
    },
    formatObjMeta(o) {
        const c = o.body?.coords;
        if (c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)))
            return `${Number(c.lat).toFixed(4)}, ${Number(c.lon).toFixed(4)}${o.body?.shape?.kind ? ' · ' + o.body.shape.kind : ''}`;
        return 'координаты не заданы';
    },
    setProvider(id) {
        if (PROVIDERS[id])
            this.provider = id;
    },
    zoomBy(delta) {
        this.zoom = Math.max(2, Math.min(18, this.zoom + Number(delta || 0)));
    },
    onWheel(e) {
        this.zoomBy(e.deltaY < 0 ? 1 : -1);
    },
    selectObject(obj) {
        if (!obj)
            return;
        this.selectedId = obj.id;
        const c = obj.body?.coords;
        if (c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))) {
            this.centerLat = Number(c.lat);
            this.centerLon = Number(c.lon);
            if (Number(c.zoom) >= 2 && Number(c.zoom) <= 18)
                this.zoom = Number(c.zoom);
        }
    },
    openObject(obj) {
        if (!obj?.id)
            return;
        const wf = this.closest?.('work-form') || this.domHost?.closest?.('work-form') || window.parent?.document?.querySelector?.('work-form');
        if (typeof wf?.applyNav === 'function')
            wf.applyNav({ view: 'object', id: obj.id, targetClassPath: obj.cid || this.$item?.short });
    },
    toggleEditMode(mode) {
        this.editMode = this.editMode === mode ? '' : mode;
        this.draftPoints = [];
    },
    cancelEdit() {
        this.editMode = '';
        this.draftPoints = [];
    },
    async _saveSelectedPatch(patch) {
        const obj = this.selectedObj;
        if (!obj || !this.$item?.fetch)
            return;
        const nextBody = { ...(obj.body || {}), ...patch };
        await this.$item.fetch('db_update', {}, { id: obj.id, version: obj.version, body: nextBody });
        await this.reload();
    },
    async saveDraftPolygon() {
        if (this.draftPoints.length < 3)
            return;
        const ring = [...this.draftPoints, this.draftPoints[0]].map(([la, lo]) => [lo, la]);
        await this._saveSelectedPatch({
            shape: {
                ...(this.selectedObj?.body?.shape || {}),
                kind: 'polygon',
                geojson: JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
                color: this.selectedObj?.body?.shape?.color || '#1d63dc',
            },
        });
        this.cancelEdit();
    },
    onViewportDblClick() {
        if (this.editMode === 'polygon' && this.draftPoints.length >= 3)
            this.saveDraftPolygon();
    },
    async onPointerDown(e) {
        const vp = this.$('#viewport');
        if (!vp)
            return;
        const rect = vp.getBoundingClientRect();
        const prov = PROVIDERS[this.provider] || PROVIDERS.osm;
        if (this.editMode) {
            const centerPx = latLonToPixel(this.centerLat, this.centerLon, this.zoom, prov.yandexProj);
            const clickPxX = centerPx.x - this.viewW / 2 + (e.clientX - rect.left);
            const clickPxY = centerPx.y - this.viewH / 2 + (e.clientY - rect.top);
            const ll = pixelToLatLon(clickPxX, clickPxY, this.zoom, prov.yandexProj);
            if (this.editMode === 'point') {
                await this._saveSelectedPatch({ coords: { lat: ll.lat, lon: ll.lon, zoom: this.zoom } });
                this.cancelEdit();
            }
            else if (this.editMode === 'polygon') {
                this.draftPoints = [...this.draftPoints, [ll.lat, ll.lon]];
            }
            return;
        }
        this._drag = {
            startX: e.clientX,
            startY: e.clientY,
            startCenterPx: latLonToPixel(this.centerLat, this.centerLon, this.zoom, prov.yandexProj),
        };
    },
    onPointerMove(e) {
        if (!this._drag)
            return;
        const prov = PROVIDERS[this.provider] || PROVIDERS.osm;
        const dx = e.clientX - this._drag.startX;
        const dy = e.clientY - this._drag.startY;
        const next = pixelToLatLon(this._drag.startCenterPx.x - dx, this._drag.startCenterPx.y - dy, this.zoom, prov.yandexProj);
        this.centerLat = next.lat;
        this.centerLon = next.lon;
    },
    onPointerUp() {
        this._drag = null;
    },
    async reload() {
        if (!this.$item?.fetch)
            return;
        try {
            const res = await this.$item.fetch('db_query', { limit: 500 });
            const list = Array.isArray(res?.items) ? res.items : [];
            this.items = list;
            if (!this.selectedId && list.length) {
                const withCoords = list.find(o => o.body?.coords?.lat != null);
                if (withCoords)
                    this.selectObject(withCoords);
                else
                    this.selectedId = list[0].id;
            }
        }
        catch {
            this.items = [];
        }
    },
    attached() {
        this.reload();
        const vp = this.$('#viewport');
        if (vp && typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver((entries) => {
                for (const ent of entries) {
                    if (ent.contentRect.width > 0)
                        this.viewW = Math.round(ent.contentRect.width);
                    if (ent.contentRect.height > 0)
                        this.viewH = Math.round(ent.contentRect.height);
                }
            });
            this._resizeObs.observe(vp);
        }
    },
    detached() {
        this._resizeObs?.disconnect?.();
    },
};
