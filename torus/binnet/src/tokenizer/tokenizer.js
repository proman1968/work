import { BinNet} from "../core/bin-net.js";
import { TokenizerCore } from "./tokenizer-core.js";
// Node-обертка над чистым ядром: персистентность + BinNet-совместимость.
// Вся логика BPE (encode/decode/train) живет в TokenizerCore и шарится с браузерным стендом.
export class Tokenizer extends BinNet {
    constructor(config = {}) {
        super(config);
        this.core = new TokenizerCore(config);
    }

    // Прокси к ядру — старый код (llm.js и др.) обращается к полям напрямую
    get vocabSize() { return this.core.vocabSize; }
    set vocabSize(v) { this.core.vocabSize = v; }
    get halfLifeSymbols() { return this.core.halfLifeSymbols; }
    set halfLifeSymbols(v) { this.core.halfLifeSymbols = v; }
    get maxTokenLength() { return this.core.maxTokenLength; }
    set maxTokenLength(v) { this.core.maxTokenLength = v; }
    get merges() { return this.core.merges; }
    set merges(v) { this.core.merges = v; }
    get singleCounts() { return this.core.singleCounts; }
    set singleCounts(v) { this.core.singleCounts = v; }
    get pairCounts() { return this.core.pairCounts; }
    set pairCounts(v) { this.core.pairCounts = v; }
    get vocab() { return this.core.vocab; }
    set vocab(v) { this.core.vocab = v; }
    get inverseVocab() { return this.core.inverseVocab; }
    set inverseVocab(v) { this.core.inverseVocab = v; }
    get tokenLengths() { return this.core.tokenLengths; }
    set tokenLengths(v) { this.core.tokenLengths = v; }
    get textEncoder() { return this.core.textEncoder; }
    get textDecoder() { return this.core.textDecoder; }

    // Геттер для сериализации и сохранения на диск
    get model() { return this.core.model; }
    async load(folder = this.folder) {
        try {
            let metadata = await this.readFile('tokenizer.json');
            metadata = JSON.parse(metadata);
            this.core.restoreFromMerges(metadata.merges, metadata.singleCounts, metadata.pairCounts);
            console.log('Токенизатор загружен');
        }
        catch(e) {
            console.log('Создан новый токенизатор');
        }
        console.log(`Модуль "${this.id}" готов к работе\n`);
    }
    async save(folder = this.folder) {
        try {
            let tokenizer = {
                merges: this.merges,
                singleCounts: this.singleCounts,
                pairCounts: this.pairCounts
            }
            await this.writeFile('tokenizer.json', JSON.stringify(tokenizer, null, 2));
            console.log('Токенизатор сохранен');
        }
        catch(e) {
            console.error('Ошибка при сохранении токенизатора!\n'+e.message);
        }
    }
    getPrunedStats(sourceObject, minCount = 5) { return this.core.getPrunedStats(sourceObject, minCount); }
    encode(text) { return this.core.encode(text); }
    decode(tokens_array) { return this.core.decode(tokens_array); }

    // Потоковое онлайн-обучение на основе энтропии и Жаккара
    train(text) { return this.core.train(text); }
}
