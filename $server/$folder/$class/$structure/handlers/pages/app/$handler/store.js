/**
 * Состояние оболочки: рабочее пространство пользователя (`db_workspace`), контекст (подразделение и
 * место) и маршрут. Компоненты подписываются на `change` и читают геттеры; адрес и localStorage
 * подставляются снаружи, поэтому хранилище проверяется в Node без браузера.
 */
import { parseHash, formatHash, navigate, sameRoute, HOME } from './router.js';
import { resolveContext, describeContext, buildMenu, sameContext, validContext, unitChain } from './menu.js';

export class AppStore extends EventTarget {
    /**
     * @param {object} opts
     * @param {import('./api.js').WorkApi} opts.api
     * @param {string} opts.root Путь подразделения, от которого строится пространство (`/BASE`)
     * @param {object} [opts.storage] `getItem`/`setItem` (по умолчанию — localStorage)
     * @param {object} [opts.location] `{ get(): string, set(hash, replace?) }` — адрес (по умолчанию — `location.hash`)
     */
    constructor({ api, root, storage, location: loc } = {}) {
        super();
        this.api = api;
        this.root = root;
        this.storage = storage ?? globalThis.localStorage ?? { getItem: () => null, setItem: () => {} };
        this.loc = loc ?? {
            get: () => globalThis.location.hash,
            set: (hash, replace) => (replace ? globalThis.history.replaceState(null, '', hash || globalThis.location.pathname + globalThis.location.search) : (globalThis.location.hash = hash)),
        };
        this.status = 'idle';
        this.error = null;
        this.ws = null;
        this.ctx = null;
        this.route = parseHash(this.loc.get());
        this._menu = null;
        this._ctxKey = `work.ctx:${root}`;
    }

    /** Подписка на изменения; возвращает отписку. */
    subscribe(fn) {
        const h = () => fn(this);
        this.addEventListener('change', h);
        return () => this.removeEventListener('change', h);
    }

    emit() {
        this.dispatchEvent(new Event('change'));
    }

    /** Описание текущего контекста (`describeContext`) или null. */
    get context() {
        return this.ws && this.ctx ? describeContext(this.ws, this.ctx) : null;
    }

    /** Разделы меню текущего контекста. */
    get sections() {
        const c = this.context;
        if (!c)
            return [];
        if (this._menu?.for !== c)
            this._menu = { for: c, sections: buildMenu(this.ws, c.links) };
        return this._menu.sections;
    }

    /**
     * Схема класса (`db_schema`) с кэшем на время работы страницы: форма и список одного класса не
     * просят её заново. Ошибка в кэше не остаётся.
     * @returns {Promise<{ schema: object, errors: string[] }>}
     */
    schema(path) {
        this._schemas ??= new Map();
        if (!this._schemas.has(path))
            this._schemas.set(path, this.api.schema(path).catch(e => {
                this._schemas.delete(path);
                throw e;
            }));
        return this._schemas.get(path);
    }

    /** Корневое подразделение (метка организации в шапке). */
    get org() {
        return this.ws?.units.find(u => u.path === this.root) ?? this.ws?.units[0] ?? null;
    }

    /** Загрузить пространство и выбрать контекст: адрес, затем сохранённый, затем первое своё место. */
    async load() {
        this.status = 'loading';
        this.error = null;
        this.emit();
        try {
            this.ws = await this.api.workspace(this.root);
        }
        catch (e) {
            this.status = 'error';
            this.error = e;
            this.emit();
            return;
        }
        const r = parseHash(this.loc.get());
        this.ctx = resolveContext(this.ws, { unit: r.unit, place: r.place }, this.saved());
        if (!this.ctx) {
            this.status = 'empty';
            this.route = r;
        }
        else {
            this.status = 'ready';
            this.route = { ...r, unit: this.ctx.unit, place: this.ctx.place };
            this.remember();
            this.write(true);
        }
        this._menu = null;
        this.emit();
    }

    saved() {
        try {
            return JSON.parse(this.storage.getItem(this._ctxKey) || 'null');
        }
        catch {
            return null;
        }
    }

    remember() {
        try {
            this.storage.setItem(this._ctxKey, JSON.stringify(this.ctx));
        }
        catch { /* хранилище недоступно — контекст не запоминается */ }
    }

    write(replace = false) {
        const hash = formatHash(this.route);
        if (hash !== (this.loc.get() || '#'))
            this.loc.set(hash, replace);
    }

    /** Переключить контекст (подразделение и место); экран — главный: меню другого места иное. */
    setContext(ctx) {
        const next = { unit: ctx.unit, place: ctx.place || '' };
        if (!this.ws || !validContext(this.ws, next) || sameContext(next, this.ctx))
            return false;
        this.ctx = next;
        this.route = { view: HOME, unit: next.unit, place: next.place, path: '', id: '', params: {} };
        this._menu = null;
        this.remember();
        this.write();
        this.emit();
        return true;
    }

    /** Перейти на экран: поля `patch` поверх текущего маршрута. */
    go(patch) {
        const next = navigate(this.route, patch);
        if (sameRoute(next, this.route))
            return;
        this.route = next;
        this.write();
        this.emit();
    }

    /** Адрес изменился (кнопки браузера, ссылка): принять маршрут и, если он про другой контекст, переключить. */
    onLocation() {
        if (this.status !== 'ready')
            return;
        const r = parseHash(this.loc.get());
        if (sameRoute(r, this.route))
            return;
        const ctx = r.unit ? { unit: r.unit, place: r.place || '' } : this.ctx;
        if (!validContext(this.ws, ctx)) {
            this.route = { ...r, unit: this.ctx.unit, place: this.ctx.place };
            this.write(true);
            this.emit();
            return;
        }
        if (!sameContext(ctx, this.ctx)) {
            this.ctx = ctx;
            this._menu = null;
            this.remember();
        }
        this.route = { ...r, unit: ctx.unit, place: ctx.place || '' };
        this.emit();
    }

    /** Подразделения от корня до текущего (для крошек и заголовка). */
    get chain() {
        return this.ctx ? unitChain(this.ws, this.ctx.unit) : [];
    }
}

/** Единственное хранилище страницы: создаётся при запуске (`app.js`), компоненты читают `app`. */
export let app = null;

export function startApp(opts) {
    return app = new AppStore(opts);
}
