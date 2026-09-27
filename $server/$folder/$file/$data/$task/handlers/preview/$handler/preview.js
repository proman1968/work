/**
 * Превью .task (карточка в проводнике/ленте): заголовок, статус, последний ответ агента.
 */
export default {
    imports: 'oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/ `
        <style>
            :host { @apply --vertical; gap: 6px; padding: 8px 10px; min-width: 0; overflow: hidden; }
            .head { @apply --horizontal; align-items: center; gap: 6px; font-size: small; min-width: 0; }
            .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .chip { @apply --chip; }
            .body { font-size: small; max-height: 240px; overflow: hidden; -webkit-mask-image: linear-gradient(black 75%, transparent); mask-image: linear-gradient(black 75%, transparent); }
            .muted { @apply --muted; font-size: small; }
        </style>
        <div class="head">
            <oda-icon no-flex icon="bootstrap:robot" :icon-size="16"></oda-icon>
            <span class="title" flex>{{title}}</span>
            <span class="chip" no-flex ~if="statusLabel">{{statusLabel}}</span>
        </div>
        <div class="body" ~if="answer"><oda-markdown-viewer vertical :value="answer"></oda-markdown-viewer></div>
        <div class="muted" ~if="!answer">{{hint}}</div>
    `,
    task: null,
    $item: {
        async set(n) {
            n?.listen('changed', () => this._load());
            this._load();
        },
    },
    async _load() {
        try {
            const raw = await this.$item?.load();
            this.task = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
        }
        catch {
            this.task = null;
        }
    },
    get title() { return this.task?.title || this.task?.name || 'Задача'; },
    get statusLabel() {
        return { running: 'работает', waiting: 'ждёт вас', stopped: 'остановлено', error: 'ошибка', limit: 'лимит' }[this.task?.status] || '';
    },
    get answer() {
        const items = this.task?.items || [];
        for (let i = items.length - 1; i >= 0; i--)
            if (items[i]?.type === 'assistant' && String(items[i].content || '').trim() && !items[i].error)
                return String(items[i].content);
        return '';
    },
    get hint() {
        const items = this.task?.items || [];
        const q = [...items].reverse().flatMap(i => i.tools || []).find(t => t.status === 'waiting' || t.status === 'approval');
        if (q)
            return q.name === 'ask_user' ? 'Вопрос: ' + (q.args?.question || '') : 'Ждёт разрешения: ' + q.name;
        const u = items.find(i => i.type === 'user');
        return u ? String(u.content || '') : 'Пустая задача';
    },
};
