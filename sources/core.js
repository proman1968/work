/**
 * Общее ядро FS-сущностей (общий предок для сервера и клиента).
 * Среда-независимый код: DATA, путь, признаки типа, genGUID.
 * Браузерная логика (fetch, save_file, body, url) — в sources/client/folder.js.
 * Серверная специфика (fs) — в sources/server/*.
 *
 * Reactor доступен глобально из oda/reactor.js.
 */
export class $item extends Reactor {
    constructor(data = {}) {
        super();
        this.DATA = data;
    }
    get $item() {
        return this;
    }
    get $public() {
        return {
            get id() {
                return this.DATA.id;
            },
            get name() {
                return (this.DATA?.name || this.id || this.path.split('/').last);
            },
            get label() {
                return (this.DATA?.label || this.name);
            },
            type: '',
        };
    }
    get short() {
        return this.constructor.toShortPath(this.path);
    }
    get isType() {
        return this.constructor.isMetaId(this.id);
    }
    get isHidden() {
        return this.constructor.isHiddenId(this.id);
    }
    get ext() {
        if (this.type === '$file') {
            let idx = this.path.lastIndexOf('.');
            if (idx > -1)
                return this.path.substring(idx + 1);
        }
        return '';
    }
    set isChanged(n) {
        if (n)
            this.fire('changed');
    }
    toString() {
        return this.constructor.name + ': ' + this.path;
    }

    static genGUID(size = 15) {
        let time = new Date().getTime();
        if (time !== this.time) {
            this.time = time;
            this.rndID = [];
        }
        time = time.toString(16);
        size -= time.length;

        let rnd = '';
        for (let i = 0; i < size; i++) {
            rnd += Math.floor(Math.random() * 16).toString(16);
        }
        if (this.rndID.indexOf(rnd) > -1)
            return this.genGUID();
        this.rndID.push(rnd);
        return (rnd + time);
    }
    static toShortPath(path) {
        return path?.replace(/\/\$[^/]+(?:\/\$[^/]+)*(?=\/[^$])/g, '/~') || '';
    }
    static isMetaId(id) {
        return id?.[0] === '$';
    }
    static isSystemId(id) {
        return id?.[0] === '#';
    }
    static isHiddenId(id) {
        return id?.[0] === '.';
    }
}
$item.LISTS = ['items', 'files', 'folders', 'children', 'users'];
$item.ITEMS = Object.create(null);
