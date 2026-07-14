/**
 * Проверка доступности Argo CD (stub / лёгкий ping).
 */
export default {
    async execute(params = {}) {
        const svc = params.$service || params.$context;
        if (!svc?.url)
            throw new Error('Argo CD: не задан url');
        return {
            ok: true,
            stub: true,
            url: svc.url,
            message: 'checkConnect: заглушка (реальный API позже)',
        };
    },
};
