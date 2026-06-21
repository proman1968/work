import fs from "fs";
import fsp from "node:fs/promises";
import path from "path";
export class BinNet extends EventTarget {
    static max32 = 4294967295; // 2 ** 32 - 1
    constructor(config = {}) {
        super(); 
        this.testMode = config.testMode;
        this.gpu = config.gpu;
        this.id = this.constructor.name + (config.id?'_' + config.id:''); 
        this.folder = config.folder ||  '.models';  
        this.params = { weights: 32 }; 
        this.pipeline  = [];  
        if (!fs.existsSync(this.folder))
            fs.mkdirSync(this.folder, { recursive: true }); 
    }
    get paramCount(){
        return Object.values(this.params).reduce((sum, v)=>sum + v.length, 0) * 32;
    }  
    readFile(filename){
        return fsp.readFile(path.join(this.folder, filename));
    }
    writeFile(filename, data){
        return fsp.writeFile(path.join(this.folder, filename), data);
    } 
    async forward(x){
        for(let step of this.pipeline){
            x = await step.forward(x); 
        }    
        return x;
    }
    async read(CpuBufferArrayOrName){
        let context = this;
        if(typeof CpuBufferArrayOrName === 'string'){
            for(let prop of CpuBufferArrayOrName.split('.')){
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
        return this.read(propname).then(result=>{
            if(!result)
                return '';
            console.warn(this.id + ': ');
            console.warn(propname, result.subarray(0, size).toString());
            console.warn('');
            return result;
        })

    }
    print(propname, group_by = 1){
        if(!this.testMode)
            return;
        return this.read(propname).then(result=>{
            if(!result)
                return '';
            let array = Array(result.length / group_by).fill().map((_, idx)=>{
                let start = idx * group_by;
                return result.subarray(start, start + group_by);
            })
            result = BinNet.printW(array)
            console.warn(this.id + ': ');
            console.warn(propname, result.toString());
            console.warn('');
            return result;
        })
    }
    write(CpuBufferArray, label, type = "storage", options = {}){
        options.label ??= this.id + ' ' + options.label || '';
        options.type ??= type;
        this.gpu.writeData(CpuBufferArray, options);
        return CpuBufferArray;
    }
    async load(){
        for(let p in this.params){
            let name = `${this.id} - ${p}.bin`;
            try{
                const buffer = await this.readFile(name);
                this.params[p] = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Uint32Array.BYTES_PER_ELEMENT); 
                console.log(`Параметры "${name}" загружены`);
            }
            catch(e){
                this.params[p] = BinNet.create_random_vector(this.params[p]);
                console.log(`Созданы новые параметры "${name}"`);
            }
        }
        console.log(`Модуль "${this.id}" готов к работе\n`);
    }
    async save(){
        for(let p in this.params){
            let name = `${this.id} - ${p}.bin`;
            try{
                await this.writeFile(name, this.params[p]);
                console.log(`Параметры "${name}" сохранены`);
            }
            catch(e){
                console.error(name + '\n' + e.message);
            }
        }
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
