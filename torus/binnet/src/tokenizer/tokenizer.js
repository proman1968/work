import { BinNet} from "../core/bin-net.js";
export class Tokenizer extends BinNet {
    textEncoder = new TextEncoder();
    textDecoder = new TextDecoder();    
    
    constructor(config = {}) {
        super(config);
        this.vocabSize = config.vocabSize || 10000;
        this.halfLifeSymbols = config.halfLifeSymbols || 100000; 
        this.maxTokenLength = config.maxTokenLength || 5;       
        
        this.merges = {};        
        this.singleCounts = {};  
        this.pairCounts = {};    
        
        this.vocab = {};
        this.inverseVocab = {};
        this.tokenLengths = {}; 
        
        // Заполняем базовые байты
        for (let i = 0; i < 256; i++) {
            this.vocab[i.toString()] = i;
            this.inverseVocab[i] = [i];
            // Измеряем длину строки после декодирования
            this.tokenLengths[i] = this.textDecoder.decode(new Uint8Array([i])).length; 
        }
    }

    // Геттер для сериализации и сохранения на диск
    get model() {
        return {
            merges: this.merges,
            singleCounts: this.getPrunedStats(this.singleCounts, 5),
            pairCounts: this.getPrunedStats(this.pairCounts, 5)
        };
    }
    async load(folder = this.folder){
        try{
            let metadata = await this.readFile('tokenizer.json');
            metadata = JSON.parse(metadata);
            this.merges = metadata.merges || {};
            this.singleCounts = metadata.singleCounts || {};
            this.pairCounts = metadata.pairCounts || {};   
        // Хронологически восстанавливаем историю слияний
            const sortedMerges = Object.entries(this.merges).sort((a, b) => Number(a[1]) - Number(b[1]));
            for (let [pair, newIdStr] of sortedMerges) {
                const newId = Number(newIdStr);
                const [id1, id2] = pair.split(',').map(Number);
                const combinedBytes = [...(this.inverseVocab[id1] || []), ...(this.inverseVocab[id2] || [])];
                
                this.vocab[combinedBytes.toString()] = newId;
                this.inverseVocab[newId] = combinedBytes;
                // Корректно восстанавливаем длину в символах для собранного токена
                this.tokenLengths[newId] = this.textDecoder.decode(new Uint8Array(combinedBytes)).length;
            }                     
            console.log('Токенизатор загружен');
        }
        catch(e){
            console.log('Создан новый токенизатор');
        }
        console.log(`Модуль "${this.id}" готов к работе\n`);
    }
    async save(folder = this.folder){
        try{
            let tokenizer = {
                merges: this.merges,
                singleCounts: this.singleCounts,
                pairCounts: this.pairCounts
            }
            await this.writeFile('tokenizer.json', JSON.stringify(tokenizer, null, 2));       
            console.log('Токенизатор сохранен');
        }
        catch(e){
            console.error('Ошибка при сохранении токенизатора!\n'+e.message);
        }
    }
    // Мягкая чистка перед экспортом
    getPrunedStats(sourceObject, minCount = 5) {
        const cleanObject = {};
        for (let key in sourceObject) {
            const count = Math.floor(Number(sourceObject[key]));
            if (count >= minCount) cleanObject[key] = count;
        }
        return cleanObject;
    }

    // Алгоритмически точное BPE-кодирование по минимальному ID слияния
    encode(text) {
        let ids = Array.from(this.textEncoder.encode(text));
        if (ids.length < 2) return new Uint32Array(ids);

        let changed = true;

        while (changed) {
            changed = false;
            
            let targetPair = null;
            let minMergeId = Infinity;

            // Находим самую приоритетную пару по времени её создания (минимальный ID)
            for (let i = 0; i < ids.length - 1; i++) {
                const pair = `${ids[i]},${ids[i+1]}`;
                const mergeId = this.merges[pair];
                if (mergeId !== undefined && mergeId < minMergeId) {
                    minMergeId = mergeId;
                    targetPair = pair;
                }
            }

            // Если ни одна пара из строки не найдена в словаре — кодирование окончено
            if (!targetPair) break;

            // Схлопываем ВСЕ вхождения этой конкретной пары за один проход по массиву
            let newIds = [];
            let i = 0;
            while (i < ids.length) {
                if (i < ids.length - 1) {
                    const currentPair = `${ids[i]},${ids[i+1]}`;
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

    // Декодирование массива токенов обратно в строку
    decode(tokens_array) {
        let result = new Uint8Array(tokens_array);
        return this.textDecoder.decode(result);
    }

    // Потоковое онлайн-обучение на основе энтропии и Жаккара
    train(text) {
        let currentVocabSize = Object.keys(this.inverseVocab).length;
        if (currentVocabSize >= this.vocabSize) 
            return 0;

        // 1. Кодируем строку ОДИН раз на входе в train
        let tokens = Array.from(this.encode(text));
        if (tokens.length < 2) 
            return 0;

        // Быстрый чекаут: если после encode не осталось повторяющихся пар, ловить нечего
        const fastCheck = {};
        let hasCandidates = false;
        for (let i = 0; i < tokens.length - 1; i++) {
            const p = `${tokens[i]},${tokens[i+1]}`;
            fastCheck[p] = (fastCheck[p] || 0) + 1;
            if (fastCheck[p] > 1){
                hasCandidates = true; 
                break;  
            }
                
        }
        if (!hasCandidates) {
            return 0;
        }

        // // Применяем затухание к глобальной истории
        // const decay = Math.pow(0.5, text.length / this.halfLifeSymbols);
        // for (let key in this.singleCounts) {
        //     let count = this.singleCounts[key] * decay;  
        //     if (count < .5) 
        //         delete this.singleCounts[key]; 
        //     else
        //     this.singleCounts[key] = count; 
        // }
        // for (let key in this.pairCounts) {
        //     let count = this.pairCounts[key] * decay;
        //     if (count < .5) 
        //         delete this.pairCounts[key]; 
        //     else
        //     this.pairCounts[key] = count; 
        // }

        // 2. Создаем сверхбыстрый связный список на плоских массивах индексов
        const len = tokens.length;
        const next = new Int32Array(len);
        const prev = new Int32Array(len);
        for (let i = 0; i < len; i++) {
            next[i] = i + 1;
            prev[i] = i - 1;
        }
        next[len - 1] = -1;

        // Собираем локальную статистику на основе связного списка
        const localSingleCounts = {};
        const localPairCounts = {};
        for (let i = 0; i < len; i++) {
            let id = tokens[i];
            localSingleCounts[id] = (localSingleCounts[id] || 0) + 1;
            this.singleCounts[id] = (this.singleCounts[id] || 0) + 1;
            if (next[i] !== -1) {
                const pair = `${tokens[i]},${tokens[next[i]]}`;
                localPairCounts[pair] = (localPairCounts[pair] || 0) + 1;
                this.pairCounts[pair] = (this.pairCounts[pair] || 0) + 1;
            }
        }

        let addedTokensCount = 0;

        // 3. Главный цикл обучения (БЕЗ вызова encode внутри!)
        while (currentVocabSize < this.vocabSize) {
            let bestPair = null;
            let maxScore = -1.0;



            // Линейно сканируем только живые локальные пары прямо по цепочке индексов
            let idx = 0;
            while (~idx) {
                let nidx = next[idx];
                if (~nidx) {
                    const id1 = tokens[idx];
                    const id2 = tokens[nidx];                    
                    const pair = id1 + ',' + id2;
                    const count = this.pairCounts[pair];
                    // Проверяем наличие пары в ЛОКАЛЬНОЙ строке, чтобы не брать фантомы из истории
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

            // Если склеивать больше нечего — чанк отработан
            if (!bestPair) break;

            // Фиксируем новый токен в словарях
            const [id1, id2] = bestPair.split(',').map(Number);
            const combinedBytes = [...(this.inverseVocab[id1] || []), ...(this.inverseVocab[id2] || [])];
            const newId = currentVocabSize;

            this.merges[bestPair] = newId;
            this.vocab[combinedBytes.toString()] = newId;
            this.inverseVocab[newId] = combinedBytes;
            
            // ИСПРАВЛЕНИЕ 1: Считаем честную длину токена в СИМВОЛАХ через TextDecoder
            this.tokenLengths[newId] = this.textDecoder.decode(new Uint8Array(combinedBytes)).length;

            // Удаляем старую склеенную пару из локального индекса
            delete localPairCounts[bestPair];

            // 4. Схлопываем ВСЕ вхождения этой пары в цепочке индексов за ОДИН проход О(N)
            idx = 0;
            while (~idx) {
                let nidx = next[idx];
                if (~nidx && tokens[idx] === id1 && tokens[nidx] === id2) {
                    let nnidx = next[nidx]; // Индекс элемента за парой

                    // Накатываем частоту для нового токена в глобальную историю
                    this.singleCounts[newId] = (this.singleCounts[newId] || 0) + 1;

                    // Перевязываем ссылки в массивах (схлопываем ноду nidx в ноду idx)
                    tokens[idx] = newId;
                    next[idx] = nnidx;
                    if (~nnidx) prev[nnidx] = idx;

                    // Корректируем счетчики пар на стыках
                    let pidx = prev[idx];
                    if (~pidx) {
                        const newLeftPair = `${tokens[pidx]},${newId}`;
                        this.pairCounts[newLeftPair] = (this.pairCounts[newLeftPair] || 0) + 1;
                        // ИСПРАВЛЕНИЕ 2: Актуализируем локальный индекс для следующей итерации while
                        localPairCounts[newLeftPair] = (localPairCounts[newLeftPair] || 0) + 1; 
                    }
                    if (~nnidx) {
                        const newRightPair = `${newId},${tokens[nnidx]}`;
                        this.pairCounts[newRightPair] = (this.pairCounts[newRightPair] || 0) + 1;
                        // ИСПРАВЛЕНИЕ 2: Актуализируем локальный индекс для следующей итерации while
                        localPairCounts[newRightPair] = (localPairCounts[newRightPair] || 0) + 1; 
                    }

                    // Делаем шаг к следующему валидному элементу
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
