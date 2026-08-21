import { $class } from './class.js';

export class $handler extends $class{
    get size(){
        return 0;
    }
    async import(path){
        path = this.short + '/~/' + path;
        if(!path.endsWith('.js'))
            path += '.js'
        const module = await import(path);
        let prototype = module?.default;
        prototype.is ??= 'item-' + this.id;
        await WORK(prototype);
        return await prototype;
    }
    /** Визуалка: `{id}.js` в метапапке, иначе class.js. */
    async importView() {
        try {
            return await this.import(this.id);
        } catch {
            return await this.import('class.js');
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
        const module = await import($item.short + '/~/class.js');
        return module.default;
    }
}
