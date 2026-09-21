// Браузерные заглушки Node-модулей, чтобы core/bin-net.js и слои
// импортировались в стенде без правок. Все файловые операции — noop/reject:
// тесты работают in-memory, персистентность им не нужна.
const noopFs = {
    existsSync: () => false,
    mkdirSync: () => {},
    readFileSync: () => { throw new Error('shim-fs: readFileSync недоступен в браузере'); },
    writeFileSync: () => { throw new Error('shim-fs: writeFileSync недоступен в браузере'); },
    statSync: () => { throw new Error('shim-fs: statSync недоступен в браузере'); },
};
const noopFsp = {
    readFile: async () => { throw new Error('shim-fs: readFile недоступен в браузере'); },
    writeFile: async () => { throw new Error('shim-fs: writeFile недоступен в браузере'); },
    mkdir: async () => {},
    stat: async () => { throw new Error('shim-fs: stat недоступен в браузере'); },
};
const fakePath = {
    join: (...parts) => parts.join('/'),
    basename: (p) => String(p).split('/').pop(),
    dirname: (p) => String(p).split('/').slice(0, -1).join('/') || '.',
    sep: '/',
};
const combined = { ...noopFs, ...noopFsp, ...fakePath, default: undefined };
combined.default = combined;
export default combined;
export const existsSync = noopFs.existsSync;
export const mkdirSync = noopFs.mkdirSync;
export const readFile = noopFsp.readFile;
export const writeFile = noopFsp.writeFile;
export const join = fakePath.join;
export const basename = fakePath.basename;
export const dirname = fakePath.dirname;
export const sep = fakePath.sep;
