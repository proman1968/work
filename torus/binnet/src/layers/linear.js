import { BinNet } from '../core/bin-net.js';

export class Linear extends BinNet {
    _shaders = {};

    constructor(config = {}) {
        super(config);
        this.in_size = config.in_size || 1;
        this.out_size = config.out_size || 1;
        this.divider = config.divider || 1;
        
        if (this.in_size % this.divider)
            throw new Error(`Linear "${config.id ?? ''}": in_size=${this.in_size} не кратен divider=${this.divider}`);
        if (this.out_size % this.divider)
            throw new Error(`Linear "${config.id ?? ''}": out_size=${this.out_size} не кратен divider=${this.divider}`);
        this.all_weights_size = (this.in_size / this.divider) * this.out_size * 32;
        this.weight_size = this.all_weights_size / (this.out_size * 32);
        // Ручка скорости обучения: дополнительные AND-итерации маски (каждая ~ вдвое реже).
        // 0 = поведение как раньше (дефолт не меняем, чтобы L-тесты и Node не поплыли).
        this.updateExtra = Math.max(0, Math.trunc(config.linUpdateExtra ?? 0));
        // Соревнование нейронов: в каждом выходном слове активны только topK
        // победителей по величине вотума (разные входы — разные победители,
        // веса не усредняются в «среднее слово»). 32 = как раньше, попиксельно
        // тот же шейдер (L2-эталон продолжает действовать).
        this.topK = Math.min(32, Math.max(1, Math.trunc(config.topK ?? 32)));
        
        this.params = { weights: this.all_weights_size };

        this.output = this.write(BinNet.create_zeros_vector(this.out_size), 'output');
        this.seedArray = this.write(new Uint32Array(1), 'seed', 'uniform');
    }

    async forward(input) {
        let incoming = input?.data ?? input;

        if (!this.input) {
            this.input = incoming;
            if (!this.gpu.buffers.has(this.input))
                this.write(this.input, 'input: ' + this.id);
        }
        else if (this.input !== incoming) {
            this.input.set(incoming);
            this.write(this.input);
        }

        if (!this._shaders.FORWARD) {
            let wg = this.gpu.compute_info(this.out_size);
            this._shaders.FORWARD = wg;
            // При topK=32 — попиксельно старый код (sum>0). При меньшем — отбор
            // победителей: бит ставят только topK нейронов с наибольшим вотумом
            // (ничьи — в пользу младшего индекса, детерминированно).
            const voteBody = `
                    for (var o = 0u; o < 32u; o++) {
                        var sum = 0;
                        let w_start = ((idx * 32u) + o) * w_size;
                        for (var i = 0u; i < w_size; i++) {
                            let input = inputs[input_start + i];
                            let weight = weights[w_start + i];
                            sum += i32(countOneBits(input & weight)) - i32(countOneBits(input & ~weight));
                        }
                        VOTE_COLLECT
                    }`;
            const legacyTail = `if (sum > 0) { out_value |= (1u << o); }`;
            const wtaTail = `s[o] = sum;`;
            const wtaSelect = `
                    for (var p = 0u; p < ${this.topK}u; p++) {
                        var best = 0u;
                        var bestSum = -2000000000;
                        for (var j = 0u; j < 32u; j++) {
                            if (s[j] > bestSum) { bestSum = s[j]; best = j; }
                        }
                        out_value |= (1u << best);
                        s[best] = -2000000000;
                    }`;
            const perNeuron = this.topK >= 32 ? legacyTail : wtaTail;
            let code = `
                // FORWARD Linear (topK=${this.topK})
                @group(0) @binding(0) var<storage, read> inputs: array<u32>;
                @group(0) @binding(1) var<storage, read> weights: array<u32>;
                @group(0) @binding(2) var<storage, read_write> outputs: array<u32>;
                @compute @workgroup_size(${wg.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${wg.idx_code_gen}
                    const w_size = ${this.weight_size}u;
                    var out_value = 0u;
                    let input_start = (idx / ${this.out_size / this.divider}u) * w_size;
                    ${this.topK >= 32 ? '' : 'var s: array<i32, 32>;'}
                    ${voteBody.replace('VOTE_COLLECT', perNeuron)}
                    ${this.topK >= 32 ? '' : wtaSelect}
                    outputs[idx] = out_value;
                }
            `;
            wg.compile(code, this.id + ':FWD');
        }
        this._shaders.FORWARD.compute([this.input, this.params.weights, this.output]);
        return { data: this.output, src: this };  
    }

    async back(targetInput) {
        let incoming = targetInput?.back_target ?? targetInput;

        if (!this.target) {
            this.target = incoming;
            if (!this.gpu.buffers.has(this.target))
                this.write(this.target, 'target: ' + this.id);
        }
        else if (this.target !== incoming) {
            this.target.set(incoming);
            this.write(this.target);
        }

// Задача back: по целям выхода восстановить цели входа.
// Честное транспонирование: бит входа = знаковый вотум по всем нейронам
// подсети (бит веса == целевой бит ? +1 : -1). Бинарный аналог W^T·target.
// (Раньше здесь читался forward-выход как «веса» — сигнал вниз был мусорным.)
        if (!this._shaders.BACK) {
            let wg = this.gpu.compute_info(this.in_size);
            this._shaders.BACK = wg;

            // Выделяем буфер под собственный back_target правильного размера (in_size)
            this._shaders.BACK.target = this.write(BinNet.create_zeros_vector(this.in_size), 'back_target');

            const wOut = this.out_size / this.divider;  // выходных u32-блоков на подсеть
            const wIn = this.weight_size;               // входных u32-блоков на нейрон
            const inPerSubnet = this.in_size / this.divider;
            let code = `
                // BACK Linear (transpose vote)
                @group(0) @binding(0) var<storage, read> weights: array<u32>;
                @group(0) @binding(1) var<storage, read> targets: array<u32>;
                @group(0) @binding(2) var<storage, read_write> back_targets: array<u32>;

                @compute @workgroup_size(${wg.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${wg.idx_code_gen}
                    let subnet = idx / ${inPerSubnet}u;
                    let j = idx % ${inPerSubnet}u;
                    let out_start = subnet * ${wOut}u;
                    var back_word = 0u;
                    for (var b = 0u; b < 32u; b++) {
                        var sum: i32 = 0;
                        for (var q = 0u; q < ${wOut}u; q++) {
                            let tword = targets[out_start + q];
                            for (var o = 0u; o < 32u; o++) {
                                let w = weights[((out_start + q) * 32u + o) * ${wIn}u + j];
                                let tbit = (tword >> o) & 1u;
                                let wbit = (w >> b) & 1u;
                                sum += select(-1, 1, wbit == tbit);
                            }
                        }
                        if (sum > 0) { back_word |= 1u << b; }
                    }
                    back_targets[idx] = back_word;
                }
            `;
            wg.compile(code, this.id + ':BACK');
        }
        this._shaders.BACK.compute([
            this.params.weights,
            this.target,
            this._shaders.BACK.target
        ]);

        if (!this._shaders.UPDATE) {
            let wg = this.gpu.compute_info(this.out_size);
            this._shaders.UPDATE = wg;

            let code = `
                // UPDATE Linear
                fn xorshift32(s: ptr<function, u32>) -> u32 {
                    var x = *s; x ^= x << 13u; x ^= x >> 17u; x ^= x << 5u; *s = x; return x;
                }
                @group(0) @binding(0) var<storage, read> inputs: array<u32>;
                @group(0) @binding(1) var<storage, read_write> weights: array<u32>;
                @group(0) @binding(2) var<storage, read> targets: array<u32>;
                @group(0) @binding(3) var<storage, read> outputs: array<u32>;
                @group(0) @binding(4) var<uniform> seed: u32;
                // @group(0) @binding(5) var<storage, read> back_targets: array<u32>;
                
                @compute @workgroup_size(${wg.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${wg.idx_code_gen} 
                    const w_size = ${this.weight_size}u;
                    let target_word = targets[idx];
                    let output_word = outputs[idx];
                    
                    let error = f32(countOneBits(output_word ^ target_word)) / 32.0;
                    let input_start = (idx / ${this.out_size / this.divider}u) * w_size;
                    
                    if (error == 0.0) { return; } 
                    
                    var rnd = idx ^ seed;
                    let loops = i32(clamp(2.0 / (0.14 + error), 1.0, 11.0)) + ${this.updateExtra}; 
                    var pre_mask = 0xFFFFFFFFu;
                    for (var r = 0; r < loops; r++) { pre_mask &= xorshift32(&rnd); }
                    
                    for (var o = 0u; o < 32u; o++) {
                        let w_start = ((idx * 32u) + o) * w_size;
                        let target_bit = (target_word >> o) & 1u;
                        for(var i = 0u; i < w_size; i++) {
                            var inp = inputs[input_start + i];
                            if (target_bit == 0u) { inp = ~inp; }
                            var rnd_bits = xorshift32(&rnd) & pre_mask;
                            ${this.topK >= 32 ? '' : 'if (((output_word >> o) & 1u) == 0u) { rnd_bits &= xorshift32(&rnd) & xorshift32(&rnd) & xorshift32(&rnd) & xorshift32(&rnd); }'}
                            weights[w_start + i] = (weights[w_start + i] & ~rnd_bits) | (inp & rnd_bits);
                        }
                    }                
                }
            `;    
            wg.compile(code, this.id + ':UPDATE'); 
        }
       
        this.seedArray[0] = Math.trunc(BinNet.max32 * Math.random());        
        this.write(this.seedArray, 'seed', 'uniform');
        
        this._shaders.UPDATE.compute([
            this.input, 
            this.params.weights, 
            this.target, 
            this.output, 
            this.seedArray
        ]);        
 
        return { back_target: this._shaders.BACK.target };
    }

    get paramCount() { return this.all_weights_size; }
}
