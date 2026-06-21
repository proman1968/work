import { BinNet } from '../core/bin-net.js';

export class Linear extends BinNet {
    _shaders = {};

    constructor(config = {}) {
        super(config);
        this.in_size = config.in_size || 1;
        this.out_size = config.out_size || 1;
        this.divider = config.divider || 1;
        
        this.all_weights_size = (this.in_size / this.divider) * this.out_size * 32;
        this.weight_size = this.all_weights_size / (this.out_size * 32);
        
        this.params = { weights: this.all_weights_size };

        this.input = this.write(BinNet.create_zeros_vector(this.in_size), 'input');
        this.output = this.write(BinNet.create_zeros_vector(this.out_size), 'output');
        this.target = this.write(BinNet.create_zeros_vector(this.out_size), 'target');
        this.seedArray = this.write(new Uint32Array(1), 'seed', 'uniform');
    }

    async forward(input) {
        let incoming = input?.data ?? input;
        if (incoming instanceof Uint32Array && this.input !== incoming) {
            this.input.set(incoming);
            this.write(this.input);
        }

        if (!this._shaders.FORWARD) {
            let wg = this.gpu.compute_info(this.out_size);
            this._shaders.FORWARD = wg;
            let code = `
                @group(0) @binding(0) var<storage, read> inputs: array<u32>;
                @group(0) @binding(1) var<storage, read> weights: array<u32>;
                @group(0) @binding(2) var<storage, read_write> outputs: array<u32>;
                @compute @workgroup_size(${wg.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${wg.idx_code_gen} 
                    const w_size = ${this.weight_size}u;
                    var out_value = 0u; 
                    let input_start = (idx / ${this.out_size / this.divider}u) * w_size;
                    
                    for(var o = 0u; o < 32u; o++){
                        var sum = 0; 
                        let start = ((idx * 32u) + o) * w_size;
                        for(var i = 0u; i < w_size; i++) {
                            sum += i32(countOneBits(inputs[input_start + i] & weights[start + i])) - i32(countOneBits(inputs[input_start + i] & ~weights[start + i]));
                        }  
                        if(sum > 0) { out_value |= (1u << o); }
                    }     
                    outputs[idx] = out_value;
                }
            `;
            wg.compile(code, this.id + ':FWD');
        }
        this._shaders.FORWARD.compute([this.input, this.params.weights, this.output]);
        return { data: this.output, src: this };  
    }

    async back(targetInput) {
        let incoming = targetInput?.target ?? targetInput;
        if (incoming instanceof Uint32Array && this.target !== incoming) {
            this.target.set(incoming);
            this.write(this.target);
        }       

        if (!this._shaders.BACK) {
            let wg = this.gpu.compute_info(this.out_size);
            this._shaders.BACK = wg;
            
            // Выделяем буфер под собственный back_target правильного размера (in_size)
            this._shaders.BACK.targetBuffer = this.write(BinNet.create_zeros_vector(this.in_size), 'back_target');
            
            let code = `
                fn xorshift32(s: ptr<function, u32>) -> u32 {
                    var x = *s; x ^= x << 13u; x ^= x >> 17u; x ^= x << 5u; *s = x; return x;
                }
                @group(0) @binding(0) var<storage, read> inputs: array<u32>;
                @group(0) @binding(1) var<storage, read_write> weights: array<u32>;
                @group(0) @binding(2) var<storage, read> targets: array<u32>;
                @group(0) @binding(3) var<storage, read> outputs: array<u32>;
                @group(0) @binding(4) var<uniform> seed: u32;
                @group(0) @binding(5) var<storage, read_write> back_targets: array<u32>; // Новый выходной таргет
                
                @compute @workgroup_size(${wg.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${wg.idx_code_gen} 
                    const w_size = ${this.weight_size}u;
                    let target_word = targets[idx];
                    let output_word = outputs[idx];
                    
                    let error = f32(countOneBits(output_word ^ target_word)) / 32.0;
                    let input_start = (idx / ${this.out_size / this.divider}u) * w_size;
                    
                    // Если этот нейрон ошибся, он генерирует инверсию или подтверждение для входа
                    if (error > 0.0) {
                        for(var i = 0u; i < w_size; i++) {
                            // Простейшая проекция: инвертируем те блоки входа, где веса не совпали с ошибочным выходом
                            back_targets[input_start + i] = inputs[input_start + i] ^ (output_word ^ target_word);
                        }
                    }

                    if (error == 0.0) { return; } 
                    
                    var rnd = idx ^ seed;
                    let loops = i32(clamp(2.0 / (0.14 + error), 1.0, 11.0)); 
                    var pre_mask = 0xFFFFFFFFu;
                    for(var r = 0; r < loops; r++){ pre_mask &= xorshift32(&rnd); }
                    
                    for(var o = 0u; o < 32u; o++) {
                        let start = ((idx * 32u) + o) * w_size;
                        let target_bit = (target_word >> o) & 1u;
                        for(var i = 0u; i < w_size; i++) {
                            var inp = inputs[input_start + i]; 
                            if (target_bit == 0u) { inp = ~inp; }                
                            weights[start + i] = (weights[start + i] & ~(xorshift32(&rnd) & pre_mask)) | (inp & (rnd & pre_mask));             
                        }
                    }                
                }
            `;    
            wg.compile(code, this.id + ':BACK'); 
        }
       
        this.seedArray = Math.trunc(BinNet.max32 * Math.random());        
        this.write(this.seedArray, 'seed', 'uniform');
        
        // Передаем новый буфер back_targets шестым аргументом
        this._shaders.BACK.compute([
            this.input, 
            this.params.weights, 
            this.target, 
            this.output, 
            this.seedArray, 
            this._shaders.BACK.targetBuffer
        ]);        

        if (!this.id) return { data: this.target, src: this }; 

        // Теперь мы передаем вниз уникальный, заново сгенерированный таргет нужного размера!
        if (this.src?.back) {
            await this.src.back({ target: this._shaders.BACK.targetBuffer });
        }
        return { data: this._shaders.BACK.targetBuffer, src: this };
    }

    get paramCount() { return this.all_weights_size; }
}
