/**
 * Bitrix24 — интеграция с CRM и задачами «Битрикс24» через стандартный входящий вебхук.
 *
 * Настройка подключения:
 *  - Создайте в Битрикс24 («Разработчикам» -> «Другое» -> «Входящий вебхук») вебхук с правами `crm` и `task`;
 *  - Сохраните URL вебхука (`https://<портал>.bitrix24.ru/rest/<user>/<код>/`) в `#secret/bitrix24.json`
 *    (`{ "webhookUrl": "https://..." }`) или в поле `baseUrl` сервиса `/SERVICES/Bitrix24`.
 */

async function resolveBitrixWebhook(service) {
    try {
        const sec = await service.read_secret({ filename: 'bitrix24.json' });
        if (sec?.webhookUrl || sec?.url)
            return String(sec.webhookUrl || sec.url).trim().replace(/\/+$/, '');
    }
    catch { /* ignore */ }
    const direct = String(service?.baseUrl || service?.DATA?.baseUrl || '').trim().replace(/\/+$/, '');
    if (direct && /^https?:\/\/.+\/rest\//i.test(direct))
        return direct;
    return '';
}

async function callBitrix(service, method, payload = {}) {
    const webhook = await resolveBitrixWebhook(service);
    if (!webhook) {
        return {
            notConfigured: true,
            hint: 'Укажите URL входящего вебхука Битрикс24 (https://<портал>.bitrix24.ru/rest/<id>/<код>/) в #secret/bitrix24.json ({ "webhookUrl": "..." }) или в поле baseUrl сервиса /SERVICES/Bitrix24.',
        };
    }
    const url = `${webhook}/${method}.json`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) {
        return { error: `Битрикс24 (${method}): ${data?.error_description || data?.error || ('HTTP ' + res.status)}` };
    }
    return data;
}

export default {
    icon: 'carbon:collaborate',
    label: 'Битрикс24 CRM',
    description: 'Работа с лидами, сделками, клиентами и задачами в корпоративном портале Битрикс24 через входящий вебхук',
    baseUrl: '',
    capabilities: ['crm', 'bitrix24', 'leads', 'deals', 'tasks'],
    enabled: true,

    SCHEMA: {
        list_deals: {
            readonly: true,
            description: 'Получить список сделок из CRM Битрикс24 (crm.deal.list) с суммами, стадиями и ответственными.',
            params: {
                type: 'object',
                properties: {
                    stageId: { type: 'string', description: 'Фильтр по стадии сделки (STAGE_ID), если нужен' },
                    search: { type: 'string', description: 'Поиск по названию сделки (TITLE)' },
                    limit: { type: 'number', description: 'Максимум записей (по умолчанию 20)' },
                },
            },
        },
        list_leads: {
            readonly: true,
            description: 'Получить список лидов из CRM Битрикс24 (crm.lead.list).',
            params: {
                type: 'object',
                properties: {
                    statusId: { type: 'string', description: 'Статус лида (STATUS_ID), например NEW, IN_PROCESS' },
                    search: { type: 'string', description: 'Поиск по названию или имени' },
                    limit: { type: 'number', description: 'Максимум записей (по умолчанию 20)' },
                },
            },
        },
        create_lead: {
            readonly: false,
            description: 'Создать новый лид в CRM Битрикс24 (crm.lead.add).',
            params: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Название лида' },
                    name: { type: 'string', description: 'Имя контактного лица' },
                    phone: { type: 'string', description: 'Телефон клиента' },
                    email: { type: 'string', description: 'Email клиента' },
                    companyTitle: { type: 'string', description: 'Название компании клиента' },
                    opportunity: { type: 'number', description: 'Предполагаемая сумма сделки в рублях' },
                    comments: { type: 'string', description: 'Комментарий к лиду' },
                },
                required: ['title'],
            },
        },
        create_task: {
            readonly: false,
            description: 'Поставить задачу сотруднику в Битрикс24 (tasks.task.add).',
            params: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Название задачи' },
                    description: { type: 'string', description: 'Подробное описание задачи' },
                    responsibleId: { type: 'number', description: 'ID ответственного сотрудника в Битрикс24 (по умолчанию 1)' },
                    deadline: { type: 'string', description: 'Крайний срок YYYY-MM-DD' },
                },
                required: ['title'],
            },
        },
    },

    async list_deals(params = {}) {
        const filter = {};
        if (params.stageId) filter.STAGE_ID = String(params.stageId).trim();
        if (params.search) filter['%TITLE'] = String(params.search).trim();
        const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
        const res = await callBitrix(this, 'crm.deal.list', {
            order: { ID: 'DESC' },
            filter,
            select: ['ID', 'TITLE', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'COMPANY_ID', 'CONTACT_ID', 'ASSIGNED_BY_ID', 'DATE_CREATE'],
        });
        if (res?.notConfigured || res?.error)
            return res;
        const deals = Array.isArray(res?.result) ? res.result.slice(0, limit) : [];
        return { source: 'Bitrix24', count: deals.length, total: res?.total ?? deals.length, deals };
    },

    async list_leads(params = {}) {
        const filter = {};
        if (params.statusId) filter.STATUS_ID = String(params.statusId).trim();
        if (params.search) filter['%TITLE'] = String(params.search).trim();
        const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
        const res = await callBitrix(this, 'crm.lead.list', {
            order: { ID: 'DESC' },
            filter,
            select: ['ID', 'TITLE', 'NAME', 'LAST_NAME', 'COMPANY_TITLE', 'STATUS_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'DATE_CREATE'],
        });
        if (res?.notConfigured || res?.error)
            return res;
        const leads = Array.isArray(res?.result) ? res.result.slice(0, limit) : [];
        return { source: 'Bitrix24', count: leads.length, total: res?.total ?? leads.length, leads };
    },

    async create_lead(params = {}) {
        const title = String(params.title || '').trim();
        if (!title)
            return { error: 'create_lead: укажите название лида title' };
        const fields = {
            TITLE: title,
            CURRENCY_ID: 'RUB',
        };
        if (params.name) fields.NAME = String(params.name).trim();
        if (params.companyTitle) fields.COMPANY_TITLE = String(params.companyTitle).trim();
        if (params.opportunity != null) fields.OPPORTUNITY = Number(params.opportunity) || 0;
        if (params.comments) fields.COMMENTS = String(params.comments).trim();
        if (params.phone) fields.PHONE = [{ VALUE: String(params.phone).trim(), VALUE_TYPE: 'WORK' }];
        if (params.email) fields.EMAIL = [{ VALUE: String(params.email).trim(), VALUE_TYPE: 'WORK' }];

        const res = await callBitrix(this, 'crm.lead.add', { fields });
        if (res?.notConfigured || res?.error)
            return res;
        return { ok: true, leadId: res?.result, title };
    },

    async create_task(params = {}) {
        const title = String(params.title || '').trim();
        if (!title)
            return { error: 'create_task: укажите название задачи title' };
        const fields = {
            TITLE: title,
            DESCRIPTION: String(params.description || '').trim(),
            RESPONSIBLE_ID: Number(params.responsibleId) || 1,
        };
        if (params.deadline)
            fields.DEADLINE = String(params.deadline).trim();
        const res = await callBitrix(this, 'tasks.task.add', { fields });
        if (res?.notConfigured || res?.error)
            return res;
        return { ok: true, task: res?.result?.task || res?.result };
    },
};
