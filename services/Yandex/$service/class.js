/**
 * Yandex — официальный Search API v2 (Cloud).
 *
 * search — POST {baseUrl}/v2/web/search, Api-Key + folderId.
 * Ответ: rawData (base64 XML) → { query, source, results[{ title, url, snippet }] }.
 *
 * SCHEMA — описание методов для ИИ (function calling).
 */
const DEFAULT_BASE = 'https://searchapi.api.cloud.yandex.net';
const MAX_RESULTS = 8;

function searchEndpoint(base) {
    const b = String(base || DEFAULT_BASE).replace(/\/$/, '');
    return /\/v2\/web\/search$/i.test(b) ? b : b + '/v2/web/search';
}

function decodeXml(s = '') {
    return String(s)
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .replace(/\s+/g, ' ')
        .trim();
}

function xmlTag(xml, name) {
    const m = String(xml).match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
    return m ? m[1] : '';
}

function parseYandexXml(xml = '') {
    const results = [];
    const seen = new Set();
    const docRe = /<doc\b[\s\S]*?<\/doc>/gi;
    let m;
    while ((m = docRe.exec(xml)) && results.length < MAX_RESULTS) {
        const block = m[0];
        const url = decodeXml(xmlTag(block, 'url'));
        if (!url || seen.has(url))
            continue;
        seen.add(url);
        results.push({
            title: decodeXml(xmlTag(block, 'title')) || url,
            url,
            snippet: decodeXml(xmlTag(block, 'passage') || xmlTag(block, 'headline')),
        });
    }
    return results;
}

export default {
    icon: 'carbon:search',
    description: 'Поиск в интернете через Yandex Search API',
    baseUrl: DEFAULT_BASE,
    folderId: '',
    capabilities: ['search'],

    SCHEMA: {
        search: {
            description: 'Поиск информации в интернете. Результат — список ссылок.',
            params: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Поисковый запрос' },
                },
                required: ['query'],
            },
        },
    },

    /** Контракт как у SearXNG: { query, source, results[], error? } */
    async search(params = {}) {
        const query = String(params.query || params.text || '').trim();
        if (!query)
            return { error: 'Пустой поисковый запрос' };
        const apiKey = String(this.apiKey || '').trim();
        const folderId = String(this.folderId || params.folderId || '').trim();
        if (!apiKey)
            return { error: 'нужен apiKey', query };
        if (!folderId)
            return { error: 'нужен folderId', query };

        try {
            const response = await fetch(searchEndpoint(this.baseUrl), {
                method: 'POST',
                headers: {
                    Authorization: 'Api-Key ' + apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    folderId,
                    query: { searchType: 'SEARCH_TYPE_RU', queryText: query.slice(0, 400) },
                    responseFormat: 'FORMAT_XML',
                    groupSpec: { groupMode: 'GROUP_MODE_FLAT', docsInGroup: '1' },
                    l10n: 'LOCALIZATION_RU',
                }),
                signal: AbortSignal.timeout(15000),
            });
            const raw = await response.text();
            if (!response.ok)
                return { error: 'Yandex HTTP ' + response.status + ': ' + raw.slice(0, 200), query };
            const data = JSON.parse(raw);
            if (!data?.rawData)
                return { error: data?.message || 'нет rawData', query };
            const xml = Buffer.from(data.rawData, 'base64').toString('utf8');
            const results = parseYandexXml(xml);
            if (!results.length)
                return { error: 'Ничего не найдено', query };
            return { source: 'Yandex', query, results };
        } catch (e) {
            return { error: e.message || 'Yandex search', query };
        }
    },
};
