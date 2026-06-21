import { BinNet } from '../core/bin-net.js';

export class MambaBlock extends BinNet {
    _shader = null;

    constructor(config = {}) {
    // constructor(hiddenSizeBlocks, webGpuInstance) {
    //     super({ gpu: webGpuInstance });
        super(config);
        this.hSize = config.hiddenSizeBlocks;
        
        // Выделяем постоянные буферы на GPU один раз при старте
        this.stateCpuKey = new Uint32Array(this.hSize);
        this.stateBuffer = this.write(this.stateCpuKey, 'mamba_state');
        
        this.outputCpuKey = new Uint32Array(this.hSize);
        this.outputBuffer = this.write(this.outputCpuKey, 'mamba_output');
        
        this.resetState();
    }

    resetState() {
        this.stateCpuKey.fill(0);
        this.write(this.stateCpuKey, 'mamba_state');
    }

    async forward(inputData = {}) {
        const { conv, forget, add } = inputData;
        const inGpu = this.gpu.buffers.get(conv);
        const fGpu = this.gpu.buffers.get(forget);
        const aGpu = this.gpu.buffers.get(add);

        if (!inGpu || !fGpu || !aGpu) 
            throw new Error("[MambaBlock] Входные буферы не найдены в кэше WebGPU.");

        if (!this._shader) {
            let wg = this.gpu.compute_info(this.hSize);
            this._shader = wg;
            let code = `
                @group(0) @binding(0) var<storage, read> current_input: array<u32>;
                @group(0) @binding(1) var<storage, read> prev_state: array<u32>;
                @group(0) @binding(2) var<storage, read> gate_forget: array<u32>;
                @group(0) @binding(3) var<storage, read> gate_add: array<u32>;
                @group(0) @binding(4) var<storage, read_write> next_state: array<u32>;
                @compute @workgroup_size(${wg.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${wg.idx_code_gen} 
                    next_state[idx] = (prev_state[idx] & ~gate_forget[idx]) | (current_input[idx] & gate_add[idx]);
                }
            `;
            wg.compile(code, this.id + ':SSM_STEP');
        }

        // Выполняем битовый шаг селективной памяти на GPU
        this._shader.compute([inGpu, this.stateBuffer, fGpu, aGpu, this.outputBuffer]);
        
        // Обновляем контекст памяти для следующего токена времени
        this.gpu.copy(this.outputBuffer, this.stateBuffer, 0, 0, this.hSize * 4);

        return this.outputCpuKey; 
    }
}
