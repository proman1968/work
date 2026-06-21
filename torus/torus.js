import {webgpu} from './web-gpu.js';

export class tensor{
    #data = null;
    #grad = null;
    dType = torus.DEFAULT_TYPE;
    #src = undefined;
    #type = undefined;
    #shape_multipliers = undefined;
    isParam = false;
    backs = [];
    step = 0;
    id = genId();
    constructor(data, $ = {dType: torus.DEFAULT_TYPE}) {
        let {shape} = $;
        $ = torus.$($)
        if(data === undefined)
            this.#data = new ($.dType)(0);
        else if (data?.$ === this.constructor.name){
            this.dType = globalThis[data.dType];
            this['#shape'] = data.shape;
            this.isParam = data.isParam;
            this['#label'] = data.label;
            this.isSerializable = data.isSerializable;
            data = data.data.split(' ');
            this.#data = new this.dType(data);
        }
        else{
            if (Array.isArray(data)){
                if(shape){
                    this.#data = data;
                    this.dType = BigInt;
                    this['#shape'] = shape;
                    return;
                }
                shape = [data.length];
                let next;
                while (next = data[0]){
                    if(Array.isArray(next)){
                        shape.push(next.length);
                        data = data.flat();
                        continue;
                    }
                    if(next.buffer){
                        shape.push(next.length);
                        $.dType = next.constructor;
                        let join = new $.dType(shape.mul());
                        data  = data.flat(Infinity);
                        data = data.reduce((r, v, i)=>{
                            r.set(v, i * next.length);
                            return r;
                        }, join);
                    }
                    break;
                }
                if (next instanceof tensor) {
                    $.dType = next.dType
                    shape.push(...next.shape);
                    let size = next.length;
                    next = new $.dType(shape.mul());
                    data = data.reduce((r, v, i)=>{
                        r.set(v.data, i * size);
                        return r;
                    }, next);
                }
                else {
                    if (!(data instanceof $.dType)) {
                        if (($.dType === BigInt64Array || $.dType === BigUint64Array) && typeof data[0] !== 'bigint')
                            data = data.map(n => BigInt(n));   // Number в BigInt необходимо преобразовывать явно
                        data = new $.dType(data);
                    }
                }
                this['#shape'] = shape;
            }
            else {
                if (data?.length === 1)
                    this['#shape'] = [1];
                else if (data?.length)
                    this['#shape'] = [data?.length];
                else if (!data?.buffer) {
                    // this['#shape'] = [1];
                    data = new this.dType([data]);
                }
            }
            this.#data = data;
        }
        this.dType = this.data.constructor;
    }
    _resize_data(data, ...shape) {
        shape = torus.flat(shape);
        const size = shape.mul();
        if (size !== data.length)
            throw new Error(`_resize_data(data, ...shape): mismatch between data size (${data.length}) and shape (${shape})`);
        this.#data = data;
        this['#shape'] = shape;
        this.clear_shape_cache();
        return this;
    }
    getPath(level = 0){
        let tab = '|'.repeat(level) + '|- '
        let path = [tab + this.label];
        let src = this.#src?.map(v=>v.getPath(level+1));
        if(src){
            path.push(...src.flat());
        }
        return path;
    }
    get path(){
        return this.getPath().join('\n');
    }
    get shape_multipliers(){
        return this.#shape_multipliers ??= this.shape.map((_,i)=> this.shape.slice(i+1).mul());
    }
    get gpu_compute_info (){
        return this['#gpu_compute_info'] ??= (()=>{
            const maxWorkgroups = torus.WebGPU.device.limits.maxComputeWorkgroupsPerDimension;
            const max_X = torus.WebGPU.device.limits.maxComputeWorkgroupSizeX;
            const max_Y = torus.WebGPU.device.limits.maxComputeWorkgroupSizeY;
            const max_Z = torus.WebGPU.device.limits.maxComputeWorkgroupSizeZ;
            const maxPerWorkgroup = torus.WebGPU.device.limits.maxComputeInvocationsPerWorkgroup;
            let size = [];
            let count = [];
            let shape_info = [];
            if (this.length <= max_X) {   // Тензор целиком умещается в одну группу измерения X
                size = [this.length];
                count = [1];
                shape_info = [{size: this.length, stride: 1}];
            }
            else if (this.length / max_X <= maxWorkgroups) {   // Тензор целиком умещается в одно измерение X
                size = [max_X];
                count = [Math.ceil(this.length / max_X)];
                shape_info = [{size: (size[0] * count[0]), stride: 1}];
            }
            else if (this.length / (max_Y * maxWorkgroups) <= maxWorkgroups * (maxPerWorkgroup / max_Y)) { // Тензор целиком умещается в измерениях X и Y
                size = [maxPerWorkgroup / max_Y, max_Y];
                count[1] = Math.ceil(this.length / max_Y / (maxWorkgroups * (maxPerWorkgroup / max_Y)));
                count[0] = Math.ceil(this.length / (max_Y * count[1]) / (maxPerWorkgroup / max_Y));
                shape_info = [{size: (size[0] * count[0]), stride: (size[1] * count[1])},
                              {size: (size[1] * count[1]), stride: 1}];
            }
            else if (this.length / (maxPerWorkgroup * maxWorkgroups * maxWorkgroups) <= maxWorkgroups) { // Тензор целиком умещается в измерениях X, Y и Z
                size = [maxPerWorkgroup / max_Y, max_Y, 1];
                count[1] = Math.ceil(this.length / max_Y / (maxWorkgroups * (maxPerWorkgroup / max_Y) * maxWorkgroups));
                count[0] = Math.ceil(this.length / (maxPerWorkgroup / max_Y) / (max_Y * count[1] * maxWorkgroups));
                count[2] = Math.ceil(this.length / ((maxPerWorkgroup / max_Y) * count[0] * max_Y * count[1]));
                shape_info[2] = {size: (size[2] * count[2]), stride: 1};
                shape_info[1] = {size: (size[1] * count[1]), stride: shape_info[2].size};
                shape_info[0] = {size: (size[0] * count[0]), stride: (shape_info[1].size * shape_info[1].stride)};
            }
            else
                throw new Error(`gpu_compute_info: tensor doesn't fit into GPU shaders. Required too many workgroups`);
            let code = new torus.CodeBuilder(
                shape_info.map((dim, i)=>{
                    switch(i){
                        case 0:
                            return `    var idx = id.x ${dim.stride===1? '':`* ${dim.stride}`};`;
                        case 1:
                            return `    idx += id.y ${dim.stride===1? '':`* ${dim.stride}`};`;
                        case 2:
                            return `    idx += id.z;`;
                    }
                }),
                `    if (idx > ${this.length-1}) {return;}`
            );
            code = code.code;
            return {size, count, code, idx: 'idx'};
        })();
    }
    get gpu_work_groups(){
        switch (this.dim){
            case 0: 
                return [1];
            case 1:
                return [Math.min(256, this.shape[0])];
            case 2: {
                let dim_x = 16, dim_y = 16;
                if (this.shape[0] < dim_x){
                    dim_x = this.shape[0];
                    dim_y = Math.trunc(256 / this.shape[0]);
                }
                if (this.shape[1] < dim_y){
                    dim_y = this.shape[1];
                    if (dim_x < this.shape[0])
                        dim_x = Math.min(this.shape[0], Math.trunc(256 / dim_y));
                }
                return [dim_x, dim_y];
            }
            default: {
                let dim_x = 4, dim_y = 4, dim_z = 16;
                let rest_dims = this.shape.slice(2).mul();
                if (this.shape[0] < dim_x) {
                    dim_x = this.shape[0];
                    dim_y = Math.trunc(256 / (dim_x * dim_z));
                }
                if (this.shape[1] < dim_y) {
                    dim_y = this.shape[1];
                    dim_z = Math.min(64, Math.trunc(256 / (dim_x * dim_y)));
                }
                if (rest_dims < dim_z) {
                    dim_z = rest_dims;
                    if (dim_x < this.shape[0])
                        dim_x = Math.min(this.shape[0], Math.trunc(256 / (dim_y * dim_z)));
                    if (dim_y < this.shape[1])
                        dim_y = Math.min(this.shape[1], Math.trunc(256 / (dim_x * dim_z)));
                }
                return [dim_x, dim_y, dim_z];
            }
        }
    }
    unsqueeze(...dims) {
        dims = torus.flat(dims);
        const rank = this.dim + dims.length;
        for (let i = 0; i < dims.length; i++) {
            let dim = dims[i];
            if (dim < -rank || dim >= rank)
                throw new Error(`unsqueeze(${dims}): axis ${dim} is out of bounds for array of dimension ${rank}`);
            if (dim < 0)
                dims[i] = dim = rank + dim;
            if (dims.indexOf(dim) !== i)
                throw new Error(`unsqueeze(${dims}): list of axes contains repeated axis ${dim}, that isn't allowed`);
        }
        dims.sort((a, b) => a - b);
        const shape = [...this.shape];
        for (let i = 0; i < dims.length; i++) {
            shape.splice(dims[i], 0, 1);
        }
        return this._shape(shape);
    }
    toJSON(){
        const result =  {
            $: this.constructor.name,
            label: this.label,
            shape: this.shape,
            isSerializable: this.isSerializable,
            isParam: this.isParam,
            dType: this.dType.name,
        }
        if (this.isDestroyed)
            result.data = 'DESTROYED';
        else {
            result.data = this.data.join(' ');
        }
        return result;
    }
    get p(){
        return tensor.param(this);
    }
    _label(label){
        this['#label'] = label;
        return this;
    }
    _src(...tensors){
        tensors = torus.flat(tensors);
        this.#src = tensors;//.filter(t=>t.allowGrad);
        return this;
    }
    get src(){
        return this.#src;
    }
    _dType(dType){
        if (this.dType !== dType){
            this.dType = dType;
            const data = new dType(this.data.length);
            let i = this.length;
            while(i--)
                data[i] = this.data[i];
            this.#data.buffer.transfer(0);
            this.#data = data;
        }
        return this;
    }
    _data(data){
        this.#grad = undefined;
        if (data.length !== this.length)
            throw new Error(`_data(data): dimension out of range (expected ${this.#data.length}, but got ${data.length})`);
        this.#data = data;
        this.dType = this.#data.constructor;
        return this;
    }
    _param(){
        this.isParam = true;
        return this;
    }
    reshape(...shape){
        return this._shape(shape);
        // return this._shape(...shape);
    }
    resize(...shape){
        return this._shape(shape);
        // return this._shape(...shape);
    }
    _shape(...shape_or_tensor) {   // shape or tensor
        this['#shape'] = this.check_shape(shape_or_tensor);
        this.clear_shape_cache();
        return this;
    }
    clear_shape_cache() {
        this['#shape_multipliers'] = undefined;
        this['#shape_info'] = undefined;
        // this['#length'] = undefined;
        return this;
    }

    //inplace functions
    mul_(factor){
        this.#data = this.data.map(d=>d * factor);
        return this;
    }
    div_(factor){
        this.#data = this.data.map(d=>d / factor);
        return this;
    }
    plus_(factor){
        this.#data = this.data.map(d=>d + factor);
        return this;
    }
    minus_(factor){
        this.#data = this.data.map(d=>d - factor);
        return this;
    }
    get OUTS(){
        if (this.allowGrad)
            this.__outs__ ??= Object.create(null);
        return this.__outs__;
    }
    set OUTS(n){
        if (!this.__outs__)
            this.__outs__ = n;
    }
    get allowGrad(){
        return (this.isParam || !!this.src?.some(i=>i.allowGrad));
    }
    get data(){
        return this.#data;
    }
    set data(n){
        this.#grad = undefined;
        if (n.length !== this.length)
            throw new Error(`set data(n): dimension out of range (expected ${this.#data.length}, but got ${n.length})`);
        this.#data = n;
        this.dType = this.#data.constructor;
    }
    clear(){
        this.fill(0);
    }
    fill(value = 0, offset = 0, end = this.length){
        if(torus.USE_GPU){
            let buffer = this.writeToGPU();
            if(value === 0 && offset === 0 && end === this.length){
                torus.WebGPU.clearBuffer(buffer);
            }
            else{
                this.data.fill(value, offset, end);
                this.writeToGPU(true);
            }
        }
        else{
            this.data.fill(value, offset, end);
        }
    }
    get grad(){
        if (!this.#grad) {
            if (this.dType === BigInt) {
                let data = Array(this.length).fill(0n);
                this.#grad = new tensor(data, {dType: BigInt, shape: this.shape});
            }
            else {
                let data = new torus.DEFAULT_TYPE(this.length);
                this.#grad = tensor.from(data)._shape(this.shape);
            }
            this.#grad._label('GRAD for: ' + (this.label ?? 'unlabeled'));
            this.#grad.OUTS = Object.create(null);
        }
        return this.#grad;
    }
    set grad(n){
        this.#grad = n;
    }
    get BiTES_PER_ELEMENT(){
        return this.dType.BYTES_PER_ELEMENT * 8;
    }
    get T(){
        return this.transpose();
    }
    get shape(){
        return this['#shape'] || [];
    }
    get length(){
        return this.data.length;
        // return this['#length'] ??= (this.shape.mul() || this.data.length);
    }
    get dim(){
        return this.shape.length;
    }
    get label(){
        return this['#label'];
    }
    get type(){
        return this.#type ?? (()=>{
            switch (this.dim){
                case 0:{
                    if (!this.length)
                        return 'empty';
                    return `scalar`;
                }
                case 1:{
                    // if (this.shape.mul() < 2)
                    //     return `scalar`;
                    return `vector`;
                }
                case 2:
                    return `matrix`;
                default:
                    return `tensor`;
            }
        })();
    }

    get paramCount(){
        if (this.isParam)
            return this.length;
        return 0;
    }
    destroy(recurce = true){
        if(this.isParam) return;
        if (!this.data.length) return;
        this.data.buffer.transfer(0);
        this.isDestroyed = true;
        if (!recurce) return;
        if (!this.src?.length) return
        this.src.forEach(s=>s.destroy(recurce))
    }
    get topo(){
        return this.__topo__ ??= (()=>{
            let topo = [];
            let visited = new Set();
            let build_topo = (t) => {
                if (!visited.has(t)) {
                    visited.add(t);
                    t.src?.filter(t=>t.allowGrad).forEach(ch => build_topo(ch));
                    topo.push(t);
                }
            }
            build_topo(this);
            topo.reverse();
            return topo;
        })()
    }
    mutate(rate = 0.05){
        if (!this.isParam){
            let params = this.topo.filter(t=>t.isParam);
            for(let t of params)
                t.mutate();
            return;
        }
        this.grad.set(this);
        let mutate_count = Math.round(this.length * rate);
        if(torus.USE_GPU){
            if(!this.gpuMutateParamsCode) {
                let wg = this.gpu_compute_info;
                let cb = new torus.ShaderBuilder(
                    `// update_params`,
                    `@group(0) @binding(0) var<storage, read> grad: array<${this.grad.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read_write> data: array<${this.gpuType}>;`,
                    `@compute @workgroup_size(${wg.size})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    wg.code,
                    `    data[idx] = data[idx] - grad[idx] * ${torus.LEARNING_RATE};`,
                    `}`
                )
                this.gpuMutateParamsCode = {code: cb.shader};
                this.gpuMutateParamsCode.count = wg.count;
            }
            torus.compute(this.gpuMutateParamsCode.code, [this.grad, this], this.gpuMutateParamsCode.count);
        }
        else{
            while(mutate_count-- > -1){
                let idx = Math.trunc(torus.generator() * this.length);
                this.data[idx] += (torus.generator() - 0.5) * torus.LEARNING_RATE;
            }
        }
    }
    mutate_revert(){
        if (!this.isParam){
            let params = this.topo.filter(t=>t.isParam);
            for(let t of params)
                t.mutate_revert();
            return;
        }
        this.set(this.grad);
    }
    back(grad){
        let topo = this.topo;
        for(let node of topo){
            if (node.allowGrad){
                node.grad.fill(0);
            }

        }

        if(grad){
            if (grad.constructor === Number)
                topo[0].grad.fill(grad);
            else
                throw Error(`Unknown value ${grad} for gradients`);
        }

        for(let node of topo){
            if (!node.src?.length || !node.allowGrad)
                continue;
            // for(let i = 0; i<node.grad.data.length; i++){
            //     node.grad.data[i] /= Math.SQRT2;
            // }
            node._back?.();
        }
        topo = topo.filter(t=>t.isParam);
        for(let t of topo)
            t.update_params();
    }
    backward(grad){
        return this.back(grad);
    }
    static from(data_or_tensor, $){
        if (!Object.equal(data_or_tensor?.constructor, tensor)){
            if (torus.USE_SCALAR_CACHE && Number.isFinite(data_or_tensor)){
                data_or_tensor = torus._scalars_tensors[data_or_tensor] ??= (new tensor(data_or_tensor, $))._label('SCALAR')
            }
            else
                data_or_tensor = new tensor(data_or_tensor, $);
        }

        if (this !== torus && this?.OUTS)
            data_or_tensor.OUTS ??= this.OUTS;
        return data_or_tensor;
    }
    static param(src){
        src = tensor.from(src);
        src.isParam = true;
        src.isSerializable = true;
        return src;
    }
    get gpuType(){
        switch (this.dType){
            case Float16Array:
                return 'f16';
            case Float32Array:
                return 'f32';
            case Float64Array:
                return 'f62';
            case Int8Array:
                return 'i8';
            case Int16Array:
                return 'i16';
            case Int32Array:
                return 'i32';
            case Uint8Array:
                return 'u8'
            case Uint16Array:
                return 'u16';
            case Uint32Array:
                return 'u32';
        }
    }
    gpuDestroy(){
        this.gpuDataBuffer?.destroy();
        this.gpuDataBuffer = null;
        webgpu.destroy(this.data);
    }
    get gpuBuffer(){
        return this.gpuDataBuffer;
    }
    writeToGPU(copy = false){
        if(!torus.USE_GPU || !webgpu.device)
            return;
            // throw new Error('GPU not supported');
        return (this.gpuDataBuffer = webgpu.writeData(this.data, copy, 't' + this.id));
    }
    async read(){
        return this.readFromGPU();
    }
    async readFromGPU(){
        try{
            if(!torus.USE_GPU)
                return this.#data;
            if(!webgpu.device)
                throw new Error('GPU not supported');
            let data = await webgpu.readData(this.#data);
            this.#data.set(data);
            return this.#data;
        }
        catch (e){
            console.warn(e.message)
        }
    }
    reverse(dim = 0){
        if (-this.dim > dim || this.dim - 1 < dim)
            throw new Error(`tensor.reverse(${dim}): dimension out of range (expected to be in range of [-${this.dim}, ${this.dim - 1}], but got ${dim})`)
        if (dim < 0)
            dim += this.dim;


        this.data.reverse();

        return this;
    }
    repeat(...repeat_shape){
        if (repeat_shape.length === 1){
            if (Number.isInteger(repeat_shape[0])){
                repeat_shape = [repeat_shape[0]];
            }
            else if (Array.isArray(repeat_shape[0])){
                repeat_shape = repeat_shape[0];
            }
        }
        const multiply = repeat_shape.mul();
        const new_size = this.length * multiply;
        let data = new this.dType(new_size);
        const old_size = this.data.length;
        for (let i = 0; i < old_size; i++){
            let d = this.data[i]
            for (let m = i; m < new_size; m += old_size){
                data[m] = d;
            }
        }
        this.#data = data;
        this._shape([...repeat_shape, ...this.shape]);
        return this;
    }
    toString(step = 0, max = 8){
        let data = this.array.toTensorString(step, max, this.shape, this.dType).split('\n');
        data = data.join('\n');
        let tab = ('  ').repeat(step);
        let result  = tab + this.type + ` ${this.label || ''}: `;
        // if (this.dim > 1 || this.shape.last > 1)
        if (this.dim > 0) {
            result += `shape(${this.shape}), length(${this.length.toLocaleString()}), ${this.dType.name}, ${this.backs.join(',')}\n`;
            result += tab + (this.dim === 1? data: `[${data}]`);
        }
        else
            result += `${this.dType.name}, ${this.backs.join(',')}\n${tab}(${data.replaceAll('[', '').replaceAll(']', '').trim()})`;
        result = ' (id#'+this.id + '): ' + result;
        if(this.gpuDataBuffer)
            result = ' GPU ' + result;
        if (this.isParam)
            result = tab + 'PARAM' + result;
        return result + '\n';
    }
    get array() {
        if (this.shape.length < 2)
            return [this.data];
        let data = Array.from(this.data);
        let res = [];
        const shape = Array.from(this.shape);
        let s
        while (s = shape.pop()){
            const size = data.length;
            for (let i = 0; i < size; i += s){
                res.push(Array.from(data.slice(i, i + s)))
            }
            data = res;
            res = [];
        }
        return data.flat();
    }
}
export const torus = {
    get DEFAULT_TYPE(){
        if(!globalThis.DEFAULT_TYPE){
            switch (this.WebGPU.defaultType){
                case 'f16':{
                    globalThis.DEFAULT_TYPE = Float16Array;
                }  break;
                default:{
                    globalThis.DEFAULT_TYPE = Float32Array;
                } break;
            }
        }
        return globalThis.DEFAULT_TYPE;
    },
    set DEFAULT_TYPE(n){
        globalThis.DEFAULT_TYPE  = n;
    },
    get LEARNING_RATE(){
        return globalThis.LEARNING_RATE || .1;
    },
    set LEARNING_RATE(n){
        globalThis.LEARNING_RATE  = n;
    },
    get USE_GPU(){
        return globalThis.USE_GPU || false;
    },
    set USE_GPU(n){
        globalThis.USE_GPU  = n;
    },
    _scalars_tensors: {},
    get USE_SCALAR_CACHE(){
        return globalThis.USE_SCALAR_CACHE || false;
    },
    set USE_SCALAR_CACHE(n){
        globalThis.USE_SCALAR_CACHE  = n;
    },
    get generator(){
        return torus.__random_generator__;
    },
    manual_seed(seed){
        if (seed) {
            seed %= 2147483647; //Защита от перехода в бесконечность
            if (seed<0)
                seed += 2147483647;
            //throw new Error(`'seed' must be positive number`);
            const gen = pseudoRandom(seed);
            torus.__random_generator__ = ()=>{
                return (gen.next().value / 2147483647);
            };
        }
        else
            torus.__random_generator__ = Math.random;
        return torus.__random_generator__;
    },
    scalars_tensors: {},
    get WebGPU(){
        return webgpu;
    }
};
torus.tensor = tensor;
torus.CodeBuilder = class CodeBuilder{
    constructor(...code_parts){
        this.parts = code_parts;
    }
    get code(){
        return this.parts.flat(Infinity).join('\n');
    }
}
torus.ShaderBuilder = class ShaderBuilder extends torus.CodeBuilder{
    constructor(...code_parts){
        super(...code_parts);
        if(torus.USE_GPU){
            if(torus.WebGPU.defaultType === 'f16'){
                this.parts.unshift('enable f16;');
            }
        }
    }
    get shader(){
        return torus.WebGPU.compile(this.code);
    }
}
torus.__random_generator__ = Math.random;
function* pseudoRandom(seed) {
    let value = seed * 16807 % 2147483647

    while(true) {
        value = value * 16807 % 2147483647

        yield value;
    }

}
//update_params

tensor.prototype.update_params = function(){
    if (!this.isParam || this.dType === BigInt)
        return;
    if (torus.USE_GPU) {
        if (!this.gpuUpdateParamsCode) {
            let wg = this.gpu_compute_info;
            let cb = new torus.ShaderBuilder(
                `// update_params`,
                `@group(0) @binding(0) var<storage, read> grad: array<${this.grad.gpuType}>;`,
                `@group(0) @binding(1) var<storage, read_write> data: array<${this.gpuType}>;`,
                `@compute @workgroup_size(${wg.size})`,
                `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                wg.code,
                `    data[idx] = data[idx] - grad[idx] * ${torus.LEARNING_RATE};`,
                `}`
            );
            this.gpuUpdateParams = {code: cb.shader};
            this.gpuUpdateParams.count = wg.count;
        }
        torus.compute(this.gpuUpdateParams.code, [this.grad, this], this.gpuUpdateParams.count);
    }
    else {
        let data = this.data;
        let grad = this.grad.data;
        for (let i = 0; i<this.length; i++) {
            let value = grad[i];
            if (!Number.isFinite(value))
                throw new Error(`Error update_param value ${value} on tensor: ` + this.label);
            if (value === 0)
                continue;
            data[i] -= (value * torus.LEARNING_RATE);
        }
    }
}
// let generator = pseudoRandom(1);

tensor.prototype.item = function (...shape){
    shape = torus.flat(shape);
    //todo
}

torus.genVarsArray = function(size, upper = false){
    let char_code = upper?65:97;
    return Array(size).fill().map((_,i)=>String.fromCharCode(i + char_code))
}

tensor.prototype.copyTo = function (target, offset = 0, from = 0, size = this.length){
    if(torus.USE_GPU){
        this.writeToGPU();
        target.writeToGPU();
        let bpe = target.data.constructor.BYTES_PER_ELEMENT;
        torus.WebGPU.copy(this.gpuBuffer, target.gpuBuffer, offset * bpe, from * bpe, size * bpe);
    }
    else{
        target.data.set(this.data.subarray(from, from + size), offset);
        // target.set(this.data, offset, from, size);
    }
    return target;
}

tensor.prototype.dot = function (other){
    if (this.shape.last !== other.shape.last)
        throw new Error(`dot: last dimentions of both tensors must be equal`);
    let x = this.shape_info.map(ax=>ax.char).join('');
    let y = other.shape_info.map(ax=>ax.char).join('');
    let exit = (x.length<y.length?y:x).slice(0, -1)
    let expr = `${x}, ${y} -> ${exit}`;
    return torus.einsum(expr, [this, other])._label('dot product ('+expr+')');
}

tensor.prototype.findIndex = function(...indices){
    indices = torus.flat(indices);
    return indices.reduce((r, v, i)=> (r + v * this.shape_multipliers[i]), 0)
}
tensor.prototype.item = function(...indices) {
    return this.get(...indices)
}
tensor.prototype.get = function(...indices){
    indices = torus.flat(indices);
    const idx = indices.reduce((r, v, i)=> (r + v * this.shape_multipliers[i]), 0)
    if(!indices.length  || indices.length === this.shape_multipliers.length)
        return this.data[idx];
    return this.data.slice(idx, idx + this.shape_multipliers.slice(indices.length-1).mul())
}
tensor.prototype.set = function(source, offset, from, size){
    source.copyTo(this, offset, from, size);
}

tensor.prototype.log_ = function (){
    let i = this.data.length
    while(i--){
        this.data[i] = Math.log(this.data[i]);
    }
    return this;
}

tensor.prototype.allclose = function(other, rtol = 1e-05, atol = 1e-08, equal_nan = false ){
    const fn = equal_nan?(r, y, i)=>(r && (this.data[i] || 0) - (y || 0) <= atol + rtol * (y || 0)):((r, y, i)=>r && this.data[i] - y <= atol + rtol * y)
    return other.data.reduce(fn, true);
}

tensor.prototype.masked_fill = function(other, mask = 0, value = 0){
    const funcs = {
        forward:    `(x0, x1) => x1 === ${mask}? ${value}: x0`,
        forwardGPU: `return select(x0, ${value}, x1 == ${mask});`,   // Вызов select(false_value, true_value, condition)
        backward_0: `(x0, x1) => x1 === ${mask}? 0: 1`,
        backwardGPU_0: `return select(1., 0., x1 == ${mask});`,   // Вызов select(false_value, true_value, condition)
    };
    const out = torus._element_wise.call(this, funcs, other);
    return out._label(`masked_fill(mask=${mask}, value=${value})`);
}
tensor.prototype.add = tensor.prototype.plus = function (other){
    const funcs = {
        forward:    '(x0, x1) => x0 + x1',
        forwardGPU: 'return x0 + x1;',
        backward: '() => 1',
        backwardGPU: 'return 1;',
    };
    const out = torus._element_wise.call(this, funcs, other);
    return out._label(`plus: (${this.shape}) + ${other?.shape? `(${other.shape})`: other}`);
}
tensor.prototype.minus = tensor.prototype.sub = tensor.prototype.substract = function (other){
    const funcs = {
        forward:    '(x0, x1) => x0 - x1',
        forwardGPU: 'return x0 - x1;',
        backward_0: '() => 1',
        backward_1: '() => -1',
        backwardGPU_0: 'return 1;',
        backwardGPU_1: 'return -1;',
    };
    const out = torus._element_wise.call(this, funcs, other);
    return out._label(`minus: (${this.shape}) - ${other?.shape? `(${other.shape})`: other}`);
}
tensor.prototype.round = function(){
    // Особенности округления отрицательных чисел в GPU (проверялось на Nvidia GT-710, версия драйвера 23.21.13.9135):
    // CPU: Math.round(-1.5) === -1
    // GPU: round(-1.5) === -2
    const funcs = {
        forward:    'Math.round',
        forwardGPU: 'return round(x0);',
    };
    let out =  torus._element_wise.call(this, funcs);
    return out._label(`round`);
}
tensor.prototype.abs = function (){
    const funcs = {
        forward:    'Math.abs',
        forwardGPU: 'return abs(x0);',
        backward_0: '(x0) => x0 < 0? -1: 1',
        backwardGPU_0: 'return select(1., -1., x0 < 0);'
    };
    const out = torus._element_wise.call(this, funcs);
    return out._label('abs: ' + this.shape);
}
tensor.prototype.mul = tensor.prototype.multiply = function (other){
    const funcs = {
        forward:    '(x0, x1) => x0 * x1',
        forwardGPU: 'return x0 * x1;',
        backward_0: '(x0, x1) => x1',
        backward_1: '(x0, x1) => x0',
        backwardGPU_0: 'return x1;',
        backwardGPU_1: 'return x0;',
    };
    const out =  torus._element_wise.call(this, funcs, other);
    return out._label(`mul: (${this.shape}) * ${other?.shape? `(${other.shape})`: other}`);
}
tensor.prototype.div = tensor.prototype.divide = function (other){
    const funcs = {
        forward:    '(x0, x1) => x0 / x1',
        forwardGPU: 'return x0 / x1;',
        backward_0: '(x0, x1) => 1 / x1',
        backward_1: '(x0, x1) => -x0 / x1 ** 2',
        backwardGPU_0: 'return 1 / x1;',
        backwardGPU_1: 'return -x0 / (x1 * x1);',
    };
    const out = torus._element_wise.call(this, funcs, other);
    return out._label(`div: (${this.shape}) / ${other?.shape? `(${other.shape})`: other}`);
}
tensor.prototype.sin = function(){
    const funcs = {
        forward:    'Math.sin',
        forwardGPU: 'return sin(x0);',
        backward_0: 'Math.cos',
        backwardGPU_0: 'return cos(x0);',
    };
    const out = torus._element_wise.call(this, funcs);
    return out._label(`sin: (${this.shape})`);
}
tensor.prototype.cos = function(){
    const funcs = {
        forward:    'Math.cos',
        forwardGPU: 'return cos(x0);',
        backward_0: 'Math.sin',
        backwardGPU_0: 'return -sin(x0);',
    };
    const out = torus._element_wise.call(this, funcs);
    return out._label(`cos: (${this.shape})`);
}
tensor.prototype.pow = function (other){
    /* Особенности работы функции pow на GPU (проверялось на Nvidia GT-710, версия драйвера 23.21.13.9135):
    Очень капризна в возведении в степень отрицательных чисел. Даже для целых степеней.
    1)  Если основание и показатель степени заданы константами 
                            let y: f32 = pow(f32(-3.), f32(2.));
            выдаст ошибку:
                            Error while parsing WGSL: :7:18 error: '-3.0 ^ 2.0' cannot be represented as 'f32'
    2)  Если константу показателя степени предварительно присвоить переменной
                            let x: f32 = 2.;
                            let y: f32 = pow(-3., x);
            вернёт правильно y = 9
                            let x: f32 = 3.; // аналогично 1, -2, 4, 0, -1
                            let y: f32 = pow(-3., x);
            вернёт y = NaN
    3)  Если показатель степени берётся из буфера данных
                            data[0] = 2.;  // data -- это буфер данных типа f32
                            let y: f32 = pow(-3., data[0]);
            вернёт y = NaN
    4)  Если значение буфера данных предварительно присвоить переменной
                            data[0] = 2.;  // data -- это буфер данных типа f32
                            let x: f32 = data[0];
                            let y: f32 = pow(-3., x);
            всё равно вернёт y = NaN
    5)  0 в степени 0
                            let x: f32 = 0.;
                            let y: f32 = pow(0., x);
            вернёт y = NaN
    6)  0 в отрицательной степени
                            let x: f32 = -1.;
                            let y: f32 = pow(0., x);
            вернёт y = Infinity
    */
    const funcs = {
        forward:    '(x0, x1) => x0===0? 0: (x0 ** x1)',
        forwardGPU: [   
            'if (x0 == 0) {return 0;}',
            'if (x0 > 0) {',
            '    return pow(x0, x1);',
            '}',
            'let z = pow(abs(x0), x1);',
            'return select(z, -z, abs(x1 % 2) == 1.0);',
            ].join('\n'),
        backward_0: '(x0, x1) => x0===0? 0: (x1 * (x0 ** (x1 - 1)))',
        backward_1: [
            '(x0, x1) => {',
            '    if (x0 === 0) return 0;',
            '    if (x0 > 0) return (x0 ** x1) * Math.log(x0);',
            '    return (x0 ** x1) * (x0 - 1.0);',  // При отрицательных x0 строгой производной не существует, поэтому используем
            '}'                                     // разность между ближайшими дискретными значениями x0^(x1+1) - x0^x1 --> x0^x1 * (x0-1)
            ].join('\n'),
        backwardGPU_0: [
            'if (x0 == 0) {return 0;}',
            'let y = x1 - 1.0;',
            'if (x0 > 0){',
            '    return x1 * pow(x0, y);',
            '}',
            'let z = x1 * pow(abs(x0), y);',
            'return select(z, -z, abs(y % 2) == 1.0);',
            ].join('\n'),
        backwardGPU_1: [
            'if (x0 == 0) {return 0;}',
            'if (x0 > 0){',
            '    return pow(x0, x1) * log(x0);',
            '}',
            'let z = pow(abs(x0), x1) * (x0 - 1.0);',       // При отрицательных x0 строгой производной не существует, поэтому используем
            'return select(z, -z, abs(x1 % 2) == 1.0);',    // разность между ближайшими дискретными значениями x0^(x1+1) - x0^x1 --> x0^x1 * (x0-1)
            ].join('\n')
    };
    const out = torus._element_wise.call(this, funcs, other);
    return out._label(`pow: (${this.shape})**${other?.shape? `(${other.shape})`: other}`);
}
torus.$ = function (...$){
    return Object.assign({keepdim: false, dType: torus.DEFAULT_TYPE}, ...$)
}
tensor.prototype.shift = function(replacer){
    this.copyTo(this, replacer.length);
    replacer.copyTo(this);
    return this;
}
//softmax
tensor.prototype.softmax = function (dim = -1){
    let key  = 'softmax: '+ dim;
    let out = torus.get_out(this, key);
    if (!out){
        let size = this.length;
        out =  tensor.from(new torus.DEFAULT_TYPE(size))._src(this)._label('softmax')._shape(this);
        torus.set_out(this, out, key);
        dim = this.dim_info(dim);
        let groups = size / dim.size;
        let step = dim.stride * dim.size;
        if(torus.USE_GPU){
            let wg = this.gpu_compute_info;
            let cb = new torus.ShaderBuilder(
                `// softmax forward`,
                `@group(0) @binding(0) var<storage, read> input: array<${this.gpuType}>;`,
                `@group(0) @binding(1) var<storage, read_write> output: array<${out.gpuType}>;`,
                `@compute @workgroup_size(${wg.size})`,
                `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                wg.code,
                `   let start = idx % ${dim.stride} + u32(idx / ${dim.stride}) * ${step};`,
                `   var max_val = input[start];`,
                `   for (var i: u32 = 1; i < ${dim.size}u; i++) {`,
                `       var v = input[start + (i * ${dim.stride}u)];`,
                `       max_val = max(max_val, v);`,
                `   }`,
                `   var sum = ${out.gpuType}(0);`,
                `   for (var i: u32 = 0; i < ${dim.size}u; i++){`,
                `       let idx = start + (i * ${dim.stride}u);`,
                `       var v = input[idx] - max_val;`,
                `       v = exp(v);`,
                `       output[idx] = v;`,
                `       sum += v;`,
                `   }`,
                `   for (var i: u32 = 0; i < ${dim.size}u; i++){`,
                `       let idx = start + (i * ${dim.stride}u);`,
                `       output[idx] /= sum;`,
                `   }`,
                `}`
            );
            let shader = cb.shader;
            out._fwd = ()=> {
                torus.compute(shader, [this, out], wg.count);
                return out._src(this);
            }
            if (this.allowGrad){
                let cb = new torus.ShaderBuilder(
                    `// softmax back`,
                    `@group(0) @binding(0) var<storage, read> out_data: array<${out.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read> out_grad: array<${out.grad.gpuType}>;`,
                    `@group(0) @binding(2) var<storage, read_write> grad: array<${this.grad.gpuType}>;`,
                    `@compute @workgroup_size(${wg.size})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    wg.code,
                    `    let v = out_data[idx];`,
                    `    grad[idx] += out_grad[idx] * v * (1 - v);`,
                    `}`
                );
                let shader = cb.shader;
                out._back = () =>{
                    torus.compute(shader, [out, out.grad, this.grad], wg.count);                    }
                }
            }
        else{
            out._fwd = ()=> {
                for (let g = 0; g<groups; g++){
                    let start = g % dim.stride + Math.trunc(g / dim.stride) * step;
                    let max = this.data[start];
                    for (let i = 1; i<dim.size; i++){
                        let v = this.data[start + i * dim.stride];
                        max = Math.max(v, max);
                    }
                    let sum = 0;
                    for (let i = 0; i < dim.size; i++){
                        let idx = start + i * dim.stride;
                        let v = this.data[idx] - max;
                        out.data[idx] = v = Math.exp(v);
                        sum += v;
                    }
                    for (let i = 0; i<dim.size; i ++){
                        let idx = start + i * dim.stride;
                        out.data[idx] /= sum;
                    }
                }
                return out._src(this);
            }
            if (this.allowGrad){
                            out.grad;    // Эти две строки нужна только для отладки, точнее для детального сравнения режимов CPU и GPU.
                            this.grad;   // Создание градиентных тензоров переносится на прямой проход как в GPU.
                out._back = () =>{
                    for (let i=0; i<out.length; i++) {
                        let v = out.data[i];
                        this.grad.data[i] += out.grad.data[i] * v * (1 - v);
                    }
                }
            }
        }
    }
    return out._fwd();
}

tensor.prototype.maxIndex = function (dim = -1) {
    dim = this.check_dim(dim);
    let key = 'max-index: ' + this.shape + ' dim: ' + dim;
    let out = torus.get_out(this, key);
    if (!out){
        const shape = this.shape.filter((v, i) => i !== dim);
        dim = this.shape_info[dim];
        const out_size = this.length / dim.size;
        const data = new Uint32Array(out_size);
        out = tensor.from(data)._label(key)._shape(shape)._src(this);
        torus.set_out(this, out, key);
        const step = dim.stride * dim.size;
        if (torus.USE_GPU){
            let wgs = [Math.min(out_size, 256)];
            const cb = new torus.ShaderBuilder(
                `// maxIndex`,
                `@group(0) @binding(0) var<storage, read> data: array<${this.gpuType}>;`,
                `@group(0) @binding(1) var<storage, read_write> out: array<${out.gpuType}>;`,
                `@compute @workgroup_size(${wgs})`,
                `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                `    let idx_o = id.x;`,
                `    if (idx_o > ${out_size-1}) {return;}`,
                `    let start = idx_o ` + (dim.stride===1? '': `% ${dim.stride} + (idx_o / ${dim.stride}) `) + `* ${step};`,
                `    var max_value = data[start];`,
                `    var max_idx: u32 = 0;`,
                `    var idx_i = start + ${dim.stride};`,
                `    for (var i: u32 = 1; i < ${dim.size}; i++){`,
                `        let d = data[idx_i];`,
                `        if (d > max_value){`,
                `            max_idx = i;`,
                `            max_value = d;`,
                `        }`,
                `        idx_i += ${dim.stride};`,
                `    }`,
                `    out[idx_o] = ${out.gpuType}(max_idx);`,
                `}`
            );
            const shader = cb.shader;
            wgs[0] = Math.ceil(out_size / wgs[0]);
            out._fwd = ()=>{
                torus.compute(shader, [this, out], wgs);
                return out;
            }
        }
        else{
            out._fwd = ()=>{
                for(let idx_o = 0; idx_o < out_size; idx_o++){
                    let start = idx_o % dim.stride + Math.trunc(idx_o / dim.stride) * step;
                    let max_value = this.data[start];
                    let max_idx = 0;
                    let idx_i = start + dim.stride;
                    for(let i = 1; i < dim.size; i++){
                        let d = this.data[idx_i];
                        if (d > max_value){
                            max_idx = i;
                            max_value = d;
                        }
                        idx_i += dim.stride;
                    }
                    out.data[idx_o] = max_idx;
                }
                return out;
            }
        }
    }
    return out._fwd();
}

tensor.prototype.hardmax = function (){
    const step = this.shape[this.shape.length-1];
    const size = this.length/step;
    const data = new torus.DEFAULT_TYPE(this.length);
    for (let x = 0; x<size; x++){
        let max = undefined;
        let idx;
        for (let y = 0; y<step; y++){
            let v = this.data[y + step * x];
            if (max === undefined || max < v){
                idx = y
                max = v;
            }
        }
        for (let y = 0; y<step; y++){
            data[y + step * x] = (idx === y)?1:0;
        }
    }
    const out =  tensor.from(data)._src(this)._label('hardmax')._shape(this);
    return out;
}

tensor.prototype.sharp = function (dims=[-1]){
    const key = `sharp: dims=${dims}`;
    let out = torus.get_out(this, key);
    if (!out){
        if (!Array.isArray(dims))
            dims = [dims];
        let d_info = this.dim_info(dims);
        d_info = d_info.filter(di => di.size > 1);   // Оси с размером 1 исключаются из расчетов, т.к. на них нет соседей для сравнения
        if (d_info.length === 0)
            return this;
        const size = this.length;
        out =  tensor.from(new this.dType(size))._shape(this)._src(this)._label(`sharp ${dims}`);
        torus.set_out(this, out, key);
        let tab = '    ';
        if (torus.USE_GPU){
            let big_tab = tab.repeat(d_info.length + 1);
            let wg = this.gpu_compute_info;
            let cb = new torus.ShaderBuilder(
                `// sharp FORWARD`,
                `@group(0) @binding(0) var<storage, read> data: array<${this.gpuType}>;`,
                `@group(0) @binding(1) var<storage, read_write> out_data: array<${out.gpuType}>;`,
                `@compute @workgroup_size(${wg.size})`,
                `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                wg.code,
                d_info.map(di => [
                    `    let idx_${di.char} = ${di.stride==1? `idx % ${di.size}`: `(idx / ${di.stride}) % ${di.size}`};`,
                    `    let start_${di.char} = select(${-di.stride}, 0, idx_${di.char} == 0);`,
                    `    let end_${di.char} = select(${di.stride}, 0, idx_${di.char} == ${di.size - 1});`
                ]),
                `    let x = data[idx];`,
                `    var sum = -x;`,
                `    var count = -1;`,
                d_info.map((di, j) => [
                    tab.repeat(j+1) + `for (var ${di.char}: i32 = start_${di.char}; ${di.char} <= end_${di.char}; ${di.char}+=${di.stride}) {`,
                    j!==d_info.length-1? (tab.repeat(j+1) + `    let idx_2${di.char} = ${j===0? `i32(idx)`: `idx_2${d_info[j-1].char}`} + ${di.char};`) : []
                ]),
                big_tab + `sum += data[${d_info.length===1? `i32(idx) + ${d_info[0].char}`: `idx_2${d_info[d_info.length-2].char} + ${d_info[d_info.length-1].char}`}];`,
                big_tab + `count++;`,
                d_info.map((di, j) => tab.repeat(j+1) + `}`).reverse(),
                `    out_data[idx] = x / (sum / ${out.gpuType}(count) / x);`,
                `}`);
// >cb.code
            let shader_f = cb.shader;
            out._fwd = () => {
                torus.compute(shader_f, [this, out], wg.count);
                return out;
            }
            if (this.allowGrad){
                cb = new torus.ShaderBuilder(
                    `// sharp BACK`,
                    `@group(0) @binding(0) var<storage, read> data: array<${this.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read> out_data: array<${out.gpuType}>;`,
                    `@group(0) @binding(2) var<storage, read> out_grad: array<${out.grad.gpuType}>;`,
                    `@group(0) @binding(3) var<storage, read_write> grad: array<${this.grad.gpuType}>;`,
                    `@compute @workgroup_size(${wg.size})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    wg.code,
                    `    grad[idx] += out_grad[idx] * (out_data[idx] / data[idx]);`,
                    `}`);
// >cb.code
                let shader_b = cb.shader;
                out._back = ()=>{
                    torus.compute(shader_b, [this, out, out.grad, this.grad], wg.count);
                }
            }
        }
        else{
            let big_tab = tab.repeat(d_info.length + 1);
            let cb = new torus.CodeBuilder(
                `// sharp FORWARD`,
                `let data = self.data;`,
                `let out_data = out.data;`,
                `for (let idx = 0; idx < ${size}; idx++) {`,
                d_info.map(di => [
                    `    let idx_${di.char} = ${di.stride===1? `idx % ${di.size}`: `Math.trunc(idx / ${di.stride}) % ${di.size}`};`,
                    `    let start_${di.char} = idx_${di.char} === 0? 0: ${-di.stride};`,
                    `    let end_${di.char} = idx_${di.char} === ${di.size - 1}? 0: ${di.stride};`
                ]),
                `    let x = data[idx];`,
                `    let sum = -x;`,
                `    let count = -1;`,
                d_info.map((di, j) => [
                    tab.repeat(j+1) + `for (let ${di.char} = start_${di.char}; ${di.char} <= end_${di.char}; ${di.char}+=${di.stride}) {`,
                    j!==d_info.length-1? (tab.repeat(j+1) + `    let idx_2${di.char} = ${j===0? `idx`: `idx_2${d_info[j-1].char}`} + ${di.char};`) : []
                ]),
                big_tab + `sum += data[${d_info.length===1? `idx + ${d_info[0].char}`: `idx_2${d_info[d_info.length-2].char} + ${d_info[d_info.length-1].char}`}];`,
                big_tab + `count++;`,
                d_info.map((di, j) => tab.repeat(j+1) + `}`).reverse(),
                `    out_data[idx] = x / (sum / count / x);`,
            `}`);
// >cb.code
            let fn = new Function('out', 'self', cb.code);
            out._fwd = ()=>{
                fn(out, this);
                return out._src(this);
            }
            if (this.allowGrad){
                const data = this.data;
                const grad = this.grad.data;
                const out_data = out.data;
                const out_grad = out.grad.data;
                out._back = ()=>{
                    for (let i = 0; i < size; i++)
                        grad[i] += out_grad[i] * (out_data[i] / data[i]);
                }
            }
        }
    }
    return out._fwd(); 
}

tensor.prototype.MSE = tensor.prototype.mse_loss = function (target) {
    const this_shape = this.shape.toReversed();
    const target_shape = target.shape.toReversed();
    if ( !target_shape.every((v, i) => v === this_shape[i] || i >= this_shape.length) )
        throw new Error(`predicted_tensor.MSE(target): ` +
            `The shape (${this.shape}) of predicted tensor mismatches the shape (${target.shape}) of target tensor`);
    let out = torus.get_out(this, 'MSE');
    if (!out) {
        out = tensor.from(new torus.DEFAULT_TYPE(1))._src(this)._label('mse_loss');
        torus.set_out(this, out, 'MSE');
        let error = tensor.from(new torus.DEFAULT_TYPE(this.length))._label('mse_error');
        if (torus.USE_GPU) {
            let wg = this.gpu_compute_info;
            let cb = new torus.ShaderBuilder(
                `// MSE`,
                `@group(0) @binding(0) var<storage, read> data: array<${this.gpuType}>;`,
                `@group(0) @binding(1) var<storage, read> tar: array<${target.gpuType}>;`,
                `@group(0) @binding(2) var<storage, read_write> error: array<${error.gpuType}>;`,
                `@compute @workgroup_size(${wg.size})`,
                `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                wg.code,
                `    error[idx] = data[idx] - tar[idx];`,
                `}`)
            let shader1 = cb.shader;
//>fwd_code
            cb = new torus.ShaderBuilder(
                `// MSE SUM`,
                `@group(0) @binding(0) var<storage, read> error: array<${error.gpuType}>;`,
                `@group(0) @binding(1) var<storage, read_write> out: array<${out.gpuType}>;`,
                `@compute @workgroup_size(1)`,
                `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                `    if (id.x > 0) {`,
                `        return;`,
                `    }`,
                `    var sum = ${out.gpuType}(0);`,
                `    for (var i = 0; i < ${error.length}; i++ ) {`,
                `       let e = error[i];`,
                `       sum += e * e;`,
                `    }`,
                `    out[id.x] = sum / ${error.length}.0;`,
                `}`);
            let shader2 = cb.shader;
            out._fwd = (target) => {
                torus.compute(shader1, [this, target, error], wg.count);
                torus.compute(shader2, [error, out], [1]);
                return out;
            }
            if (this.allowGrad) {
                cb = new torus.ShaderBuilder(
                    `// MSE Back`,
                    `@group(0) @binding(0) var<storage, read> error: array<${error.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read_write> grad: array<${this.grad.gpuType}>;`,
                    `@compute @workgroup_size(${wg.size})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    wg.code,
                    `    grad[idx] += error[idx] * 2;`,
                    `}`)
                let shader = cb.shader;
                out._back = ()=>{
                    torus.compute(shader, [error, this.grad], wg.count);
                }
            }
        }
        else {
            out._fwd = (target) => {
                let loss = 0;
                for (let i = 0; i < this.length; i++) {
                    loss += (error.data[i] = this.data[i] - target.data[i % target.length]) ** 2;
                }
                loss /= this.length;
                out.data.set([loss]);
                return out;
            }
            if (this.allowGrad) {
                out._back = ()=>{
                    for (let i = 0; i < this.length; i++)
                        this.grad.data[i] += error.data[i] * 2;
                }
            }
        }

    }
    return out._fwd(target);
}

tensor.prototype.MAE = tensor.prototype.mae_loss = function (target) {
    const this_shape = this.shape.toReversed();
    const target_shape = target.shape.toReversed();
    if ( !target_shape.every((v, i) => v === this_shape[i] || i >= this_shape.length) )
        throw new Error(`predicted_tensor.MAE(target): ` +
            `The shape (${this.shape}) of predicted tensor mismatches the shape (${target.shape}) of target tensor`);
        let error = tensor.from(new torus.DEFAULT_TYPE(this.length))._label('mae_error');
    let out = torus.get_out(this, 'MAE');
    if (!out) {
        out = tensor.from(new torus.DEFAULT_TYPE(1))._src(this)._label('mae_loss');
        torus.set_out(this, out, 'MAE');
        if (torus.USE_GPU) {
            let wg = this.gpu_compute_info;
            let cb = new torus.ShaderBuilder(
                `// MAE`,
                `@group(0) @binding(0) var<storage, read> data: array<${this.gpuType}>;`,
                `@group(0) @binding(1) var<storage, read> tar: array<${target.gpuType}>;`,
                `@group(0) @binding(2) var<storage, read_write> error: array<${error.gpuType}>;`,
                `@compute @workgroup_size(${wg.size})`,
                `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                wg.code,
                `    error[idx] = data[idx] - tar[idx];`,
                `}`)
            let shader1 = cb.shader;
//>fwd_code
            cb = new torus.ShaderBuilder(
                `// MAE SUM`,
                `@group(0) @binding(0) var<storage, read> error: array<${error.gpuType}>;`,
                `@group(0) @binding(1) var<storage, read_write> out: array<${out.gpuType}>;`,
                `@compute @workgroup_size(1)`,
                `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                `    if (id.x > 0) {`,
                `        return;`,
                `    }`,
                `    var sum = ${out.gpuType}(0);`,
                `    for (var i = 0; i < ${error.length}; i++ ) {`,
                `        sum += abs(error[i]);`,
                `    }`,
                `    out[id.x] = sum / ${error.length}.0;`,
                `}`)
            let shader2 = cb.shader;
            out._fwd = (target) => {
                torus.compute(shader1, [this, target, error], wg.count);
                torus.compute(shader2, [error, out], [1]);
                return out;
            }
            if (this.allowGrad) {
                cb = new torus.ShaderBuilder(
                    `// MAE Back`,
                    `@group(0) @binding(0) var<storage, read> error: array<${error.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read_write> grad: array<${this.grad.gpuType}>;`,
                    `@compute @workgroup_size(${wg.size})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    wg.code,
                    `    let e = error[idx];`,
                    `    grad[idx] += select(select(-1.0, 1.0, e > 0.0), 0.0, e == 0.0);`,
                    `}`)
                let shader = cb.shader;
                out._back = ()=>{
                    torus.compute(shader, [error, this.grad], wg.count);
                }
            }
        }
        else{
            out._fwd = (target) => {
                let loss = 0;
                for (let i = 0; i < this.length; i++) {
                    loss += Math.abs(error.data[i] = this.data[i] - target.data[i % target.length]);
                }
                loss /= this.length;
                out.data.set([loss]);
                return out;
            }
            if (this.allowGrad) {
                out._back = ()=>{
                    for (let i = 0; i < this.length; i++)
                        this.grad.data[i] += Math.sign(error.data[i]);
                }
            }
        }

    }
    return out._fwd(target);
}

tensor.prototype.repeat = function (count = 1) {
    return tensor.from(Array(count).fill().map(i=>this));
}

//cross_entropy
tensor.prototype.cross_entropy = tensor.prototype.crossEntropy = function (target) {
    if (this.label !== 'softmax'){
        let result = this.softmax();
        return result.cross_entropy(target);
    }

    const key = '#crossEntropy ' + (target?.shape || target?.length || 1);
    if (this[key]) {
        if (Array.isArray(target))
            target = target.flat(Infinity);
        this[key].data.set(target.data || target);
        target = this[key];
        target.writeToGPU(true);
    }
    else
        target = this[key] = tensor.from(target);

    let out = torus.get_out(this, 'cross_entropy');
    if (!out){
        let shape = this.shape.slice(0, -1);
        if (!Object.equal(this.shape, target.shape, true)){
            if (!Object.equal(shape, target.shape, true))
                throw new Error(`cross_entropy: Expected input batch_size (${this.shape.slice(0, -2).mul()}) to match target batch_size (${this.shape.mul()})`);
        }
        out = tensor.from(new torus.DEFAULT_TYPE(this.length / this.shape.last))._src(this)._shape(shape)._label('crossEntropy');
        torus.set_out(this, out, 'cross_entropy');
        let size = this.length;
        let stride = this.length / target.length;
        if (torus.USE_GPU){
            let cb;
            let wgs = [Math.min(out.length, 256)];
            if (this.length === target.length){
                cb = new torus.ShaderBuilder(
                    `// cross_entropy`,
                    `@group(0) @binding(0) var<storage, read_write> predictions: array<${this.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read> targets: array<${target.gpuType}>;`,
                    `@group(0) @binding(2) var<storage, read_write> out: array<${out.gpuType}>;`,
                    `@compute @workgroup_size(${wgs})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    `   let idx = id.x;`,
                    `   if(idx > ${out.length-1}) {return;}`,
                    `   let start = id.x * ${this.shape.last};`,
                    `   let end = start + ${this.shape.last};`,
                    `   for (var i: u32 = start; i < end; i++){`,
                    `       let y = targets[i];`,
                    `       if(y == 1) {`,
                    `           let x = clamp(predictions[i], 1e-7, 1.0 - 1e-7);`,
                    `           predictions[i] = x - y;`,
                    `           out[idx] = -log(x);`,
                    `           break;`,
                    `       }`,
                    `   }`,
                    `}`
                )
            }
            else{
                cb = new torus.ShaderBuilder(
                    `// cross_entropy`,
                    `@group(0) @binding(0) var<storage, read_write> data: array<${this.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read> targets: array<${target.gpuType}>;`,
                    `@group(0) @binding(2) var<storage, read_write> out: array<${out.gpuType}>;`,
                    `@compute @workgroup_size(${wgs})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    `   let i = id.x;`,
                    `   if(i > ${target.length-1}) {return;}`,
                    `   let j = u32(targets[i]);`,
                    `   var idx = i * ${stride} + j;`,
                    `   let x = clamp(data[idx], 1e-7, 1.0 - 1e-7);`,
                    `   data[idx] = x - 1;`,
                    `   out[i] = -log(x);`,
                    `}`
                )
            }
            let shader = cb.shader;
            wgs[0] = Math.ceil(out.length / wgs[0]);
            out._fwd = (target)=>{
                torus.compute(shader, [this, target, out], wgs);
                return out._src(this);
            }
        }
        else{
            out._fwd = (target)=>{
                if (this.length === target.length){
                    let oidx = 0;
                    for (let i = 0; i < size; i++){
                        let y = target.data[i];
                        if(!y) continue;
                        let x = Math.min(Math.max(this.data[i], 1e-7), 1.0 - 1e-7);
                        this.data[i] = x - y;
                        out.data[oidx++] = -Math.log(x);
                    }
                }
                else {
                    let t_size = target.length;
                    for(let i = 0; i < t_size; i++){
                        let j = target.data[i];
                        let idx = i * stride + j;
                        let x = Math.min(Math.max(this.data[idx], 1e-7), 1.0 - 1e-7);
                        this.data[idx] = x - 1;
                        out.data[i] = -Math.log(x);
                    }
                }
                return out._src(this);
            }
        }
        if (this.allowGrad){
            this._back = ()=>{  // this - ПРАВИЛЬНО, т.к. _back подменяется у SOFTMAX;
                this.copyTo(this.src[0].grad);
            }
        }

    }
    return out._fwd(target);
}

if (!Array.prototype.toTensorString) {
    Object.defineProperty(Array.prototype, 'toTensorString', {
        configurable:true,
        enumerable:false,
        value (step = 0, max = 4, shape = [], dType = torus.DEFAULT_TYPE) {
            let float_type = dType.name[0] === 'F'
            function recurse(d, idx = 0, l = 0){
                let result = (idx?`\n${('  ').repeat(step)+(' ').repeat(l)}[`:'[');
                if (d[0]?.map){
                    let list = Array.from(d).map((v, i)=>{
                        return recurse(v, i, l + 1)
                    })
                    result += list.join(',');
                }
                else{
                    if (d.length > max){
                        const showing = Math.floor(max/2);
                        result += Array.from(d.slice(0, showing)).map(x=>{
                            return  num2text(x, float_type);
                        }).join(',') ;
                        result +=  `,  ...,`;
                        result +=  Array.from(d.slice(-showing)).map(x=>{
                            return num2text(x, float_type);
                        }).join(',');
                    }
                    else{
                        result += Array.from(d).map(x=>{
                            return num2text(x, float_type);
                        }).join(',') || num2text(d, float_type);
                    }
                }

                result = result + ']';
                return result;
            }
            let res = recurse(this);
            res = res.slice(1, -1);
            res = res.replaceAll(']],', ']],\n')
            return res;
        }
    } )
}
// let max = 8;


function num2text(x, float_type = false, text_max = 8) {
    x = Number(x);    // Для получения строки из значений BigInt64Array и BigUint64Array необходимо явное преобразование в Number
    let num = ' '.repeat(Math.sign(x)===-1 ? 1: 2);
    if (!Number.isFinite(x)) {
        num += x.toString();
        num = num.substring(0, 5);
    }
    else {
        const x_abs = Math.abs(x);
        const showAsExponential = x_abs >= 10**(text_max-3 + (Number.isInteger(x) && !float_type)) || (x_abs < 0.01 && x!==0);
        if (showAsExponential) {
            let mantissa;
            if (x_abs >= 1e+100 || x_abs < 1e-99)
                mantissa = text_max-9 < 1? 1: text_max-9;
            else if (x_abs >= 1e+10 || x_abs < 1e-9)
                mantissa = text_max-8 < 1? 1: text_max-8;
            else
                mantissa = text_max-7 < 1? 1: text_max-7;
            num += x.toExponential(mantissa);
            //Рассчитанная выше длина мантиссы считалась для исходного числа.
            //При этом метод toExponential перед формированием строки округляет число, что может изменить порядок числа.
            //Например, для числа 9.999999e+9 была рассчитана длина мантиссы 2, и, следовательно, ожидалась строка «9.99e+9» из семи символов.
            //Однако метод toExponential округляет число и выдаёт строку «1.00e+10» длинной восемь символов,
            //т.к. в порядке стало две цифры, а длина мантиссы рассчитывалась для одной цифры.
            //Ещё пример, для числа 9.999999e-10 была рассчитана длина мантиссы 1, и, следовательно, ожидалась строка «9.9e-10» из семи символов.
            //Однако метод toExponential округляет число и выдаёт строку «1.0e-9» длинной шесть символов,
            //т.к. в порядке оказалась одна цифра, а длина мантиссы рассчитывалась для двух цифр.
            //При выводе многомерных тензоров разная длина чисел будет ломать стройный вид столбцов.
            //Следующие пять строчек кода устраняют этот недостаток.
            if (num.length < text_max )   //Если длина строки меньше заданной увеличиваем количество цифр в мантиссе
                num = num.replace('e','0e');
            else
                if (num.length > text_max && mantissa > 1)   //Если длина строки больше заданной и есть куда сжимать мантиссу
                    num = num.replace('0e','e');
            //Ещё пример, для числа 0.00999999 была рассчитана длина мантиссы 2, и, следовательно, ожидалась строка «9.99e-3».
            //Однако метод toExponential округляет число и выдаёт строку «1.00e-2». На мой взгляд, это число выглядит приятней в виде «0.01000».
            //Следующие две строчки кода устраняют этот недостаток.
            if (num.slice(-3) === "e-2")
                num = (num.slice(0, 2) + '0.01').padEnd(text_max, '0')
        }
        else {
            if (Number.isInteger(x)) {
                num += x.toString();
                if (float_type)
                    num += '.';
            }
            else{
                const precision = text_max - 3 - (x_abs < 1) - (x_abs < .1);
                num += x.toPrecision(precision).replace(/(\.0+)$/,'.');
                if (!num.includes('.'))   // метод toPrecision отбрасывает десятичную точку в конце числа и оно выглядит как целое
                    num += '.';
            }
        }
    }
    return num.padStart(text_max, ' ');
}

function genId(){
    return ++tensor._id;
}
tensor._id = 0;
tensor.cos_similar = (A, B) => {
    if (A && B) {
        A = A.data || A;
        B = B.data || B;
        let scalar = 0;
        let avgA = 0;
        let avgB = 0;
        let a, b
        let i = A.length;
        while (i--){
            a = A[i];
            b = B[i];
            scalar += a * b;
            avgA += a * a;
            avgB += b * b;
        }
        if(scalar){
            avgA = Math.sqrt(avgA);
            avgB = Math.sqrt(avgB);
            scalar /= avgA * avgB;
            return scalar;//Math.abs(scalar);
        }
    }
    return 0;
}

tensor.rearrange = (expr, src)=>{
    //todo
}
tensor.reduce = (expr, src, agg_func = 'max')=>{
    //todo
}
tensor.repeat = (expr, src, vars = {})=>{
    //todo
}
tensor.pack = (expr, inputs)=>{
    //todo
}
tensor.unpack = (expr, inputs)=>{
    //todo
}

torus.STEP = 0;
systems:{
    torus.get_broadcast_shapes = (...tensors)=>{
        return tensors.reduce((r, t, n)=>{
            t.shape.toReversed().forEach((d, i)=>{
                let d_r = r[i] ??= d;
                if (d_r !== d){
                    if (d_r !== 1 && d !== 1)
                        throw new Error(`Broadcast error for tensor ${n} `);
                    r[i] = Math.max(d, d_r);
                }
            })
            return r;
        },[]).toReversed();
    }
    torus.get_out = function (place, key = 'out' ){
        if (Array.isArray(place)){
            place = place.find(p=>p.OUTS);
        }
        return place?.OUTS?.[key];
    }
    torus.set_out = function (place, out, key = 'out'){
        if (Array.isArray(place)){
            place = place.find(p=>p.OUTS);
        }
        if(place?.OUTS && out){
            out.OUTS ??= Object.create(null);
            place.OUTS[key] = out;
        }

    }

    torus.compare_shapes = (...tensors)=>{
        tensors = torus.flat(tensors);
        const shapes = tensors.filter(Boolean).map(t=>t.shape.toReversed());
        if (shapes.length > 1) {
            const max_dim = shapes.reduce((res, shape)=>{
                return Math.max(res, shape.length);
            }, 0);
            const max_shape = Array(max_dim).fill(1);
            shapes.forEach((shape, idx)=>{
                shape.forEach((dim, i)=>{
                    if (dim === 1) return;
                    if (max_shape[i] === 1)
                        max_shape[i] = dim;
                    else
                        if (dim !== max_shape[i]) {
                            //Для выдачи подробной ошибки необходимо найти с кем конкретно конфликтует текущий тензор
                            for (let j=0; j<shapes.length; j++)
                                if (shapes[j][i] && shapes[j][i]!==1 && shapes[j][i]!==dim)
                                    throw new Error(`compare_shapes(): ` +
                                        `The shape (${shapes[j].toReversed()}) of tensor ${j} mismatches the shape (${shape.toReversed()}) of tensor ${idx} ` +
                                        `at non-singleton dimension`);
                        }
                });
            });
        }
        return shapes.map(shape=>shape.mul() || 1);
    }
    torus.compare_shapes_strict = (...tensors)=>{
        tensors = torus.flat(tensors);
        const shapes = tensors.filter(Boolean).map(tensor => tensor.shape.length? tensor.shape: [1]);   // Учитываем, что скаляры имеют 'пустую' форму []
        if (shapes.length > 1) {
            const reference_shape = shapes[0];
            const reference_dim = reference_shape.length;
            shapes.forEach((shape, idx)=>{
                if (shape.length !== reference_dim || shape.some((dim, i) => dim !== reference_shape[i]))
                    throw new Error(`compare_shapes_strict(): Tensor ${idx} has shape (${shape}) ` +
                                    `that mismatches the shape (${reference_shape}) of tensor 0`);
            });
        }
        return shapes[0]?.mul() || 1;
    }    
    torus.compare_shapes_except_dim = (tensors, dim)=>{
        tensors = torus.flat(tensors);
        const shapes = tensors.map(tensor => tensor.shape.length? tensor.shape: [1]);   // Учитываем, что скаляры имеют 'пустую' форму []
        const reference_shape = [...shapes[0]];
        if (shapes.length > 1) {
            dim = tensors[0].check_dim(dim);
            const reference_dim = reference_shape.length;
            reference_shape[dim] = shapes.reduce((r, shape, idx)=>{
                    if (shape.length !== reference_dim)
                        throw new Error(`compare_shapes_except_dim(dim=${dim}): Tensor ${idx} has shape ${shape.length}-D ` +
                                        `that mismatches the shape ${reference_dim}-D of tensor 0`);
                    if (shape.some((d, i) => d !== reference_shape[i] && i !== dim) )
                        throw new Error(`compare_shapes_except_dim(dim=${dim}): Tensor ${idx} has shape (${shape}) ` +
                                        `that mismatches the shape (${reference_shape}) of tensor 0`);
                    return r + shape[dim];
            }, 0);
        }
        return reference_shape;
    }    

    torus._shapes_are_equal = (...tensors)=>{
        tensors = torus.flat(tensors);
        const shapes = tensors.filter(Boolean).map(t=>t.shape);
        if (shapes.length > 1) {
            const reference_shape = shapes[0];
            const reference_dim = reference_shape.length;
            return shapes.every((shape) => shape.length === reference_dim && shape.every((dim, i) => dim === reference_shape[i]) );
        }
        return true;
    }
    torus._shapes_are_equal_except_dims = (tensors, dims)=>{
        tensors = torus.flat(tensors);
        const shapes = tensors.map(tensor => tensor.shape.length? tensor.shape: [1]);   // учитываем, что скаляры имеют 'пустую' форму []
        if (shapes.length > 1) {
            const reference_shape = shapes[0];
            const reference_dim = reference_shape.length;
            dims = dims.map(dim => dim<0? dim + reference_shape.length: dim);
            return shapes.every((shape) => shape.length === reference_dim && shape.every((dim, i) => dim === reference_shape[i] || dims.includes(i)) );
        }
        return true;
    }
    torus._check_list_of_tensors = (...tensors)=>{
        tensors = torus.flat(tensors);
        if (tensors.length === 0 || tensors.length === 1 && tensors[0] === undefined)
            throw new Error(`_check_list_of_tensors(): expected a non-empty TensorList`);
        const idx = tensors.findIndex(t => t?.constructor.name !== 'tensor');
        if (idx !== -1)
            throw new Error(`_check_list_of_tensors(): expected Tensor as element ${idx} in TensorList, but got ${tensors[idx]?.constructor.name||tensors[idx]}`);
        return tensors;
    }
    tensor.prototype.check_dim = function (dim, extendable = false){  // extendable = false -- для текущего числа измерений, true -- предполагается увеличение числа измерений
        if (!Number.isInteger(dim))
            throw new Error(`tensor.check_dim((dim = ${dim}): argument 'dim' must be Integer, but got ${typeof dim === 'number'? dim: dim?.constructor.name||dim}`);
        const tensor_dim = this.dim + Number(extendable);
        if (dim < -tensor_dim || dim >= tensor_dim)
            throw new Error(`tensor.check_dim((dim = ${dim}): dimension out of range (expected to be in range of [-${tensor_dim}, ${tensor_dim - 1}], but got ${dim})`);
        if (dim < 0)
            dim += tensor_dim;
        return dim;
    }
    tensor.prototype.check_shape = function (...shape) {   // shape or tensor
        shape = torus.flat(shape);
        if (Object.equal(shape[0]?.constructor, tensor))
            shape = shape[0].shape;
        else {    //Проверяем наличие осей с неизвестным размером
            const known_axes = shape.filter((v)=> v!==-1);
            if (shape.length - known_axes.length !== 0)   //Если существуют оси с неизвестным размером
                if (shape.length - known_axes.length === 1)    //Если такая ось единственная, рассчитываем размер оси
                    shape[shape.indexOf(-1)] = this.length / (known_axes.mul() || 1);
                else    //Если неизвестны несколько осей
                    throw new Error(`tensor.check_shape(${shape}): only one dimension can be inferred`);
        }
        if (shape.some((v)=> !Number.isInteger(v) || v<0))
            throw new Error(`tensor.check_shape(${shape}): dimensions must be positive integer`);
        const size = shape.mul() || 1;
        if (size !== this.length)
            throw new Error(`tensor.check_shape(${shape}): convert (${this.shape}) to (${shape}) not allow`);
        return shape;
    }
    torus.async = (handler)=>{
        return new Promise(resolve=>{
            setTimeout(()=>{
                handler();
                resolve()
            })
        })
    }
    tensor.prototype.gen_chars = function(dims = []){
        dims = torus.flat(dims);
        let chars = this.shape.map((_, i)=>{
            return String.fromCharCode(i + 97);
        }).toReversed();
        if(dims.length){
            dims = dims.map(d=>{
                return this.check_dim(d);
            })
            chars = chars.map((ch,d)=>{
                if(dims.includes(d))
                    return ch;

            }).filter(Boolean)
        }
        return chars;
    }
    Object.defineProperty(tensor.prototype, 'shape_info', {
        configurable: true,
        get(){
            return this['#shape_info'] ??= (()=>{
                let stride, c, m = 1;
                return this.shape.toReversed().map((size, idx)=>{
                    stride = m;
                    m *= size;
                    let char = String.fromCharCode(idx + 97);
                    idx = this.dim - idx - 1;
                    return {stride, size, char, idx};
                }).toReversed();
            })()
        }
    })
    Object.defineProperty(tensor.prototype, 'strides', {
        configurable: true,
        get(){
            let m = 1;
            return this.shape.toReversed().map((dim)=>{
                let s = m;
                m *= dim;
                return s;
            }).toReversed();
        }
    })
    tensor.prototype.dim_info = function(...dim){
        let dims = torus.flat(dim).filter(v => v || v === 0);
        let shape_info = this.shape_info;
        if (dims.length){
            shape_info = dims.reduce((r, d, idx)=>{
                idx = this.check_dim(d);
                let v = shape_info[idx];
                if (v)
                    r.add(v)
                return r
            }, []).sort((a,b)=>{
                return a.idx<b.idx?-1:1
            })
        }
        if(dim.length === 1 && !dim[0].length){
            shape_info = shape_info[0]
        }
        return shape_info;
    }
    tensor.prototype.fill_ = function(value_or_handler = 0) {
        if (typeof value_or_handler === 'function') {
            const tmp = this.data.map(value_or_handler);
            this.data.set(tmp);
            tmp.buffer.transfer(0);
        }
        else
            this.data.fill(value_or_handler);
        return this;
    }
    torus.fill = (shape, value_or_handler, $ = {}) => {
        $ = torus.$($)
        shape = torus.flat(shape);
        const size = shape.mul() || 1;
        let out =  tensor.from(new torus.DEFAULT_TYPE(size))._shape(shape)._label(torus.label_from_error());
        return out.fill_(value_or_handler);
    }
    // _element_wise
    torus._element_wise = function ($ = {forward: '', forwardGPU: '', backward: '', backwardGPU: '', label: ''}, other){
        let key = $.forward + ': ' + (other?.shape? `(${other.shape})`: (other ?? '-')); 
        let out = torus.get_out(this, key);
        if (!out){
            let shape = this.shape;
            let src = [this];
            if (other?.shape) {  //other -- tensor
                src.push(other);
                shape = torus.get_broadcast_shapes(this, other);
            }
            out = tensor.from(new torus.DEFAULT_TYPE(shape.mul() || 1))._shape(shape)._src(src);
            torus.set_out(this, out, key);
            let out_info = out.shape_info.filter(dim_info => dim_info.size !== 1);   //Оси с длинной 1 в формировании реального индекса не участвуют
            let this_info = this.shape_info.filter(dim_info => dim_info.size !== 1);
            let other_info = other?.shape_info?.filter(dim_info => dim_info.size !== 1);
            if(other && other?.length>1 && this.length>1 && !torus._shapes_are_equal(this, other)) { // Если необходимо для каждого операнда рассчитывать собственный индекс выборки, пытаемся объединить подходящие оси
                const squeeze = (tensor_info) => {
                    tensor_info = structuredClone(tensor_info);
                    let squeeze_axes1 = tensor_info.filter(d_info => {   // Старшие оси - претенденты на объединение
                        return d_info.char.charCodeAt(0) > this_info[0].char.charCodeAt(0) || d_info.char.charCodeAt(0) > other_info[0].char.charCodeAt(0);
                    });
                    let squeeze_axes2 = tensor_info.filter(d_info => {   // Внутренние оси - претенденты на объединение
                        return this_info.some(di => d_info.char === di.char) && other_info.some(di => d_info.char === di.char);
                    });
                    [squeeze_axes1, squeeze_axes2].forEach(squeeze_axes => {
                        for (let i = 0; i <= squeeze_axes.length-2; i++) { // Объединяем соседние оси, чтобы не рассчитывать лишние индексы
                            if (squeeze_axes[i+1].idx - squeeze_axes[i].idx === 1 ) {
                                let info_0 = tensor_info.find(v => v.idx === squeeze_axes[i].idx);
                                let info_1 = tensor_info.find(v => v.idx === squeeze_axes[i+1].idx);
                                info_1.size *= info_0.size;
                                info_1.char += info_0.char;
                                tensor_info = tensor_info.filter(v => v.idx !== squeeze_axes[i].idx);
                            }
                        }
                    });
                    return tensor_info;
                }
                out_info = squeeze(out_info);
                let this_info_tmp = squeeze(this_info);
                other_info = squeeze(other_info);
                this_info = this_info_tmp;
            }
            if (Number.isFinite(other)) {   // Если второй операнд является числом, вставляем его напрямую в расчётные формулы
                $ = structuredClone($);
                if (Number.isInteger(other))
                    other = other + '.';
                $.forwardGPU = $.forwardGPU.replaceAll('x1', other);
                if ($.backwardGPU_0)
                    $.backwardGPU_0 = $.backwardGPU_0.replaceAll('x1', other);
                if ($.backwardGPU)
                    $.backwardGPU = $.backwardGPU.replaceAll('x1', other);
                $.forward = $.forward.replace(/, *x1/, '').replaceAll('x1', other);
                if ($.backward_0)
                    $.backward_0 = $.backward_0.replace(/, *x1/, '').replaceAll('x1', other);
                if ($.backward)
                    $.backward = $.backward.replace(/, *x1/, '').replaceAll('x1', other);
                other = undefined;
            }
            if (torus.USE_GPU){
                let wg = out.gpu_compute_info;
                let cb;
                if (other === undefined) {   // Если имеется только один операнд, то всё очень просто
                    cb = new torus.ShaderBuilder(
                        `// element_wise FORWARD`,
                        `@group(0) @binding(0) var<storage, read> self_data: array<${this.gpuType}>;`,
                        `@group(0) @binding(1) var<storage, read_write> out_data: array<${out.gpuType}>;`,
                        `fn calculate(x0: ${this.gpuType}) -> ${out.gpuType} {`,
                            $.forwardGPU?.split('\n').map(s => '    ' + s).join('\n'),  // Достаточно $.forwardGPU, остальное задаёт отступ тела метода
                        `}`,
                        `@compute @workgroup_size(${wg.size})`,
                        `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                        wg.code,
                            `    out_data[idx] = calculate(self_data[idx]);`,
                        `}`
                    );
                }
                else if (!other?.shape || other.length===1 || this.length===1 || torus._shapes_are_equal(this, other)) {   // Если достаточно простой линейной выборки данных 
                    cb = new torus.ShaderBuilder(
                        `// element_wise FORWARD`,
                        `@group(0) @binding(0) var<storage, read> self_data: array<${this.gpuType}>;`,
                        (other?.shape)? `@group(0) @binding(1) var<storage, read> other_data: array<${other.gpuType}>;`: '',
                        `@group(0) @binding(${src.length}) var<storage, read_write> out_data: array<${out.gpuType}>;`,
                        `fn calculate(x0: ${this.gpuType}, x1: ${other?.gpuType || out.gpuType}) -> ${out.gpuType} {`,
                            $.forwardGPU?.split('\n').map(s => '    ' + s).join('\n'),  // Достаточно $.forwardGPU, остальное задаёт отступ тела метода
                        `}`,
                        `@compute @workgroup_size(${wg.size})`,
                        `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                        wg.code,
                        `    out_data[idx] = calculate(self_data[${this.length===1? 0: 'idx'}], ${!other?.shape? other: (other.length===1? 'other_data[0]': 'other_data[idx]')});`,
                        `}`
                    );
                }
                else {  // Если необходимо для каждого операнда рассчитывать собственный индекс выборки
                    cb = new torus.ShaderBuilder(
                        `// element_wise FORWARD`,
                        `@group(0) @binding(0) var<storage, read> self_data: array<${this.gpuType}>;`,
                        `@group(0) @binding(1) var<storage, read> other_data: array<${other.gpuType}>;`,
                        `@group(0) @binding(2) var<storage, read_write> out_data: array<${out.gpuType}>;`,
                        `fn calculate(x0: ${this.gpuType}, x1: ${other.gpuType}) -> ${out.gpuType} {`,
                            $.forwardGPU?.split('\n').map(s => '    ' + s).join('\n'),  // Достаточно $.forwardGPU, остальное задаёт отступ тела метода
                        `}`,
                        `@compute @workgroup_size(${wg.size})`,
                        `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                        wg.code,
                        out_info.map(di => {
                            if (this_info.some(v=>v.char===di.char) && this.length!==out.length || other_info.some(v=>v.char===di.char) && other.length!==out.length)
                                return `    let idx_${di.char} = ${di.stride===1? `idx % ${di.size}`: `(idx / ${di.stride}) % ${di.size}`};`;
                            return [];
                        }),
                        [this_info, other_info].map((shape_info, i) => {
                            if (shape_info.length === out_info.length)
                                return `    let idx_${i} = idx;`;
                            return `    let idx_${i} = ${shape_info.map(di => di.stride === 1? `idx_${di.char}`:`idx_${di.char} * ${di.stride}`).join(' + ')};`
                        }),
                        `    out_data[idx] = calculate(self_data[idx_0], other_data[idx_1]);`,
                        `}`
                    );
                }
                let shader = cb.shader;
// >cb.code                
                out._fwd = (other)=>{
                    let src = [this];
                    if(other?.shape)
                        src.push(other);                    
                    torus.compute(shader, [...src, out], wg.count);
                    return out._src(src);
                }
                
                if (src.some(t=>t.allowGrad)) {
                    const the_same = this.data === other?.data;
                    let cb;
                    if (other === undefined) {   // Если имеется только один операнд, то всё очень просто
                        cb = new torus.ShaderBuilder(
                            `// element_wise BACK`,
                            `@group(0) @binding(0) var<storage, read> out_grad: array<${out.grad.gpuType}>;`,
                            `@group(0) @binding(1) var<storage, read> self_data: array<${this.gpuType}>;`,
                            `@group(0) @binding(2) var<storage, read_write> self_grad: array<${this.grad.gpuType}>;`,
                            `fn fn_self(x0: ${this.gpuType}) -> ${out.gpuType} {`,
                                ($.backwardGPU_0 || $.backwardGPU)?.split('\n').map(s => '    ' + s).join('\n'),  // Достаточно $.forwardGPU, остальное задаёт отступ тела метода
                            `}`,
                            `@compute @workgroup_size(${wg.size})`,
                            `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                            wg.code,
                            `    self_grad[idx] += out_grad[idx] * fn_self(self_data[idx]);`,
                            `}`
                        );
                    }
                    else if (!other?.shape || other.length===1 || this.length===1 || torus._shapes_are_equal(this, other)) {   // Если достаточно простой линейной выборки данных 
                        cb = new torus.ShaderBuilder(
                            `// element_wise BACK`,
                            `@group(0) @binding(0) var<storage, read> out_grad: array<${out.grad.gpuType}>;`,
                            `@group(0) @binding(1) var<storage, read> self_data: array<${this.gpuType}>;`,
                            (()=>{    //Объявляем буфера для данных второго параметра (если он тензор) и градиентов (если они нужны)
                                const code = [];
                                let binding_idx = 2;
                                if (this.allowGrad) {
                                    code.push(`@group(0) @binding(${binding_idx}) var<storage, read_write> self_grad: array<${this.grad.gpuType}>;`);
                                    binding_idx++;
                                }
                                if (!the_same && other?.shape) {
                                    code.push(`@group(0) @binding(${binding_idx}) var<storage, read> other_data: array<${other.gpuType}>;`);
                                    binding_idx++;
                                    if (other?.allowGrad)
                                        code.push(`@group(0) @binding(${binding_idx}) var<storage, read_write> other_grad: array<${other.grad.gpuType}>;`);
                                }
                                return code;
                            })(),
                            (this.allowGrad)? [
                                `fn fn_self(x0: ${this.gpuType}, x1: ${other?.gpuType || out.gpuType}) -> ${out.gpuType} {`,
                                    ($.backwardGPU_0 || $.backwardGPU)?.split('\n').map(s => '    ' + s).join('\n'),  // Достаточно $.forwardGPU, остальное задаёт отступ тела метода
                                `}`
                            ]: '',
                            (other?.allowGrad)? [
                                `fn fn_other(x0: ${this.gpuType}, x1: ${other?.gpuType || out.gpuType}) -> ${out.gpuType} {`,
                                    ($.backwardGPU_1 || $.backwardGPU)?.split('\n').map(s => '    ' + s).join('\n'),  // Достаточно $.forwardGPU, остальное задаёт отступ тела метода
                                `}`
                            ]: '',
                            `@compute @workgroup_size(${wg.size})`,
                            `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                            wg.code,
                            (this.allowGrad || other.length===out.length && other.allowGrad)?
                                                    `    let x0 = self_data[${this.length===1? 0: 'idx'}];`: [],
                            (()=>{
                                 if (the_same) return [];
                                 if (!(other.allowGrad || this.length===out.length && this.allowGrad)) return [];
                                 if (!other?.shape) return `    let x1 = ${out.gpuType}(${other});`;
                                 return `    let x1 = other_data[${other.length===1? 0: 'idx'}];`
                            })(),
                            (()=>{   // Рассчитываем и сохраняем градиенты
                                if (the_same)
                                    return `    self_grad[idx] += out_grad[idx] * (fn_self(x0, x0) + fn_other(x0, x0));`;
                                return [this, other].map((t, i) => {
                                    if (!t?.allowGrad) return [];
                                    let t_name = (i===0)? 'self': 'other';
                                    if (t.length === out.length)
                                        return `    ${t_name}_grad[idx] += out_grad[idx] * fn_${t_name}(x0, x1);`;
                                    return  [
                                            `    if (idx == 0) {`,
                                            `        for (var i = 0u; i < ${out.length}u; i++) {`,
                                            `            ${t_name}_grad[0] += out_grad[i] * fn_${t_name}(${i===0? 'x0, other_data[i]': 'self_data[i], x1'});`,
                                            `        }`,
                                            `    }`,
                                            ];
                                });
                            })(),
                            `}`
                        );
                    }
                    else {  // Если необходимо для каждого операнда рассчитывать собственный индекс выборки
                        const this_broadcast_axes = out_info.filter(dim_info => !this_info.some(di => dim_info.char === di.char));
                        const other_broadcast_axes = out_info.filter(dim_info => !other_info.some(di => dim_info.char === di.char));
                        const tab = '    ';
                        cb = new torus.ShaderBuilder(
                            `// element_wise BACK`,
                            `@group(0) @binding(0) var<storage, read> out_grad: array<${out.grad.gpuType}>;`,
                            `@group(0) @binding(1) var<storage, read> self_data: array<${this.gpuType}>;`,
                            (()=>{    //Объявляем буфера для данных второго параметра и градиентов (если они нужны)
                                const code = [];
                                let binding_idx = 2;
                                if (this.allowGrad) {
                                    code.push(`@group(0) @binding(${binding_idx}) var<storage, read_write> self_grad: array<${this.grad.gpuType}>;`);
                                    binding_idx++;
                                }
                                code.push(`@group(0) @binding(${binding_idx}) var<storage, read> other_data: array<${other.gpuType}>;`);
                                binding_idx++;
                                if (other.allowGrad) {
                                    code.push(`@group(0) @binding(${binding_idx}) var<storage, read_write> other_grad: array<${other.grad.gpuType}>;`);
                                }
                                return code;
                            })(),
                            (this.allowGrad)? [
                                `fn fn_self(x0: ${this.gpuType}, x1: ${other.gpuType}) -> ${out.gpuType} {`,
                                    ($.backwardGPU_0 || $.backwardGPU)?.split('\n').map(s => '    ' + s).join('\n'),  // Достаточно $.forwardGPU, остальное задаёт отступ тела метода
                                `}`
                            ]: [],
                            (other.allowGrad)? [
                                `fn fn_other(x0: ${this.gpuType}, x1: ${other.gpuType}) -> ${out.gpuType} {`,
                                    ($.backwardGPU_1 || $.backwardGPU)?.split('\n').map(s => '    ' + s).join('\n'),  // Достаточно $.forwardGPU, остальное задаёт отступ тела метода
                                `}`
                            ]: [],
                            `@compute @workgroup_size(${wg.size})`,
                            `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                            wg.code,
                            out_info.map(di => {
                                if (this_info.some(v=>v.char===di.char) && (this.length!==out.length || other.allowGrad) || 
                                            other_info.some(v=>v.char===di.char) && (other.length!==out.length || this.allowGrad))
                                    return `    let idx_${di.char} = ${di.stride===1? `idx % ${di.size}`: `(idx / ${di.stride}) % ${di.size}`};`;
                                return [];
                            }),
                            [this, other].map((t, i, tensors) => {
                                let s_info = (i===0)? this_info: other_info;
                                if (t.allowGrad || tensors[i^1].length===out.length && tensors[i^1].allowGrad)
                                    return [
                                        t.length===out.length? `    let idx_${i} = idx;`:
                                            `    let idx_${i} = ${s_info.map(di => di.stride === 1? `idx_${di.char}`:`idx_${di.char} * ${di.stride}`).join(' + ')};`,
                                        `    let x${i} = ${i===0? 'self': 'other'}_data[idx_${i}];`
                                    ];
                                return [];
                            }),
                            (this.length===out.length && this.allowGrad || other.length===out.length && other.allowGrad)? `    let grad = out_grad[idx];`: [],
                            [this, other].map((t, i, tensors) => {
                                if (!t.allowGrad) return [];
                                let t_name = (i===0)? 'self': 'other';
                                if (t.length === out.length)
                                    return `    ${t_name}_grad[idx_${i}] += grad * fn_${t_name}(x0, x1);`;
                                let broadcast_axes = (i===0)? this_broadcast_axes: other_broadcast_axes;
                                const out_not_broadcast_axes = out_info.filter(dim_info => !broadcast_axes.some(di => dim_info.char === di.char));
                                let s_info = [this_info, other_info];
                                let tabs = tab.repeat(broadcast_axes.length + 2);
                                let out_start_idx_code = out_not_broadcast_axes.map(di => `idx_${di.char} ${di.stride > 1? `* ${di.stride}`: ''}`).join(' + ');
                                let input_crossing_axes = s_info[i^1].filter(d0 => s_info[i].some(d1 => d0.char === d1.char));
                                let in_start_idx_code = input_crossing_axes.map(di => `idx_${di.char} ${di.stride > 1? `* ${di.stride}`: ''}`).join(' + ');
                                return [
                                    `    if (${broadcast_axes.map(di => `idx_${di.char} == 0`).join(' && ')}) {`,
                                    broadcast_axes.map((di, j, d_info) => [
                                        tab.repeat(j+2) + `var idx_o_${di.char} = ${j===0? out_start_idx_code: `idx_o_${d_info[j-1].char}`};`,
                                        tab.repeat(j+2) + (() => {
                                            if (tensors[i^1].length === out.length) return '';
                                            return `var idx_i_${di.char} = ${(j===0? (input_crossing_axes.length? in_start_idx_code: 0): `idx_i_${d_info[j-1].char}`)};`;
                                        })(),
                                        tab.repeat(j+2) + `for (var idx_${di.char} = 0u; idx_${di.char} < ${di.size}; idx_${di.char}++) {`,
                                    ]),
                                    (() => {
                                        const idx_i_name = (tensors[i^1].length === out.length)? `idx_o_${broadcast_axes.last.char}`: `idx_i_${broadcast_axes.last.char}`;
                                        return tabs + `${t_name}_grad[idx_${i}] += out_grad[idx_o_${broadcast_axes.last.char}] * fn_${t_name}(${i===0? `x0, other_data[${idx_i_name}]`: `self_data[${idx_i_name}], x1`});`;
                                    })(),
                                    broadcast_axes.map((di, j, d_info) => [
                                        tab.repeat(j+3) + `idx_o_${di.char} += ${out_info.find(inf => inf.char === di.char).stride};`,
                                        tab.repeat(j+3) + (tensors[i^1].length===out.length? '' : `idx_i_${di.char} += ${s_info[i^1].find(inf => inf.char === di.char).stride};`),
                                        tab.repeat(j+2) + `}`
                                    ]).reverse(),
                                    `    }`
                                ];
                            }),
                            `}`
                        );
                    }
                    let shader = cb.shader;
// >cb.code
                    out._back = ()=>{
                        const tensors = [];
                        if (this.allowGrad)
                            tensors.push(this.grad);
                        if (!the_same && other?.shape) {
                            tensors.push(other);
                            if (other.allowGrad)
                                tensors.push(other.grad);
                        }
                        torus.compute(shader, [out.grad, this, ...tensors], wg.count);
                    }
                }
            }
            else{
                let cb;
                if (other === undefined) {   // Если имеется только один операнд, то всё очень просто
                    cb = new torus.CodeBuilder(
                        `// element_wise FORWARD`,
                        `const self_data = self.data;`,
                        `const out_data = out.data;`,
                        `const fn = ${$.forward};`,
                        `for (let idx = 0; idx < ${out.length}; idx++){`,
                        `    out_data[idx] = fn(self_data[idx]);`,
                        `}`
                    );
                }
                else if (!other?.shape || other.length===1 || this.length===1 || torus._shapes_are_equal(this, other)) {   // Если достаточно простой линейной выборки данных 
                    cb = new torus.CodeBuilder(
                        `// element_wise FORWARD`,
                        `const self_data = ${this.length === 1? `self.data[0]`: `self.data`};`,
                        `const other_data = ${!other?.shape? `other`: (other.length === 1? `other.data[0]`: `other.data`)};`,
                        `const out_data = out.data;`,
                        `const fn = ${$.forward};`,
                        `for (let idx = 0; idx < ${out.length}; idx++){`,
                        `    out_data[idx] = fn(self_data${this.length > 1? `[idx]`: ''}, other_data${other?.length > 1? `[idx]`: ''});`,
                        `}`
                    );
                }
                else {  // Если необходимо для каждого операнда рассчитывать собственный индекс выборки
                    cb = new torus.CodeBuilder(
                        `// element_wise FORWARD`,
                        `const self_data = self.data;`,
                        `const other_data = other.data;`,
                        `const out_data = out.data;`,
                        `const fn = ${$.forward};`,
                        `for (let idx = 0; idx < ${out.length}; idx++){`,
                        out_info.map(di => {
                            if (this_info.some(v=>v.char===di.char) && this.length!==out.length || other_info.some(v=>v.char===di.char) && other.length!==out.length)
                                return `    const idx_${di.char} = ${di.stride===1? `idx % ${di.size}`: `Math.trunc(idx / ${di.stride}) % ${di.size}`};`;
                            return '';
                        }),
                        [this_info, other_info].map((shape_info, i) => {
                            if (shape_info.length === out_info.length)
                                return  `    const idx_${i} = idx;`;
                            return `    const idx_${i} = ${shape_info.map(di => di.stride === 1? `idx_${di.char}`:`idx_${di.char} * ${di.stride}`).join(' + ')};`
                        }),
                        `    out_data[idx] = fn(self_data[idx_0], other_data[idx_1]);`,
                        `}`
                    );
                }
// >cb.code
                let fn = new Function('out', 'self', 'other', cb.code);
                out._fwd = (other)=>{
                    let src = [this];
                    if(other?.shape)
                        src.push(other);
                    fn(out, this, other);
                    return out._src(src);
                }
                if (src.some(t=>t.allowGrad)) {
                    let cb;
                    if (other === undefined) {   // Если имеется только один операнд, то всё очень просто
                        cb = new torus.CodeBuilder(
                            `// element_wise BACK`,
                            `const self_data = self.data;`,
                            `const self_grad = self.grad.data;`,
                            `const out_grad = out.grad.data;`,
                            `const fn_self = ${$.backward_0 || $.backward};`,
                            `for (let idx = 0; idx < ${out.grad.length}; idx++){`,
                            `    self_grad[idx] += out_grad[idx] * fn_self(self_data[idx]);`,
                            `}`
                        );
                    }
                    else if (!other?.shape || other.length===1 || this.length===1 || torus._shapes_are_equal(this, other)) {   // Если достаточно простой линейной выборки данных 
                        cb = new torus.CodeBuilder(
                            `// element_wise BACK`,
                            (this.length === 1)? `const x0 = self.data[0];`:
                                                 `const self_data = self.data;`,
                            (this.allowGrad)? `const self_grad = self.grad.data;`: '',
                            (!other?.shape)? `const x1 = other;`: (other.length === 1? `const x1 = other.data[0];`: `const other_data = other.data;`),
                            (other?.allowGrad)? `const other_grad = other.grad.data;`: '',
                            `const out_grad = out.grad.data;`,
                            (this.allowGrad)? `const fn_self = ${$.backward_0 || $.backward};`: '',
                            (other?.allowGrad)? `const fn_other = ${$.backward_1 || $.backward};`: '',
                            `for (let idx = 0; idx < ${out.grad.length}; idx++){`,
                            `    const grad = out_grad[idx];`,
                            (this.length > 1)? `    const x0 = self_data[idx];`: '',
                            (other?.length > 1)? `    const x1 = other_data[idx];`: '',
                            (this.allowGrad)? `    self_grad[${this.length > 1? `idx`: 0}] += grad * fn_self(x0, x1);`: '',
                            (other?.allowGrad)? `    other_grad[${other.length > 1? `idx`: 0}] += grad * fn_other(x0, x1);`: '',
                            `}`
                         );
                    }
                    else {  // Если необходимо для каждого операнда рассчитывать собственный индекс выборки
                        cb = new torus.CodeBuilder(
                            `// element_wise BACK`,
                            `const self_data = self.data;`,
                            (this.allowGrad)? `const self_grad = self.grad.data;`: '',
                            `const other_data = other.data;`,
                             (other?.allowGrad)? `const other_grad = other.grad.data;`: '',
                            `const out_grad = out.grad.data;`,
                            (this.allowGrad)? `const fn_self = ${$.backward_0 || $.backward};`: '',
                            (other?.allowGrad)? `const fn_other = ${$.backward_1 || $.backward};`: '',
                            `for (let idx = 0; idx < ${out.grad.length}; idx++){`,
                            out_info.map(di => {
                                if (this_info.some(v=>v.char===di.char) && this.length!==out.length || other_info.some(v=>v.char===di.char) && other.length!==out.length)
                                    return `    const idx_${di.char} = ${di.stride===1? `idx % ${di.size}`: `Math.trunc(idx / ${di.stride}) % ${di.size}`};`;
                                return '';
                            }),
                            [this_info, other_info].map((shape_info, i) => {
                                if (shape_info.length === out_info.length)
                                    return `    const idx_${i} = idx;`;
                                return `    const idx_${i} = ${shape_info.map(di => di.stride === 1? `idx_${di.char}`:`idx_${di.char} * ${di.stride}`).join(' + ')};`
                            }),
                            `    const grad = out_grad[idx];`,
                            `    const x0 = self_data[idx_0];`,
                            `    const x1 = other_data[idx_1];`,
                            (this.allowGrad)? `    self_grad[idx_0] += grad * fn_self(x0, x1);`: '',
                            (other?.allowGrad)? `    other_grad[idx_1] += grad * fn_other(x0, x1);`: '',
                            `}`
                        );
                    }
// >cb.code
                    src.forEach(t => {if (t.allowGrad) t.grad});    // Эта строка нужна только для отладки, точнее для детального сравнения режимов CPU и GPU.
                                                                    // Создание градиентных тензоров переносится на прямой проход как в GPU.
                    let back_fn = new Function('out', 'self', 'other', cb.code);
                    out._back = ()=>{
                        return back_fn(out, this, out.src[1] || other);
                    }
                }
            }
        }
        return out._fwd(other);
    }
}
tensor.prototype.size = function (dim){
    if (dim === undefined)
        return this.shape;
    dim = this.check_dim(dim);
    return this.shape[dim];
}
einops:{
    //einsum
    torus.parseEinsumFormula = function (formula, tensors) {
        let [inputTerms, secondPart] = formula.split('->');
        let inputs = inputTerms.split(',');
        inputs = inputs.map(term=>{
            term = term.trim();
            term = term.replace(/\.\.+/g, '.');
            return term.split('');
        });

        let [outputTerm, varsPart] = secondPart ? secondPart.split(':').map(term=>term.trim()) : [];
        if (!outputTerm)
            outputTerm = '';
        outputTerm = outputTerm.trim();
        outputTerm = outputTerm.replace(/\.\.+/g,'.');

        let outputs = outputTerm.split('');
        const vars = varsPart ? varsPart.trim().split(',').reduce((r, v)=>{
            v = v.trim().split('=');
            r[v[0].trim()] = +v[1].trim();
            return r;
        }, Object.create(null)): Object.create(null);

        const varsIndices = Object.keys(vars);
        let all = inputs.flat().reduce((r,idx)=>{
            if (idx !== '.' && !r.includes(idx))
                r.add(idx);
            return r;
        }, []);

        //проверки

        if (!inputs.length)
            throw new Error(`The expression "${formula}" must contain at least one input tensor.`);
        let dots = [];
        inputs = inputs.map((input, i)=>{
            let uniq = input.reduce((r, idx, j)=>{
                if (idx === '.' && j)
                    throw new Error(`Input #${i+1} in expression "${formula}" must use mask "..." only before other indices.`);
                if (r.includes(idx))
                    throw new Error(`Input #${i+1} in expression "${formula}" contains a repeating index "${idx}".`);
                r.push(idx);
                return r;
            }, []);
            let tensor = tensors[i];
            let shape_info = tensor.shape_info.toReversed();
            dots[i] = [];
            input = input.toReversed();
            input = shape_info.map((info, d)=>{
                let idx = input[d];
                if (!idx || idx === '.') {
                    if (input[input.length-1] !== '.')
                        throw new Error(`Input #${i+1} in expression "${formula}" must match the dimension of the tensor.`);
                    for (let c = 97; c<255; c++ ) {
                        idx = String.fromCharCode(c);
                        if(!all.includes(idx) && !dots[i].includes(idx))
                            break;
                    }
                    dots[i].push(idx);
                }
                return {input: i, idx, size: info.size, stride: info.stride, };
            });
            return input.toReversed();
        });
        dots = dots.flat().unique();
        all.push(...dots);
        let flat_inputs = inputs.flat();
        flat_inputs.forEach((axis, i)=>{
            let idx = axis.idx;
            let output = outputs.indexOf(idx);
            if (output>-1)
                axis.output = output;
            let size;
            let flat_idx = flat_inputs.filter(a=>a.idx === idx);
            let max = Math.max(...flat_idx.map(a=>a.size));
            flat_idx.forEach(a=>{
                if (!size)
                    size = a.size
                if (a.size === 1){
                    a.broadcast = true;
                    return;
                }
                if (a.size < max) {
                    a.drop = true;
                }
            })
            if (flat_idx.filter(a=>a.drop).length>1)
                throw new Error(`Input #${i+1} in expression "${formula}" to many drops (${flat_idx.filter(a=>a.drop).length}) for  index "${idx}".`)
        })
        outputs.forEach((idx, i)=>{
            if (i === 0){
                if (idx === '.'){
                    outputs.shift();
                    if (dots.length)
                        outputs.unshift(...dots.toReversed());
                    return;
                }
            }

            if (!all.includes(idx) && !varsIndices.includes(idx) && !dots.includes(idx))
                throw new Error(`Output index "${idx}" in expression "${formula}" must be alsow define in inputs or variables.`);
            if (idx === '.')
                throw new Error(`Output in expression "${formula}" must use mask "..." only before other indices.`);
        })
        varsIndices.forEach(idx=>{
            if (!outputs.includes(idx))
                throw new Error(`Variable index "${idx}" in expression "${formula}" must be define in output.`);
            if (inputs.flat().includes(idx))
                throw new Error(`Variable index "${idx}" in expression "${formula}" contains index already used in inputs.`);
            all.add(idx);
        })

        let stride, m = 1;
        outputs = outputs.toReversed().map(idx=>{
            all.splice(all.indexOf(idx), 1);
            all.unshift(idx);
            stride = m;

            let size = vars[idx];
            if (!size) {
                size = flat_inputs.filter(axis=>axis.idx === idx).sort((a,b)=>{
                    if (a.size === 1)
                        return 1;
                    if (b.size === 1)
                        return -1;
                    return a.size-b.size;
                });
                size = size[0]?.size;
            }
            m *= size;
            return  {idx, size, stride};
        }).toReversed();

        let model = {
            all,
            inputs,
            outputs,
            vars
        }
        //      >model
        return model;
    }
//gg
    torus.einsum = function (expression, tensors = [], $ = {}) {
        tensors = torus.flat(tensors).map(t=>tensor.from(t));
        let key = expression + ': ' + tensors.map(t=>t.shape.toString()).join(',');
        let out = torus.get_out(tensors, key);
        if (!out) {
            $ = Object.assign({grad: undefined, spike_level: undefined}, $);
            const model = torus.parseEinsumFormula(expression, tensors, $.allow_drop);

            let shape  = model.outputs.map(s=>s.size);
            if($.grad)
                out = $.grad;
            else
                out = tensor.from(new torus.DEFAULT_TYPE(shape.mul() || 1))._src(tensors)._label(`einsum('${expression}')`)._shape(shape);
            torus.set_out(tensors, out, key);

            const common_code = (for_gpu = false, back = false)=>{
                let conv_indices  = model.inputs.flat().reduce((r, a)=>{
                    if (!r[a.idx]) {
                        r[a.idx] = [];
                    }
                    r[a.idx].push(a);
                    return r;
                }, {});
                let conv_keys = Object.keys(conv_indices);
                let for_counter = 0;
                return new torus.CodeBuilder(
                    !model.outputs.length?`var sum = ${for_gpu?(out.gpuType+'(0)'):'0.0'};`:'',
                    model.all.map((idx, i) =>{
                        let before = model.all.filter((a, j)=> j <= i);
                        let tab = '    '.repeat(i);
                        let output = model.outputs.find(a=>a.idx === idx);
                        let end_outs = model.outputs.length === before.length;
                        let inputs = model.inputs.filter(input => input.some(a => a.idx === idx));
                        let axis = [...(conv_indices[idx] || [])];
                        if(model.vars[idx]){
                            axis.push({size: model.vars[idx], idx: output.idx, stride: output.stride})
                        }
                        let max = Math.max(...axis.map(a => a.size));
                        let min = Math.min(...axis.map(a => a.size));
                        let axis_indices = axis.map(a => {
                            let s;
                            let idxi = a.idx + (a.input ?? '');
                            if (a.size === 1) {
                                s = tab + `let idx_${idxi} = ${a.broadcast?'0':(a.idx + (a.stride > 1?' * ' + a.stride:''))}${for_gpu?'u':''};`;
                                if(a.broadcast)
                                    return {broadcast: a.broadcast, s};
                                return s;
                            }
                            // else if(max === min || a.drop) {
                                return tab + `    let idx_${idxi} = ${a.idx + (a.stride > 1? ' * ' + a.stride:'')};`;
                            // }
                            // else
                            //     return tab + `    let idx_${idxi} = (start_${a.idx} + ${a.idx}) % ${max + (a.stride > 1?' * ' + a.stride:'')};`;

                        });
                        return [
                            axis_indices.filter(a=>a.broadcast).map(a=>a.s),
                            axis.filter(a=>a.drop).map(a=>{
                                let outs = model.inputs[a.input].filter(a=>a.output !== undefined)
                                outs = outs.map(o=>{
                                    return o.idx + ` * `+ o.stride;
                                }).join(' + ') || 0;
                                return [
                                    tab + `let start_${a.idx} = out_idx % ${max};`,
                                ]
                            }),
                            (()=>{
                                if((!for_gpu || !output)){
                                    for_counter++;
                                    return (tab + `for (var ${idx} = 0${for_gpu?'u':''}; ${idx} < ${max}${for_gpu?'u':''}; ${idx}++) {`)
                                }
                                return '';
                            })(),
                            output?(tab + `    let out_${idx} = ${idx + (output.stride > 1?' * ' + output.stride:'')};`):'',
                            axis_indices.filter(a=>!a.broadcast),
                            end_outs?(tab +`    let out_idx = ${model.outputs.map(o => `out_` + o.idx).join(' + ')};`):'' ,




                            inputs.filter(input=>input.every(a=>before.includes(a.idx))).filter(Boolean).map(input=>{
                                let t_idx = model.inputs.indexOf(input);
                                let res = [
                                    tab + `    let val_${t_idx} = data_${t_idx}[${input.map(a=>'idx_' + a.idx + t_idx).join(' + ')}];`,
                                    tab + `    if (val_${t_idx} == 0) {${(for_gpu && !for_counter)? 'return': 'continue'};}`
                                ];
                                return res;
                            }),
                            (()=>{
                                if(end_outs){
                                    return [(Number.isFinite($.spike_level))?[
                                            tab + `    if (out_data[out_idx] > ${$.spike_level}) {`,
                                            tab + `       out_data[out_idx] = ${out.gpuType}(0);`,
                                            tab + `       ${(for_gpu && !for_counter)? 'return': 'continue'};`,
                                            tab + `    }`]
                                        :'',
                                        tab + `    var sum = ${for_gpu? (out.gpuType+'(0)'): '0.0'};`]
                                }
                            })(),

                        ]
                    }),
                    (()=>{
                        return '    '.repeat(model.all.length) + `sum += ${model.inputs.map((_,i) => `val_`+i).join(' * ')};`;
                    })(),
                    model.all.map((idx, i)=>{
                        let before = model.all.filter((a, j)=> j <= i);
                        let tab = '    '.repeat(i);
                        let end_outs = model.outputs.length === before.length;
                        let output = model.outputs.find(a=>a.idx === idx);
                        let res = [];

                        if(end_outs){
                            res.push(tab +`    out_data[out_idx] = sum;`)
                        }

                        if(!for_gpu || !output)
                            res.push(tab + '}');

                        return res;
                    }).toReversed(),
                    (!model.outputs.length)?`out_data[0] = sum;`:'',
                );
            }


            if (torus.USE_GPU) {
                let work_groups = out.gpu_work_groups;
                let cb = new torus.ShaderBuilder(
                    `// ${$.grad?'BACK':''} einsum("${expression}")`,
                    tensors.map((t, i)=>{
                        return `@group(0) @binding(${i}) var <storage, read> data_${i}: array<${t.gpuType}>;`
                    }),
                    `@group(0) @binding(${tensors.length}) var <storage, read_write> out_data: array<${out.gpuType}>;`,
                    `@compute @workgroup_size(${work_groups})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>){`,
                    model.outputs.map((axis, i)=>{
                        switch(i){
                            case 0:
                                return `    let ${axis.idx} = id.x;`
                            case 1:
                                return `    let ${axis.idx} = id.y;`
                            case 2:
                                return `    let flatIndex = id.z;`

                        }
                    }).filter(Boolean),

                    (()=>{
                        let expr = [];
                        for(let i = 2; i<model.outputs.length; i++){
                            let axis = model.outputs[i];
                            expr.push(`    let ${axis.idx} = (flatIndex / (${model.outputs.filter((_, j)=>j>i).map(ax=>ax.size).join('*') || 1})) % ${axis.size};`)
                        }
                        return expr;
                    })(),
                    model.outputs.map((axis, i)=>`    if(${axis.idx} > ${axis.size-1}) {return;}`),
                    common_code(true, !!$.grad).code,
                    `}`,
                );

                let shader = cb.shader;
//>code
                let ws = work_groups.map((v,i) => Math.ceil((out.shape[i] || 1) / v));
                out._fwd = (tensors)=>{
                    torus.compute(shader, [...tensors, out], ws);
                    return out._src(tensors);
                }
            }
            else{

                let cb = new torus.CodeBuilder(
                    `// ${$.grad?'BACK':''} einsum("${expression}")`,
                    model.inputs.map((input, i) => `let data_${i} = tensors[${i}].data;`),
                    `let out_data = out.data;`,
                    common_code(false, !!$.grad).code,
                    `return out_data;`
                );

// >cb.code
                let fn = new Function('out', 'tensors', cb.code);
                out._fwd = (tensors)=>{
                    fn(out, tensors);
                    return out._src(tensors);
                }
            }

            if (!$.grad && tensors.some(t=>t.allowGrad)) {
                out._back = ()=>{
                    let sources = out.src;
                    let grads = sources.map((t, i)=>{
                        if (!t.allowGrad) return;
                        let inputs = model.inputs.map((input, j) => i !== j? input: model.outputs);
                        let output = model.inputs[i];
                        let expr = inputs.map(input=>input.map(ax=>ax.idx).join('')).join(',') + '->' + output.map(ax=>ax.idx).join('');
                        inputs = inputs.flat();
                        let vars = output.filter(ax=>!inputs.some(a=>a.idx === ax.idx && a.size === ax.size));
                        if (vars.length)
                            expr += ': '+ vars.map(ax=>ax.idx + '=' + ax.size).join(', ');
                        let back_targets = sources.map((tens, idx)=>(idx === i)?out.grad:tens);
                        let res = torus.einsum(expr, back_targets, {grad: t.grad});
                    });
                }
            }
        }
        return out._fwd(tensors);
    }
}
generators:{

// ФУНКЦИИ ГЕНЕРАТОРЫ

    tensor.hippo = (size)=>{
        const data = new torus.DEFAULT_TYPE(size * size);
        let x;
        for (let n=0, stride=0; n<size; n++, stride+=size) {
            data[stride+n] = -(n + 1);
            x = 4 * n + 2;
            let k = n;
            while( k-- )
                data[stride + k] = -Math.sqrt(x * (k + 0.5));
        }
        return tensor.from(data)._shape(size, size)._label('hippo');
    }
    tensor.randn = (...shape)=>{
        const handle = ()=>{
            return Math.sqrt(-2 * Math.log(torus.generator())) * Math.cos((2 * Math.PI) * torus.generator());
        }
        return torus.fill(shape, handle, {dType: torus.DEFAULT_TYPE})._label(`randn`);
    }
    tensor.arange = (from_or_size = 0, to, ...step_or_shape)=>{
        const it_is_shape = Array.isArray(step_or_shape[0]);   //Если передан массив, то это однозначно форма. Позволяет отличить шаг от 1D формы.
        step_or_shape = torus.flat(step_or_shape);
        let step, steps;
        let label = 'arange';
        if (to === undefined) {   //Если у метода один параметр — размер прогрессии
            to = from_or_size;
            from_or_size = 0;
            step = Math.sign(to);
            steps = Math.ceil(Math.abs(to));
        }
        else if (step_or_shape.length === 0) {   //Если у метода два параметра — начало и конец прогрессии
            step = Math.sign(to - from_or_size)
            steps = Math.ceil(Math.abs(to - from_or_size));
        }
        else if (step_or_shape.length === 1 && !it_is_shape) {   //Если указан шаг прогрессии
            step = step_or_shape[0];
            if (step === 0)
                throw new Error(`torus.arange(from = ${from_or_size}, to = ${to}, step = ${step_or_shape}): step must be nonzero`);
            if (Math.sign(step) !== Math.sign(to - from_or_size) && to !== from_or_size)
                throw new Error(`torus.arange(from = ${from_or_size}, to = ${to}, step = ${step_or_shape}): starting and final bounds inconsistent with step sign`);
            steps = Math.ceil(Math.abs( (to - from_or_size) / step ));
        }
        else {   //Если указана форма тензора
            steps = step_or_shape.mul();
            step = (to - from_or_size) / steps;
        }
        const data = new torus.DEFAULT_TYPE(steps);
        if ( steps ) {
            for ( let i = 0, v = from_or_size; i < steps ; i++, v += step)
                data[i] = v;
            label += ` ${from_or_size} … ${to}`;
        }
        if (step_or_shape.length <= 1)   //Если форма тензора не задана или тензор одномерный
            return tensor.from(data)._label(label);
        return tensor.from(data)._shape(step_or_shape)._label(label);
    }

    tensor.eye = (...shape)=>{
        shape = torus.flat(shape);
        if (shape.length === 1)   //Если указана только одна ось, то создаётся вторая того же размера. Тензор приводится к 2-D.
            shape[1] = shape[0];
        const columns = shape[shape.length - 1] ?? 0;
        const rows = shape[shape.length - 2] ?? 0;
        const steps = Math.min( rows, columns);
        const step = columns + 1;
        const repeat = shape.length < 3 ? 1: shape.slice(0, -2).mul();
        const stride = rows * columns;
        const data = new torus.DEFAULT_TYPE(shape.mul() || [1]);
        for (let i=0, target=0; i<repeat ; i++, target+=stride)  //Заполнение старших размерностей
            for (let j=0, idx=target; j<steps; j++, idx+=step)   //Заполнение матрицы
                data[idx] = 1;
        return tensor.from(data)._shape(shape)._label('eye');
    }

    tensor.ones = (...shape) => {
        shape = torus.flat(shape);
        let data = 1;
        let size = shape.mul();
        if(size)
            data = new torus.DEFAULT_TYPE(size).fill(1)
        else
            shape = [];
        return tensor.from(data)._label('ones')._shape(shape);
    }
    tensor.zeros = (...shape) => {
        shape = torus.flat(shape);

        let data = 0;
        let size = shape.mul();
        if(size)
            data = new torus.DEFAULT_TYPE(size)
        else
            shape = [];
        return tensor.from(data)._label('zeros')._shape(shape);
    }
    tensor.rand = (shape, amplitude = 1, type = torus.DEFAULT_TYPE) => {
        shape = torus.flat(shape);
        let size = shape.mul();
        if(!size){
            size = 1;
            shape = [1]
        }
        const data = new type(size);
        while(size--)
            data[size] = (torus.generator() - .5) * amplitude;
        return tensor.from(data)._label('rand')._shape(shape);
    }
    tensor.rand_int = (min_or_max = 0, max, ...shape)=>{
        shape = torus.flat(shape);
        if (max === undefined) {
            max = min_or_max;
            min_or_max = 0;
        }
        min_or_max = Math.trunc(min_or_max);
        max = Math.trunc(max);
        if (max <= min_or_max)
            throw new Error(`torus.rand_int(min_or_max = ${min_or_max}, max = ${max}, ...shape = [${shape}]): max <= min`);
        if (shape.length === 0)
            shape = [Math.round(max - min_or_max)];
        const data = new Uint32Array(shape.mul() || 1).map(i=>{
            const r = torus.generator();
            return Math.floor(r * (max - min_or_max) + min_or_max);
        });
        return new tensor(data, {dType: torus.Uint32Array})._shape(shape)._label(`rand_int ${min_or_max} … ${max}`);
    }
}

functions:{
    tensor.prototype.expand = function(dim = -1, repeat = 1) {
        if (Array.isArray(dim)) {
            return dim.reduce((res, d, i)=>{
                return this.expand(d, Array.isArray(repeat)? (repeat[i] || 1): repeat);
            }, this);
        }
        dim = this.check_dim(dim);
        let shape = [...this.shape];
        shape[dim] = repeat;
        let other = tensor.zeros(shape);
        let res = torus.concat([this, other], dim);
        shape = [...this.shape];
        shape[dim] += repeat;
        this._resize_data(res.data, shape);
        this.OUTS = Object.create(null);
        return this;
    }
    tensor.prototype.sqrt = function() {
        let out = torus.get_out(this, 'sqrt');
        if (!out) {
            out = tensor.from(new torus.DEFAULT_TYPE(this.length))._shape(this)._src(this)._label('sqrt: ' + this.shape);
            torus.set_out(this, out, 'sqrt');
            if (torus.USE_GPU) {
                let wg = out.gpu_compute_info;
                let cb = new torus.ShaderBuilder(
                    `// sqrt FORWARD`,
                    `@group(0) @binding(0) var<storage, read> data: array<${this.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read_write> out: array<${out.gpuType}>;`,
                    `@compute @workgroup_size(${wg.size})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                        wg.code,
                    `    out[idx] = sqrt(data[idx]);`,
                    `}`
                );
                let shader = cb.shader;
                out._fwd = ()=>{
                    torus.compute(shader, [this, out], wg.count);
                    return out;
                }
                if (this.allowGrad) {
                    cb = new torus.ShaderBuilder(
                        `// sqrt BACKWARD`,
                        `@group(0) @binding(0) var<storage, read> out_grad: array<${out.grad.gpuType}>;`,
                        `@group(0) @binding(1) var<storage, read> out: array<${out.gpuType}>;`,
                        `@group(0) @binding(2) var<storage, read_write> grad: array<${this.grad.gpuType}>;`,
                        `@compute @workgroup_size(${wg.size})`,
                        `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                        wg.code,
                        `    grad[idx] += out_grad[idx] / (2.0 * out[idx]);`,
                        `}`
                    );
                    let shader = cb.shader;
                    out._back = ()=>{
                        torus.compute(shader, [out.grad, out, this.grad], wg.count);
                    }
                }
            }
            else {
                const this_data = this.data;
                const out_data = out.data;
                const length = this.length;
                out._fwd = ()=>{
                    for (let i = 0; i < length; i++)
                        out_data[i] = Math.sqrt(this_data[i]);
                    return out;
                }
                if (this.allowGrad) {
                    const out_data =out.data;
                    const out_grad = out.grad.data;
                    const this_grad = this.grad.data;
                    const length = this.length;
                    out._back = ()=>{
                        for (let i = 0; i < length; i++)
                            this_grad[i] += out_grad[i] / (2 * out_data[i]);
                    }
                }
            }
        }
        return out._fwd();
    }
    tensor.prototype.rsqrt = function(){
        let result = this.sqrt();
        result = result.pow(-1);
        return result._label('rsqrt: ' + this.shape);
    }
    tensor.prototype.invert = function (){
        const funcs = {
            forward:    '(x0) => -x0',
            forwardGPU: 'return -x0;',
            backward_0: '() => -1',
            backwardGPU_0: 'return -1;'
        };
        const out = torus._element_wise.call(this, funcs);
        return out._label('invert: ' + this.shape);
    }
    tensor.prototype.exp = function (){
        let out = torus.get_out(this, 'exp');
        if (!out){
            out = tensor.from(new torus.DEFAULT_TYPE(this.length))._shape(this)._src(this)._label('exp: ' + this.shape);
            torus.set_out(this, out, 'exp');
            if (torus.USE_GPU){
                let wg = out.gpu_compute_info;
                let cb = new torus.ShaderBuilder(
                    `// exp FORWARD`,
                    `@group(0) @binding(0) var<storage, read> data: array<${this.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read_write> out: array<${out.gpuType}>;`,
                    `@compute @workgroup_size(${wg.size})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    wg.code,
                    `    out[idx] = exp(data[idx]);`,
                    `}`)
                let shader = cb.shader;
                out._fwd = ()=>{
                    torus.compute(shader, [this, out], wg.count);
                    return out;
                }
                if (this.allowGrad){
                    cb = new torus.ShaderBuilder(
                        `// exp BACKWARD`,
                        `@group(0) @binding(0) var<storage, read> out_grad: array<${out.grad.gpuType}>;`,
                        `@group(0) @binding(1) var<storage, read> out: array<${out.gpuType}>;`,
                        `@group(0) @binding(2) var<storage, read_write> grad: array<${this.grad.gpuType}>;`,
                        `@compute @workgroup_size(${wg.size})`,
                        `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                        wg.code,
                        `    grad[idx] += out_grad[idx] * out[idx];`,
                        `}`
                    )
                    let shader = cb.shader;
                    out._back = ()=>{
                        torus.compute(shader, [out.grad, out, this.grad], wg.count);
                    }
                }
            }
            else {
                out._fwd = ()=>{
                    const this_data = this.data;
                    const out_data = out.data;
                    for (let i = 0; i < this_data.length; i++)
                        out_data[i] = Math.exp(this_data[i]);
                    return out;
                }
                if (this.allowGrad){
                    out._back = ()=>{
                        const this_grad = this.grad.data;
                        const out_grad  = out.grad.data;
                        const out_data = out.data;
                        for (let i = 0; i < this_grad.length; i++)
                            this_grad[i] += out_grad[i] * out_data[i];
                    }
                }
            }
        }
        return out._fwd();
    }
    tensor.prototype.log = function (){
        const funcs = {
            forward:    'Math.log',
            forwardGPU: 'return log(x0);',
            backward_0: 'x0 => 1 / x0',
            backwardGPU_0: 'return 1 / x0;'
        };
        const out = torus._element_wise.call(this, funcs);
        return out._label('log: ' + this.shape);
    }
    tensor.prototype.tanh = function (){
        const funcs = {
            forward:    'Math.tanh',
            forwardGPU: 'return tanh(x0);',
            backward_0: 'x0 => 1 - x0 ** 2',
            backwardGPU_0: 'return 1 - pow(x0, 2);'
        };
        const out = torus._element_wise.call(this, funcs);
        return out._label('tanh: ' + this.shape);
    }
    tensor.prototype.sigmoid = tensor.prototype.sigm = function (params){
        let out = torus.get_out(this, 'sigmoid');
        if (!out){
            out = tensor.from(new torus.DEFAULT_TYPE(this.length))._shape(this)._src(this)._label('sigmoid: ' + this.shape);
            torus.set_out(this, out, 'sigmoid');
            if (torus.USE_GPU){
                let wg =  out.gpu_compute_info;
                let cb = new torus.ShaderBuilder(
                    `// sigmoid FORWARD`,
                    `@group(0) @binding(0) var<storage, read> data: array<${this.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read_write> out: array<${out.gpuType}>;`,
                    `@compute @workgroup_size(${wg.size})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    wg.code,
                    `    out[idx] = 1.0 / (1.0 + exp(-data[idx]));`,
                    `}`);
                let shader = cb.shader;
                out._fwd = ()=>{
                    torus.compute(shader, [this, out], wg.count);
                    return out;
                }
                if (this.allowGrad){
                    cb = new torus.ShaderBuilder(
                        `// sigmoid BACKWARD`,
                        `@group(0) @binding(0) var<storage, read> out_grad: array<${out.grad.gpuType}>;`,
                        `@group(0) @binding(1) var<storage, read> out: array<${out.gpuType}>;`,
                        `@group(0) @binding(2) var<storage, read_write> grad: array<${this.grad.gpuType}>;`,
                        `@compute @workgroup_size(${wg.size})`,
                        `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                        wg.code,
                        `    let y = out[idx];`,
                        `    grad[idx] += out_grad[idx] * y * (1.0 - y);`,
                        `}`
                    );
                    let shader = cb.shader;
                    out._back = ()=>{
                        torus.compute(shader, [out.grad, out, this.grad], wg.count);
                    }
                }
            }
            else{
                 out._fwd = ()=>{
                    const this_data = this.data;
                    const out_data = out.data;
                    for (let i = 0; i < this_data.length; i++)
                        out_data[i] = 1 / (1 + Math.exp(-this_data[i]));
                    return out;
                }
                if(this.allowGrad){
                    out._back = ()=>{
                        const this_grad = this.grad.data;
                        const out_grad = out.grad.data;
                        const out_data = out.data;
                        for (let i = 0; i < this_grad.length; i++){
                            let y = out_data[i];
                            this_grad[i] += out_grad[i] * y * (1 - y);
                        }
                    }
                }
            }
        }
        return out._fwd();
    }

    tensor.prototype.relu = tensor.prototype.ReLU = function (...$) {
        $ = Object.assign({k: 0, limit: 0}, ...$);
        const funcs = {
            forward:    `x => x<0? ${$.k? `(x * ${$.k})`: 0}: ${$.limit? `(x>${$.limit}? (${$.limit} ${$.k? `+ ${$.k} * (x - ${$.limit})`: ''}): x)`: 'x'}`,
            forwardGPU: [
                        `if (x0 < 0) {`,
                        `    return ${$.k? `x0 * ${$.k}`: 0};`,
                        `}`,
                        $.limit? `return select(x0, ${$.limit} ${$.k? `+ ${$.k} * (x0 - ${$.limit})`: ''}, x0 > ${$.limit});` :    // Вызов select(false_value, true_value, condition)
                                 'return x0;',
                        ].join('\n'),
            backward_0: `x => x>0 ${$.limit? `&& x<${$.limit}`:''}? 1: ${$.k || 0}`,
            backwardGPU_0: `return select(${$.k || 0.}, 1., x0 > 0 ${$.limit? `&& x0 < ${$.limit}`:''});`   // Вызов select(false_value, true_value, condition)
        };
        const out = torus._element_wise.call(this, funcs);
        return out._label(`ReLU(k=${$.k}, limit=${$.limit}): ` + this.shape);
    }

    tensor.prototype.softplus = function (...$) {
        $ = Object.assign({beta: 1, threshold: 20}, ...$);
        let funcs;
        if ( $.beta === 1)
            funcs = {
                forward:    `x => (x < ${$.threshold})? Math.log(1 + Math.exp(x)): x`,
                forwardGPU: `return select(x0, log(1 + exp(x0)), x0 < ${$.threshold});`,   // select(false_value, true_value, condition)
                backward_0: `x => (x < ${$.threshold})? (1 / ( 1 + Math.exp(-x))): 1`,
                backwardGPU_0: `return select(1, 1 / ( 1 + exp(-x0)), x0 < ${$.threshold});`,   // select(false_value, true_value, condition)
            };
        else
            funcs = {
                forward:    `x => (${$.beta} * x < ${$.threshold})? (Math.log(1 + Math.exp(${$.beta} * x)) / ${$.beta}): x`,
                forwardGPU: `return select(x0, log(1 + exp(${$.beta} * x0)) / ${$.beta}, ${$.beta} * x0 < ${$.threshold});`,
                backward_0: `x => (${$.beta} * x < ${$.threshold})? (1 / ( 1 + Math.exp(${-$.beta} * x))): 1`,
                backwardGPU_0: `return select(1, 1 / ( 1 + exp(${-$.beta} * x0)), ${$.beta} * x0 < ${$.threshold});`,   // select(false_value, true_value, condition)
            };
        const out = torus._element_wise.call(this, funcs);
        return out._label(`softplus(beta=${$.beta}, threshold=${$.threshold}): ` + this.shape);
    }

    tensor.prototype.silu = tensor.prototype.SiLU = function() {
        const out = this.sigm().mul(this);
        return out._label('SiLU: ' + this.shape);
    }
    
    tensor.prototype.elu = tensor.prototype.ELU = function ($ = {alpha: 1}) {
        const alpha = $?.alpha || 1;
        const key = 'ELU ' + alpha;
        let out = torus.get_out(this, key);
        if (!out){
            out = tensor.from(new torus.DEFAULT_TYPE(this.length))._shape(this)._src(this)._label(`ELU(alpha=${alpha}): ` + this.shape);
            torus.set_out(this, out, key);
            if (torus.USE_GPU){
                let wg =  out.gpu_compute_info;
                let cb = new torus.ShaderBuilder(
                    `// elu FORWARD`,
                    `@group(0) @binding(0) var<storage, read> data: array<${this.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read_write> out: array<${out.gpuType}>;`,
                    `@compute @workgroup_size(${wg.size})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    wg.code,
                    `    let x = data[idx];`,
                    `    out[idx] = select(x, ${alpha===1? '': `${alpha} *`} (exp(x) - 1), x < 0);`,   // Вызов select(false_value, true_value, condition)
                    `}`);
                let shader = cb.shader;
                out._fwd = ()=>{
                    torus.compute(shader, [this, out], wg.count);
                    return out;
                }
                if (this.allowGrad){
                    cb = new torus.ShaderBuilder(
                        `// elu BACKWARD`,
                        `@group(0) @binding(0) var<storage, read> out_grad: array<${out.grad.gpuType}>;`,
                        `@group(0) @binding(1) var<storage, read> out: array<${out.gpuType}>;`,
                        `@group(0) @binding(2) var<storage, read_write> grad: array<${this.grad.gpuType}>;`,
                        `@compute @workgroup_size(${wg.size})`,
                        `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                        wg.code,
                        `    let y = out[idx];`,
                        `    grad[idx] += out_grad[idx] * select(1., y + ${alpha}, y < 0);`,   // Вызов select(false_value, true_value, condition)
                        `}`);
                    let shader = cb.shader;
                    out._back = ()=>{
                        torus.compute(shader, [out.grad, out, this.grad], wg.count);
                    }
                }
            }
            else{
                let fn_fwd = new Function('self', 'out', [
                    `const self_data = self.data;`,
                    `const out_data = out.data;`,
                    `for (let i = 0; i < ${this.length}; i++){`,
                    `    const x = self_data[i];`,
                    `    out_data[i] = x < 0? (${alpha===1? '':`${alpha} *`} (Math.exp(x) - 1)): x;`,
                    `}`,
                    `return out;`
                ].join('\n'));
                out._fwd = ()=>{
                    return fn_fwd(this, out);
                }
                if(this.allowGrad){
                    const fn_back = new Function('self', 'out', [
                        `const self_grad = self.grad.data;`,
                        `const out_data = out.data;`,
                        `const out_grad = out.grad.data;`,
                        `for (let i = 0; i < ${this.length}; i++){`,
                        `    const y = out_data[i];`,
                        `    self_grad[i] += out_grad[i] * (y < 0? (y + ${alpha}): 1);`,
                        `}`,
                    ].join('\n'));
                    out._back = ()=>{
                        fn_back(this, out);
                    }
                }
            }
        }
        return out._fwd();
    }
}
aggregates:{
    tensor.prototype.max = function(dim,  $ = {keepdim: false}){
        let key = dim+$;
        let out = torus.get_out(this, 'max');
        if (!out){
            let di = input.dim_info(dim);
            let stride = di.map(d=>d.size).mul() || this.length;
            let size = this.length / stride;
            out = {
                values: tensor.from(new this.dType(size))._src(this)._label(`max-values(dim=${dim})`),
                indices: tensor.from(new torus.DEFAULT_TYPE(size))._src(this)._label(`max-indices(dim=${dim})`),
            }
            torus.set_out(this, out, 'max');
            out._fwd = ()=>{
                for (let i = 0, from = 0, to = stride; i < size; i++, from = to, to += stride){
                    let slice = this.data.subarray(from, to);
                    let res = slice.reduce((r, v, i)=>(r.v<v)?{v,i}:r, {v:slice[0], i:0});
                    out.values.data[i] = res.v;
                    out.indices.data[i] = res.i;
                }
                if ($.keepdim){
                    let add = Array(this.dim - 1).fill(1);
                    out.values._shape(add, out.values.shape);
                    out.indices._shape(add, out.indices.shape);
                }
                return out;
            }
            out._back = this.allowGrad? ()=>{
                for(let i = 0, from = 0, to = stride; i < size; i++, from = to, to += stride)
                    this.data.subarray(from, to).fill(out.values.data[i]);
            }: null;
        }
        return out._fwd();
    }
    tensor.prototype.min = function(dim,  $ = {keepdim: false}){
        let key = dim+$;
        let out = torus.get_out(this, 'min');
        if(!out){
            let di = input.dim_info(dim);
            let stride = di.map(d=>d.size).mul() || this.length;
            let size = this.length / stride;
            out = {
                values: tensor.from(new this.dType(size))._src(this)._label(`min-values(dim=${dim})`),
                indices: tensor.from(new torus.DEFAULT_TYPE(size))._src(this)._label(`min-indices(dim=${dim})`),
            }
            torus.set_out(this, out, 'min');
            out._fwd = ()=>{
                for (let i = 0, from = 0, to = stride; i < size; i++, from = to, to += stride){
                    let slice = this.data.subarray(from, to);
                    let res = slice.reduce((r, v, i)=>(r.v>v)?{v,i}:r, {v:slice[0], i:0});
                    out.values.data[i] = res.v;
                    out.indices.data[i] = res.i;
                }
                if ($.keepdim){
                    let add = Array(this.dim - 1).fill(1);
                    out.values._shape(add, out.values.shape);
                    out.indices._shape(add, out.indices.shape);
                }
                return out;
            }
            out._back = this.allowGrad? ()=>{
                for (let i = 0, from = 0, to = stride; i < size; i++, from = to, to += stride)
                    this.data.subarray(from, to).fill(out.values.data[i]);
            }: null;
        }
        return out._fwd();
    }
    tensor.prototype.sum = function (dims = [-1], keepdim = false){
        let d_info = this.dim_info([dims].flat());
        let output = d_info.map?.(a=>a.char);
        let input = this.shape_info.map(a=>a.char);
        output = input.filter(a => !output.includes(a));
        let expr = input.join('') + ' -> ' + output.join('');
        let result = torus.einsum(expr, this);
        if(keepdim){
            let shape = this.shape.map((d, i)=>(d_info.some(di=>di.idx === i))?1:d)
            result = result.view(shape);
        }
        return result._label(`sum(dims=[${dims}], keepdim=${keepdim}):\'${expr}\'`);
    }

    tensor.prototype.mean = function(dims = [-1], keepdim = false){
        let sum = this.sum(dims, keepdim);
        let result = sum.divide(this.length / sum.length);
        return result._label('mean');
    }
    tensor.prototype.var = function(dims = [-1], $ = {keepdim: false, correction: 1}){
        let keepdim = $.keepdim;
        $.keepdim = true;
        const mean = this.mean(dims, $);
        // >mean
        $.forward = '(x, y)=>(x - y) ** 2';
        $.backward_0 = '(x, y)=>2 * (x - y)';
        $.backward_1 = '(x, y)=>(-2 * (x - y))';

        let chars = this.gen_chars();
        let ins = chars.join('')
        dims = this.gen_chars(dims);
        let outs;
        if(keepdim){
            chars = chars.map(ch=>{
                if(dims.includes(ch))
                    ch = ch.toUpperCase();
                return ch;
            })
            outs = chars.join('') + ':' + dims.map(d => d.toUpperCase()+'=1').join(',')
        }
        else
            outs = chars.filter(ch=>!dims.includes(ch)).join('');
        let expr = ins + ',' + ins + '->' + outs;



        const sum = torus.einsum(expr, [this, mean]);
        // >sum
        const multiplier = 1/Math.max(0, this.length / mean.length - $.correction);
        const out = sum.mul(multiplier);
        out._label(`var(dims=[${dims}], ${JSON.stringify($)}):\'${expr}\'`);
        return out;
    }
    tensor.prototype.std = function(dims = [-1], $ = {keepdim: false, correction: 1}){
        let out = this.var(...arguments);
        out = out.sqrt();
        out._label(`std(dim = [${dims}], ${JSON.stringify($)})`);
        return out
    }
}
convertors:{
    torus.stack = function (tensors, dim = 0){
        let key = 'stack: ' + tensors.length + ', dim=' + dim;
        let out = torus.get_out(tensors, key);
        if (!out){
            dim = tensors[0].check_dim(dim, true);
            const shape = [...tensors[0].shape];
            for (let t = 1; t < tensors.length; t++){
                const tensor = tensors[t];
                if (tensors[0].dim !== tensor.dim)
                    throw new Error(`stack: Tensor #${t} has the wrong dimention (${tensor.dim}), expected (${tensors[0].dim}).`);
                const cur_shape = tensor.shape;
                shape.forEach((d, i)=>{
                    if (d !== cur_shape[i])
                        throw new Error(`stack: Axis #${i} of tensor #${t} has the wrong size (${cur_shape[i]}), expected (${d}).`);
                });
            }
            shape.splice(dim, 0, tensors.length);
            if (tensors.length < 2) {   // Если стэк создаётся из одного тензора, то незачем копировать данные, достаточно изменить форму
                return tensors[0].view(shape)._label(key);
            }
            const size = shape.mul();
            out = tensor.from(new tensors[0].dType(size))._shape(shape)._label(key)._src(tensors);
            torus.set_out(tensors, out, key);
            
            const steps = shape.slice(0, dim).mul() || 1;
            const step = size / steps;
            const di = dim < tensors[0].dim? tensors[0].dim_info(dim): {stride:1, size:1};
            const stride = di.stride * di.size;
            out._fwd = (tensors)=>{
                for (let i = 0; i < steps; i++){
                    let offset = i * step;
                    for(let tensor of tensors){
                        const start = i * stride;
                        out.set(tensor, offset, start, stride);
                        offset += stride;
                    }
                }
                out._src(tensors);
                return out;
            };
            if (tensors.some(t=>t.allowGrad)) {
                out._back = ()=>{
                    for (let i = 0; i < steps; i++){
                        let offset = i * step;
                        for(let tensor of tensors){
                            const start = i * stride;
                            tensor.grad.set(out.grad, start, offset, stride);
                            offset += stride;
                        }
                    }
                };
            }
        }
        return out._fwd(tensors);
    }
    tensor.prototype.dropout = function(probability = 0.5, inplace = false){
        let out = inplace? this: torus.get_out(this, 'dropout');
        if (!out){
            out = tensor.from(this.data.slice(0))._label(`dropout(probability = ${probability}, inplace = ${inplace})`)._src(this)._shape(this);
            torus.set_out(this, out, 'dropout');
            out._fwd = () => {
                let from = this.data;
                let to = out.data;
                let i = this.length;
                while(i--){
                    if (probability && torus.generator()<probability)
                        to[i] = 0;
                    else
                        to[i] = from[i]
                }
                return out;
            }
            out._back = () =>{
                this.grad.set(out.grad);
            }
        }
        return out._fwd();
    }
    torus.slice_codegenerator = function (slicers, to_back = false){
        let space = '   ';
        let shape = [];
        let code = ['let idx=-1;'];
        if (!to_back) {
            code.push('let out_data = out.data;');
            code.push('let data = tensor.data;');
        }
        else {
            code.push('let out_grad = out.grad.data');
            code.push('let grad = tensor.grad.data');
        }
        let dim, start, end, step, add_shape;
        this.strides.forEach((stride, d)=>{
            let slicer = (slicers[d]?.toString() || '').toString().trim();
            dim = this.shape[d];
            if (slicer.length && !Number.isNaN(+slicer)){
                add_shape = false;
                start = +slicer;
                if (start < -dim || start >= dim)
                    throw new Error(`tensor.slice(${slicers}): index ${start} is out of bounds for dimension ${d} with size ${dim}`);
                if (start < 0)
                    start += dim;
                end = start + 1;
                step = 1;
            }
            else{
                add_shape = true;
                slicer = slicer.split(':');
                start = +(slicer[0]?.trim() || 0);
                if (start < 0)
                    start += dim;
                end = +(slicer[1]?.trim() || dim);
                if (end < 0)
                    end += dim;
                step = +(slicer[2]?.trim() || 1);
                if (step <= 0)
                    throw new Error(`tensor.slice(${slicers}): step for axis ${d} must be greater than zero`);
            }
            if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(step))
                throw new Error(`tensor.slice(${slicers}): slice indices and step for axis ${d} must be integers or omitted`);
            if (end > dim)
                end = dim;
            if (start < 0)
                start = 0;
            dim = Math.ceil((end - start) / step);
            if (dim < 0)
                dim = 0;
            let t = space.repeat(d);
            code.push(t + `for(let d${d} = ${start}, _i${d} = ${start * stride}; d${d}<${end}; d${d} += ${step}, _i${d} += ${step * stride}){`)
            if (add_shape)
                shape.push(dim);
        })
        if(!to_back){
            code.push(space.repeat(this.dim)+`out_data[++idx] = data[${this.shape.map((_,i)=>'_i'+i).join(' + ')}];`);
        }
        else{
            code.push(space.repeat(this.dim)+`grad[${this.shape.map((_,i)=>'_i'+i).join(' + ')}] = out_grad[++idx];`);
        }
        this.shape.forEach((_, d)=>{
            code.push(space.repeat(this.dim - d - 1)+`}`);
        })
        let size = shape.mul() || 1;
        return code.join('\n');
    }

    tensor.prototype.slice = function (...slicers) {
        slicers = torus.flat(slicers);
        if (slicers.length > this.dim)
            throw new Error(`tensor.slice(${slicers}): indexError: too many indices for tensor of dimension ${this.dim}`);
        let key = 'slice: ' + this.shape + '->' + slicers;
        let out = torus.get_out(this, key);
        if (!out){
            let model = slicers.map((s, i)=>{
                if(Number.isFinite(+s)){
                    s = +s;
                    if(s<0)
                        s = this.shape[i] + s;
                    s = s+':'+(s+1);
                }
                s = s.split(':');
                const start = s[0] || 0;
                const end = s[1] || this.shape[i];
                const step = s[2] || 1;
                const size = Math.ceil((end - start) / step);
                return {start, end, step, size};
            })
            let shape = model.map(d=>d.size);
            out = tensor.from(new this.dType(shape.mul()))._shape(shape)._label(key)._src(this);
            torus.set_out(this, out, key);
            if (torus.USE_GPU){
                let wgs = [Math.min(256, out.length)];
                let cb = new torus.ShaderBuilder(
                    `// slice FORWARD`,
                    `@group(0) @binding(0) var<storage, read_write> data: array<${this.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read_write> out: array<${out.gpuType}>;`,
                    `@compute @workgroup_size(${wgs})`,
                    `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                    `    var idx = id.x;`,
                    `    if(idx > ${out.length-1}) {return;}`,
                    `${
                        model.map((d, i)=>{
                            return [`    let idx${i} = ${d.start * this.shape_info[i].stride} + idx/${out.shape_info[i].stride} * ${this.shape_info[i].stride * d.step};`,
                                `    idx = idx%${out.shape_info[i].stride};`].join('\n')
                        }).join('\n')
                    }`,
                    `    out[id.x] = data[${
                        model.map((d, i)=>{
                            return `idx${i}`
                        }).join(' + ')
                    }];`,
                    `}`
                );
                wgs[0] = [Math.ceil(out.length / wgs[0])];
                let shader = cb.shader;
                out._fwd = ()=>{
                    torus.compute(shader, [this, out], wgs);
                    return out;
                }
                if (this.allowGrad){
                    cb = new torus.ShaderBuilder(
                        `// slice BACKWARD`,
                        `@group(0) @binding(0) var<storage, read_write> grad: array<${this.gpuType}>;`,
                        `@group(0) @binding(1) var<storage, read_write> out: array<${out.gpuType}>;`,
                        `@compute @workgroup_size(${wgs})`,
                        `fn main(@builtin(global_invocation_id) id: vec3<u32>) {`,
                        `    var idx = id.x;`,
                        `    if(idx > ${out.length-1}) {return;}`,
                        `${
                            model.map((d, i)=>{
                                return [`    let idx${i} = ${d.start * this.shape_info[i].stride} + idx/${out.shape_info[i].stride} * ${this.shape_info[i].stride * d.step};`,
                                    `    idx = idx%${out.shape_info[i].stride};`].join('\n')
                            }).join('\n')
                        }`,
                        `    grad[${
                            model.map((d, i)=>{
                                return `idx${i}`
                            }).join(' + ')
                        }] = out[id.x];`,
                        `}`
                    );
                    wgs[0] = [Math.ceil(out.length / wgs[0])];
                    let shader = cb.shader;
                    out._back = ()=>{
                        torus.compute(shader, [this.grad, out.grad], wgs);
                    }
                }
            }
            else{
                let code = torus.slice_codegenerator.call(this, slicers);
                let fn = new Function('tensor', 'out', code);
                out._fwd = ()=>{
                    fn(this, out);
                    return out;
                }
                if (this.allowGrad){
                    code = torus.slice_codegenerator.call(this, slicers, true);
                    let back = new Function('tensor', 'out', code);
                    out._back = ()=>{
                        back(this, out);
                    }
                }
            }
        }
        return out._fwd();
    }

    tensor.prototype.norm = tensor.prototype.normalize = function (k_norm = 1, dim = -1, esp = 1e-5) {
        let key = 'norm: '+ k_norm;
        let out = torus.get_out(this, key);
        if(!out){
            if (!Number.isFinite(k_norm))
                throw new Error(`normalize(): argument k_norm mast be finite, but got ${typeof k_norm === 'number'? k_norm: k_norm?.constructor.name||k_norm}`);
            if (k_norm === 0)
                throw new Error(`normalize(): argument k_norm mast be nonzero`);
            dim = this.dim_info(dim);
            out = tensor.from(new this.dType(this.length))._src(this)._shape(this)._label(key);
            torus.set_out(this, out, key);
            let step = dim.stride * dim.size;
            let mults = new torus.DEFAULT_TYPE(this.length / step);
            out._fwd = ()=>{
                for(let i = 0; i<this.length; i += step){
                    let slice = this.data.subarray(i, i + step);
                    let sum = esp;
                    for(let j = 0; j<step; j++){
                        sum += slice[j] ** 2;
                    }
                    sum = (1 / Math.sqrt(sum)) * k_norm;
                    for(let j = 0; j<step; j++){
                        out.data[i + j] = slice[j] * sum;
                    }
                    mults[i]  = sum;
                }
                return out;
            }
            if(this.allowGrad){
                out._back = ()=>{
                    for(let i = 0; i<this.length; i += step){
                        let slice = out.grad.data.subarray(i, i + step);
                        let sum = mults[i];
                        for(let j = 0; j<step; j++){
                            this.grad.data[i + j] += slice[j] * sum;
                        }
                    }
                }
            }
        }
        return out._fwd();
    }

    tensor.prototype.view = function (...shape_or_tensor) {
        let key = 'view: '+ shape_or_tensor.toString();
        let out = torus.get_out(this, key);
        if (!out){
            const shape = this.check_shape(shape_or_tensor);
            out = tensor.from(this.data)._shape(shape)._src(this)._label('view to ('+shape+')')
            torus.set_out(this, out, key);
            out.grad = this.grad;
            if(torus.USE_GPU)
                out.writeToGPU();
        }
        return out;
    }

    tensor.prototype.multinomial = function(num_samples = 1, replacement = false, $ = {}){
        let key = 'multinomial: '+num_samples;
        let out = torus.get_out(this, key);
        if (!out) {
            $ = torus.$({generator: null}, $);
            const step = this.shape.last;
            if (!$.generator)
                $.generator = torus.generator;
            let steps = this.length / step;
            out = tensor.from(new Uint32Array(steps * num_samples))._shape([steps, num_samples])._label(key)._src(this);
            torus.set_out(this, out, key);
            let random = tensor.from(new torus.DEFAULT_TYPE(out.length));
            if (torus.USE_GPU) {
                let wgs = [Math.min(steps, 256)];
                let cb = new torus.ShaderBuilder(
                    `// multinomial FORWARD`,
                    `@group(0) @binding(0) var<storage, read> data: array<${this.gpuType}>;`,
                    `@group(0) @binding(1) var<storage, read> random: array<${random.gpuType}>;`,
                    `@group(0) @binding(2) var<storage, read_write> out: array<${out.gpuType}>;`,
                    `@compute @workgroup_size(${wgs})`,
                    `fn main(@builtin(global_invocation_id) id: vec3u) {`,
                    `   var idx = id.x;`,
                    `   if (idx > ${steps-1}) {return;}`,
                    `   idx = idx * ${step};`,
                    `   var arr: array<${random.gpuType}, ${step}>;`,
                    `   var sum = ${this.gpuType}(0);`,
                    `   for (var i:u32 = 0; i < ${step}; i++) {`,
                    `       let d = data[i + idx];`,
                    `       sum += abs(d);`,
                    `       arr[i] = sum;`,
                    `   }`,
                    `   for (var n:u32 = 0; n < ${num_samples}; n++) {`,
                    `       let rand = random[id.x + n] * sum;`,
                    `       for (var a:${out.gpuType} = 0; a<${step}; a++) {`,
                    `           if (arr[a] >= rand) {`,
                    `               out[id.x + n] = a;`,
                    `               break;`,
                    `           }`,
                    `       }`,
                    `   }`,
                    `}`,
                );
                wgs[0] = Math.ceil(steps/wgs[0]);
                let shader = cb.shader;
                out._fwd = ()=>{
                    for(let i = 0; i<random.length; i++){
                        random.data[i] = $.generator();
                    }
                    random.writeToGPU(true);
                    torus.compute(shader, [this, random, out], wgs);
                    return out;
                }
            }
            else{
                out._fwd = ()=>{
                    for(let i = 0; i<random.length; i++){
                        random.data[i] = $.generator();
                    }
                    let idx = -1
                    for (let s = 0; s<steps; s++){
                        let sum = 0;
                        let arr = [];
                        let l = s * step;
                        for(let i = 0; i<step; i++){
                            let d = this.data[i+l];
                            sum += Math.abs(d);
                            arr[i] = sum;
                        }
                        for(let n = 0; n<num_samples; n++){
                            let rand = random.data[s+n] * sum;
                            for(let a = 0; a<step; a++){
                                if(arr[a]>=rand){
                                    out.data[++idx] = a;
                                    break;
                                }
                            }
                        }
                    }
                    return out;
                }
            }

        }
        return out._fwd();
    }
    torus.flat = function (...shape){
        return shape.flat(Infinity);
    }
    torus.compute = function (code, tensors, work_groups){
        return torus.WebGPU.compute(code, tensors, work_groups);
    }

    torus.join = function (tensors = []){
        let key = 'join: ' + tensors.map(t => t.shape).flat().join(',');
        let out = torus.get_out(this, key);
        if (!out){
            tensors = torus._check_list_of_tensors(tensors);
            let first = tensors[0];
            const shape = [tensors.length, ...first.shape];
            out = tensor.from(new first.dType(shape.mul()))._src(tensors)._label(`join: ${tensors.length} tensors`)._shape(shape);
            torus.set_out(this, out, key);
            if(torus.USE_GPU){
                out.writeToGPU();
                out._fwd = (tensors)=>{
                    let offset = 0;
                    const commandEncoder = torus.WebGPU.device.createCommandEncoder();
                    for(let t of tensors){
                        t.writeToGPU();
                        commandEncoder.copyBufferToBuffer(t.gpuDataBuffer, 0, out.gpuDataBuffer, offset,  t.data.byteLength);
                        offset += t.data.byteLength;
                    }
                    torus.WebGPU.device.queue.submit([commandEncoder.finish()]);
                    return out._src(tensors);
                }
                out._back = ()=>{
                    let offset = 0;
                    const commandEncoder = torus.WebGPU.device.createCommandEncoder();
                    for (let t of tensors){
                        commandEncoder.copyBufferToBuffer(out.grad.gpuDataBuffer, offset, t.grad.gpuDataBuffer, 0, t.data.byteLength);
                        offset += t.data.byteLength;
                    }
                    let result = torus.WebGPU.device.queue.submit([commandEncoder.finish()]);
                    if (!result)
                        result = torus.WebGPU.device.queue.onSubmittedWorkDone();
                }
            }
            else{
                out._fwd = (tensors)=>{
                    let offset = 0;
                    for (let i = 0; i < tensors.length; i++) {
                        let t = tensors[i];
                        out.set(t, offset);
                        offset += t.length;
                    }
                    return out._src(tensors);
                }

                out._back = ()=>{
                    let offset = 0;
                    for (let i = 0; i < out.src.length; i++) {
                        let t = tensors[i];
                        if (t.allowGrad)
                            t.grad.set(out.grad, 0, offset, t.length);
                        offset += t.length;
                    }
                }
            }
        }
        return out._fwd(tensors);
    }
    torus.cat = torus.concat = function (tensors = [], dim = -1) {
        if (tensors.length < 2)
            return tensors[0];
        let key = 'concat: ' + tensors.length + ', dim=' + dim  + ' shape: ' + tensors.map(t => t.shape).flat().join(',');
        let out = torus.get_out(tensors, key);
        if (!out) {
            const error_idx = tensors.findIndex(t=> t.dim === 0);   // Нельзя объединять скалярные тензоры, т.к. они не имеют измерений
            if (error_idx !== -1)
                throw new Error(`concat: zero-dimensional tensor (at position ${error_idx}) cannot be concatenated.`);
            dim = tensors[0].check_dim(dim);
            let shape = tensors[0].shape;
            for (let t = 1; t < tensors.length; t++) {
                const tensor = tensors[t];
                if (tensors[0].dim !== tensor.dim)
                    throw new Error(`concat: Tensor #${t} has the wrong dimention (${tensor.dim}), expected (${tensors[0].dim}).`);
                let cur_shape = tensor.shape;
                shape = shape.map((d, i)=>{
                    let cur_d = cur_shape[i];
                    if (i === dim)
                        return d + cur_d;
                    if (d === cur_d)
                        return d;
                    throw new Error(`concat: Axis #${i} of tensor #${t} has the wrong size (${cur_d}), expected (${d}).`)
                });
            }
            const size = shape.mul();
            out = tensor.from(new tensors[0].dType(size))._label(key)._shape(shape)._src(tensors);
            torus.set_out(tensors, out, key);
            const step = size / (out.shape.slice(0, dim).mul() || 1);
            let steps = size / step;
            out._fwd = (tensors)=>{
                for (let i = 0; i < steps; i ++) {
                    let offset = i * step;
                    for (let t of tensors){
                        let di = t.dim_info(dim);
                        let stride = di.stride * di.size;
                        let start = i * stride;
                        out.set(t, offset, start, stride);
                        offset += stride;
                    }
                }
                out._src(tensors);
                return out;
            };
            if (tensors.some(t=>t.allowGrad)) {
                out._back = ()=>{
                    for (let i = 0; i < steps; i ++) {
                        let start = i * step;
                        for (let t of tensors) {
                            let di = t.dim_info(dim);
                            let stride = di.stride * di.size;
                            let offset = i * stride;
                            t.grad.set(out.grad, offset, start, stride);
                            start += stride;
                        }
                    }
                };
            }
        }
        return out._fwd(tensors);
    }


    tensor.prototype.split = function(split_size_or_sections, dim = 0){
        let key = `split (${split_size_or_sections.toString() + ', ' + dim})`;
        let outs = torus.get_out(this, key);
        if (!outs){
            let steps = Array.isArray(split_size_or_sections)?split_size_or_sections:[split_size_or_sections];
            dim = this.check_dim(dim);
            const d_info = this.shape_info[dim];
            
            if (steps.length === 1){
                const step = steps[0];
                if (step > d_info.size){
                    steps = [d_info.size];
                }
                else{
                    const  p = Math.floor(d_info.size / step);
                    steps = Array(p).fill(step);
                    const rest = d_info.size - steps.sum();
                    if(rest)
                        steps.push(rest);
                }
            }
            if (steps.sum() !== d_info.size)
                throw new Error(`split_with_sizes expects split_sizes to sum exactly to ${d_info.size} (input tensor's size at dimension ${dim}), but got split_sizes=[${steps.toString()}]`)

            outs = steps.map((s, i) => {
                const shape = this.shape.map((ts,i)=>(i === dim?s:ts));
                return tensor.from(new torus.DEFAULT_TYPE(shape.mul()))
                ._src(this)
                ._shape(shape)
                ._label(`splitted part № ${i + 1} by size=${s}`);
            });

            torus.set_out(this, outs, key);

            steps = steps.map(s=>s * d_info.stride);
            outs._fwd = ()=>{
                for (let i = 0; i < outs.length; i++)
                    outs[i].idx = 0;
                let s = 0;
                while (s < this.length){
                    for(let i = 0; i<steps.length; i++){
                        const out = outs[i];
                        const step = steps[i];
                        const end = s + step ;
                        out.set(this, out.idx, s, step);
                        out.idx += step;
                        s = end;
                    }
                }
                return outs;
            }
            if (this.allowGrad){
                const full_step = steps.sum();
                outs.map((out, o)=>{
                    const step = steps[o];
                    const start = steps.reduce((r, s, i) => r + (i<o? s: 0), 0);
                    out._back = ()=>{
                        let from = start;
                        for (let i = 0; i < out.length; i += step){
                            this.grad.set(out.grad, from, i, step);
                            from += full_step;
                        }
                    }
                });
            }
        }
        return outs._fwd();
    }
    tensor.prototype.tril = function (diagonal = 0) {
        if (this.dim < 2)
            throw new Error(`tril(): input tensor must have at least 2 dimensions, but got ${this.dim}`);
        let width = this.size(-1);
        let height = this.size(-2);
        let stride = width * height;
        diagonal += 1;
        for(let h = 0; h < height; h++){
            let start = h + diagonal;
            if(start < 0)
                start = 0;
            let add = h * width;
            start += add
            let end = add + width;
            for(let s = 0; s < this.length; s += stride){
                this.data.fill(0, start + s, end + s);
            }
        }
        return this;
    }
}
tensor.prototype.transpose = function(dim0 = -1, dim1 = -2) {
    if (this.dim < 2)
        throw new Error(`Dimension out of range (expected more 2 or more, but got ${this.dim})`);
    dim0 = this.dim_info(dim0).idx;
    dim1 = this.dim_info(dim1).idx;
    if (dim0 === dim1)
        throw new Error(`transpose: dim0 and dim1 can not be equal`);

    let var_in = this.shape_info.map(v=>v.char);

    const var_out = var_in.map((v, i)=>{
        if (i === dim0)
            return var_in[dim1]
        if (i === dim1)
            return var_in[dim0]
        return v.char;
    })
    const expression = var_in.join('')+'->'+var_out.join('');
    return torus.einsum(expression, this)._label(`transpose (${dim0}, ${dim1}) ` + expression);
}
tensor.prototype.pad = function(paddings, mode = 'constant', constant_value = 0) {
    let new_shape = this.shape.slice();
    for (let i = 0; i < paddings.length; i++) {
        new_shape[i] += paddings[i] * 2;
    }
    let new_data = new this.dType(new_shape.mul()).fill(constant_value);
    let offsets = paddings.slice();
    let strides = [1];
    for (let i = this.dim - 1; i >= 0; i--) {
        strides[i] = strides[i + 1] * this.shape[i];
    }
    let index = (indices) => {
        let offset = 0;
        for (let i = 0; i < indices.length; i++) {
            offset += indices[i] * strides[i];
        }
        return offset;
    }
    let unpadded_indices = (indices) => {
        let result = [];
        for (let i = 0; i < indices.length; i++) {
            result.push(Math.max(Math.min(indices[i] - offsets[i], this.shape[i]), 0));
        }
        return result;
    }
    let padded_indices = (indices) => {
        let result = [];
        for (let i = 0; i < indices.length; i++) {
            result.push(Math.max(Math.min(indices[i], new_shape[i]), 0));
        }
        return result;
    }
    let i = this.data.length;
    while(i--){
        let indices = unpadded_indices(index(i));
        new_data[index(indices)] = this.data[i];
    }
    if (mode === 'reflect') {
        for (let i = 0; i < paddings.length; i++) {
            let axis_size = this.shape[i];
            let padding_size = paddings[i];
            for (let j = 0; j < axis_size; j++) {
                let left_index = index([...Array(i).fill(0), j, ...Array(this.dim - i - 1).fill(0)]);
                let right_index = index([...Array(i).fill(0), axis_size - 1 - j, ...Array(this.dim - i - 1).fill(0)]);
                let left_offset = Math.floor((left_index - padding_size) / (axis_size + padding_size * 2));
                let right_offset = Math.floor((right_index - padding_size) / (axis_size + padding_size * 2));
                for (let k = 1; k <= padding_size; k++) {
                    let left_padded_index = index([...Array(i).fill(0), padding_size - k + left_offset * (axis_size + padding_size * 2), ...Array(this.dim - i - 1).fill(0)]);
                    let right_padded_index = index([...Array(i).fill(0), padding_size - k + right_offset * (axis_size + padding_size * 2), ...Array(this.dim - i - 1).fill(0)]);
                    new_data[left_padded_index] = this.data[left_index];
                    new_data[right_padded_index] = this.data[right_index];
                }
            }
        }
    } else if (mode === 'replicate') {
        for (let i = 0; i < paddings.length; i++) {
            let axis_size = this.shape[i];
            let padding_size = paddings[i];
            for (let j = 0; j < axis_size; j++) {
                let left_index = index([...Array(i).fill(0), j, ...Array(this.dim - i - 1).fill(0)]);
                let right_index = index([...Array(i).fill(0), axis_size - 1 - j, ...Array(this.dim - i - 1).fill(0)]);
                for (let k = 1; k <= padding_size; k++) {
                    let left_padded_index = index([...Array(i).fill(0), padding_size - k, ...Array(this.dim - i - 1).fill(0)]);
                    let right_padded_index = index([...Array(i).fill(0), new_shape[i] - padding_size + k, ...Array(this.dim - i - 1).fill(0)]);
                    new_data[left_padded_index] = this.data[left_index];
                    new_data[right_padded_index] = this.data[right_index];
                }
            }
        }
    } else if (mode === 'circular') {
        for (let i = 0; i < paddings.length; i++) {
            let axis_size = this.shape[i];
            let padding_size = paddings[i];
            for (let j = 0; j < axis_size; j++) {
                let left_index = index([...Array(i).fill(0), j, ...Array(this.dim - i - 1).fill(0)]);
                let right_index = index([...Array(i).fill(0), axis_size - 1 - j, ...Array(this.dim - i - 1).fill(0)]);
                for (let k = 1; k <= padding_size; k++) {
                    let left_padded_index = index([...Array(i).fill(0), padding_size - k, ...Array(this.dim - i - 1).fill(0)]);
                    let right_padded_index = index([...Array(i).fill(0), new_shape[i] - padding_size + k, ...Array(this.dim - i - 1).fill(0)]);
                    new_data[left_padded_index] = this.data[index([...Array(i).fill(0), (left_index + k) % axis_size, ...Array(this.dim - i - 1).fill(0)])];
                    new_data[right_padded_index] = this.data[index([...Array(i).fill(0), (right_index + k) % axis_size, ...Array(this.dim - i - 1).fill(0)])];
                }
            }
        }
    }
    let result = new tensor(new_data, this.dType);
    result._shape(new_shape);
    result._label(`pad(${paddings}, ${mode}, ${constant_value})`);
    result._src(this);
    result._back = () => {
        let unpadded_grad = new this.dType(this.data.length);
        let i = this.data.length
        while (i--) {
            let indices = unpadded_indices(index(i));
            unpadded_grad[i] = result.grad.data[index(indices)];
        }
        this.grad.data = unpadded_grad;
    }
    return result;
}

globalThis.range ??= (count = 0)=>{
    count = Math.floor(count)
    return Array(count).fill().map((_, i)=>i);
}


torus.label_from_error = (deep = 0)=>{
    return new Error().stack.split('at torus.')?.[1 + deep]?.split(' ')?.[0] || 'torus';
}