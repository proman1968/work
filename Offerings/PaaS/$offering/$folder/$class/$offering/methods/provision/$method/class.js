async function deployApplication(staticCfg, subdomain) {
    const deployUrl = String(staticCfg.deployUrl || '').trim();
    if (!deployUrl)
        return { ok: true, stub: true, reason: 'deployUrl not configured' };

    const token = String(staticCfg.deployToken || '').trim();
    const headers = { 'Content-Type': 'application/json' };
    if (token)
        headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    const body = {
        metadata: { name: subdomain },
        spec: {
            project: staticCfg.project || 'default',
            source: {
                repoURL: staticCfg.repoURL || '',
                chart: staticCfg.chart || '',
                targetRevision: '*',
            },
            destination: {
                server: staticCfg.destinationServer || 'https://kubernetes.default.svc',
                namespace: subdomain,
            },
            syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
    };

    try {
        const res = await fetch(deployUrl, { method: 'POST', headers, body: JSON.stringify(body) });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch { data = { raw: text }; }
        if (!res.ok)
            return { ok: false, status: res.status, error: data?.message || text };
        return { ok: true, data };
    }
    catch (e) {
        return { ok: false, error: e.message, stub: true };
    }
}

export default {
    async execute(params = {}, post) {
        const P = await globalThis.loadHost('offering-paas');
        const offering = params.$context || params.$offering || this;
        await offering.info?.();
        const body = typeof post === 'string' ? P.safeParse(post) : (post || params);
        const proposal = body?.proposal || params.proposal || body?.order;
        if (!proposal?.subdomain)
            throw new Error('provision: нет subdomain');

        const skip = ['в процессе создания', 'работает', 'остановлен', 'ready'];
        if (proposal.status && skip.includes(proposal.status))
            return { ok: true, skipped: true, status: proposal.status };

        const staticCfg = P.getStaticFields(offering);
        const subdomain = P.normalizeSubdomain(proposal.subdomain);
        const baseDomain = String(staticCfg.baseDomain || 'odant.org').replace(/^\.+/, '');
        const fqdn = proposal.fqdn || `${subdomain}.${baseDomain}`;
        const url = proposal.url || `https://${fqdn}`;
        const buyer = proposal.buyer;
        const planId = proposal.planId;

        const deployResult = await deployApplication(staticCfg, subdomain);

        const paasRoot = await WORK.get_item('/paas');
        if (!paasRoot?.create)
            throw new Error('provision: /paas недоступен');

        const paasPath = '/paas/' + subdomain;
        let paasItem = await WORK.get_item(paasPath, 0, undefined, { user: globalThis.WORK });
        if (!paasItem || paasItem.type !== '$paas') {
            if (paasItem && paasRoot.__items__)
                delete paasRoot.__items__[subdomain];
            paasRoot.reset?.();
            await paasRoot.create({
                type: '$paas',
                id: subdomain,
                post: P.toDataJs({
                    label: subdomain,
                    tariff: planId,
                    subdomain,
                    fqdn,
                    url,
                    status: 'в процессе создания',
                    buyer,
                    usersActiveToday: 0,
                    '#security': buyer ? { admin: buyer, users: [buyer] } : {},
                }),
                user: globalThis.WORK,
            });
            paasItem = await WORK.get_item(paasPath, 0, undefined, { user: globalThis.WORK });
        }

        proposal.status = deployResult.ok ? 'provisioning' : 'approved';
        proposal.deploy = deployResult;
        proposal.paasPath = paasPath;
        proposal.provisioned = Date.now();

        return {
            ok: true,
            stub: !!deployResult.stub,
            paasPath,
            deploy: deployResult,
            status: proposal.status,
        };
    },
};
