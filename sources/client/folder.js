import { $item } from '../core.js';

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
                $save: true,
                set(role) {
                    const colors = { admin: 'red', master: 'green', slave: 'indigo' };
                    document.documentElement?.style?.setProperty('--main-color', colors[role] || 'indigo');
                }
            },
        }
    }
    get url() {
        return encodeURI(globalThis.location?.origin + this.short);
    }
    get open_url() {
        return new URL(this.url + '/~/handlers//' + this.page + '/index.html').href;
    }
    get_item(path, method, params = {}) {
        path = this.short + path;
        return WORK.get_item(path, method, params);
    }
    /** Роли текущего пользователя в данном классе (через серверный метод roles). */
    get roles() {
        return this.fetch('roles').then(roles => Array.isArray(roles) ? roles : []);
    }
    /** Проверка роли администратора. */
    get isAdmin() {
        return this.roles.then(roles => roles.includes('admin'));
    }
    get expanded() {
        return false
    }
    get checked() {
        return false
    }
    get count() {
        return 0;
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
    reset() {
        if (this.path)
            this.fetch('reset');
        else {
            this[R].cache = {};
            this.fire('changed');
        }
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
        if (this.expanded)
            return this.isType ? 'fontawesome:s-folder-open' : 'fontawesome:r-folder-open';
        return this.isType ? 'fontawesome:s-folder' : 'fontawesome:r-folder';
    }
    _onEmpty(key, params = {}) {
        if (key[0] === '#')
            return undefined;
        let fn = (params = {}) => {
            if (this[R].cache[key] !== undefined) return this[R].cache[key];
            let path;
            switch (key) {
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
