import { BinNet } from "./bin-net.js";
import { Tokenizer } from '../tokenizer/tokenizer.js';
import { Embedding } from '../layers/embedding.js';
import { MambaLayer } from '../layers/mamba-layer.js';
import { Head } from '../layers/head.js';

export class LLM extends BinNet {
    constructor(config = {}) {
        super(config);
        this.vocabSize = config.vocabSize || 65536;
        this.embSize = config.embSize || 256;
        this.layersCount = config.layersCount ?? 6;

        this.tokenizer = new Tokenizer(config);

        // СТРОГО ПО АРХИТЕКТУРЕ: Наполняем пайплайн для автоматического paramCount и forward
        this.pipeline = [
            this.embedding = new Embedding(config),
            ...this.layers = Array(this.layersCount).fill().map((_, id) => new MambaLayer(Object.assign({}, config, { id }))),
            this.head = new Head(config)
        ];
    }

    // Универсальный и точный подсчет параметров со всех слоев
    get paramCount() {
        return this.pipeline.reduce((sum, layer) => sum + layer.paramCount, 0);
    }

    // Сброс рекуррентного состояния всех слоев (память Mamba + conv-задержки).
    // Вызывается на каждую новую независимую последовательность.
    resetState() {
        for (let layer of this.layers) layer.resetState?.();
    }

    async load(folder = this.folder) {
        await this.tokenizer.load(folder);
        for (let layer of this.pipeline) {
            await layer.load(folder);
        }
        console.log(`Модель "${folder}" загружена и готова к работе.\n`);
    }

    async save(folder = this.folder) {
        await this.tokenizer.save(folder);
        for (let layer of this.pipeline) {
            await layer.save({readGpu: true});
        }
        console.log(`Модель "${folder}" сохранена.\n`);
    }

    // Единый цикл обучения LLM с честным причинно-следственным сдвигом токенов.
    // Раньше были два дубля (trainEmbedding/train) с двойным обучением — оставлен один.
    // Послойный schedule против погони за движущейся целью: первые headOnlyEpochs
    // эпох учится ТОЛЬКО Head (низ заморожен на случайной инициализации),
    // затем разморозка всей цепочки. Возвращает статистику; verbose=false — тихо.
    async train(text_corpus, opts = {}) {
        const epochs = opts.epochs ?? 1;
        const headOnlyEpochs = opts.headOnlyEpochs ?? 0;
        const verbose = opts.verbose ?? false;
        const log = (...a) => { if (verbose) console.log(...a); };

        const lines = text_corpus.split('\n').filter(line => line.trim().length > 0);

        let all_add = 0;
        for (let row of lines) {
            all_add += this.tokenizer.train(row);
        }
        log('Добавлено новых токенов в словарь:', all_add);

        const history = [];
        for (let ep = 0; ep < epochs; ep++) {
            const headOnly = ep < headOnlyEpochs;
            let counter = 0;
            let errors = 0;
            for (let i = 0; i < lines.length; i++) {
                this.resetState(); // новая строка — чистый контекст
                let tokens = this.tokenizer.encode(lines[i].trim());
                if (tokens.length < 2) continue;

                // Честный сдвиг: по текущему токену предсказываем СЛЕДУЮЩИЙ
                for (let t = 0; t < tokens.length - 1; t++) {
                    counter++;
                    let currentToken = tokens[t];
                    let nextToken = tokens[t + 1];

                    let result = await this.forward({ tokenIdx: currentToken, targetIdx: nextToken });
                    if (result.loss) {
                        if (headOnly) await this.head.back({ back_target: nextToken, predict: result.predictIdx });
                        else await this.back({ back_target: nextToken, predict: result.predictIdx });
                        errors++;
                    }
                    log('current', currentToken, 'target', nextToken, 'predict', result.predictIdx, 'loss', result.loss);
                }
            }
            const acc = counter ? 1 - errors / counter : 0;
            history.push({ epoch: ep, tokens: counter, errors, acc, headOnly });
            log(`Эпоха ${ep}${headOnly ? ' [head-only]' : ''}: токенов ${counter}, ошибок ${errors}, acc ${acc.toFixed(4)}`);
        }
        if (opts.save) await this.save();
        return { addedTokens: all_add, history };
    }

    // Совместимость со старым main.js: раньше была отдельная trainEmbedding
    async trainEmbedding(text_corpus, opts = {}) {
        return this.train(text_corpus, opts);
    }

    // Замер next-token accuracy БЕЗ обучения (forward-проходы, веса не трогаем)
    async accuracy(text_corpus) {
        const lines = text_corpus.split('\n').filter(line => line.trim().length > 0);
        let counter = 0;
        let errors = 0;
        for (let row of lines) {
            this.resetState();
            let tokens = this.tokenizer.encode(row.trim());
            if (tokens.length < 2) continue;
            for (let t = 0; t < tokens.length - 1; t++) {
                counter++;
                let result = await this.forward({ tokenIdx: tokens[t], targetIdx: tokens[t + 1] });
                if (result.loss) errors++;
            }
        }
        return { tokens: counter, errors, acc: counter ? 1 - errors / counter : 0 };
    }

    // Авторегрессионная контекстная генерация текста
    async generate(promptText, maxLength = 100) {
        let tokens = this.tokenizer.encode(promptText);
        if (tokens.length === 0) return "";

        this.resetState(); // генерация всегда стартует с чистого контекста
        let context;
        // Насыщаем рекуррентную память Mamba контекстом промпта
        for (let token of tokens) {
            context = await this.forward({ tokenIdx: token, targetIdx: 0 });
        }

        // predictIdx уже готов на CPU (Head.forward читает vars сам) —
        // никакого readData(undefined) и масок: ID всегда в диапазоне словаря
        let nextTokenId = context.predictIdx;
        let resultTokens = [];
        let counter = maxLength;

        while (counter-- > 0) {
            if (!nextTokenId || nextTokenId >= this.vocabSize) break; // 0 = конец/паддинг
            resultTokens.push(nextTokenId);
            context = await this.forward({ tokenIdx: nextTokenId, targetIdx: 0 });
            nextTokenId = context.predictIdx;
        }

        return this.tokenizer.decode(resultTokens);
    }
}
