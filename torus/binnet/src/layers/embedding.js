import { BinNet } from '../core/bin-net.js';

export class Embedding extends BinNet {
    constructor(config = {}) {
        super(config);
        this.vocabSize = config.vocabSize || 65536;                  
        this.embSize = config.embSize || 256; // Количество u32-блоков на токен    
        this.params = { // параметры изначально указываются в виде размера Uint32Array
            embeddings: this.vocabSize * this.embSize 
        }   
        this.output = this.write(BinNet.create_zeros_vector(this.embSize), 'output');
        this.target = this.write(BinNet.create_zeros_vector(this.embSize), 'target');
    }

    async forward(input = {}) {
        const { tokenIdx = 0, targetIdx = 0} = input; 
        this.input = input;   
        if (!this.FWD) {
            this.FWD = this.gpu.compute_info(this.embSize); 
            this.FWD.offsets = this.write(new Uint32Array(2), 'offsets', 'uniform');
            let code = `
                // FORWARD Embedding
                struct Offsets {
                    outputs: u32,
                    targets: u32
                };
                @group(0) @binding(0) var<storage, read> embeddings: array<u32>;
                @group(0) @binding(1) var<uniform> offsets: Offsets;
                @group(0) @binding(2) var<storage, read_write> outputs: array<u32>;
                @group(0) @binding(3) var<storage, read_write> targets: array<u32>;
                @compute @workgroup_size(${this.FWD.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                ${this.FWD.idx_code_gen}     
                    outputs[idx] = embeddings[idx + offsets.outputs];
                    targets[idx] = embeddings[idx + offsets.targets];
                }
            `;
            this.FWD.compile(code, this.id + ':FWD');
        }  
        // Считаем индекс начала строки в массиве элементов u32
        this.FWD.offsets[0] = tokenIdx * this.embSize;  
        this.FWD.offsets[1] = targetIdx * this.embSize; 
        this.write(this.FWD.offsets);

        this.FWD.compute([
            this.params.embeddings, 
            this.FWD.offsets, 
            this.output,
            this.target
        ]);
        this.test('output');
        this.test('target');

        return Object.assign({}, input, {src: this, data: this.output, target: this.target});  
    }    

    back(data = {}) {
        let target = data.back_target || 0;
        let predict = data.predict || 0;
        
        if (!this.BACK) {
            if (!this.vars) {
                this.vars = new Float32Array(6);
                this.write(this.vars, this.id + '_vars', 'uniform');
            }

            this.BACK = this.gpu.compute_info(this.embSize);
            let code = `
                // BACK Embedding
                struct Offsets {
                    output: u32,
                }
                struct Vars {
                    max_logit: i32,
                    errors: u32,
                    predict: u32,
                    target_idx: u32,
                    loss: f32,
                    random: f32                      
                }

                @group(0) @binding(0) var<storage, read> outputs: array<u32>;   
                @group(0) @binding(1) var<storage, read_write> embeddings: array<u32>;           
                @group(0) @binding(2) var<uniform> vars: Vars; 
                @group(0) @binding(3) var<uniform> offsets: Offsets; 

                @compute @workgroup_size(${this.BACK.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${this.BACK.idx_code_gen}

                    let emb_idx = idx + offsets.output;
                    
                    let current_emb = embeddings[emb_idx];
                    let output_val = outputs[idx];
                    let diff = current_emb ^ output_val;

                    let rand_bits = bitcast<u32>(vars.random);
                    var hash = (idx ^ rand_bits) * 0xcc9e2d51u;
                    hash = (hash << 15u) | (hash >> 17u);
                    hash = hash * 0x1b873593u;
                    // Мутируем биты эмбеддингов порциями (например, 10% за шаг), чтобы память обновлялась плавно
                    for (var bit = 0u; bit < 32u; bit++) {
                        let bit_check = 1u << bit;
                        if ((diff & bit_check) != 0u) {
                            let bit_hash = hash ^ bit;
                            let mut_chance = f32((bit_hash * 0x1b873593u) >> 16u) / 65535.0;
                            
                            if (mut_chance < 0.1) { // 10% скорость обучения для эмбеддингов
                                let target_bit = output_val & bit_check;
                                embeddings[emb_idx] = (embeddings[emb_idx] & ~bit_check) | target_bit;
                            }
                        }
                    }
                }
            `;
            this.BACK.compile(code, this.id + ':BACK_EMB');
        }

        const view = new DataView(this.vars.buffer, this.vars.byteOffset);
        view.setUint32(8, target || 0, true);        
        view.setFloat32(20, Math.random(), true); 
        this.write(this.vars);

        this.BACK.compute([
            this.output,           
            this.params.embeddings, 
            this.vars,             
            this.FWD.offsets       
        ]);
    }
}
