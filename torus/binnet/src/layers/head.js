import { BinNet } from '../core/bin-net.js';

export class Head extends BinNet {
    constructor(config = {}) {
        super(config);
        this.vocabSize = config.vocabSize || 32768; // 2 ** 15
        this.embSize = config.embSize || 32;   

        this.params = {
            weights: this.vocabSize * this.embSize
        };   

        this.logits = this.write(new Int32Array(this.vocabSize), 'logits');    
        // 1. Создаем сырой буфер на 24 байта (6 элементов * 4 байта)
        const buffer = new ArrayBuffer(24);

        // 2. Создаем типизированные представления для разных типов данных внутри этой памяти
        this.varsInt32   = new Int32Array(buffer);
        this.varsUint32  = new Uint32Array(buffer);
        this.varsFloat32 = new Float32Array(buffer);

        // 3. Регистрируем буфер в WebGPU (передаем любой из view, они делят один buffer)
        this.vars = this.write(this.varsInt32, 'vars');

    }

    async forward(input = {}) {    
        this.input = input;
        if (!this.FWD) {
            this.FWD = this.gpu.compute_info(this.vocabSize);
            let code = `
                struct Vars {
                    max_logit: atomic<i32>,
                    errors: atomic<u32>,
                    predict: atomic<u32>,
                    target_idx: u32,
                    loss: f32,
                    random: f32                      
                }
                @group(0) @binding(0) var<storage, read> inputs: array<u32>; 
                @group(0) @binding(1) var<storage, read> weights: array<u32>;
                @group(0) @binding(2) var<storage, read_write> logits: array<i32>;
                @group(0) @binding(3) var<storage, read_write> vars: Vars;
                
                @compute @workgroup_size(${this.FWD.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${this.FWD.idx_code_gen} 
                    let e_size = ${this.embSize}u;
                    let weight_start = idx * e_size;
                    var sum: i32 = 0;
                    
                    for(var i = 0u; i < e_size; i++) {
                        let x = inputs[i];
                        let w = weights[weight_start + i];
                        let xnor = ~(x ^ w);
                        sum += i32(countOneBits(xnor));
                    }
                    
                    sum = (sum * 2) - i32(${this.embSize * 32});
                    logits[idx] = sum;
                    
                    atomicMax(&vars.max_logit, sum);
                }
            `;
            this.FWD.compile(code, this.id + ':FWD');
        }

        // Инициализация буфера vars через DataView
        const view = new DataView(this.vars.buffer, this.vars.byteOffset);
        view.setInt32(0, -2147483648, true);   // max_logit
        view.setUint32(4, 0, true);            // errors (больше не считаем на GPU)
        view.setUint32(8, 4294967295, true);   // predict
        view.setUint32(12, this.input.targetIdx, true); 
        view.setFloat32(16, 1.0, true);        // loss (по умолчанию ошибка)
        view.setFloat32(20, Math.random(), true); 
        
        this.write(this.vars);

        this.FWD.compute([
            this.input.data, 
            this.params.weights, 
            this.logits,
            this.vars
        ]);

        if (!this.SAMPLE) {
            this.SAMPLE = this.gpu.compute_info(this.vocabSize);
            let code = `
                struct Vars {
                    max_logit: atomic<i32>,
                    errors: atomic<u32>,
                    predict: atomic<u32>,
                    target_idx: u32,
                    loss: f32,
                    random: f32                      
                }
                @group(0) @binding(0) var<storage, read> logits: array<i32>;
                @group(0) @binding(1) var<storage, read_write> vars: Vars;
                
                @compute @workgroup_size(${this.SAMPLE.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${this.SAMPLE.idx_code_gen} 
                    let logit = atomicLoad(&vars.max_logit);
                    if(logits[idx] == logit) {  
                        atomicMin(&vars.predict, idx);
                    }
                }
            `;
            this.SAMPLE.compile(code, this.id + ':SAMPLE');
        }
        
        this.SAMPLE.compute([this.logits, this.vars]);
        await this.read(this.vars);

        let predict = view.getUint32(8, true);
        
        // ВЫЧИСЛЕНИЕ ЧЕСТНОГО LOSS НА CPU
        let loss = (predict === this.input.targetIdx) ? 0.0 : 1.0;
        view.setFloat32(16, loss, true); // Перезаписываем loss для BACK шага

        this.back({ target: this.input.targetIdx, predict: predict });
        return { predict, loss };  
    }

    back(data = {}) {
        let targetIdx = data.target || 0;
        let predictIdx = data.predict || 0;

        if (targetIdx === predictIdx) { return; }

        if (!this.BACK) {
            this.BACK = this.gpu.compute_info(this.vocabSize);

            let code = `
                struct Vars {
                    max_logit: i32,
                    errors: u32,
                    predict: u32,
                    target_idx: u32,
                    loss: f32,
                    random: f32                      
                }
                @group(0) @binding(0) var<storage, read> inputs: array<u32>; 
                @group(0) @binding(1) var<storage, read_write> weights: array<u32>; 
                
                // ИСПРАВЛЕНО: Меняем uniform на storage, read, чтобы убрать ошибку Binding Usage!
                @group(0) @binding(2) var<storage, read> vars: Vars; 

                @compute @workgroup_size(${this.BACK.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${this.BACK.idx_code_gen}
                    let e_size = ${this.embSize}u;
                    let w_start = idx * e_size;

                    if (idx == vars.target_idx) {
                        for (var i = 0u; i < e_size; i++) {
                            weights[w_start + i] = inputs[i]; 
                        }
                    }
                    if (idx == vars.predict) {
                        for (var i = 0u; i < e_size; i++) {
                            weights[w_start + i] = ~inputs[i]; 
                        }
                    }
                }
            `;
            this.BACK.compile(code, this.id + ':BACK_HEAD_CONTRAST');
        }

        let targetBuffer = null;
        if (this.input) {
            if (this.input.data) targetBuffer = this.input.data;
            else if (this.input.buffer) targetBuffer = this.input;
        }
        if (!targetBuffer && this.embedding) {
            targetBuffer = this.embedding.output;
        }

        if (!targetBuffer || !this.logits || !this.vars || !this.params || !this.params.weights) {
            return;
        }

        const view = new DataView(this.vars.buffer, this.vars.byteOffset);
        view.setUint32(12, targetIdx, true); 
        view.setUint32(8, predictIdx, true);  
        view.setFloat32(20, Math.random(), true); 
        this.write(this.vars);

        this.BACK.compute([
            targetBuffer,          
            this.params.weights,   
            this.vars              
        ]);

        if (this.embedding && typeof this.embedding.back === 'function') {
            this.embedding.back({ target: targetIdx, parentLoss: 1.0 });
        }
    }


}
