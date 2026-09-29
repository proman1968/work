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

        if (this.ste) {
            this.nBits = this.embSize * 32;
            // Температура softmax: логиты ∈ [-n, n], при случайных весах std ≈ √n
            this.temp = config.headTemp ?? Math.sqrt(this.nBits);
            this.steLrHead = config.steLrHead ?? this.steLr;
            this.steInit = config.steInitHead ?? this.steInit;
            this.gLogits = this.write(new Float32Array(this.vocabSize), 'grad_logits');
            this.gIn = this.write(new Float32Array(this.nBits), 'grad_in');
        }
    }

    // Полный softmax + cross-entropy по словарю, счетчики вместо перезаписи бит.
    backSte(data = {}) {
        const target = data.back_target ?? 0;
        const invT = BinNet.fmt(1 / this.temp);
        const V = this.vocabSize, E = this.embSize;
        this.ensureCounters(this.params.weights);
        if (!this.SOFTMAX) {
            this.SOFTMAX = this.gpu.compile(`
                // SOFTMAX Head: gl[v] = p_v - [v == target]
                struct Vars { max_logit: i32, errors: u32, predict: u32, target_idx: u32, loss: f32, random: f32 }
                @group(0) @binding(0) var<storage, read> logits: array<i32>;
                @group(0) @binding(1) var<storage, read> vars: Vars;
                @group(0) @binding(2) var<storage, read_write> gl: array<f32>;
                var<workgroup> sh: array<f32, 256>;
                @compute @workgroup_size(256)
                fn main(@builtin(local_invocation_id) lid: vec3<u32>) {
                    let t = lid.x;
                    var m = -3.0e38;
                    for (var v = t; v < ${V}u; v += 256u) { m = max(m, f32(logits[v])); }
                    sh[t] = m;
                    workgroupBarrier();
                    for (var off = 128u; off > 0u; off >>= 1u) {
                        if (t < off) { sh[t] = max(sh[t], sh[t + off]); }
                        workgroupBarrier();
                    }
                    let mx = sh[0];
                    workgroupBarrier();
                    var s = 0.0;
                    for (var v = t; v < ${V}u; v += 256u) { s += exp((f32(logits[v]) - mx) * ${invT}); }
                    sh[t] = s;
                    workgroupBarrier();
                    for (var off = 128u; off > 0u; off >>= 1u) {
                        if (t < off) { sh[t] = sh[t] + sh[t + off]; }
                        workgroupBarrier();
                    }
                    let total = sh[0];
                    for (var v = t; v < ${V}u; v += 256u) {
                        let p = exp((f32(logits[v]) - mx) * ${invT}) / total;
                        gl[v] = p - select(0.0, 1.0, v == vars.target_idx);
                    }
                }
            `);

            this.BACK_X = this.gpu.compute_info(this.nBits);
            this.BACK_X.compile(`
                // BACK_X Head: dL/dx_k = Σ_v gl_v · w_vk / T
                @group(0) @binding(0) var<storage, read> weights: array<u32>;
                @group(0) @binding(1) var<storage, read> gl: array<f32>;
                @group(0) @binding(2) var<storage, read_write> gin: array<f32>;
                @compute @workgroup_size(${this.BACK_X.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${this.BACK_X.idx_code_gen}
                    let i = idx / 32u;
                    let b = idx % 32u;
                    var sum = 0.0;
                    for (var v = 0u; v < ${V}u; v++) {
                        sum += gl[v] * ste_sign(weights[v * ${E}u + i], b);
                    }
                    gin[idx] = sum * ${invT};
                }
                ${BinNet.STE_WGSL}
            `, this.id + ':BACK_X');

            this.UPDATE = this.gpu.compute_info(V * E);
            this.UPDATE.compile(`
                // UPDATE Head STE
                @group(0) @binding(0) var<storage, read> inputs: array<u32>;
                @group(0) @binding(1) var<storage, read_write> weights: array<u32>;
                @group(0) @binding(2) var<storage, read_write> counters: array<i32>;
                @group(0) @binding(3) var<storage, read> gl: array<f32>;
                @group(0) @binding(4) var<uniform> seed: u32;
                @compute @workgroup_size(${this.UPDATE.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${this.UPDATE.idx_code_gen}
                    let widx = idx;
                    let g = gl[widx / ${E}u] * ${invT};
                    if (abs(g) < 1e-9) { return; }
                    let x = inputs[widx % ${E}u];
                    ${BinNet.steWordUpdate({ lr: this.steLrHead, cmax: this.steCmax, grad: 'g * ste_sign(x, b)', salt: this.steSalt })}
                    weights[widx] = word;
                }
                ${BinNet.STE_WGSL}
            `, this.id + ':UPDATE_STE');
        }

        // target_idx уже записан forward'ом (targetIdx == следующий токен)
        if (this.input?.targetIdx !== target) {
            const view = new DataView(this.vars.buffer, this.vars.byteOffset);
            view.setUint32(12, target, true);
            this.write(this.vars);
        }
        const x = this.input?.data ?? this.input;
        this.gpu.compute(this.SOFTMAX, [this.logits, this.vars, this.gLogits], [1, 1, 1]);
        this.BACK_X.compute([this.params.weights, this.gLogits, this.gIn]);
        this.UPDATE.compute([x, this.params.weights, this.counters, this.gLogits, this.steSeed()]);
        return { grad: this.gIn };
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

        // Обучение без ожидания GPU: ошибки копятся в errorCount, читаются раз в строку
        if (this.input.noRead) {
            if (!this.COUNT) {
                this.errorCount = this.write(new Uint32Array(1), 'error_count');
                this.COUNT = this.gpu.compile(`
                    struct Vars { max_logit: i32, errors: u32, predict: u32, target_idx: u32, loss: f32, random: f32 }
                    @group(0) @binding(0) var<storage, read> vars: Vars;
                    @group(0) @binding(1) var<storage, read_write> count: array<u32>;
                    @compute @workgroup_size(1)
                    fn main() {
                        if (vars.predict != vars.target_idx) { count[0] = count[0] + 1u; }
                    }
                `);
            }
            this.gpu.compute(this.COUNT, [this.vars, this.errorCount], [1, 1, 1]);
            return { predictIdx: -1, loss: undefined, src: this.input.src };
        }
        await this.read(this.vars);

        let predictIdx = view.getUint32(8, true);
        
        // ВЫЧИСЛЕНИЕ ЧЕСТНОГО LOSS НА CPU
        let loss = (predictIdx === this.input.targetIdx) ? 0.0 : 1.0;
        view.setFloat32(16, loss, true); // Перезаписываем loss для BACK шага

        return { predictIdx, loss, src: this.input.src };
    }

    back(data = {}) {
        if (this.ste) return this.backSte(data);
        let target = data.back_target || 0;
        let predict = data.predict || 0;

        if (!this.BACK) {

            // Трети потоков: target (притянуть), predict (оттолкнуть),
            // случайный негатив (оттолкнуть — рассредоточивает урон по словарю)
            this.BACK = this.gpu.compute_info(this.embSize * 3);
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
                    const v_size = ${this.vocabSize}u;

                    // Базовое случайное зерно из JS
                    let base_seed = bitcast<u32>(vars.random);
                    // var rnd = (idx ^ base_seed) * 0xcc9e2d51u;
                    // rnd = (rnd << 15u) | (rnd >> 17u);
                    // rnd = rnd * 0x1b873593u;
                    let rnd = hash(base_seed ^ (idx + 1u));
                    // Генерируем фиксированный процент маски (пример: 6.25% == 2 единицы в маске) через И
                    // Первый множитель дает 16 единиц в маске, каждый последующий делит это число на 2
                    let mask = rnd & ((rnd >> 5u) | (rnd << 27u)) & ((rnd >> 11u) | (rnd << 21u)) & ((rnd >> 17u) | (rnd << 15u));
                    // Притяжение цели — вчетверо сильнее отталкивания (~25%):
                    // запоминание должно обгонять урон по чужим рядам
                    let mask_pull = rnd & ((rnd >> 5u) | (rnd << 27u));

                    // Разделяем потоки на три трети: target, predict, случайный негатив
                    if (idx < e_size) {
                        let i = idx;
                        let w_index = vars.target_idx * e_size + i;
                        let old_w = weights[w_index];
                        let new_w = inputs[i];
                        weights[w_index] = (old_w & ~mask_pull) | (new_w & mask_pull);
                        back_target[i] = weights[w_index];
                    }
                    else if (idx < e_size * 2u) {
                        let i = idx - e_size; // Смещаем индекс обратно к 0..e_size
                        let w_index = vars.predict * e_size + i;
                        let old_w = weights[w_index];
                        let new_w = ~inputs[i];
                        weights[w_index] = (old_w & ~mask) | (new_w & mask);
                    }
                    else {
                        let i = idx - e_size * 2u;
                        var r = hash(base_seed ^ (idx + 7919u)) % v_size;
                        if (r == vars.target_idx) { r = (r + 1u) % v_size; }
                        let w_index = r * e_size + i;
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
