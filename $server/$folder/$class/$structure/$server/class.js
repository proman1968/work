export default {
    isSystem: true,
    icon: './odant.png',
    ACCESS: {
        distro_info: 'read',
        export_distro: 'read',
    },
    async distro_info(params = {}) {
        const { pathToFileURL } = await import('node:url');
        const path = await import('node:path');
        const { serverDistroMethods } = await import(pathToFileURL(path.resolve('sources/server/class/distro.js')).href);
        return serverDistroMethods.distro_info.call(this, params);
    },
    async export_distro(params = {}) {
        const { pathToFileURL } = await import('node:url');
        const path = await import('node:path');
        const { serverDistroMethods } = await import(pathToFileURL(path.resolve('sources/server/class/distro.js')).href);
        return serverDistroMethods.export_distro.call(this, params);
    },
}
