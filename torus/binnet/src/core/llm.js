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
                if (i % 10 === 0) {
                    opts.onLine?.(i, lines.length);
                    await opts.yieldNow?.();
                }
                this.resetState(); // новая строка — чистый контекст
                let tokens = this.tokenizer.encode(lines[i].trim());
                if (tokens.length < 2) continue;

                if (this.ste && !headOnly && (opts.bptt ?? true)) {
                    counter += tokens.length - 1;
                    await this.trainSequence(Array.from(tokens), { bpttK: opts.bpttK });
                    const ec = this.head.errorCount;
                    errors += (await this.gpu.readData(ec))[0];
                    ec[0] = 0;
                    this.write(ec);
                    continue;
                }
                if (this.ste) {
                    // Без чтения с GPU на каждом токене: ошибки считаются на GPU
                    const seed = this.gpu.stepSeed ??= this.write(new Uint32Array(1), 'step_seed', 'uniform');
                    for (let t = 0; t < tokens.length - 1; t++) {
                        counter++;
                        seed[0] = Math.trunc(BinNet.max32 * Math.random());
                        this.write(seed);
                        await this.forward({ tokenIdx: tokens[t], targetIdx: tokens[t + 1], noRead: true });
                        if (headOnly) await this.head.back({ back_target: tokens[t + 1] });
                        else await this.back({ back_target: tokens[t + 1] });
                    }
                    const ec = this.head.errorCount;
                    errors += (await this.gpu.readData(ec))[0];
                    ec[0] = 0;
                    this.write(ec);
                    continue;
                }
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

    // STE + обратный проход через время (усеченный окнами по bpttK шагов).
    // tokens — массив id; mask[t] — учить ли предсказание tokens[t+1] (по умолчанию все).
    // Forward окна со снимками шагов → Head учится на каждом шаге сразу →
    // назад по окну: слои сверху вниз с переносом градиента по памяти, затем Embedding.
    async trainSequence(tokens, opts = {}) {
        const K = opts.bpttK ?? this.bpttK ?? 64;
        const mask = opts.mask;
        const T = tokens.length - 1;
        if (T < 1) return;
        const nBits = this.head.embSize * 32;
        const bytes = nBits * 4;
        const gpu = this.gpu;
        const seed = gpu.stepSeed ??= this.write(new Uint32Array(1), 'step_seed', 'uniform');
        if (!this._seqBufs || this._seqK < K) {
            this._seqK = K;
            this._seqBufs = {
                hist: gpu.device.createBuffer({ size: bytes * K, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, label: 'LLM grad history' }),
                zero: this.write(new Float32Array(nBits), 'grad_zero'),
                top: this.write(new Float32Array(nBits), 'grad_top'),
            };
        }
        const { hist, zero, top } = this._seqBufs;
        const E = this.embedding;
        const setToken = (tok) => {
            E.FWD.offsets[0] = tok * E.embSize;
            this.write(E.FWD.offsets);
        };

        this.resetState();
        for (let w = 0; w < T; w += K) {
            const n = Math.min(K, T - w);
            for (let i = 0; i < n; i++) {
                const t = w + i;
                seed[0] = Math.trunc(BinNet.max32 * Math.random());
                this.write(seed);
                await this.forward({ tokenIdx: tokens[t], targetIdx: tokens[t + 1], noRead: true });
                for (const layer of this.layers) layer.saveStep(i, K);
                const learn = !mask || mask[t];
                if (learn) await this.head.back({ back_target: tokens[t + 1] });
                if (!this.layers.length) {
                    if (learn) await E.back({ grad: this.head.gIn });
                    continue;
                }
                gpu.copy(learn ? this.head.gIn : zero, hist, i * bytes, 0, bytes);
            }
            if (!this.layers.length) continue;

            // Назад по окну
            for (const layer of this.layers) layer.resetCarry();
            for (let i = n - 1; i >= 0; i--) {
                seed[0] = Math.trunc(BinNet.max32 * Math.random());
                this.write(seed);
                gpu.copy(hist, top, 0, i * bytes, bytes);
                let g = top;
                for (let l = this.layers.length - 1; l >= 0; l--) {
                    this.layers[l].restoreStep(i);
                    g = (await this.layers[l].backSte({ grad: g }, { bptt: true })).grad;
                }
                setToken(tokens[w + i]);
                await E.back({ grad: g });
            }
            // Рекуррентное состояние продолжает течь в следующее окно — восстанавливать
            // не нужно: forward последнего шага окна оставил его как есть, а restoreStep
            // трогает только снимки (state/convDelay не входят в снимок).
        }
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
                await this.forward({ tokenIdx: tokens[t], targetIdx: tokens[t + 1], noRead: true });
            }
            const ec = this.head.errorCount;
            errors += (await this.gpu.readData(ec))[0];
            ec[0] = 0;
            this.write(ec);
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
