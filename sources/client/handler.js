import { $class } from './class.js';

export class $handler extends $class{
    get size(){
        return 0;
    }
    async import(path, is){
        path = this.short + '/~/' + (path || this.id);
        if(!path.endsWith('.js'))
            path += '.js'
        const module = await import(path);
        let prototype = module?.default;
        // ES-модуль кэшируется: module.default — один объект на все импорты.
        // ??= оставляло имя первого импорта, и повторный импорт того же URL
        // с другим is регистрировал старое имя, а элемент с новым is
        // оставался незарегистрированным (пустой экран при открытии во вкладке).
        // Поэтому при несовпадении имён клонируем прототип с сохранением
        // дескрипторов (геттеры/сеттеры) и регистрируем клон под нужным именем.
        const want = is || ('item-' + this.id);
        if (prototype.is && prototype.is !== want) {
            // Клонируем с сохранением дескрипторов (геттеры/сеттеры переживают
            // клонирование; Object.assign здесь нельзя — он схлопывает их в значения).
            prototype = Object.defineProperties(Object.create(Object.getPrototypeOf(prototype)), Object.getOwnPropertyDescriptors(prototype));
        }
        prototype.is = want;
        await WORK(prototype);
        return await prototype;
    }
    /** Визуалка: `{id}.js` в метапапке, иначе class.js. `is` — тег страницы (pages-explorer), иначе item-{id}. */
    async importView(is) {
        try {
            return await this.import(this.id, is);
        } catch {
            return await this.import('class.js', is);
        }
    }
    async execute(...params) {
        const module = await this.getModule();
        if (module.execute) {
            module.execute.call(this, ...params);
            return;
        }

        if (this.short.includes('form')) {
            if (window.execute) {
                window.execute(this);
                return;
            }
        }
        window.open(this.short + '/');
    }
    async showSettings(...params) {
        const module = await this.getModule();
        if (module.showSettings) {
            return await module.showSettings.call(this, ...params);
        }
    }
    get hasSettings() {
        return new AsyncPromise(async () => {
            try {
                const module = await this.getModule();
                return typeof module?.showSettings === 'function';
            } catch {
                return false;
            }
        });
    }
    async getModule() {
        const $item = Reactor.activate(this);
        $item.$context = await $item.$context;
        const module = await import(`${$item.short}/~/class.js`);
        return module.default;
    }
}
