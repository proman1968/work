import { $item } from '../core.js';

/**
 * Эффективная роль точки: предпочитаемая, если доступна (включая USER
 * для просмотра); иначе ближайшая к ней по порядку, при равной
 * удалённости — более слабая; без предпочтения — сильнейшая из своих.
 * @param {string[]} mine Свои роли в точке
 * @param {string[]} order Порядок ролей точки
 * @param {string} preferred Предпочитаемая роль приложения
 * @returns {string} Роль или 'GUEST'
 */
export function effectiveRole(mine = [], order = [], preferred = '') {
    mine = Array.isArray(mine) ? [...new Set(mine)] : [];
    if (!mine.length)
        return 'GUEST';
    const selectable = mine.includes('USER') ? mine : [...mine, 'USER'];
    if (preferred && selectable.includes(preferred))
        return preferred;
    const rank = r => {
        const i = order.indexOf(r);
        return i < 0 ? order.length : i;
    };
    if (!preferred)
        return mine.slice().sort((a, b) => rank(a) - rank(b))[0];
    const pr = rank(preferred);
    return mine.slice().sort((a, b) =>
        (Math.abs(rank(a) - pr) - Math.abs(rank(b) - pr)) || (rank(b) - rank(a)))[0];
}

export class $folder extends $item {
    __version = 0;
    increaseVersion() {
        return ++this.__version;
    }
    async update(key, value) {
        let body = await this.body;
        body[key] = value;
        this.isChanged = true;
    }
    get body() {
        return undefined;
    }
    get subIcon() {
        return '';
    }
    get tools() {
        return [];
    }
    /** Схема FIELDS типизатора — из DATA.METADATA. Не кэшировать до прихода METADATA (иначе пустой root навсегда). */
    get $fields() {
        const meta = this.DATA?.METADATA;
        if (!meta) {
            this._fieldsRoot = undefined;
            this._fieldsMeta = undefined;
            return undefined;
        }
        const listFn = globalThis.CORE?.$class?.fieldsList;
        meta.FIELDS = listFn
            ? listFn(meta.FIELDS)
            : (Array.isArray(meta.FIELDS) ? meta.FIELDS : (meta.FIELDS?.fields || []));
        if (this._fieldsRoot && this._fieldsMeta === meta)
            return this._fieldsRoot;
        this._fieldsMeta = meta;
        return this._fieldsRoot = new CORE.$field({ id: 'FIELDS', fields: meta.FIELDS }, this);
    }
    get $public() {
        return {
            '@system': {
                get path() {
                    return this.DATA.path;
                },
                get isInherit() {
                    return this.DATA.isInherit;
                }
            },
            '@view': {
                form: 'folder',
                page: 'form',
            },
            role: {
                $def: '',
            },
        }
    }
    get url() {
        return encodeURI(globalThis.location?.origin + this.short);
    }
    /**
     * Роли пользователя в точке (сервер). Кэш сбрасывается в reset().
     * @returns {Promise<string[]>} Роли без дубликатов
     */
    get myRoles() {
        return this._myRoles ??= Promise.resolve(this.fetch('roles'))
            .then(roles => Array.isArray(roles) ? [...new Set(roles)] : [])
            .catch(() => []);
    }
    /** Порядок ролей точки для выбора ближайшей (ключи declared_roles). */
    get roleOrder() {
        return this._roleOrder ??= Promise.resolve(this.fetch('declared_roles'))
            .then(d => (d && typeof d === 'object' ? Object.keys(d) : ['ADMIN', 'BOSS', 'USER', 'GUEST']))
            .catch(() => ['ADMIN', 'BOSS', 'USER', 'GUEST']);
    }
    /**
     * Роли для переключателя: свои + USER, чтобы смотреть глазами исполнителя.
     * @returns {Promise<string[]>}
     */
    get selectableRoles() {
        return Promise.all([this.myRoles]).then(([mine]) =>
            mine.includes('USER') ? mine : [...mine, 'USER']);
    }
    /**
     * Эффективная роль точки: предпочитаемая (если доступна здесь),
     * иначе ближайшая по порядку; без предпочтения — сильнейшая.
     */
    async syncRole() {
        const mine = await this.myRoles;
        const order = await this.roleOrder;
        const next = effectiveRole(mine, order, WORK.preferredRole);
        if (this.role !== next)
            this.role = next;
        return this.role;
    }
    /** Заполнить роль, если пустая (перед запросами, зависящими от роли). */
    async ensureRole() {
        if (!this.role)
            await this.syncRole();
        return this.role;
    }
    get open_url() {
        return new URL(this.url + '/~/handlers//' + this.page + '/index.html').href;
    }
    get_item(path, method, params = {}) {
        path = String(path ?? '');
        if (path && !/^[\/~?]/.test(path))
            path = '/' + path;
        path = this.short + path;
        return WORK.get_item(path, method, params);
    }
    /** Роли текущего пользователя в данном классе (через серверный метод roles). */
    get roles() {
        return Promise.resolve(this.fetch('roles')).then(roles => Array.isArray(roles) ? roles : []);
    }
    /** Проверка роли администратора. */
    get isAdmin() {
        return Promise.resolve(this.roles).then(roles => roles.includes('ADMIN'));
    }
    get expanded() {
        return false
    }
    get checked() {
        return false
    }
    get localStorage() {
        return new ODA.LocalStorage(this.path)
    }
    get users() {
        return this.get_item('/@users');
    }
    get admins() {
        return null;
    }
    get bosses() {
        return null;
    }
    get allAdmins() {
        return null;
    }
    get allBosses() {
        return null;
    }
    reset() {
        this._myRoles = undefined;
        this._roleOrder = undefined;
        if (this.path)
            this.fetch('reset');
        else {
            this[R].cache = {};
            this.fire('changed');
        }
        return true;
    }
    invite(view) {
        return this.fetch('invite', { view });
    }
    get script() {
        if (this.ext === 'js')
            return this.import();
    }
    async save_files(data, params = {}) {
        return this.fetch('save_files', params, data);
    }
    async save_includes(data) {
        return this.fetch('save_includes', {}, data)
    }
    async save_file(file, params = {}) {
        return new Promise(resolve => {
            params.filename = params.id = file.name;
            const fr = new FileReader();
            fr.onload = async () => {
                let data = fr.result;
                let res = await this.fetch('save_file', params, data);
                resolve(res)
            }
            fr.readAsArrayBuffer(file);
        })
    }
    writeToStream(data, params = {}) {
        return this.fetch('write_to_stream', params, data, data.type);
    }
    closeWriteStream(params = {}) {
        return this.fetch('close_write_stream', params);
    }
    async execute(...params) {
        if (window.execute) {
            window.execute(Reactor.activate(this));
        }
        else {
            let url = encodeURI(this.short + '/~/handlers//' + this.page + '/');
            window.open(url);
        }
    }
    async download() {
        const link = document.createElement('a');
        link.setAttribute('href', this.short + '?download');
        link.setAttribute('download', this.id);
        link.click();
    }
    fetch(method, params, post_data) {
        params ??= {};
        if (this.role && !params.role)
            params.role = this.role;
        return WORK.fetch?.(this.short || '/', method, params, post_data).then(res => {
            return WORK.__bind(res);
        })
    }
    delete() {
        return this.fetch('delete');
    }
    create(p = {}, post) {
        return this.fetch('create', p, post);
    }
    ensure_folder(p = {}) {
        return this.fetch('ensure_folder', p);
    }
    load(params = {}) {
        return this.body ??= new AsyncPromise(async _ => {
            return this.fetch('load', {...params, version: this.__version});
        })
    }
    async save(post = this.body) {
        await this.fetch('save', {}, post);
        this.isChanged = false;
    }
    async reload() {
        let data = await this.fetch('info');
        this.DATA = data;
    }
    send(params = { text: "привет", includes: [{}] }) {
    }
    get size() {
        return this.fetch('size').then(size => {
            if (size) {
                let pcs;
                if (size < 1000) {
                    pcs = ' b';
                } else if (size < 1000000) {
                    size = Math.round(size / 10) / 100;
                    pcs = ' Kb'
                } else if (size < 1000000000) {
                    size = Math.round(size / 10000) / 100;
                    pcs = ' Mb'
                } else if (size < 1000000000000) {
                    size = Math.round(size / 10000000) / 100;
                    pcs = ' Gb'
                } else if (size < 1000000000000000) {
                    size = Math.round(size / 10000000000) / 100;
                    pcs = ' Tb'
                }
                return size.toLocaleString() + pcs;
            }
            return size;
        });
    }
    get icon() {
        if (this.DATA?.icon)
            return this.DATA.icon;
        if (this.expanded)
            return this.isType ? 'fontawesome:s-folder-open' : 'fontawesome:r-folder-open';
        return this.isType ? 'fontawesome:s-folder' : 'fontawesome:r-folder';
    }
    _onEmpty(key, params = {}) {
        if (key[0] === '#')
            return undefined;
        // отладка: сколько раз какое свойство ушло на сервер (WORK.emptyHits; tests/perf/tree-load.mjs)
        if (WORK.DEV_MODE)
            (WORK.emptyHits ??= {})[key] = (WORK.emptyHits[key] || 0) + 1;
        let fn = (params = {}) => {
            if (this[R].cache[key] !== undefined) return this[R].cache[key];
            // дети — через info с глубиной 1: у каждого ребёнка приходит hasItems,
            // и дереву не нужен отдельный @items ради стрелки раскрытия
            if (key === 'items' && this.type !== '$file' && !String(this.short).includes('~'))
                return WORK.fetch(location.origin + (this.short || '/'), 'info', { ...params, deep: 1 })
                    .then(r => Array.isArray(r?.items) ? r.items : []);
            let path;
            switch (key) {
                case 'entries':
                case 'files':
                case 'folders':
                    path = this.path;
                    break
                default:
                    path = this.short;
            }
            return WORK.fetch(location.origin + path + '/@' + key, '', params);
        }
        return fn(params).then(r => WORK.__bind(r)).then(result => {
            return this[key] = this[R].cache[key] = Reactor.activate(result);
        }).catch(e => {
            console.warn(e)
            return this[key] = null;
        })
    }
}
