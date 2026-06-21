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
            await layer.save(folder);
        }
        console.log(`Модель "${folder}" сохранена.\n`);
    }    

    // Тренировка эмбеддингов со сдвигом на предсказание следующего слова
    async trainEmbedding(text_corpus) {
        const lines = text_corpus.split('\n').filter(line => line.trim().length > 0);
        let all_add = 0;
        
        console.time('Токенизация');
        for (let row of lines) {
            all_add += this.tokenizer.train(row);
        }
        console.log('Добавлено новых токенов в словарь:', all_add);
        console.timeEnd('Токенизация');

        console.time('Тренировка Эмбеддингов');
        let counter = 0;
        for (let i = 0; i < lines.length; i++) {
            let tokens = this.tokenizer.encode(lines[i].trim());
            if (tokens.length < 2) continue;
            console.log('--- line', i, 'из', lines.length);

            // Идем до length - 1, цель — строго следующий токен
            for (let t = 0; t < tokens.length - 1; t++) {
                counter++;
                let currentToken = tokens[t];
                let nextToken = tokens[t + 1];

                let result = await this.forward({ tokenIdx: currentToken, targetIdx: nextToken });  
                await result.src.back({ target: nextToken });
                console.log('target', nextToken, 'predict', result.predict, 'loss', result.loss)  
            }
        }
        console.timeEnd('Тренировка Эмбеддингов');
        console.log("Обработано токенов:", counter, '\n');
        await this.save();
    }

    // Главный цикл обучения LLM с честным причинно-следственным сдвигом токенов
    async train(text_corpus) {
        const lines = text_corpus.split('\n').filter(line => line.trim().length > 0);
        
        for (let row of lines) {
            this.tokenizer.train(row);
        }
        
        console.log(`\n================== СТАРТ ОБУЧЕНИЯ (1 ЭПОХА) ==================`);
        const epochStart = performance.now();
        let lineCounter = 0;

        for (let row of lines) {
            let tokens = this.tokenizer.encode(row);
            if (tokens.length < 2) continue; 
            
            lineCounter++;
            const lineStart = performance.now();
            const showDetails = (lineCounter === 1); 

            if (showDetails) {
                console.log(`\n--- Детальный разбор Строки ${lineCounter}: "${row.trim()}" ---`);
            }

            // Честный сдвиг: обучаем сеть по текущему токену предсказывать СЛЕДУЮЩИЙ
            for (let i = 0; i < tokens.length - 1; i++) {
                let currentToken = tokens[i];
                let nextToken = tokens[i + 1]; 

                // 1. Прямой ход по всей цепочке слоев
                let result = await this.forward({ tokenIdx: currentToken, targetIdx: nextToken });
                
                // 2. Обратный ход (обучение Хебба во всех подслоях Linear каскадом)
                await result.src.back({ target: nextToken });

                if (showDetails) {
                    let predBuffer = await this.gpu.readData(result.predict);
                    const predTokenId = predBuffer[0] & 0x1FFFF; 

                    const currentWord = this.tokenizer.decode([currentToken]);
                    const targetWord = this.tokenizer.decode([nextToken]);
                    const predictedWord = this.tokenizer.decode([predTokenId]);

                    const status = (predTokenId === nextToken) ? "🟢 [УГАДАЛ]" : "🔴 [ОШИБКА]";
                    console.log(`  Слово: "${currentWord}" -> Ждем: "${targetWord}" | Сеть выдала: "${predictedWord}" ${status}`);
                }
            }
            
            // Читаем loss из vars нашего Head слоя на CPU
            const headVars = await this.gpu.readData(this.head.vars);
            const view = new DataView(headVars.buffer, headVars.byteOffset);
            const lastLoss = view.getFloat32(16, true); 
            const lineDuration = performance.now() - lineStart;

            if (!showDetails) {
                console.log(`Строка ${lineCounter}: Loss: ${lastLoss.toFixed(4)} | Время: ${lineDuration.toFixed(2)} ms`);
            } else {
                console.log(`>> Итоговый Loss строки: ${lastLoss.toFixed(4)} | Время: ${lineDuration.toFixed(2)} ms\n`);
            }
        }

        console.log(`\n>> Обучение завершено за ${((performance.now() - epochStart) / 1000).toFixed(2)} сек.`);
        await this.save();
    }

    // Авторегрессионная контекстная генерация текста
    async generate(promptText, maxLength = 100) {
        let tokens = this.tokenizer.encode(promptText);
        if (tokens.length === 0) return "";
        
        let context;
        // Насыщаем рекуррентную память Mamba контекстом промпта
        for (let token of tokens) {
            context = await this.forward({ tokenIdx: token, targetIdx: 0 });
        }
        
        let nextTokenId = context.predict;
        let resultTokens = [nextTokenId];
        let counter = maxLength;
        
        while (nextTokenId && counter-- > 0) {
            context = await this.forward({ tokenIdx: nextTokenId, targetIdx: 0 });
            
            // Читаем предсказанный ID токена из буфера GPU
            let predBuffer = await this.gpu.readData(context.predict);
            nextTokenId = predBuffer[0] & 0x1FFFF;
            
            if (nextTokenId === 0) break; // Конец генерации (или паддинг)
            resultTokens.push(nextTokenId);
        }
        
        return this.tokenizer.decode(resultTokens);
    }
}
