class WebGpu{
    adapter = null;
    device = null;
    buffers = new Map();
    readableBuffer = null;
    defaultType = 'f32';
    constructor(){
        return new Promise(async resolve=>{
            if (EnvironmentChecker.isNodeJS) {
                const gpu = await import('gpu');
                navigator.gpu = gpu.create([]);
                process.on('beforeExit', this.nodejs_destroyWebGPU);
                process.on('SIGTERM', ()=>{this.nodejs_destroyWebGPU(); process.exit(0)}); // Для ОС отличных от Windows
                process.on('SIGINT', ()=>{this.nodejs_destroyWebGPU(); process.exit(0)}); // "CTRL + C"
                process.on('SIGBREAK', ()=>{this.nodejs_destroyWebGPU(); process.exit(0)}); // "CTRL + Break" у меня не работает
            }
            this.adapter = await navigator.gpu.requestAdapter();
            if (!this.adapter)
                throw new Error(`The graphic adapter doesn't support WebGPU API.`)
            let maxBufferSize = this.info?.maxStorageBufferBindingSize || this.adapter.limits?.maxStorageBufferBindingSize;
            const requiredLimits = {
                maxStorageBufferBindingSize : maxBufferSize,
                maxBufferSize,
                // maxComputeInvocationsPerWorkgroup: this.adapter.limits.maxComputeInvocationsPerWorkgroup,  // Теоретически увеличение группы увеличивает параллелизм вычислений.
                // maxComputeWorkgroupSizeX: this.adapter.limits.maxComputeWorkgroupSizeX,                    // Практически параллелизм зависит и от доступности других ресурсов,
                // maxComputeWorkgroupSizeY: this.adapter.limits.maxComputeWorkgroupSizeY,                    // например регистровой памяти, которая делится между всеми членами группы.
                // maxComputeWorkgroupSizeZ: this.adapter.limits.maxComputeWorkgroupSizeZ,                    // Кроме того увеличиваются расходы на параллелизм и реальная скорость падает.
                // maxComputeWorkgroupsPerDimension: this.adapter.limits.maxComputeWorkgroupsPerDimension,

                // maxComputeWorkgroupStorageSize: this.adapter.limits.maxComputeWorkgroupStorageSize,   // Увеличение лимита в 2 раза на скорость не повлияло
            };
            const requiredParams = {requiredLimits};
            if (this.info.features.includes('shader-f16')){
                requiredParams.requiredFeatures = ['shader-f16'];
                this.defaultType = 'f16';
            }
            this.device = await this.adapter.requestDevice(requiredParams);
            resolve(this);
        });
    }
    compute_info (data_size) {
            const maxWorkgroups = this.device.limits.maxComputeWorkgroupsPerDimension;
            const max_X = this.device.limits.maxComputeWorkgroupSizeX;
            const max_Y = this.device.limits.maxComputeWorkgroupSizeY;
            const max_Z = this.device.limits.maxComputeWorkgroupSizeZ;
            const maxPerWorkgroup = this.device.limits.maxComputeInvocationsPerWorkgroup;

            // Используем конструктор Array во избежание сбоев разметки
            let size = new Array(1, 1, 1);
            let count = new Array(1, 1, 1);
            let shape_info = new Array();

            if (data_size <= max_X) {
                // 1D: Полностью влезает в одну группу по оси X
                size = new Array(data_size, 1, 1);
                count = new Array(1, 1, 1);
                shape_info = new Array(
                    {size: data_size, stride: 1},
                    {size: 1, stride: 1},
                    {size: 1, stride: 1}
                );
            }
            else if (data_size / max_X <= maxWorkgroups) {
                // 1D: Разделяется на несколько групп только по оси X
                size = new Array(max_X, 1, 1);
                count = new Array(Math.ceil(data_size / max_X), 1, 1);
                shape_info = new Array(
                    {size: (size[0] * count[0]), stride: 1},
                    {size: 1, stride: 1},
                    {size: 1, stride: 1}
                );
            }
            else if (data_size / (max_Y * maxWorkgroups) <= maxWorkgroups * (maxPerWorkgroup / max_Y)) {
                // 2D: Данные слишком большие, задействуем оси X и Y
                size = new Array(maxPerWorkgroup / max_Y, max_Y, 1);
                count[1] = Math.ceil(data_size / max_Y / (maxWorkgroups * (size[0])));
                count[0] = Math.ceil(data_size / (max_Y * count[1]) / (size[0]));
                count[2] = 1;

                // id.x меняется непрерывно (stride=1), а id.y делает большой шаг по рядам
                shape_info = new Array(
                    {size: (size[0] * count[0]), stride: 1},
                    {size: (size[1] * count[1]), stride: (size[0] * count[0])},
                    {size: 1, stride: 1}
                );
            }
            else if (data_size / (maxPerWorkgroup * maxWorkgroups * maxWorkgroups) <= maxWorkgroups) {
                // 3D: Данные огромные, задействуем оси X, Y и Z
                size = new Array(maxPerWorkgroup / max_Y, max_Y, 1);
                count[1] = Math.ceil(data_size / max_Y / (maxWorkgroups * (size[0]) * maxWorkgroups));
                count[0] = Math.ceil(data_size / (size[0]) / (max_Y * count[1] * maxWorkgroups));
                count[2] = Math.ceil(data_size / ((size[0]) * count[0] * max_Y * count[1]));

                shape_info = new Array(
                    {size: (size[0] * count[0]), stride: 1},
                    {size: (size[1] * count[1]), stride: (size[0] * count[0])},
                    {size: (size[2] * count[2]), stride: (size[0] * count[0] * size[1] * count[1])}
                );
            }
            else
                throw new Error(`gpu_compute_info: tensor doesn't fit into GPU shaders. Required too many workgroups`);

            // Формируем плоский индекс с правильной u32 типизацией в WGSL
            let codeLines = new Array();
            codeLines.push(`    var idx: u32 = id.x;`); // id.x всегда имеет stride = 1
            if (count[1] > 1 || size[1] > 1) {
                codeLines.push(`    idx += id.y * ${shape_info[1].stride}u;`);
            }
            if (count[2] > 1 || size[2] > 1) {
                codeLines.push(`    idx += id.z * ${shape_info[2].stride}u;`);
            }
            codeLines.push(`    if (idx >= ${data_size}u) { return; }`);

            let code = codeLines.join('\n');

            return {
                size: size.join(', '), // Строка для @workgroup_size(${wg.size}) -> "256, 1, 1"
                count: count,          // Массив [X, Y, Z] для dispatchWorkgroups
                code,
                idx: 'idx'
            };
    }

    get info(){
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
        return {
            info,
            limits,
            features
        }
    }
    copy(src, target, offset = 0, from = 0, size = src.size){
        const commandEncoder = this.device.createCommandEncoder();

        commandEncoder.copyBufferToBuffer(
            src,  // источник
            from,             // смещение в источнике (байты)
            target, // приемник
            offset,             // смещение в приемнике (байты)
            size // размер копируемых данных
        );

        this.device.queue.submit([commandEncoder.finish()]);
    }
    destroy(bufferArray){
        this.buffers.delete(bufferArray);
    }
    get maxBufferSize(){
        return this.info.limits.maxBufferSize / this.info.limits.maxDynamicStorageBuffersPerPipelineLayout;
    }
    writeData(bufferArray, copy = false, label = 'buffer', options = {}){ // data - BufferArray
        let buffer = this.buffers.get(bufferArray);
        if (!buffer) {
            if (this.maxBufferSize<bufferArray.byteLength)
                throw new Error(`The created buffer has a size of ${bufferArray.byteLength}, with a maximum of ${this.maxBufferSize}.`);
            let alignSize = Math.ceil(bufferArray.byteLength/4) * 4;
            let keyBuffer = bufferArray;
            if(bufferArray.byteLength < alignSize){
                const alignedBuffer = new bufferArray.constructor(alignSize / bufferArray.BYTES_PER_ELEMENT);
                alignedBuffer.set(bufferArray);
                bufferArray = alignedBuffer;
            }
            options.size =  alignSize;
            options.usage ??=  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
            options.label = label;
            options.mappedAtCreation = false;
            buffer = this.device.createBuffer(options);

            this.buffers.set(keyBuffer, buffer);
            this.device.queue.writeBuffer(buffer, 0, bufferArray);
            // await this.device.queue.onSubmittedWorkDone();
            return buffer;
        }
        if (copy){
            this.device.queue.writeBuffer(buffer, 0, bufferArray);
            // await this.device.queue.onSubmittedWorkDone();
        }

        return buffer;
    }
    createBuffer(size = 0, mappedAtCreation = false, usage =  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, label = ''){
        return this.device.createBuffer({
            size,
            usage,
            mappedAtCreation,
            label
        });
    }
    async readData(bufferArray){
        let buffer = bufferArray instanceof GPUBuffer?bufferArray:this.buffers.get(bufferArray);
        if (!buffer)
            throw new Error('Readable buffer not found.');
        const readableBuffer = this.device.createBuffer({
            size: buffer.size,
            usage: /*GPUBufferUsage.UNIFORM | */GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
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
        for (let buf of this.buffers){
            buf[1].destroy();
        }
        this.buffers.clear();
    }
    compute(){
        return this.run(...arguments);
    }
    compile(code){
        return this.device.createShaderModule({ code });
    }
    run(code_or_shader_module, buffers = [], workgroups = [8,8,1]){
        if (!(code_or_shader_module instanceof GPUShaderModule))
            code_or_shader_module = this.compile(code_or_shader_module);
        const computePipeline = this.device.createComputePipeline({
            layout: "auto",
            compute: {
                module: code_or_shader_module,
                entryPoint: "main",
            },
        });
        let entries = buffers.map((buffer, i)=>{
            buffer = buffer.writeToGPU?.() || this.writeData(buffer);
            return {binding: i, resource: { buffer }};
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
        let result = this.device.queue.submit([commandEncoder.finish()]);
        return code_or_shader_module;
    }
    nodejs_destroyWebGPU = async () => { // В nodejs необходимо уничтожать device, иначе приложение не заканчивает работу
        if (!this.isShuttingDown && this.device) {
            try {
                this.device.destroy();
                await new Promise(resolve => setTimeout(resolve, 100));
                delete navigator.gpu;
            } catch (error) {
                console.error("  ✗ Ошибка при уничтожении WebGPU: ", error);
            }
            this.isShuttingDown = true;
        }
    }
}

const EnvironmentChecker = {
    get isNodeJS() { return Boolean(globalThis.process && globalThis.process.versions && globalThis.process.versions.node) }, 
    get isBrowser() { return Boolean(globalThis.window && globalThis.navigator && globalThis.document && globalThis.localStorage) },
    get isWebWorker() { return Boolean(self && importScripts) },
    get name() {
        if (EnvironmentChecker.isNodeJS) return 'nodejs';
        if (EnvironmentChecker.isBrowser) return 'browser';
        if (EnvironmentChecker.isWebWorker) return 'webworker';
        return 'unknown';
    }
};

const webgpu = await (new WebGpu());
export {
    WebGpu,
    webgpu
};
