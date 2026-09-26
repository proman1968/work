// BrowserGpu — браузерный аналог Node WebGpu (src/core/web-gpu.js):
// та же поверхность (compute_info/writeData/readData/copy/compile/compute),
// поверх нативного navigator.gpu. Слои binnet используют только её.
export class BrowserGpu {
    buffers = new Map();
    device = null;
    adapter = null;

    static async create() {
        const gpu = new BrowserGpu();
        if (!navigator.gpu) throw new Error('navigator.gpu недоступен (нужен Chrome/Edge + WebGPU)');
        gpu.adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!gpu.adapter) throw new Error('requestAdapter вернул null');
        gpu.device = await gpu.adapter.requestDevice();
        return gpu;
    }

    destroy() {
        for (const buf of this.buffers.values()) { try { buf.destroy(); } catch (_) {} }
        this.buffers.clear();
        try { this.device?.destroy(); } catch (_) {}
    }

    compute_info(data_size) {
        const maxWorkgroups = this.device.limits.maxComputeWorkgroupsPerDimension;
        const max_X = this.device.limits.maxComputeWorkgroupSizeX;
        let size, count;
        if (data_size <= max_X) {
            size = [data_size, 1, 1]; count = [1, 1, 1];
        } else if (data_size / max_X <= maxWorkgroups) {
            size = [max_X, 1, 1]; count = [Math.ceil(data_size / max_X), 1, 1];
        } else {
            throw new Error(`browser-gpu: data_size=${data_size} не влезает в 1D-лимиты (стенд: vocab ≤ 1024)`);
        }
        // global_invocation_id.x линеен по всем workgroup X: id.x покрывает [0, size*count).
        const idx_code_gen = [`    var idx = id.x;`, `    if (idx >= ${Math.round(data_size)}u) { return; }`].join('\n');
        const gpu = this;
        let shader = null;
        return {
            workgroup_size: size.join(', '),
            idx_code_gen,
            compile(code, label = '???') {
                shader = gpu.compile(code);
                if (shader) { try { shader.label = label; } catch (_) {} }
            },
            compute(buffers) { gpu.compute(shader, buffers, count); }
        };
    }

    compile(code) {
        return this.device.createShaderModule({ code });
    }

    _resolveBuffer(b) {
        if (b instanceof GPUBuffer) return b;
        let gb = this.buffers.get(b);
        if (!gb) gb = this.writeData(b);
        return gb;
    }

    compute(compiled_shader, buffers = [], workgroups = [1, 1, 1]) {
        const pipe = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: compiled_shader, entryPoint: 'main' },
        });
        const entries = buffers.map((b, i) => ({ binding: i, resource: { buffer: this._resolveBuffer(b) } }));
        const bg = this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
        const enc = this.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(...workgroups);
        pass.end();
        this.device.queue.submit([enc.finish()]);
        return compiled_shader;
    }

    writeData(bufferArray, options = {}) {
        let buffer = this.buffers.get(bufferArray);
        if (!buffer) {
            const type = options.type || 'storage';
            const alignment = type === 'uniform' ? 16 : 4;
            const alignSize = Math.ceil(bufferArray.byteLength / alignment) * alignment;
            let src = bufferArray;
            if (bufferArray.byteLength < alignSize) {
                const padded = new bufferArray.constructor(alignSize / bufferArray.BYTES_PER_ELEMENT);
                padded.set(bufferArray);
                src = padded;
            }
            const usage = type === 'uniform'
                ? GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
            buffer = this.device.createBuffer({ size: alignSize, usage, mappedAtCreation: false, label: options.label || '' });
            this.buffers.set(bufferArray, buffer);
            this.device.queue.writeBuffer(buffer, 0, src);
            return buffer;
        }
        this.device.queue.writeBuffer(buffer, 0, bufferArray);
        return buffer;
    }

    copy(src, target, offset = 0, from = 0, size = 0) {
        const srcBuf = this._resolveBuffer(src);
        const dstBuf = this._resolveBuffer(target);
        const n = size || srcBuf.size;
        const enc = this.device.createCommandEncoder();
        enc.copyBufferToBuffer(srcBuf, from, dstBuf, offset, n);
        this.device.queue.submit([enc.finish()]);
    }

    async readData(bufferArray) {
        const buffer = bufferArray instanceof GPUBuffer ? bufferArray : this.buffers.get(bufferArray);
        if (!buffer) throw new Error('browser-gpu: readable buffer not found');
        const stag = this.device.createBuffer({ size: buffer.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
            const enc = this.device.createCommandEncoder();
            enc.copyBufferToBuffer(buffer, 0, stag, 0, buffer.size);
            this.device.queue.submit([enc.finish()]);
            await this.device.queue.onSubmittedWorkDone();
            await stag.mapAsync(GPUMapMode.READ);
            const data = stag.getMappedRange().slice(0);
            if (bufferArray instanceof GPUBuffer) return data;
            const view = new bufferArray.constructor(data);
            bufferArray.set(view.subarray(0, bufferArray.length));
            return bufferArray;
        } finally {
            stag.destroy();
        }
    }
}
