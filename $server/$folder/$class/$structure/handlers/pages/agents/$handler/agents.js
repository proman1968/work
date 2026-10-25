/**
 * Страница «Агенты» (9.3-UI): панель наблюдаемости для администратора.
 * Данные — метод корня agent_panel (GET /?agent_panel, REST с cookie-сессией):
 * задачи в работе и ожидающие человека, стоимость за день и месяц по пользователям,
 * последние записи журнала безопасности, песочницы.
 *
 * Рендер — DOM-строением с textContent (никакого innerHTML): пути задач, uid,
 * тексты журнала — данные, не разметка; экранирование не нужно, потому что
 * разметки из данных не строится вовсе.
 */
export default {
    icon: 'iconoir:dashboard',
    imports: 'oda//button, oda//icon',
    template: /* html */`
        <style>:host { @apply --vertical; @apply --flex; }</style>
        <div slot="top-panel" horizontal style="gap:4px; align-items:center;">
            <oda-button icon="icons:refresh" @tap="agentsPage?.reload?.()" title="Обновить"></oda-button>
        </div>
        <form-agents flex :$item></form-agents>
    `,
    get agentsPage() {
        return this.$('form-agents');
    },
}

ODA({
    is: 'form-agents',
    template: /* html */`
        <style>
            :host { @apply --vertical; @apply --flex; overflow: auto; }
            #body { @apply --vertical; gap: 12px; width: 100%; max-width: 920px; margin: 0 auto; padding: 16px 20px 40px; box-sizing: border-box; }
            h1 { margin: 0; font-size: 1.25rem; }
            h2 { margin: 12px 0 0; font-size: 1.02rem; }
            ul { margin: 2px 0 0; padding-left: 20px; }
            li { line-height: 1.45; }
            .muted { @apply --muted; font-size: small; }
            .error { color: var(--danger, #b3261e); line-height: 1.5; }
            table { border-collapse: collapse; margin-top: 4px; }
            th { @apply --muted; font-weight: 500; text-align: left; }
            td, th { padding: 3px 14px 3px 0; line-height: 1.4; }
        </style>
        <div id="body" vertical flex></div>
    `,
    attached() {
        this.reload();
    },
    async reload() {
        // DOM компонента строится лениво (ODA observers): ждём #body до 2,5 с
        let body = null;
        for (let i = 0; i < 50 && !(body && typeof body.append === 'function'); i++) {
            body = this.__shadowRoot__?.querySelector?.('#body') ?? this.$?.('#body') ?? null;
            if (!(body && typeof body.append === 'function')) {
                body = null;
                await new Promise(r => setTimeout(r, 50));
            }
        }
        if (!body)
            return;
        body.textContent = '';
        let p;
        try {
            const res = await fetch('/?agent_panel');
            if (!res.ok)
                throw new Error((await res.text().catch(() => '')).slice(0, 200) || 'HTTP ' + res.status);
            p = await res.json();
            if (p && p.error != null)
                throw new Error(String(p.error));
        }
        catch (e) {
            const div = document.createElement('div');
            div.className = 'error';
            div.textContent = 'Панель не получена: ' + String(e?.message || e) + '. Доступ — администратору WORK (запустите от его имени или попросите агента it-admin).';
            body.append(div);
            return;
        }
        this.renderPanel(body, p);
    },
    /** Сводка данными (agent_panel) — DOM-строением, без innerHTML. */
    renderPanel(body, p) {
        const el = (tag, cls, text) => {
            const n = document.createElement(tag);
            if (cls)
                n.className = cls;
            if (text != null)
                n.textContent = String(text);
            return n;
        };
        const section = title => {
            const s = el('section');
            s.append(el('h2', '', title));
            body.append(s);
            return s;
        };
        const money = c => c == null || !Number.isFinite(Number(c)) || !Number(c) ? '—' : '$' + (+Number(c).toFixed(4));
        const tok = n => (Number(n) || 0).toLocaleString('ru-RU') + ' ток.';
        body.append(el('h1', '', 'Агенты — панель наблюдаемости'));
        body.append(el('div', 'muted', 'по состоянию на ' + String(p.time || '').replace('T', ' ').slice(0, 16)));
        // задачи
        const t = p.tasks || {};
        const ts = section('Задачи');
        ts.append(el('div', '', (t.running?.length || 0) + ' в работе, ' + (t.waiting?.length || 0) + ' ждут человека'));
        if ((t.running?.length || 0) + (t.waiting?.length || 0)) {
            const ul = el('ul');
            for (const x of t.running || [])
                ul.append(el('li', '', '[работает] ' + x));
            for (const x of t.waiting || [])
                ul.append(el('li', '', '[ждёт человека] ' + x));
            ts.append(ul);
        }
        // стоимость
        const c = p.cost || {};
        const cs = section('Стоимость');
        cs.append(el('div', '', 'Сегодня: ' + tok(c.day?.tokens) + ', ' + money(c.day?.cost) + ' · Месяц: ' + tok(c.month?.tokens) + ', ' + money(c.month?.cost)));
        const users = c.byUserDay || [];
        if (users.length) {
            const table = el('table');
            const hr = el('tr');
            for (const h of ['Пользователь (сегодня)', 'Ходов', 'Токены', 'Стоимость'])
                hr.append(el('th', '', h));
            const thead = el('thead');
            thead.append(hr);
            const tb = el('tbody');
            for (const u of users) {
                const tr = el('tr');
                tr.append(el('td', '', u.uid), el('td', '', u.turns), el('td', '', tok(u.tokens)), el('td', '', money(u.cost)));
                tb.append(tr);
            }
            table.append(thead, tb);
            cs.append(table);
        }
        // журнал безопасности
        const a = p.audit || {};
        const as = section('Журнал безопасности (последние сегодня)');
        if (a.last?.length) {
            const ul = el('ul');
            for (const r of a.last)
                ul.append(el('li', '', String(r.time || '').slice(11, 19) + ' ' + r.event + (r.tool ? '/' + r.tool : '')
                    + (r.subject ? ' — ' + r.subject : '') + ' → ' + (r.verdict || '') + (r.outcome ? ' ' + r.outcome : '')));
            as.append(ul);
        }
        else
            as.append(el('div', 'muted', 'записей сегодня нет'));
        const counts = Object.entries(a.counts || {});
        if (counts.length)
            as.append(el('div', 'muted', 'события сегодня: ' + counts.map(([k, v]) => k + ' ' + v).join(', ')));
        // песочницы
        const s = p.sandbox || {};
        const ss = section('Песочницы');
        if (Array.isArray(s.computers)) {
            ss.append(el('div', '', s.computers.length + ' контейнер(ов), запущено: ' + s.computers.filter(x => x.state === 'running').length));
            if (s.computers.length) {
                const ul = el('ul');
                for (const x of s.computers)
                    ul.append(el('li', '', (x.owner || '?') + '/' + (x.name || '?') + ' — ' + (x.state || '?')));
                ss.append(ul);
            }
        }
        else
            ss.append(el('div', 'muted', s.unavailable ? ('Docker недоступен: ' + s.unavailable) : (s.error ? ('ошибка: ' + s.error) : 'состояние неизвестно')));
    },
});
