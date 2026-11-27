export default {
    imports: 'oda//icon, oda//button',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow-y: auto;
                background: var(--content-background, #ffffff);
                color: var(--content-color, #1e293b);
                font-size: 13px;
                padding: 16px 20px;
                gap: 14px;
                box-sizing: border-box;
            }
            .head {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 10px;
                padding: 12px 16px;
                border-radius: 10px;
                border: 1px solid var(--subtle-border, var(--border-color));
                background: var(--subtle-background, #f8fafc);
            }
            .title {
                font-size: 16px;
                font-weight: 700;
            }
            .sub {
                font-size: 12px;
                color: var(--muted-color);
                margin-top: 2px;
            }
            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
                gap: 12px;
            }
            .card {
                @apply --vertical;
                gap: 8px;
                padding: 12px 14px;
                border-radius: 10px;
                border: 1px solid var(--subtle-border, var(--border-color));
                background: var(--content-background, #ffffff);
                cursor: pointer;
                transition: border-color .12s ease, box-shadow .12s ease;
            }
            .card:hover {
                border-color: var(--accent-color, #2563eb);
                box-shadow: 0 2px 8px rgba(37, 99, 235, 0.08);
            }
            .card-top {
                @apply --horizontal;
                align-items: center;
                gap: 10px;
            }
            .card-name {
                font-weight: 700;
                font-size: 14px;
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .badge {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                font-size: 11.5px;
                font-weight: 600;
                padding: 2px 8px;
                border-radius: 999px;
                background: var(--subtle-background);
                color: var(--muted-color);
                white-space: nowrap;
            }
            .badge.on {
                background: light-dark(#dcfce7, #14532d);
                color: light-dark(#166534, #bbf7d0);
            }
            .dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: #94a3b8;
            }
            .badge.on .dot {
                background: #22c55e;
            }
            .reason {
                font-size: 12px;
                color: var(--muted-color);
            }
        </style>

        <div class="head">
            <div>
                <div class="title">Провайдеры и модели ИИ</div>
                <div class="sub">Выберите провайдера для настройки API-ключей, локальных весов и дообучения.</div>
            </div>
            <oda-button icon="icons:refresh" @tap="reload()">Обновить</oda-button>
        </div>

        <div ~if="error" style="color:var(--error-color, #dc2626);font-size:12.5px;">{{error}}</div>

        <div class="grid">
            <div class="card" ~for="providers" @tap="openProvider($for.item)">
                <div class="card-top">
                    <oda-icon :icon="$for.item.icon" icon-size="24"></oda-icon>
                    <span class="card-name">{{$for.item.label}}</span>
                    <span class="badge" ~class="{ on: $for.item.active }">
                        <span class="dot"></span>
                        <span>{{$for.item.active ? 'Активен' : 'Не настроен'}}</span>
                    </span>
                </div>
                <div class="reason">{{$for.item.reason}}</div>
            </div>
        </div>
    `,
    $item: {
        $def: null,
        set(n) {
            if (n)
                this.reload();
        }
    },
    providers: [],
    error: '',
    async attached() {
        await this.reload();
    },
    async reload() {
        this.error = '';
        if (!this.$item)
            return;
        try {
            const raw = await Promise.resolve(this.$item.items).catch(() => []) || [];
            const list = [];
            for (const it of raw) {
                if (!it || it.id?.[0] === '$')
                    continue;
                const active = Boolean(it.DATA?.aiActive ?? it.aiActive);
                const reason = String(it.DATA?.aiStatusReason || it.aiStatusReason || it.DATA?.protocol || it.path || '');
                list.push({
                    id: it.id,
                    label: it.DATA?.label || it.label || it.id,
                    icon: it.DATA?.icon || (typeof it.icon === 'string' ? it.icon : '') || 'carbon:api',
                    active,
                    reason,
                    item: it,
                });
            }
            this.providers = list;
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    openProvider(entry) {
        if (entry?.item && typeof window?.execute === 'function')
            window.execute(entry.item);
    },
};
