// Чистое BPE-ядро без Node-зависимостей (fs/BinNet).
// Используется и в Node (src/tokenizer/tokenizer.js), и в браузере (test-ui).
// Логика encode/train — как в исходном tokenizer.js, decode — исправлен:
// было `new Uint8Array(tokenIDs)` (обрезка ID>255), стало развертывание через inverseVocab.
export class TokenizerCore {
    textEncoder = new TextEncoder();
    textDecoder = new TextDecoder();

    constructor(config = {}) {
        this.vocabSize = config.vocabSize || 10000;
        this.halfLifeSymbols = config.halfLifeSymbols || 100000;
        this.maxTokenLength = config.maxTokenLength || 5;

        this.merges = {};
        this.singleCounts = {};
        this.pairCounts = {};

        this.vocab = {};
        this.inverseVocab = {};
        this.tokenLengths = {};

        for (let i = 0; i < 256; i++) {
            this.vocab[i.toString()] = i;
            this.inverseVocab[i] = [i];
            this.tokenLengths[i] = this.textDecoder.decode(new Uint8Array([i])).length;
        }
    }

    get model() {
        return {
            merges: this.merges,
            singleCounts: this.getPrunedStats(this.singleCounts, 5),
            pairCounts: this.getPrunedStats(this.pairCounts, 5)
        };
    }

    getPrunedStats(sourceObject, minCount = 5) {
        const cleanObject = {};
        for (let key in sourceObject) {
            const count = Math.floor(Number(sourceObject[key]));
            if (count >= minCount) cleanObject[key] = count;
        }
        return cleanObject;
    }

    // Восстановление словарей из сохраненных merges (порядок — по возрастанию newId)
    restoreFromMerges(merges = {}, singleCounts = {}, pairCounts = {}) {
        this.merges = merges || {};
        this.singleCounts = singleCounts || {};
        this.pairCounts = pairCounts || {};
        const sortedMerges = Object.entries(this.merges).sort((a, b) => Number(a[1]) - Number(b[1]));
        for (let [pair, newIdStr] of sortedMerges) {
            const newId = Number(newIdStr);
            const [id1, id2] = pair.split(',').map(Number);
            const combinedBytes = [...(this.inverseVocab[id1] || []), ...(this.inverseVocab[id2] || [])];
            this.vocab[combinedBytes.toString()] = newId;
            this.inverseVocab[newId] = combinedBytes;
            this.tokenLengths[newId] = this.textDecoder.decode(new Uint8Array(combinedBytes)).length;
        }
    }

    encode(text) {
        let ids = Array.from(this.textEncoder.encode(text));
        if (ids.length < 2) return new Uint32Array(ids);

        let changed = true;
        while (changed) {
            changed = false;
            let targetPair = null;
            let minMergeId = Infinity;
            for (let i = 0; i < ids.length - 1; i++) {
                const pair = `${ids[i]},${ids[i + 1]}`;
                const mergeId = this.merges[pair];
                if (mergeId !== undefined && mergeId < minMergeId) {
                    minMergeId = mergeId;
                    targetPair = pair;
                }
            }
            if (!targetPair) break;
            let newIds = [];
            let i = 0;
            while (i < ids.length) {
                if (i < ids.length - 1) {
                    const currentPair = `${ids[i]},${ids[i + 1]}`;
                    if (currentPair === targetPair) {
                        newIds.push(minMergeId);
                        i += 2;
                        changed = true;
                        continue;
                    }
                }
                newIds.push(ids[i]);
                i += 1;
            }
            ids = newIds;
        }
        return new Uint32Array(ids);
    }

    // ИСПРАВЛЕННЫЙ decode: разворачиваем каждый токен в байты через inverseVocab
    decode(tokens_array) {
        const bytes = [];
        for (let i = 0; i < tokens_array.length; i++) {
            const id = Number(tokens_array[i]);
            const chunk = this.inverseVocab[id];
            if (chunk) {
                for (let b of chunk) bytes.push(b);
            }
            // неизвестный id — пропускаем (не роняем декодирование)
        }
        return this.textDecoder.decode(new Uint8Array(bytes));
    }

    train(text) {
        let currentVocabSize = Object.keys(this.inverseVocab).length;
        if (currentVocabSize >= this.vocabSize)
            return 0;

        let tokens = Array.from(this.encode(text));
        if (tokens.length < 2)
            return 0;

        const fastCheck = {};
        let hasCandidates = false;
        for (let i = 0; i < tokens.length - 1; i++) {
            const p = `${tokens[i]},${tokens[i + 1]}`;
            fastCheck[p] = (fastCheck[p] || 0) + 1;
            if (fastCheck[p] > 1) {
                hasCandidates = true;
                break;
            }
        }
        if (!hasCandidates) {
            return 0;
        }

        const len = tokens.length;
        const next = new Int32Array(len);
        const prev = new Int32Array(len);
        for (let i = 0; i < len; i++) {
            next[i] = i + 1;
            prev[i] = i - 1;
        }
        next[len - 1] = -1;

        const localPairCounts = {};
        for (let i = 0; i < len; i++) {
            let id = tokens[i];
            this.singleCounts[id] = (this.singleCounts[id] || 0) + 1;
            if (next[i] !== -1) {
                const pair = `${tokens[i]},${tokens[next[i]]}`;
                localPairCounts[pair] = (localPairCounts[pair] || 0) + 1;
                this.pairCounts[pair] = (this.pairCounts[pair] || 0) + 1;
            }
        }

        let addedTokensCount = 0;

        while (currentVocabSize < this.vocabSize) {
            let bestPair = null;
            let maxScore = -1.0;

            let idx = 0;
            while (~idx) {
                let nidx = next[idx];
                if (~nidx) {
                    const id1 = tokens[idx];
                    const id2 = tokens[nidx];
                    const pair = id1 + ',' + id2;
                    const count = this.pairCounts[pair];
                    if (count > 1 && localPairCounts[pair] > 0) {
                        const len1 = this.tokenLengths[id1] || 1;
                        const len2 = this.tokenLengths[id2] || 1;
                        if ((len1 + len2) <= this.maxTokenLength) {
                            const count1 = this.singleCounts[id1] || 0;
                            const count2 = this.singleCounts[id2] || 0;
                            const score = (count / (count1 + count2 - count)) * Math.log2(count);
                            if (score > maxScore) {
                                maxScore = score;
                                bestPair = pair;
                            }
                        }
                    }
                }
                idx = nidx;
            }

            if (!bestPair) break;

            const [id1, id2] = bestPair.split(',').map(Number);
            const combinedBytes = [...(this.inverseVocab[id1] || []), ...(this.inverseVocab[id2] || [])];
            const newId = currentVocabSize;

            this.merges[bestPair] = newId;
            this.vocab[combinedBytes.toString()] = newId;
            this.inverseVocab[newId] = combinedBytes;
            this.tokenLengths[newId] = this.textDecoder.decode(new Uint8Array(combinedBytes)).length;

            delete localPairCounts[bestPair];

            idx = 0;
            while (~idx) {
                let nidx = next[idx];
                if (~nidx && tokens[idx] === id1 && tokens[nidx] === id2) {
                    let nnidx = next[nidx];
                    this.singleCounts[newId] = (this.singleCounts[newId] || 0) + 1;
                    tokens[idx] = newId;
                    next[idx] = nnidx;
                    if (~nnidx) prev[nnidx] = idx;

                    let pidx = prev[idx];
                    if (~pidx) {
                        const newLeftPair = `${tokens[pidx]},${newId}`;
                        this.pairCounts[newLeftPair] = (this.pairCounts[newLeftPair] || 0) + 1;
                        localPairCounts[newLeftPair] = (localPairCounts[newLeftPair] || 0) + 1;
                    }
                    if (~nnidx) {
                        const newRightPair = `${newId},${tokens[nnidx]}`;
                        this.pairCounts[newRightPair] = (this.pairCounts[newRightPair] || 0) + 1;
                        localPairCounts[newRightPair] = (localPairCounts[newRightPair] || 0) + 1;
                    }
                    nidx = nnidx;
                }
                idx = nidx;
            }
            currentVocabSize++;
            addedTokensCount++;
        }
        return addedTokensCount;
    }
}
