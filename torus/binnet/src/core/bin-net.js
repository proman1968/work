import fs from "fs";
import fsp from "node:fs/promises";
import path from "path";
export class BinNet extends EventTarget {
    static max32 = 4294967295; // 2 ** 32 - 1

    // Режим обучения 'ste': у каждого бита веса — целочисленный счетчик (латентный вес),
    // бит = знак счетчика. Forward по-прежнему XNOR+popcount, назад идет числовой сигнал.
    static fmt(x) { return Number(x).toFixed(8); }
    static STE_WGSL = `
        fn ste_hash(x: u32) -> u32 {
            var v = x;
            v = ((v >> 16u) ^ v) * 0x45d9f3bu;
            v = ((v >> 16u) ^ v) * 0x45d9f3bu;
            return (v >> 16u) ^ v;
        }
        // Стохастическое округление: E[результат] == d
        fn ste_round(d: f32, r: u32) -> i32 {
            let fl = floor(d);
            let u = f32(r >> 8u) / 16777216.0;
            return i32(fl) + select(0, 1, u < (d - fl));
        }
        fn ste_sign(word: u32, b: u32) -> f32 {
            return f32(i32((word >> b) & 1u) * 2 - 1);
        }
    `;
    // Обновление 32 счетчиков одного слова весов, возвращает новое слово.
    // grad(b) — WGSL-выражение градиента по биту b (использует переменную b).
    static steWordUpdate({ lr, cmax, grad, salt = 0 }) {
        return `
            var word = 0u;
            let seed_s = ste_hash(seed ^ ${salt >>> 0}u);
            for (var b = 0u; b < 32u; b++) {
                let ci = widx * 32u + b;
                let d = -${BinNet.fmt(lr)} * (${grad});
                var c = counters[ci] + ste_round(d, ste_hash(seed_s ^ ste_hash(ci + 1u)));
                c = clamp(c, -${cmax}, ${cmax - 1});
                counters[ci] = c;
                if (c >= 0) { word |= (1u << b); }
            }`;
    }
    // Зерно для стохастического округления. Если LLM выставил общее зерно на шаг
    // (gpu.stepSeed, пишется раз на токен) — берем его, иначе пишем свое.
    get steSalt() {
        let h = 2166136261;
        for (const ch of this.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
        return h >>> 0;
    }
    steSeed() {
        if (this.gpu.stepSeed) return this.gpu.stepSeed;
        this._seed ??= this.write(new Uint32Array(1), 'seed', 'uniform');
        this._seed[0] = Math.trunc(BinNet.max32 * Math.random());
        this.write(this._seed);
        return this._seed;
    }
    static countersFromWeights(weights, init = 0) {
        const c = new Int32Array(weights.length * 32);
        for (let w = 0; w < weights.length; w++) {
            const word = weights[w];
            for (let b = 0; b < 32; b++)
                c[w * 32 + b] = ((word >>> b) & 1) ? init : -init - 1;
        }
        return c;
    }

    constructor(config = {}) {
        super(); 
        this.ste = config.learn === 'ste';
        this.steLr = config.steLr ?? 8;
        this.steCmax = config.steCmax ?? 16;
        this.steInit = config.steInit ?? 0;
        this.steClip = config.steClip ?? 2;
        this.testMode = config.testMode;
        this.gpu = config.gpu;
        this.id = this.constructor.name + (config.id?'_' + config.id:''); 
        this.folder = config.folder ||  '.models';  
        this.params = { weights: 32 }; 
        this.pipeline  = [];  
        if (!fs.existsSync(this.folder))
            fs.mkdirSync(this.folder, { recursive: true }); 
    }
    get paramCount() {
        return Object.values(this.params).reduce((sum, v)=>sum + v.length, 0) * 32;
    }  
    readFile(filename) {
        return fsp.readFile(path.join(this.folder, filename));
    }
    writeFile(filename, data) {
        return fsp.writeFile(path.join(this.folder, filename), data);
    } 
    async forward(x) {
        for (let step of this.pipeline) {
            x = await step.forward(x); 
        }    
        return x;
    }
    async back(x) {
        let pipeline = this.pipeline.toReversed();
        for (let step of pipeline) {
            x = await step.back(x); 
        }    
        return x;
    }
    async read(CpuBufferArrayOrName) {
        let context = this;
        if(typeof CpuBufferArrayOrName === 'string'){
            for (let prop of CpuBufferArrayOrName.split('.')) {
                context = context[prop];
            }
        }
        else
            context = CpuBufferArrayOrName;

        return context && this.gpu.readData(context);
    }
    test(propname, size = 6){
        if(!this.testMode)
            return;
        return this.read(propname).then(result => {
            if (!result)
                return '';
            console.warn(this.id + ': ');
            console.warn(propname, result.subarray(0, size).toString());
            console.warn('');
            return result;
        })

    }
    print(propname, group_by = 1) {
        if (!this.testMode)
            return;
        return this.read(propname).then(result => {
            if(!result)
                return '';
            let array = Array(result.length / group_by).fill().map((_, idx)=>{
                let start = idx * group_by;
                return result.subarray(start, start + group_by);
            })
            result = BinNet.printW(array);
            console.warn(this.id + ': ');
            console.warn(propname, result.toString());
            console.warn('');
            return result;
        })
    }
    write(CpuBufferArray, label, type = "storage", options = {}) {
        options.label ??= this.id + ' ' + label || '';
        options.type ??= type;
        this.gpu.writeData(CpuBufferArray, options);
        return CpuBufferArray;
    }
    async load() {
        for (let p in this.params) {
            let name = `${this.id} - ${p}.bin`;
            try{
                const buffer = await this.readFile(name);
                this.params[p] = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Uint32Array.BYTES_PER_ELEMENT); 
                console.log(`Параметры "${name}" загружены`);
            }
            catch(e) {
                this.params[p] = BinNet.create_random_vector(this.params[p]);
                console.log(`Созданы новые параметры "${name}"`);
            }
        }
        await this.loadSte();
        console.log(`Модуль "${this.id}" готов к работе\n`);
    }
    // STE-состояние (счетчики весов, смещения) хранится рядом с весами: "<id> - counters.bin"
    async loadSte() {
        if (!this.ste) return;
        for (const name of ['counters', 'bias']) {
            try {
                const buf = await this.readFile(`${this.id} - ${name}.bin`);
                const arr = Int32Array.from(new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
                if (name === 'counters') this._savedCounters = arr;
                else if (this.bias && arr.length === this.bias.length) { this.bias.set(arr); this.write(this.bias); }
                console.log(`STE "${this.id} - ${name}.bin" загружен`);
            } catch (e) { /* нет файла — начнем с битов */ }
        }
    }
    async saveSte() {
        if (!this.ste) return;
        for (const name of ['counters', 'bias']) {
            const arr = this[name];
            if (!arr) continue;
            try {
                await this.gpu.readData(arr);
                await this.writeFile(`${this.id} - ${name}.bin`, arr);
            } catch (e) {
                console.error(`${this.id} - ${name}.bin\n${e.message}`);
            }
        }
    }
    // Счетчики создаются лениво при первом обратном проходе: из файла или из текущих бит
    ensureCounters(weights) {
        if (!this.counters) {
            let c = this._savedCounters;
            if (!c || c.length !== weights.length * 32) c = BinNet.countersFromWeights(weights, this.steInit);
            this._savedCounters = null;
            this.counters = this.write(c, 'counters');
        }
        return this.counters;
    }
    async save(config = {readGpu: true}) {
        for (let p in this.params) {
            let name = `${this.id} - ${p}.bin`;
            try {
                if (config.readGpu && this.gpu.buffers.has(this.params[p])) {
                    await this.gpu.readData(this.params[p]);
                }
                await this.writeFile(name, this.params[p]);
                console.log(`Параметры "${name}" сохранены`);
            }
            catch(e) {
                console.error(name + '\n' + e.message);
            }
        }
        await this.saveSte();
        console.log(`Модуль "${this.id}" сохранен\n`);
    }    
    static vec2bits(vector = new Uint32Array(), split = 0) {
        if (split) {
            let list = new Array();
            for (let i = 0; i < vector.length; i += split) {
                list.push(vector.subarray(i, i + split));
            }
            return this.printW(list);
        }
        return Array.prototype.map.call(vector, v => v.toString(2).padStart(32, '0')).join(' ');
    }

    static printW(weights) {
        return weights.map(w => Array.prototype.map.call(w, v => v.toString(2).padStart(32, '0')).join(''));
    }    
     
    static create_random_vector(size) {
        return this.create_zeros_vector(size).map(() => Math.trunc(this.max32 * Math.random()));
    }

    static create_zeros_vector(size) {
        return new Uint32Array(size);
    }

    static create_ones_vector(size) {
        return this.create_zeros_vector(size).fill(this.max32);
    }

    static popcount32(v) {
        // Быстрый побитовый popcount для CPU (Моррис-Пратт-Уоррен алгоритм)
        var x = v;
        x = x - ((x >> 1) & 0x55555555);
        x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
        x = (x + (x >> 4)) & 0x0F0F0F0F;
        x = x + (x >> 8);
        x = x + (x >> 16);
        return x & 0x0000003F;
    }

    static hamming_distance(a, b) {
        return a.reduce((sum, v1, i) => sum + this.popcount32(v1 ^ b[i]), 0);
    } 

    static bitSimilarityUint32(vec1, vec2) {
        if (vec1.length !== vec2.length) return 0;
        if (vec1.length === 0) return 100;
      
        let totalDiffBits = 0;
        const len = vec1.length;
      
        for (let i = 0; i < len; i++) {
            let xor = vec1[i] ^ vec2[i];
            // Алгоритм Брайана Кернигана для быстрого подсчета единиц
            while (xor !== 0) {
                totalDiffBits++;
                xor &= (xor - 1); 
            }
        }
      
        const totalBits = len * 32;
        const matchingBits = totalBits - totalDiffBits;
      
        return 1 - matchingBits / totalBits;
    }
}
