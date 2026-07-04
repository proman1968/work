import { BinNet } from '../core/bin-net.js';

export class MambaBlock extends BinNet {
    _shader = null;

    constructor(config = {}) {
        super(config);
        this.hSize = config.hiddenSizeBlocks;
        this.state = this.write(new Uint32Array(this.hSize), 'mamba_state');
        this.output = this.write(new Uint32Array(this.hSize), 'mamba_output');
        this.resetState();
    }

    resetState() {
        this.state.fill(0);
        this.write(this.state, 'mamba_state');
    }

    async forward(inputData = {}) {
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
        this._shader.compute([
            inputData.conv,
            this.state,
            inputData.forget,
            inputData.add,
            this.output
        ]);
        
        // Обновляем контекст памяти для следующего токена времени
        this.gpu.copy(this.output, this.state, 0, 0, this.hSize * 4);

        return this.output; 
    }
}
