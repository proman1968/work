/**
 * Создание Application в Argo CD — stub.
 * Тело заявки: params.spec или post (JSON Application).
 */
export default {
    async execute(params = {}, post) {
        const svc = params.$service || params.$context;
        if (!svc?.url)
            throw new Error('Argo CD: не задан url');

        let spec = params.spec;
        if (!spec && post) {
            spec = typeof post === 'string' ? JSON.parse(post) : post;
        }
        if (!spec)
            throw new Error('createApplication: нет spec');

        console.info('[ArgoCD] createApplication stub', svc.url, spec?.metadata?.name || spec);
        return {
            ok: true,
            stub: true,
            message: 'createApplication: заглушка',
            application: spec,
        };
    },
};
