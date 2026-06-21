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
        
        // const lCfg = (sub) => ({ gpu: this.gpu, testMode: this.testMode, folder: this.folder, id: `${this.id}_${sub}` });

        // Внутренние проекции Linear
        // this.projIn     = new Linear(Object.assign(lCfg('in'),     { in_size: this.hSize, out_size: this.dSize, divider: this.divider })); 
        // this.projForget = new Linear(Object.assign(lCfg('forget'), { in_size: this.dSize, out_size: this.dSize, divider: this.divider }));
        // this.projAdd    = new Linear(Object.assign(lCfg('add'),    { in_size: this.dSize, out_size: this.dSize, divider: this.divider }));
        // this.projOut    = new Linear(Object.assign(lCfg('out'),    { in_size: this.dSize, out_size: this.hSize, divider: this.divider }));
        this.projIn     = new Linear(Object.assign({}, config, { in_size: this.hSize, out_size: this.dSize, divider: this.divider, id: `${this.id}_in` })); 
        this.projForget = new Linear(Object.assign({}, config, { in_size: this.dSize, out_size: this.dSize, divider: this.divider, id: `${this.id}_forget` }));
        this.projAdd    = new Linear(Object.assign({}, config, { in_size: this.dSize, out_size: this.dSize, divider: this.divider, id: `${this.id}_add` }));
        this.projOut    = new Linear(Object.assign({}, config, { in_size: this.dSize, out_size: this.hSize, divider: this.divider, id: `${this.id}_out` }));

        // Наполняем пайплайн для автоматического сквозного подсчета параметров в LLM.js
        this.pipeline = [this.projIn, this.projForget, this.projAdd, this.projOut];
        this.mambaMemory = new MambaBlock(Object.assign({}, config, { hiddenSizeBlocks: this.dSize, id: this.layerId }));
        // this.mambaMemory = new MambaBlock(this.dSize, this.gpu);

        // Буферы для бинарной свертки времени Conv1D
        this.convDelayBuffer = this.write(new Uint32Array(this.dSize), 'mamba_conv_delay');
        this.convOutputCpuKey = new Uint32Array(this.dSize);
        this.convOutputBuffer = this.write(this.convOutputCpuKey, 'mamba_conv_output');
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

    _applyBinaryConv1d(expandedInputCpuKey) {
        const inGpu = this.gpu.buffers.get(expandedInputCpuKey);
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
        this._convShader.compute([inGpu, this.convDelayBuffer, this.convOutputBuffer]);
        this.gpu.copy(inGpu, this.convDelayBuffer, 0, 0, this.dSize * 4);
        return this.convOutputCpuKey; 
    }

    async back(targetInput) {
        // Каскадный спуск градиента: каждый подслой Linear автоматически обновляет веса внутри своего .back()
        let gOut = await this.projOut.back({ target: targetInput?.target ?? targetInput });
        let gForget = await this.projForget.back({ target: gOut.data });
        let gAdd = await this.projAdd.back({ target: gOut.data });
        let tBottom = await this.projIn.back({ target: gAdd.data });

        return { data: tBottom.data, src: this };
    }
}
