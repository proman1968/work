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
        this.convMode = config.convMode ?? 'or'; // 'or' | 'xor' | 'none'
        
        // gateBias: обучаемые смещения гейтов; forgetBias < 0 — по умолчанию «хранить»
        const gb = this.ste && !!config.gateBias;
        this.projIn     = new Linear(Object.assign({}, config, { in_size: this.hSize, out_size: this.dSize, divider: this.divider, id: `${this.id}_in`, resBeta: 0, useBias: false })); 
        this.projForget = new Linear(Object.assign({}, config, { in_size: this.dSize, out_size: this.dSize, divider: this.divider, id: `${this.id}_forget`, resBeta: 0,
            useBias: gb, biasInit: config.forgetBias ?? -1.5 }));
        this.projAdd    = new Linear(Object.assign({}, config, { in_size: this.dSize, out_size: this.dSize, divider: this.divider, id: `${this.id}_add`, resBeta: 0,
            useBias: gb, biasInit: config.addBias ?? 0 }));
        this.projOut    = new Linear(Object.assign({}, config, { in_size: this.dSize, out_size: this.hSize, divider: this.divider, id: `${this.id}_out`,
            resBeta: this.ste ? (config.resBeta ?? 1) : 0, useBias: false }));

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
        this.prevDelay = this.write(new Uint32Array(this.dSize), 'mamba_prev_delay');
        if (this.ste) {
            const n = this.dSize * 32;
            this.gGateA = this.write(new Float32Array(n), 'grad_gate_add');
            this.gGateF = this.write(new Float32Array(n), 'grad_gate_forget');
            this.gConv = this.write(new Float32Array(n), 'grad_conv');
            this.gExp = this.write(new Float32Array(n), 'grad_exp');
            // Переносы градиента во времени (BPTT): по памяти h и по задержке свертки.
            // В одношаговом режиме остаются нулями.
            this.gCarryIn = this.write(new Float32Array(n), 'grad_carry_h_in');
            this.gCarryOut = this.write(new Float32Array(n), 'grad_carry_h_out');
            this.gDelayIn = this.write(new Float32Array(n), 'grad_carry_d_in');
            this.gDelayOut = this.write(new Float32Array(n), 'grad_carry_d_out');
        }
    }

    // --- BPTT: снимок шага и восстановление ---
    _stepBuffers() {
        return [
            this.projIn.input, this.projIn.preact, this.projIn.output,
            this.convOutput, this.prevDelay,
            this.projForget.output, this.projForget.preact,
            this.projAdd.output, this.projAdd.preact,
            this.mambaMemory.prevState, this.mambaMemory.output,
            this.projOut.preact,
        ];
    }
    saveStep(i, K) {
        if (!this._hist || this._histK < K) {
            this._histK = K;
            this._hist = this._stepBuffers().map(arr => {
                const src = this.gpu.buffers.get(arr);
                const buf = this.gpu.device.createBuffer({
                    size: src.size * K,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
                    label: this.id + ' history'
                });
                return { src, buf, size: src.size };
            });
        }
        for (const h of this._hist) this.gpu.copy(h.src, h.buf, i * h.size, 0, h.size);
    }
    restoreStep(i) {
        for (const h of this._hist) this.gpu.copy(h.buf, h.src, 0, i * h.size, h.size);
    }
    resetCarry() {
        this.write(this.gCarryIn);
        this.write(this.gDelayIn);
    }
    // Перенос: выход шага t становится входом шага t-1
    _advanceCarry() {
        const bytes = this.dSize * 32 * 4;
        this.gpu.copy(this.gCarryOut, this.gCarryIn, 0, 0, bytes);
        this.gpu.copy(this.gDelayOut, this.gDelayIn, 0, 0, bytes);
    }

    // Обратный проход шага. Биты {0,1}: h = (hp & ~f) | (c & a), c = x | d.
    //   dh/da = c·(1 - hp·(1-f)),  dh/df = -hp·(1 - c·a),  dh/dc = a·(1 - hp·(1-f))
    //   dh/dhp = (1-f)·(1 - c·a)  → перенос на шаг t-1 (BPTT)
    //   dc/dx = 1 - d,  dc/dd = 1 - x  → перенос по задержке на x_{t-1}
    async backSte(data, opts = {}) {
        const gH = await this.projOut.back({ grad: data.grad });
        const n = this.dSize * 32;
        if (!this._gatesShader) {
            // Два прохода по 8 буферов (лимит WebGPU maxStorageBuffersPerShaderStage = 8)
            const gatesCode = (outA, outB, label) => {
                const wg = this.gpu.compute_info(n);
                wg.compile(`
                    // ${label} Mamba STE
                    @group(0) @binding(0) var<storage, read> gh: array<f32>;
                    @group(0) @binding(1) var<storage, read> gcarry: array<f32>;
                    @group(0) @binding(2) var<storage, read> hprev: array<u32>;
                    @group(0) @binding(3) var<storage, read> gf: array<u32>;
                    @group(0) @binding(4) var<storage, read> ga: array<u32>;
                    @group(0) @binding(5) var<storage, read> conv: array<u32>;
                    @group(0) @binding(6) var<storage, read_write> out_a: array<f32>;
                    @group(0) @binding(7) var<storage, read_write> out_b: array<f32>;
                    fn bit(v: u32, b: u32) -> f32 { return f32((v >> b) & 1u); }
                    @compute @workgroup_size(${wg.workgroup_size})
                    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                        ${wg.idx_code_gen}
                        let w = idx / 32u;
                        let b = idx % 32u;
                        let g = gh[idx] + gcarry[idx];
                        let hp = bit(hprev[w], b);
                        let f = bit(gf[w], b);
                        let a = bit(ga[w], b);
                        let c = bit(conv[w], b);
                        let keep = 1.0 - hp * (1.0 - f);
                        out_a[idx] = ${outA};
                        out_b[idx] = ${outB};
                    }
                `, this.id + ':' + label);
                return wg;
            };
            // dL/da, dL/df
            this._gatesShader = gatesCode('g * c * keep', '-g * hp * (1.0 - c * a)', 'BACK_GATES');
            // dL/dc (прямой путь), перенос по памяти на h_{t-1}
            this._gatesShader2 = gatesCode('g * a * keep', 'g * (1.0 - f) * (1.0 - c * a)', 'BACK_GATES2');

            const wc = this.gpu.compute_info(n);
            this._convBackShader = wc;
            wc.compile(`
                // BACK_CONV Mamba STE
                @group(0) @binding(0) var<storage, read> gc: array<f32>;
                @group(0) @binding(1) var<storage, read> gxf: array<f32>;
                @group(0) @binding(2) var<storage, read> gxa: array<f32>;
                @group(0) @binding(3) var<storage, read> delay: array<u32>;
                @group(0) @binding(4) var<storage, read> xexp: array<u32>;
                @group(0) @binding(5) var<storage, read> gdcarry: array<f32>;
                @group(0) @binding(6) var<storage, read_write> gx: array<f32>;
                @group(0) @binding(7) var<storage, read_write> out_dcarry: array<f32>;
                @compute @workgroup_size(${wc.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${wc.idx_code_gen}
                    let w = idx / 32u;
                    let b = idx % 32u;
                    let d = f32((delay[w] >> b) & 1u);
                    let x = f32((xexp[w] >> b) & 1u);
                    let gconv = gc[idx] + gxf[idx] + gxa[idx];
                    gx[idx] = gconv * ${{ or: '(1.0 - d)', xor: '(1.0 - 2.0 * d)', none: '1.0' }[this.convMode]} + gdcarry[idx];
                    out_dcarry[idx] = gconv * ${{ or: '(1.0 - x)', xor: '(1.0 - 2.0 * x)', none: '0.0' }[this.convMode]};
                }
            `, this.id + ':BACK_CONV');
        }
        const gateIn = [gH.grad, this.gCarryIn, this.mambaMemory.prevState, this.projForget.output, this.projAdd.output, this.convOutput];
        this._gatesShader.compute([...gateIn, this.gGateA, this.gGateF]);
        this._gatesShader2.compute([...gateIn, this.gConv, this.gCarryOut]);
        const gxF = await this.projForget.back({ grad: this.gGateF });
        const gxA = await this.projAdd.back({ grad: this.gGateA });
        this._convBackShader.compute([this.gConv, gxF.grad, gxA.grad, this.prevDelay, this.projIn.output, this.gDelayIn, this.gExp, this.gDelayOut]);
        if (opts.bptt) this._advanceCarry();
        const gIn = await this.projIn.back({ grad: this.gExp });
        if (!this.projOut.resR) return gIn;
        // + градиент residual-пути (identity)
        if (!this._resBackShader) {
            const wr = this.gpu.compute_info(this.hSize * 32);
            this._resBackShader = wr;
            this.gResIn = this.write(new Float32Array(this.hSize * 32), 'grad_res_in');
            wr.compile(`
                @group(0) @binding(0) var<storage, read> a: array<f32>;
                @group(0) @binding(1) var<storage, read> b: array<f32>;
                @group(0) @binding(2) var<storage, read_write> c: array<f32>;
                @compute @workgroup_size(${wr.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${wr.idx_code_gen}
                    c[idx] = a[idx] + b[idx];
                }
            `, this.id + ':BACK_RES');
        }
        this._resBackShader.compute([gIn.grad, data.grad, this.gResIn]);
        return { grad: this.gResIn };
    }

    get paramCount() { return this.pipeline.reduce((sum, l) => sum + l.paramCount, 0); }
    async load(f = this.folder) { await Promise.all(this.pipeline.map(l => l.load(f))); }
    async save(f = this.folder) { await Promise.all(this.pipeline.map(l => l.save(f))); }

    // Сброс рекуррентного состояния между независимыми последовательностями.
    // Без этого контекст течет между строками корпуса при обучении и генерации.
    resetState() {
        this.mambaMemory.resetState();
        this.convDelay.fill(0);
        this.write(this.convDelay, 'mamba_conv_delay');
    }

    async forward(input = {}) {
        let x_exp = await this.projIn.forward(input);
        let x_conv = this._applyBinaryConv1d(x_exp.data);

        // Параллельный расчет гейтов без блокировки (команды летят на GPU одновременно)
        let [fg, ga] = await Promise.all([
            this.projForget.forward({ data: x_conv }),
            this.projAdd.forward({ data: x_conv })
        ]);

        let h_state = await this.mambaMemory.forward({ conv: x_conv, forget: fg.data, add: ga.data });
        let output = await this.projOut.forward({ data: h_state, residual: input.data });
        
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
                    outputs[idx] = ${{ or: 'current_x[idx] | delay_x[idx]', xor: 'current_x[idx] ^ delay_x[idx]', none: 'current_x[idx]' }[this.convMode]};
                }
            `, this.id + ':CONV1D');
        }
        this.gpu.copy(this.convDelay, this.prevDelay, 0, 0, this.dSize * 4);
        this._convShader.compute([expandedInput, this.convDelay, this.convOutput]);
        this.gpu.copy(expandedInput, this.convDelay, 0, 0, this.dSize * 4);
        return this.convOutput; 
    }

    async back(targetInput) {
        if (this.ste) return this.backSte(targetInput);
        // Каскадный спуск: каждый подслой Linear автоматически обновляет веса внутри своего .back().
        // Сигналы forget/add ветвей комбинируются консервативно, ветка forget больше не роняется.
        let gOut = await this.projOut.back({ back_target: targetInput.back_target});
        let [gForget, gAdd] = await Promise.all([
            this.projForget.back({ back_target: gOut.back_target }),
            this.projAdd.back({ back_target: gOut.back_target })
        ]);
        if (!this._backCombineShader) {
            let wg = this.gpu.compute_info(this.dSize);
            this._backCombineShader = wg;
            this._backCombined = this.write(BinNet.create_zeros_vector(this.dSize), 'mamba_back_combined');
            wg.compile(`
                // BACK_COMBINE: согласие ветвей = уверенность, разногласие = текущий бит
                @group(0) @binding(0) var<storage, read> sig_forget: array<u32>;
                @group(0) @binding(1) var<storage, read> sig_add: array<u32>;
                @group(0) @binding(2) var<storage, read> current: array<u32>;
                @group(0) @binding(3) var<storage, read_write> combined: array<u32>;
                @compute @workgroup_size(${wg.workgroup_size})
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    ${wg.idx_code_gen}
                    let f = sig_forget[idx];
                    let a = sig_add[idx];
                    let agree = ~(f ^ a);
                    combined[idx] = (f & agree) | (current[idx] & ~agree);
                }
            `, this.id + ':BACK_COMBINE');
        }
        this._backCombineShader.compute([
            gForget.back_target,
            gAdd.back_target,
            this.convOutput,
            this._backCombined
        ]);
        let tBottom = await this.projIn.back({ back_target: this._backCombined });
        return { back_target: tBottom.back_target};
    }
}
