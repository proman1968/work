import { BinNet } from '../core/bin-net.js';
import { Linear } from './linear.js'; 
import { MambaBlock } from './mamba-block.js'; 

export class MambaLayer extends BinNet {
    _convShader = null;

    constructor(config = {}) {
        super(config);
        this.layerId = config.id ?? 0;
        this.id = `MambaLayer_${this.layerId}`;
        this.hSize = config.embSize || 1024; 
        this.dSize = this.hSize * (config.expansionFactor || 2); 
        this.divider = config.divider || 1;
        
        this.projIn     = new Linear(Object.assign({}, config, { in_size: this.hSize, out_size: this.dSize, divider: this.divider, id: `${this.id}_in` })); 
        this.projForget = new Linear(Object.assign({}, config, { in_size: this.dSize, out_size: this.dSize, divider: this.divider, id: `${this.id}_forget` }));
        this.projAdd    = new Linear(Object.assign({}, config, { in_size: this.dSize, out_size: this.dSize, divider: this.divider, id: `${this.id}_add` }));
        this.projOut    = new Linear(Object.assign({}, config, { in_size: this.dSize, out_size: this.hSize, divider: this.divider, id: `${this.id}_out` }));

        // Наполняем пайплайн для автоматического сквозного подсчета параметров в LLM.js
        this.pipeline = [
            this.projIn,
            this.projForget,
            this.projAdd,
            this.projOut
        ];
        this.mambaMemory = new MambaBlock(Object.assign({}, config, { hiddenSizeBlocks: this.dSize, id: this.layerId }));

        // Буферы для бинарной свертки времени Conv1D
        this.convDelay = this.write(new Uint32Array(this.dSize), 'mamba_conv_delay');
        this.convOutput = this.write(new Uint32Array(this.dSize), 'mamba_conv_output');
    }

    get paramCount() { return this.pipeline.reduce((sum, l) => sum + l.paramCount, 0); }
    async load(f = this.folder) { await Promise.all(this.pipeline.map(l => l.load(f))); }
    async save(f = this.folder) { await Promise.all(this.pipeline.map(l => l.save(f))); }

    async forward(input = {}) {
        let x_exp = await this.projIn.forward(input);
        let x_conv = this._applyBinaryConv1d(x_exp.data);

        // Параллельный расчет гейтов без блокировки (команды летят на GPU одновременно)
        let [fg, ga] = await Promise.all([
            this.projForget.forward({ data: x_conv }),
            this.projAdd.forward({ data: x_conv })
        ]);

        let h_state = await this.mambaMemory.forward({ conv: x_conv, forget: fg.data, add: ga.data });
        let output = await this.projOut.forward({ data: h_state });
        
        return Object.assign({}, input, { data: output.data, src: this });
    }

    _applyBinaryConv1d(expandedInput) {
        if (!this._convShader) {
            let wg = this.gpu.compute_info(this.dSize);
            this._convShader = wg;
            wg.compile(`
                @group(0) @binding(0) var<storage, read> current_x: array<u32>;
                @group(0) @binding(1) var<storage, read> delay_x: array<u32>;
                @group(0) @binding(2) var<storage, read_write> outputs: array<u32>;
                @compute @workgroup_size(${wg.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${wg.idx_code_gen}
                    outputs[idx] = current_x[idx] | delay_x[idx];
                }
            `, this.id + ':CONV1D');
        }
        this._convShader.compute([expandedInput, this.convDelay, this.convOutput]);
        this.gpu.copy(expandedInput, this.convDelay, 0, 0, this.dSize * 4);
        return this.convOutput; 
    }

    async back(targetInput) {
        // Каскадный спуск градиента: каждый подслой Linear автоматически обновляет веса внутри своего .back()
        let gOut = await this.projOut.back({ back_target: targetInput.back_target});
        let gForget = await this.projForget.back({ back_target: gOut.back_target });
        let gAdd = await this.projAdd.back({ back_target: gOut.back_target });
        let tBottom = await this.projIn.back({ back_target: gAdd.back_target });
        return { back_target: tBottom.back_target};
    }
}
