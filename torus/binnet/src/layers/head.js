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
        this.vars = this.write(new Uint32Array(6), 'vars');

        this.back_target = this.write(new Uint32Array(this.embSize), 'back_target');
    }

    async forward(input = {}) {    
        this.input = input;
        if (!this.FWD) {
            this.FWD = this.gpu.compute_info(this.vocabSize);
            let code = `
                // FORWARD Head
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
                // SAMPLE Head
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
                    if (logits[idx] == logit) {  
                        atomicMin(&vars.predict, idx);
                    }
                }
            `;
            this.SAMPLE.compile(code, this.id + ':SAMPLE');
        }
        
        this.SAMPLE.compute([this.logits, this.vars]);
        await this.read(this.vars);

        let predictIdx = view.getUint32(8, true);
        
        // ВЫЧИСЛЕНИЕ ЧЕСТНОГО LOSS НА CPU
        let loss = (predictIdx === this.input.targetIdx) ? 0.0 : 1.0;
        view.setFloat32(16, loss, true); // Перезаписываем loss для BACK шага

        return { predictIdx, loss, src: this.input.src };
    }

    back(data = {}) {
        let target = data.back_target || 0;
        let predict = data.predict || 0;

        if (!this.BACK) {

            this.BACK = this.gpu.compute_info(this.embSize * 2);  // Первая половина потоков обновит веса для target_idx, а вторая половина — для predict
            let code = `
                // BACK Head
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
                @group(0) @binding(2) var<storage, read> vars: Vars;
                @group(0) @binding(3) var<storage, read_write> back_target: array<u32>;

                // Сверхбыстрый целочисленный хеш
                fn hash(state: u32) -> u32 {
                    var x = state;
                    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
                    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
                    x = (x >> 16u) ^ x;
                    return x;
                }

                @compute @workgroup_size(${this.BACK.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${this.BACK.idx_code_gen}
                    const e_size = ${this.embSize}u;

                    // Базовое случайное зерно из JS
                    let base_seed = bitcast<u32>(vars.random);
                    // var rnd = (idx ^ base_seed) * 0xcc9e2d51u;
                    // rnd = (rnd << 15u) | (rnd >> 17u);
                    // rnd = rnd * 0x1b873593u;
                    let rnd = hash(base_seed ^ (idx + 1u));
                    // Генерируем фиксированный процент маски (пример: 6.25% == 2 единицы в маске) через И
                    // Первый множитель дает 16 единиц в маске, каждый последующий делит это число на 2
                    let mask = rnd & ((rnd >> 5u) | (rnd << 27u)) & ((rnd >> 11u) | (rnd << 21u)) & ((rnd >> 17u) | (rnd << 15u));

                    // Разделяем потоки: первая половина для target, вторая для predict
                    if (idx < e_size) {
                        let i = idx;   
                        let w_index = vars.target_idx * e_size + i;
                        let old_w = weights[w_index];
                        let new_w = inputs[i];
                        weights[w_index] = (old_w & ~mask) | (new_w & mask);
                        back_target[i] = weights[w_index];
                    } 
                    else {
                        let i = idx - e_size; // Смещаем индекс обратно к 0..e_size
                        let w_index = vars.predict * e_size + i;
                        let old_w = weights[w_index];
                        let new_w = ~inputs[i];
                        weights[w_index] = (old_w & ~mask) | (new_w & mask);
                    }
                }
            `;
            this.BACK.compile(code, this.id + ':BACK_HEAD_CONTRAST');
        }

        let targetBuffer = this.input?.data ?? this.input;

        const view = new DataView(this.vars.buffer, this.vars.byteOffset);
        view.setUint32(12, target, true);
        view.setUint32(8, predict, true);
        view.setFloat32(20, Math.random(), true);
        this.write(this.vars);

        this.BACK.compute([
            targetBuffer,
            this.params.weights,
            this.vars,
            this.back_target
        ]);

        return { predict, back_target: this.back_target };
     }

}
