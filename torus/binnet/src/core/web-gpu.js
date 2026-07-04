import { create, globals } from 'webgpu';

Object.assign(globalThis, globals);
// Создаем контекст устройства
const navigator = { gpu: create([]) };

export class WebGpu {
    adapter = null;
    device = null;
    buffers = new Map();
    readableBuffer = null;
    defaultType = 'f32';
    isShuttingDown = false;
    constructor() {}
    static async create() {
        const instance = new WebGpu();
        instance.adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
            
        if (!instance.adapter) throw new Error(`The graphic adapter doesn't support WebGPU API.`);
        // ... (весь ваш код настройки лимитов, только вместо `this` используем `instance`)
        let maxBufferSize = instance.info?.limits?.maxStorageBufferBindingSize || instance.adapter.limits?.maxStorageBufferBindingSize;
        const requiredLimits = { maxStorageBufferBindingSize: maxBufferSize, maxBufferSize };
        const requiredParams = { requiredLimits };
        
        if (instance.info.features.includes('shader-f16')) {
            requiredParams.requiredFeatures = ['shader-f16'];
            instance.defaultType = 'f16';
        }
        
        try {
            instance.device = await instance.adapter.requestDevice(requiredParams);
        } catch (error) {
            throw new Error(`WebGPU не удалось создать устройство: ${error}`);
        }
        return instance; // Возвращаем полностью готовый и собранный объект
    }

    compute_info(data_size) {
        const maxWorkgroups = this.device.limits.maxComputeWorkgroupsPerDimension;
        const max_X = this.device.limits.maxComputeWorkgroupSizeX;
        const max_Y = this.device.limits.maxComputeWorkgroupSizeY;
        const max_Z = this.device.limits.maxComputeWorkgroupSizeZ;
        const maxPerWorkgroup = this.device.limits.maxComputeInvocationsPerWorkgroup;

        let size = new Array(1, 1, 1);
        let count = new Array(1, 1, 1);
        let shape_info = new Array();

        if (data_size <= max_X) {
            size = new Array(data_size, 1, 1);
            count = new Array(1, 1, 1);
            shape_info = new Array(
                {size: data_size, stride: 1},
                {size: 1, stride: 1},
                {size: 1, stride: 1}
            );
        }
        else if (data_size / max_X <= maxWorkgroups) {
            size = new Array(max_X, 1, 1);
            count = new Array(Math.ceil(data_size / max_X), 1, 1);
            shape_info = new Array(
                {size: (size[0] * count[0]), stride: 1},
                {size: 1, stride: 1},
                {size: 1, stride: 1}
            );
        }
        else if (data_size / (max_Y * maxWorkgroups) <= maxWorkgroups * (maxPerWorkgroup / max_Y)) {
            size = new Array(Math.floor(maxPerWorkgroup / max_Y), max_Y, 1);
            count[1] = Math.ceil(data_size / max_Y / (maxWorkgroups * (size[0])));
            count[0] = Math.ceil(data_size / (max_Y * count[1]) / (size[0]));
            count[2] = 1;

            // Округляем страйд до целого
            const stride1 = Math.round(size[0] * count[0]);
            shape_info = new Array(
                {size: stride1, stride: 1},
                {size: Math.round(size[1] * count[1]), stride: stride1},
                {size: 1, stride: 1}
            );
        }
        else if (data_size / (maxPerWorkgroup * maxWorkgroups * maxWorkgroups) <= maxWorkgroups) {
            size = new Array(Math.floor(maxPerWorkgroup / max_Y), max_Y, 1);
            count[1] = Math.ceil(data_size / max_Y / (maxWorkgroups * (size[0]) * maxWorkgroups));
            count[0] = Math.ceil(data_size / (size[0]) / (max_Y * count[1] * maxWorkgroups));
            count[2] = Math.ceil(data_size / ((size[0]) * count[0] * max_Y * count[1]));

            const stride1 = Math.round(size[0] * count[0]);
            const stride2 = Math.round(stride1 * size[1] * count[1]);

            shape_info = new Array(
                {size: stride1, stride: 1},
                {size: Math.round(size[1] * count[1]), stride: stride1},
                {size: Math.round(size[2] * count[2]), stride: stride2}
            );
        }
        else
            throw new Error(`gpu_compute_info: tensor doesn't fit into GPU shaders. Required too many workgroups`);

        let codeLines = new Array();
        // Явно берем координату x
        codeLines.push(`    var idx = id.x;`); 
        if (count[1] > 1 || size[1] > 1) {
            codeLines.push(`    idx += id.y * ${Math.round(shape_info[1].stride)}u;`);
        }
        if (count[2] > 1 || size[2] > 1) {
            codeLines.push(`    idx += id.z * ${Math.round(shape_info[2].stride)}u;`);
        }
        codeLines.push(`    if (idx >= ${Math.round(data_size)}u) { return; }`);
        
        let idx_code_gen = codeLines.join('\n');
        let gpu = this;
        let shader;
        return {
            workgroup_size: size.join(', '),          
            idx_code_gen,
            compile(code, label = '???'){
                shader = gpu.compile(code);
                // Безопасная проверка на существование объекта перед присвоением label
                if (shader) {
                    shader.label = label;
                }
            },
            compute(buffers){
                gpu.compute(shader, buffers, count);
            }
        }
    }

    get info(){
        if (!this.adapter) {
            return { info: {}, limits: { maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456 }, features: [] };
        }
        let d_info = Object.getOwnPropertyDescriptors(this.adapter.info.__proto__);
        let info = {};
        for (let key in d_info){
            info[key] = this.adapter.info[key];
            if (key === 'memoryHeaps'){
                info[key] = this.adapter.info[key].map(m=>({properties: m.properties, size:m.size}));
            }
        }
        let d_limits = Object.getOwnPropertyDescriptors(this.adapter.limits.__proto__);
        let limits = {};
        for (let key in d_limits){
            limits[key] = this.adapter.limits[key];
        }
        let features = [...this.adapter.features];
        return { info, limits, features };
    }

    copy(src, target, offset = 0, from = 0, size = src.size) {
        let src_buffer = src instanceof GPUBuffer? src: this.buffers.get(src);
        if (!src_buffer)
            throw new Error(`WebGpu.copy: source has no GPU buffer`);
        let target_buffer = target instanceof GPUBuffer? target: this.buffers.get(target);
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(src_buffer, from, target_buffer, offset, size);
        this.device.queue.submit([commandEncoder.finish()]);
    }

    destroy(bufferArray){
        let buffer = this.buffers.get(bufferArray);
        if (buffer) {
            buffer.destroy();
            this.buffers.delete(bufferArray);
        }
    }

    get maxBufferSize(){
        return this.info.limits.maxBufferSize / this.info.limits.maxDynamicStorageBuffersPerPipelineLayout;
    }

    writeData(bufferArray, options = {}) { 
        let buffer = this.buffers.get(bufferArray);
        if (!buffer) {
            if (this.maxBufferSize < bufferArray.byteLength)
                throw new Error(`The created buffer has a size of ${bufferArray.byteLength}, with a maximum of ${this.maxBufferSize}.`);
            let type = options.type || 'storage'; // ['storage', 'uniform']
            delete options.type;
            let alignment = type === 'uniform' ? 16 : 4;
            let alignSize = Math.ceil(bufferArray.byteLength / alignment) * alignment;   //Необходимо, чтобы буфер в целом был кратен alignment
            // let alignSize = Math.ceil(bufferArray.byteLength / 4) * alignment;   // Здесь каждый отдельный элемент буфера кратен alignment
            let keyBuffer = bufferArray;
            if(bufferArray.byteLength < alignSize) {
                const alignedBuffer = new bufferArray.constructor(alignSize / bufferArray.BYTES_PER_ELEMENT);
                alignedBuffer.set(bufferArray);
                bufferArray = alignedBuffer;
            }
            options.size = alignSize;
            switch(type) {
                case 'storage': {
                    options.usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
                } break;
                case 'uniform': {
                    options.usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
                }       
            }

            options.mappedAtCreation = false;
            buffer = this.device.createBuffer(options);
            this.buffers.set(keyBuffer, buffer);
        }
        this.device.queue.writeBuffer(buffer, 0, bufferArray);
        return buffer;
    }


    createBuffer(size = 0, mappedAtCreation = false, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, label = ''){
        return this.device.createBuffer({ size, usage, mappedAtCreation, label });
    }

    async readData(bufferArray){
        let buffer = (bufferArray.constructor.name === 'GPUBuffer')?bufferArray:this.buffers.get(bufferArray);
        if (!buffer)
            throw new Error('Readable buffer not found.');
        const readableBuffer = this.device.createBuffer({
            size: buffer.size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        try{
            const commandEncoder = this.device.createCommandEncoder();
            commandEncoder.copyBufferToBuffer(
                buffer,  // источник
                0,       // смещение в источнике
                readableBuffer,  // назначение
                0,       // смещение в назначении
                buffer.size     // размер данных
            );

            // 3. Отправляем команды
            this.device.queue.submit([commandEncoder.finish()]);

            await this.device.queue.onSubmittedWorkDone(); 

            // 4. Асинхронно запрашиваем данные
            await readableBuffer.mapAsync(GPUMapMode.READ);

            // 5. Получаем данные
            let data = readableBuffer.getMappedRange().slice(0);
            if (buffer === bufferArray )
                return data;
            data = new bufferArray.constructor(data);
            bufferArray.set(data.subarray(0, bufferArray.length));
            return bufferArray;
        }
        finally {
            readableBuffer.destroy();// unmap();
        }
    }


    clearBuffer(buffer){
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.clearBuffer(buffer);
        this.device.queue.submit([commandEncoder.finish()]);
    }

    clear(){
        for (let buf of this.buffers.values()){
            buf.destroy();
        }
        this.buffers.clear();
    }


    compile(code){
        return this.device.createShaderModule({ code });
    }

    compute(compiled_shader, buffers = [], workgroups = new Array(8, 8, 1)) {

        const computePipeline = this.device.createComputePipeline({
            layout: "auto",
            compute: {
                module: compiled_shader,
                entryPoint: "main",
            },
        });

        let entries = buffers.map((buffer, i) => {
            if ('length' in buffer) {
                let gb = this.buffers.get(buffer);
                if(!gb)
                    gb = this.writeData(buffer);
                buffer = gb
            }
            return { binding: i, resource: { buffer } };
        });

        const bindGroup = this.device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries
        });

        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(...workgroups);
        passEncoder.end();
        
        this.device.queue.submit([commandEncoder.finish()]);
        return compiled_shader;
    }

    nodejs_destroyWebGPU = async () => {
        if (!this.isShuttingDown && this.device) {
            try {
                this.device.destroy();
                await new Promise(resolve => setTimeout(resolve, 100));
                if (typeof navigator !== 'undefined' && navigator.gpu) {
                    delete navigator.gpu;
                }
            } 
            catch (error) {
                console.error("  ✗ Ошибка при уничтожении WebGPU: ", error);
            }
            this.isShuttingDown = true;
        }
    }
}

