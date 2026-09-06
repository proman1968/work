import { pipeline } from "@xenova/transformers";
import * as kreuzberg  from '@kreuzberg/node';
import * as fs from 'node:fs';
process.env.EMBEDDINGS_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
class XenovaService {
    extractor = null;
    generator = null;
    modelName;
    dimension;
    constructor() {
        // По умолчанию используем rubert-tiny2 для русского языка
        this.modelName = process.env.EMBEDDINGS_MODEL;
        this.dimension = 312; // Размерность вектора для rubert-tiny2
    }

    async initEmbedding() {
        return this.extractor ??= new AsyncPromise(async _=>{
            console.log(`🔄 Загрузка модели: ${this.modelName}...`);
            let extractor = await pipeline("feature-extraction", this.modelName,  {device: 'cpu',  quantized: true }); // Используем квантованную версию для скорости
            console.log("✅ модель готова!");
            return extractor;
        })
    }
    async initGenerator() {
        return this.generator ??= new AsyncPromise(async _=>{
            console.log(`🔄 Загрузка модели: ${'Xenova/Qwen1.5-0.5B-Chat'}...`, {device: 'webgpu', quantized: true, dtype: 'fp32'});
            let generator = await pipeline('text-generation', 'Xenova/Qwen1.5-0.5B-Chat');
            console.log("✅ модель готова!");
            return generator;
        })
    }    
    async generate(messages){
        const generator = await this.initGenerator();
        const text = generator.tokenizer.apply_chat_template(messages, {
            tokenize: false,
            add_generation_prompt: true,
        });
        const output = await generator(text, {
            max_new_tokens: 128,
            do_sample: false,
            return_full_text: false,
        });
        let result = output[0].generated_text;
        console.log(result);
        return result;
    }

    async embedding(text) {
        if (!text || text.trim().length === 0) {
            return [];
        }

        const extractor = await this.initEmbedding();
        
        try {
            const response = await extractor(text, embeddingOptions);
            
            return Array.from(response.data);
        } catch (error) {
            console.error("❌ Ошибка генерации эмбеддинга:", error);
            throw error;
        }
    }

    async embeddings(batch) {
        let results = batch.map(text => this.embedding(text));
        results = await Promise.all(results);
        return results;
    }

    getDimension() {
        return this.dimension;
    }
}
const embeddingOptions = {
    pooling: "mean",
    normalize: true,
}
const xenova = new XenovaService();

const encoder = new TextEncoder('utf-8');
const ExtractionConfig = {
    enableQualityProcessing: true,
    chunking: {
        enabled: true,
        maxChars: 2000,      // Максимум 1000 символов на чанк
        maxOverlap: 200,       // Перекрытие 100 символов между чанками
    },
    pdfOptions:{
        extractImages: true,
        hierarchy: true,
    },
    languageDetection:{
        enabled: true,
        minConfidence: .7,
        detectMultiple: true
    },
    tokenReduction:{
        mode: "light",
        preserveImportantWords: true
    }
  };
/** Текстовые расширения — load + splitter (как $file.TEXT_EXTS + платформенные). */
const TEXT_EXTS = [
    'js', 'txt', 'html', 'md', 'mjs', 'css', 'chat', 'xml', 'svg', 'yaml', 'yml',
    'py', 'ts', 'mts', 'json', 'skill', 'logs', 'task', 'ai', 'csv', 'tsv', 'eml', 'ics',
];
/** Только то, что kreuzberg реально разбирает — иначе тихий skip (без MIME-warn). */
const KREUZBERG_EXTS = [
    'pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'odt', 'ods', 'odp',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff', 'bmp',
];
class TextExtractor{
    async extract(file){
        let result;
        try{
            if (file.isInherit && !file.inherit_source)
                return;
            const ext = String(file.ext || '').toLowerCase();
            if (TEXT_EXTS.includes(ext) || !ext){
                let text = await file.load({hasTilde: true, encoding: 'utf-8'});
                result = advancedTextSplitter(text, ExtractionConfig)
                result = {
                    chunks: result.map(ch=>{
                        return {
                            content: ch.text,
                            metadata: {
                                chunkIndex: ch.index,
                                totalChunks: result.length
                            }
                        }
                    })
                }
            }
            else if (KREUZBERG_EXTS.includes(ext)) {
                const disk = file.real_dir || file.dir;
                if (!disk || !fs.existsSync(disk))
                    return;
                result = await kreuzberg.extractFile(disk, ExtractionConfig);
            }
            else {
                // .task уже в TEXT; ico/unknown/example/clineignore — не в kreuzberg
                return;
            }
        }
        catch(e){
            console.warn(e.message);
            return;
        }
        // process.stdout.write(`Прогресс:`);
        result = result.chunks.map(async (chunk, idx, items) => {            
            chunk.embedding ??= await xenova.embedding(chunk.content);
            await new Promise(resolve=>{
                setTimeout(()=>{
                    // process.stdout.write(`\rX`);
                    resolve();
                })
            })
            return chunk;
        })   
        // console.log('Ready chunks:', file.path)
        result = await Promise.all(result);             
        return result;
    }
}
function advancedTextSplitter(text, options = {}) {
    const {
        maxChars = 1000,
        minChars = 0,
        maxOverlap = 200,
        respectParagraphs = true,
        respectSentences = true
    } = options.chunking;
    
    if (!text || typeof text !== 'string') {
        return [];
    }
    
    // Предварительная обработка текста
    const chunks = [];
    let currentChunk = '';
    let currentChunkStart = 0;
    
    // Разбиваем на параграфы, если нужно
    const paragraphs = respectParagraphs 
        ? text.split(/\n\s*\n/) 
        : [text];
    
    for (const paragraph of paragraphs) {
        if (!paragraph.trim()) continue;
        
        // Если параграф слишком большой, разбиваем на предложения
        if (paragraph.length > maxChars && respectSentences) {
            const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
            
            for (const sentence of sentences) {
                if (!sentence.trim()) continue;
                
                // Если текущий чанк + предложение превышают размер
                if (currentChunk.length + sentence.length > maxChars) {
                    // Сохраняем текущий чанк, если он не пустой
                    if (currentChunk.length >= minChars) {
                        chunks.push({
                            text: currentChunk.trim(),
                            start: currentChunkStart,
                            end: currentChunkStart + currentChunk.length,
                            index: chunks.length
                        });
                    }
                    
                    // Начинаем новый чанк с перекрытием
                    const overlapText = currentChunk.slice(-maxOverlap);
                    currentChunk = overlapText + sentence;
                    currentChunkStart = Math.max(0, currentChunkStart + currentChunk.length - maxOverlap);
                } else {
                    currentChunk += sentence;
                }
            }
        } else {
            // Если параграф помещается, добавляем его
            if (currentChunk.length + paragraph.length > maxChars) {
                if (currentChunk.length >= minChars) {
                    chunks.push({
                        text: currentChunk.trim(),
                        start: currentChunkStart,
                        end: currentChunkStart + currentChunk.length,
                        index: chunks.length
                    });
                }
                
                const overlapText = currentChunk.slice(-maxOverlap);
                currentChunk = overlapText + paragraph;
                currentChunkStart = Math.max(0, currentChunkStart + currentChunk.length - maxOverlap);
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
            }
        }
    }
    
    // Добавляем последний чанк
    if (currentChunk.length >= minChars) {
        chunks.push({
            text: currentChunk.trim(),
            start: currentChunkStart,
            end: currentChunkStart + currentChunk.length,
            index: chunks.length
        });
    }
    
    return chunks;
}
const extractor = new TextExtractor();
export {
    xenova,
    extractor,
}