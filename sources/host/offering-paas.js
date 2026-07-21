export function normalizeSubdomain(raw) {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .replace(/^-+|-+$/g, '');
}

export function safeParse(s) {
    try { return JSON.parse(s); }
    catch { return null; }
}

export function formatPrice(plan) {
    const amount = plan?.price?.amount;
    const currency = plan?.price?.currency || 'RUB';
    if (amount == null || amount === 0)
        return { priceLabel: 'БЕСПЛАТНО', priceHint: plan?.price?.unit ? '' : '-' };
    const unit = plan?.price?.unit || '';
    const formatted = new Intl.NumberFormat('ru-RU').format(amount);
    const suffix = currency === 'RUB' ? ' ₽' : ` ${currency}`;
    return {
        priceLabel: `от ${formatted}${suffix}`,
        priceHint: unit.replace('/', ' / ') || '',
    };
}

export function planCardView(plan) {
    const { priceLabel, priceHint } = formatPrice(plan);
    return {
        id: plan.id,
        title: plan.title || plan.id,
        priceLabel,
        priceHint,
        includes: plan.includes || [],
        badge: plan.badge || null,
        default: !!plan.default,
    };
}

export function getStaticFields(offering) {
    const data = offering?.DATA || {};
    return {
        baseDomain: data.baseDomain || 'odant.org',
        deployUrl: data.deployUrl || '',
        deployToken: data.deployToken || '',
        project: data.project || 'default',
        chart: data.chart || '',
        repoURL: data.repoURL || '',
        destinationServer: data.destinationServer || 'https://kubernetes.default.svc',
    };
}

export function getFormFields(offering) {
    return offering?.METADATA?.FIELDS?.fields
        || offering?.DATA?.METADATA?.FIELDS?.fields
        || [];
}

export function buildProposalForm({ plan, staticCfg, fields, values = {} }) {
    const baseDomain = String(staticCfg.baseDomain || 'odant.org').replace(/^\.+/, '');
    const subdomain = values.subdomain || '';
    const previewUrl = subdomain
        ? `https://${normalizeSubdomain(subdomain)}.${baseDomain}`
        : '';

    const descriptorFields = (fields.length ? fields : [
        { id: 'subdomain', type: 'String', placeholder: 'my-org' },
        { id: 'planId', type: 'String' },
        { id: 'contactEmail', type: 'String', placeholder: 'email@example.com' },
    ]).map(f => ({
        id: f.id,
        type: f.type || 'String',
        label: f.label || f.id,
        placeholder: f.placeholder || '',
        required: f.required ?? (f.id === 'subdomain' || f.id === 'planId'),
        hidden: f.hidden ?? f.id === 'planId',
        readonly: f.readonly ?? (f.id === 'previewUrl'),
        computed: f.computed ?? (f.id === 'previewUrl'),
        constraints: f.constraints || (f.id === 'subdomain' ? {
            pattern: '^[a-z0-9-]+$',
            minLength: 2,
            maxLength: 63,
        } : {}),
        sizing: f.sizing || (f.type === 'Text' ? 'full' : 'mid'),
    }));

    if (!descriptorFields.some(f => f.id === 'previewUrl')) {
        descriptorFields.push({
            id: 'previewUrl',
            type: 'String',
            label: 'Адрес',
            readonly: true,
            computed: true,
            hidden: false,
            sizing: 'full',
        });
    }

    return {
        planId: plan?.id,
        plan: plan ? planCardView(plan) : null,
        values: {
            planId: plan?.id || values.planId || '',
            subdomain: values.subdomain || '',
            contactEmail: values.contactEmail || '',
            previewUrl,
            ...values,
        },
        fields: descriptorFields,
    };
}

export function validateProposalData(data, { staticCfg, plan } = {}) {
    const errors = {};
    const subdomain = normalizeSubdomain(data.subdomain);
    if (!subdomain)
        errors.subdomain = 'Укажите имя хоста';
    else if (subdomain.length < 2)
        errors.subdomain = 'Слишком короткое имя';
    else if (subdomain.length > 63)
        errors.subdomain = 'Слишком длинное имя';

    const planId = String(data.planId || plan?.id || '').trim();
    if (!planId)
        errors.planId = 'Не выбран тариф';

    const email = String(data.contactEmail || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.contactEmail = 'Некорректный email';

    const baseDomain = String(staticCfg?.baseDomain || 'odant.org').replace(/^\.+/, '');
    const fqdn = subdomain ? `${subdomain}.${baseDomain}` : '';
    const valid = !Object.keys(errors).length;
    return {
        valid,
        errors,
        normalized: valid ? {
            planId,
            subdomain,
            fqdn,
            url: fqdn ? `https://${fqdn}` : '',
            contactEmail: email,
            status: 'pending',
        } : null,
    };
}

export function canManageOffering(offering, params) {
    const uid = params.user?.uid;
    if (!uid) return false;
    const sec = offering?.DATA?.['#security'] || offering?.['#security'] || {};
    const admins = [sec.ADMIN, sec.admin, sec.BOSS, sec.boss].filter(Boolean);
    const users = sec.USERS || sec.users || [];
    return admins.includes(uid) || users.includes(uid);
}

export function toDataJs(obj) {
    const C = globalThis.WORK?.constructor;
    if (typeof C?.toScript === 'function')
        return 'export default ' + C.toScript(obj);
    return 'export default ' + JSON.stringify(obj, null, 4);
}

/** Default plans seed for first getPlans when plans.json missing. */
export function defaultPlansDocument() {
    return {
        plans: [
            {
                id: 'СТАРТ',
                title: 'Старт',
                price: { amount: 0, currency: 'RUB', unit: 'user/day' },
                includes: [
                    'Минимальный объём дискового пространства',
                    'Минимальные вычислительные ресурсы',
                    'Стоимость работы одного пользователя в сутки — 1 000 ₽',
                    'Поддержка с низким приоритетом',
                ],
                limits: { diskGb: 10, maxUsers: 10 },
                order: 1,
                visible: true,
                default: true,
            },
            {
                id: 'БИЗНЕС',
                title: 'Бизнес',
                price: { amount: 10000, currency: 'RUB', unit: 'user/day' },
                includes: [
                    'Увеличенный объём диска',
                    'Увеличенные вычислительные ресурсы',
                    'Стоимость на пользователя в сутки — 1 000 ₽',
                    'Поддержка со средним приоритетом',
                ],
                limits: { diskGb: 50, maxUsers: 100 },
                order: 2,
                visible: true,
            },
            {
                id: 'ПРЕДПРИЯТИЕ',
                title: 'Предприятие',
                price: { amount: 100000, currency: 'RUB', unit: 'user/day' },
                includes: [
                    'Настраиваемые характеристики хранилища',
                    'Настраиваемые характеристики производительности',
                    'Стоимость за пользователя от 3 000 ₽',
                    'Поддержка с максимальным приоритетом',
                ],
                limits: { diskGb: 500, maxUsers: 1000 },
                order: 3,
                visible: true,
            },
        ],
    };
}
