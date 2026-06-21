const STORAGE_TYPES = new Set(['$storage', '$user']);

export function file_sort(files, reverse = false) {
    const isType = this.isType;
    files = files.sort((a, b) => {
        if (a?.parent === a?.$owner) {
            if (b?.$owner !== b?.parent)
                return isType ? 1 : -1;
        }
        else if (b?.$owner === b?.parent) {
            return isType ? -1 : 1;
        }
        if (a.type === b.type) {
            if (a.id[0] !== '$') {
                if (b.id[0] === '$')
                    return -1;
            }
            else if (b.id[0] !== '$')
                return 1;
            return a.id < b.id ? -1 : 1;
        }
        if (STORAGE_TYPES.has(a.type) && !STORAGE_TYPES.has(b.type))
            return -1;
        if (!STORAGE_TYPES.has(a.type) && STORAGE_TYPES.has(b.type))
            return 1;
        return a.type < b.type ? -1 : 1;
    });
    if (reverse)
        files.reverse();
    return files;
}

export function inherit(source, parent) {
    let item = parent.__items__[source.id];
    if (!item) {
        item = parent.__items__[source.id] = new source.constructor(source[R].__data__, parent);
        item.id = source.id;
        item.inherit_source = source;
    }
    return item;
}

export function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash.toString(16);
}

export function cosineSimilarityDense(vecA, vecB) {
    let dot = 0, normA = 0, normB = 0;
    const len = vecA.length;
    for (let i = 0; i < len; i++) {
        const a = vecA[i];
        const b = vecB[i];
        dot += a * b;
        normA += a * a;
        normB += b * b;
    }
    return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

export function splitTextIntoChunksUnicode(text, chunkSizeKb = 1, overlapPercent = 5) {
    const chunkSizeBytes = chunkSizeKb * 1024;
    const overlapBytes = Math.floor(chunkSizeBytes * (overlapPercent / 100));
    const stepBytes = chunkSizeBytes - overlapBytes;

    if (overlapBytes >= chunkSizeBytes) {
        throw new Error('Перекрытие не может быть больше или равно размеру фрагмента');
    }

    const chars = Array.from(text);
    const chunks = [];
    let startIndex = 0;

    while (startIndex < chars.length) {
        let endIndex = Math.min(startIndex + chunkSizeBytes, chars.length);
        const chunk = chars.slice(startIndex, endIndex).join('');
        chunks.push(chunk);

        if (endIndex === chars.length) {
            break;
        }

        startIndex += stepBytes;

        if (stepBytes <= 0) {
            throw new Error('Шаг должен быть положительным числом');
        }
    }

    return chunks;
}

export function filterRagData(data, sensitivity = 0.5) {
    if (!data.length) return [];

    const scores = data.map(item => item.sim);
    const temperature = 0.3 + sensitivity * 0.5;
    const expScores = scores.map(s => Math.exp(s / temperature));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    const probabilities = expScores.map(e => e / sumExp);

    const items = data.map((item, i) => ({
        ...item,
        probability: probabilities[i],
    })).sort((a, b) => b.probability - a.probability);

    const maxGroups = Math.floor(1 + sensitivity * 2);
    const result = [items[0]];
    const maxSim = items[0].sim;

    for (let i = 1; i < items.length && result.length < maxGroups; i++) {
        const simRatio = items[i].sim / maxSim;
        const minSimRatio = 0.7 - sensitivity * 0.4;
        if (simRatio >= minSimRatio) {
            result.push(items[i]);
        } else {
            break;
        }
    }

    return result;
}

export function extractIcon(svgText, id) {
    const START = '<g';
    const ID = `id="${id}"`;
    const END = '</g>';
    const l = svgText.length;
    let tagStart = 0;
    while (tagStart < l) {
        tagStart = svgText.indexOf(START, tagStart);
        const tagEnd = svgText.indexOf('>', tagStart) + 1;
        if (tagStart === -1) return;
        let pos = tagStart;
        let deep = 0;
        if (svgText.indexOf(ID, tagStart) > -1) {
            while (pos < l) {
                if (deep === 0 && svgText.slice(pos, pos + END.length) === END) {
                    return svgText.slice(tagStart, pos + END.length);
                }
                else if (['/>', '</'].includes(svgText.slice(pos, pos + 2))) {
                    --deep;
                }
                else if (svgText[pos] === '<') {
                    ++deep;
                }
                ++pos;
            }
        }
        else {
            tagStart = svgText.indexOf(START, tagStart + 1);
        }
    }
    return null;
}

export function importScript(script) {
    const b64 = Buffer.from(script, 'utf-8').toString('base64');
    return import('data:text/javascript;base64, ' + b64).then(module => module.default).catch(err => {
        console.error(err, script);
    });
}
