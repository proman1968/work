export const nn = {};
nn.Module = nn.NeuroModule = class NeuroModule extends Function{
    props = Object.create(null);
    OUTS = Object.create(null);
    constructor(props = {}, def = {}) {
        super();
        props = Object.assign(def, props);
        if(props.$ !== this.constructor.name)
            this.__init__?.call(props);
        this.restoreModel(props);
        return new Proxy(this, {
            get(target, p, receiver) {
                return target[p];
            },
            apply(target, _, args) {
                return target.forward(...args);
            }
        })
    }
    get model(){
        let props = this.toJSON();
        let model = Object.keys(props).reduce((res, key)=>{
            let prop = props[key];
            if(prop instanceof Object && 'model' in prop){
                prop = JSON.parse(prop.model);
            }
            res[key] = prop;
            return res;
        }, {})
        return JSON.stringify(model, undefined, 2);
    }
    restoreModel(model){
        for (let n in model){
            const item = model[n];
            this[n] = this.props[n] ??= ((item)=>{
                function recurse (obj){
                    if (Array.isArray(obj)){
                        return obj.map(i=> {
                            if (i?.$)
                                return new (eval(i.$))(i);
                            return recurse (i);
                        })
                    }
                    if (obj?.$)
                        return new (eval(obj.$))(obj);
                    if (obj?.constructor === Object){
                        let res = Object.create(null);
                        for (let o in obj){
                            res[o] = recurse(obj[o])
                        }
                        return res;
                    }
                    return obj
                }
                return recurse (item);
            })(item)
        }
    }
    forward(x, target, backward = true){
        return x;
    }
    parameters(items = Object.values(this.props)){
        let props = items.map(prop=>{
            if(prop instanceof tensor){
                if(prop.isParam)
                    return prop;
            }
            else if(prop instanceof nn.Module){
                return prop.parameters();
            }
            else if(Array.isArray(prop)){
                return this.parameters(prop);
            }
        })
        while(props.some(p=>Array.isArray(p)))
            props = props.flat();
        return props.filter(Boolean);
    }
    get param_count(){
        return this.parameters().reduce((r,tensor)=>r+tensor.size, 0)
    }
    get __children__(){
        let ch = Object.getOwnPropertyDescriptors(this);
        const result = []
        for (let n in ch){
            const prop = ch[n]
            if (prop.value instanceof  NeuroModule){
                result.push({[n]:prop.value})
            }
            else if (prop.value instanceof tensor){
                result.push({[n]:prop.value})
            }
            else if (Array.isArray(prop.value) && prop.value.some(v => v instanceof NeuroModule || v instanceof tensor)){
                result.push({[n]:prop.value.map(i=>i)})
            }
        }
        return result;
    }
    toString(step = 0){
        let tab = ('  ').repeat(step);
        let s = tab + `${this.label}\n`;
        tab = ('  ').repeat(++step);
        step++;
        s += this.__children__.map(obj => {
            const key = Object.keys(obj)[0];
            const prop = obj[key];
            if(Array.isArray(prop)){
                return tab + key + `[${prop.length}]:\n` + prop.map((m, i)=>(' ').repeat(step)+i+': '+m.toString(step)).join('')
            }
            return tab + key+':\n' + prop.toString(step);
        }).join('\n');
        return s;
    }
    _label(label){
        this.label = label;
        return this;
    }
    set label(n) {
        this['#label'] = n;
    }
    get label(){
        return this['#label'] ??= `${this.constructor.name} [${this.param_count.toLocaleString()}] (${Object.keys(this.props).filter(p => typeof this.props[p] !== "object" && typeof this.props[p] !== "function").map(p => p+': ' + this.props[p]).join(', ')})`;
    }
    toJSON(){
        const props = Object.getOwnPropertyDescriptors(this);
        const res = Object.assign({$: this.constructor.name}, this.props);
        // for(let key in props){
        //     const obj = props[key];
        //     if (!obj.enumerable) continue;
        //     if(obj?.value && typeof obj.value === 'object'){ // вложенный модуль
        //         res[key] = obj.value;
        //     }
        // }
        return res
    }
}

export class Linear extends nn.Module{
    constructor(net = {}) {
        net = Object.assign({shape_in: 4, shape_out: 4, bias: false}, net);
        if(!Array.isArray(net.shape_in))
            net.shape_in = [net.shape_in];
        if(!Array.isArray(net.shape_out))
            net.shape_out = [net.shape_out];
        super(net);
    }
    __init__() {
        this.size_in = this.shape_in.mul();
        this.size_out = this.shape_out.mul();
        let dim_in = this.shape_in[this.shape_in.length-1];
        let dim_out = this.shape_out[this.shape_out.length-1];
        let w = tensor.rand([dim_in, dim_out]);
        this.weight = w._label(w.label + ': Weights').p;
        if(this.bias){
            let b = tensor.rand([dim_out]);
            this.B = b._label(b.label + ': Bias').p;
        }

    }
    updateOutShape(new_shape){ //Изменение выходного размера слоя!!!
        if(!Array.isArray(new_shape))
            new_shape = [new_shape];

        if (new_shape.sum() <= this.shape_out.sum())
            return;
        this.shape_out = this.props.shape_out = new_shape;
        let data = new this.W.dType(this.shape_in.mul() * this.shape_out.mul());
        data = data.map((_,i)=>{
            return this.W.data[i] ?? (Math.random()-.5) * .1;
        })
        this.W._resize_data(data, this.shape_in, this.shape_out);
        if (this.bias){
            data = new this.B.dType(this.shape_out.mul());
            data = data.map((_,i)=>{
                return this.B.data[i] ?? (Math.random()-.5) * .1;
            })
            this.B._resize_data(data, this.shape_out);
        }
    }
    async forward(input){
        input = tensor.from(input);
        let output = await torus.einsum('ab, ...a -> ...b', [this.weight, input]);
        if (this.bias)
            output = await output.plus(this.B)._label('plus BIAS');
        return output;
    }
}
nn.Linear = Linear;

function countBigIntOnes(n) {
    let count = 0;
    while (n > 0n) {
        n &= (n - 1n); // Сбрасываем младшую единицу
        count++;
    }
    return count;
}
export class BinLinear extends nn.Module{
    constructor(net = {}) {
        net = Object.assign({shape_in: 32, shape_out: 32}, net);
        if(!Array.isArray(net.shape_in))
            net.shape_in = [net.shape_in];
        if(!Array.isArray(net.shape_out))
            net.shape_out = [net.shape_out];
        super(net);
    }
    // get model(){
    //     return JSON.stringify(this, (key, value)=>{
    //         if (typeof value === 'bigint')
    //             return value.toString();
    //         return value;
    //     }, 2);
    // }
    // restoreModel(model){
    //     for (let n in model){
    //         const prop = model[n];
    //         this[n] = this.props[n] ??= ((prop)=>{
    //             if(n === 'weights')
    //                 return prop.map(v => BigInt(v))
    //             return prop;
    //         })(prop)
    //     }
    // }
    __init__() {
        this.size_in = this.shape_in.mul();
        this.size_out = this.shape_out.mul();
        this.weights = new tensor(Array(this.size_out).fill().map(v=>{
            let n = Array(this.size_in).fill().map(_=>{
                return Math.round(torus.generator())
            }).join('');
            return BigInt('0b'+ n);
        }), {shape: [this.shape_in, this.shape_out].flat(Infinity)})._label('weights').p;
    }

    forward(input = {data: 0n}){ // input - BigInt
        // let key  = 'BinLinear: '+ dim;
        // let out = torus.get_out(this, key);
        let {data} = input;
        if(data.length){
            data = data.map(v => v>0 ? 1 : 0).join('').padStart(this.size_in, '0');
            data = BigInt('0b' + data);
        }
        data = this.weights.data.map(w => (countBigIntOnes(data & w) - countBigIntOnes(data & ~w)));

        let out =  tensor.from(data)._src(input, [this.weights])._label('BinLinear')._shape(this.shape_out);
        out._back = () => {
            if (!out.grad.data.some(v => v))
                return;
            // console.log(out.grad);

            // let error = data ^ target;
            // if (error === 0n)
            //     return;
            let target = undefined;

            let input_data = input.data;
            if (input.data.length) {
                input_data = input.data.map(v => v>0 ? 1 : 0).join('').padStart(this.size_in, '0');
                input_data = BigInt('0b' + input_data);
            }
        
            for (let i = 0n; i < BigInt(this.size_out); i++){
                // if (((error >> i) & 1n) === 0n)
                if (out.grad.data[i] === 0)
                    continue;
                let error = out.grad.data[i];
                let step = (Math.sign(error) || -1) * -2;
                let pos, max = this.size_in;
                if (step > 0) {
                    if (error === -1) {
                        pos = BigInt(Math.trunc(this.size_in * torus.generator()));
                        if (((input_data >> pos) & 1n) !== ((this.weights.data[i] >> pos) & 1n)) {
                            // target = input_data ^ (1n << pos);
                            if (input.grad) {
                                input.grad.data[pos] = ((input_data >> pos) & 1n) === 0n? -1: 1;
                                continue;
                            }
                        }
                    }
                    // while (error < 0 && max--) {
                        pos = BigInt(Math.trunc(this.size_in * torus.generator()));
                        if (((this.weights.data[i] >> pos) & 1n) === 0n){
                            this.weights.data[i]  = this.weights.data[i]  ^ (1n << pos);
                            error += step;
                        }
                    // }
        
                    if (error > 0/* 1 */) {
                        pos = BigInt(Math.trunc(this.size_in * torus.generator()));
                        if (((input_data >> pos) & 1n) === ((this.weights.data[i] >> pos) & 1n)) {
                            // target = input_data ^ (1n << pos);
                            if (input.grad)
                                input.grad.data[pos] = ((input_data >> pos) & 1n) === 0n? -1: 1;
                        }
                    }
                    else if (error < 0/* 1 */) {
                        pos = BigInt(Math.trunc(this.size_in * torus.generator()));
                        if (((input_data >> pos) & 1n) !== ((this.weights.data[i] >> pos) & 1n)) {
                            // target = input_data ^ (1n << pos);
                            if (input.grad)
                                input.grad.data[pos] = ((input_data >> pos) & 1n) === 0n? -1: 1;
                        }
                    }
                }
                else {
                    if (error === 1) {
                        pos = BigInt(Math.trunc(this.size_in * torus.generator()));
                        if (((input_data >> pos) & 1n) === ((this.weights.data[i] >> pos) & 1n)) {
                            // target = input_data ^ (1n << pos);
                            if (input.grad) {
                                input.grad.data[pos] = ((input_data >> pos) & 1n) === 0n? -1: 1;
                                continue;
                            }
                        }
                    }
                    // while (error > 0 && max--) {
                        pos = BigInt(Math.trunc(this.size_in * torus.generator()));
                        if (((this.weights.data[i] >> pos) & 1n) === 1n) {
                            this.weights.data[i]  = this.weights.data[i]  ^ (1n << pos);
                            error += step;
                        }
                    // }
                    if (error < 0) {
                        pos = BigInt(Math.trunc(this.size_in * torus.generator()));
                        if (((input_data >> pos) & 1n) !== ((this.weights.data[i] >> pos) & 1n)) {
                             // target = input_data ^ (1n << pos);
                            if (input.grad)
                                input.grad.data[pos] = ((input_data >> pos) & 1n) === 0n? -1: 1;
                        }
                    }
                    else if (error > 0) {
                        pos = BigInt(Math.trunc(this.size_in * torus.generator()));
                        if (((input_data >> pos) & 1n) === ((this.weights.data[i] >> pos) & 1n)) {
                            // target = input_data ^ (1n << pos);
                            if (input.grad)
                                input.grad.data[pos] = ((input_data >> pos) & 1n) === 0n? -1: 1;
                        }
                    }
                }
            }
            input.grad?.data.reverse();
        }
        return out;
    }

}
nn.BinLinear = BinLinear;

nn.List = (count, handler)=>{
    return Array(count).fill().map(handler);
}

nn.Embedding = class Embedding extends nn.Linear{
    logits = {};
    constructor(net = {}) {
        super(net, {shape_in: [], shape_out: [], bias: false});
    }
    forward(input) {
        let logits = this.logits[input.shape.toString()] ??= (()=>{
            return tensor.from(new torus.DEFAULT_TYPE(input.length * this.size_in)).reshape(input.shape, this.size_in);
        })();
        let data = logits.data;
        data.fill(0);
        for (let i = 0; i < input.length; i++){
            const idx = i * this.size_in;
            data[idx + input.data[i]] = 1;
        }
        return super.forward(logits);
    }
}
nn.Dropout = class Dropout extends nn.Module{
    constructor(net = {probability: 0.5, inplace: false}){
        super(net)
    }
    forward(x){
        return x.dropout(this.probability, this.inplace);
    }
}
nn.conv1D = class conv1D extends nn.Module {
    constructor(in_channels,
                out_channels,
                kernel_size = 4,
                stride = 1,
                padding = 0,
                padding_mode = 'zeros', // options('zeros', 'reflect', 'replicate', 'circular')
                dilation = 1,
                groups = 1,
                bias = true) {
        super(...arguments);
    }
    __init__() {
        if (this.in_channels%this.groups)
            throw new Error('in_channels must be divisible by groups');
        if (this.out_channels%this.groups)
            throw new Error('out_channels must be divisible by groups');
        let k = Math.sqrt(this.groups / (this.in_channels * this.kernel_size))
        this.weight_shape = [this.out_channels, this.in_channels / this.groups, this.kernel_size];
        this.weights = tensor.rand(this.weight_shape).minus_(.5).mul_(2 * k).p;
        if (this.bias)
            this.bias_weights = tensor.rand([this.out_channels]).minus_(.5).mul_(2 * k).p;
        this.pads = Array(this.padding).fill(0);
    }
    forward(x) {
        let k_size = this.kernel_size;
        if ((x.getDim(-2) || 1) !== this.in_channels)
            throw new Error(`Given groups=${this.groups}, weight of size [${this.weight_shape}], expected input[${x.shape}] to have ${this.in_channels} channels, but got ${(x.getDim(-2) || 1)} channels instead`);
        let stride = this.stride;
        let dilation = this.dilation;
        let x_data = x.data;
        let k_data = this.weights.data;
        let padding = this.padding;
        let L_in = x.getDim(-1);
        let padded_size = L_in + padding * 2;
        let over_axis = x.shape.slice(0, x.dim-2);

        let batches = over_axis.mul();
        let dim_out = (padded_size - dilation * (k_size - 1) - 1) / stride + 1;
        const shape_out = [this.out_channels, dim_out];
        shape_out.unshift(...over_axis)
        const out_size = shape_out.mul();
        let data = new torus.DEFAULT_TYPE(out_size);

        let outs = this.out_channels;
        let links = this.in_channels / this.groups;
        let ins = this.in_channels;
        let groups = this.groups;
        let in_idx = 0;
        let in_step = x.getDim(-1) * this.groups;
        const kernels = [];
        let idx = -1;
        let data_step = this.in_channels * L_in;
        batches *= data_step
        for (let b = 0; b < batches; b += data_step){
            let batch_data = x.data.slice(b, b + data_step);
            for (let o = 0; o < outs; o++) {
                let kernel = kernels[o] ??= this.weights.slice(o);
                let src_idx = 0;
                let k_idx = 0;
                for (let l = 0; l<links; l++){
                    let src = new torus.DEFAULT_TYPE(L_in);
                    for (let g = 0; g < groups; g++){
                        const src_grp = batch_data.slice(src_idx, src_idx += L_in);
                        src = src.map((v, i)=>{
                            return v + src_grp[i];
                        })
                    }
                    let src_data =  [...this.pads, ...src, ...this.pads];

                    let k = kernel.slice(k_idx, k_idx += k_size);
                    for (let step = 0; step < dim_out; step++){
                        data[++idx] = k.reduce((r, k_val, i)=>{
                            let x_idx = step * stride + i * dilation;
                            return r + k_val * src_data[x_idx];
                        }, 0)
                    }
                }
            }
        }
        const out = tensor.from(data)._src(x, this.weights)._label(this.label)._shape(shape_out);
        out._back = ()=>{
            let out_idx = -1;
            let in_idx = -1;
            let o_grad = out.grad;
            let k_step = this.weights.size / this.weights.shape[0];
            let k_grad = this.weights.grad;
            for (let b = 0; b < batches; b += data_step){
                for (let o = 0; o < outs; o++) {
                    let src_idx = 0;
                    let k_idx = o * k_step;
                    for (let gr = 0; gr < groups; gr++){
                        for (let l = 0; l<links; l++){
                            let x_idx = (in_idx++) - this.padding;
                            // const src_grp = batch_data.slice(src_idx, src_idx += L_in);
                            let src_data =  [...this.pads, ...src_grp, ...this.pads];
                            for (let step = 0; step < dim_out; step++){
                                const g = o_grad[++out_idx];
                                for (let i = 0; i<k_size; i++){
                                    let x_idx = step * stride + i * dilation;
                                    k_grad[k_idx] += src_data[x_idx] * g;
                                    x_data[x_idx] += k_data[k_idx] * g;
                                    k_idx++;
                                }
                            }
                        }
                    }
                }
            }
        }
        return out;
    }

}

nn.RMSNorm = class RMSNorm extends nn.Module{
    constructor(net = {}) {
        super(net, {d_model: 255, bias: false, eps: 1e-5});
    }
    __init__(){
        this.weight = tensor.ones(this.d_model)._label('RMSNorm-W').p;
        if (this.bias)
            this.B = tensor.rand(this.d_model)._label('RMSNorm - bias').p;
    }
    forward(x){
        x = tensor.from.call(this, x);
        let output = x.pow(2);
        output = output.mean(-1, true);
        output = output.plus(this.eps);
        output = output.rsqrt();
        output = x.mul(output);
        output = output.mul(this.weight);
        if (this.bias)
            output = output.plus(this.B);
        return output;
    }
}

function Conv1d(in_channels, out_channels, kernel_size, stride = 1, padding = 0, dilation = 1, groups = 1, bias = true, padding_mode = 'zeros') {
    const weight = new torus([out_channels, in_channels / groups, kernel_size], 'float32');
    const input = new torus([1, in_channels, input_data.length], 'float32');

    if (bias) {
        const bias_data = new Array(out_channels).fill(0);
        this.bias = new torus([out_channels], 'float32', bias_data);
    }

    this.forward = function(input_data) {
        input.data = input_data;

        const output_length = Math.floor((input.shape[2] + 2 * padding - kernel_size) / stride) + 1;
        const output = new torus([1, out_channels, output_length], 'float32');

        if (padding_mode === 'zeros') {
            const padded_input = tensor.pad(input, [0, 0, padding, padding], 'constant', 0);
            for (let g = 0; g < groups; g++) {
                for (let out_channel = g; out_channel < out_channels; out_channel += groups) {
                    for (let i = 0; i < output_length; i++) {
                        for (let j = 0; j < kernel_size; j++) {
                            const input_index = i * stride + j * dilation;
                            const in_channel = Math.floor(weight.data[out_channel + j * weight.shape[1] + g]) / groups;

                            output.data[i + out_channel * output_length] +=
                                padded_input.data[input_index + in_channel * padded_input.shape[2]] *
                                weight.data[out_channel + j * weight.shape[1] + g];
                        }
                    }
                    if (bias) {
                        output.data[i + out_channel * output_length] += bias.data[out_channel];
                    }
                }
            }
        } else {
            // Реализация других режимов заполнения (padding_mode)
        }

        return output;
    }
}


function Conv1dBackward(input, grad_output, weight, bias = null, stride = 1, padding = 0, dilation = 1, groups = 1) {
    const in_channels = input.shape[1];
    const out_channels = grad_output.shape[1];
    const kernel_size = weight.shape[2];

    const grad_input = new torus(input.shape, 'float32');
    if (bias !== null) {
        const grad_bias = new torus(bias.shape, 'float32');
        for (let i = 0; i < out_channels; i++) {
            grad_bias.data[i] = grad_output.sum(0, i);
        }
        return [grad_input, grad_weight, grad_bias];
    } else {
        const grad_weight = new torus(weight.shape, 'float32');
        for (let g = 0; g < groups; g++) {
            for (let i = 0; i < out_channels; i++) {
                if (g === i % groups) {
                    for (let j = 0; j < kernel_size; j++) {
                        const weight_index = i * weight.shape[1] * weight.shape[2] + (g + j * groups) * weight.shape[2] + j;
                        for (let k = 0; k < in_channels / groups; k++) {
                            const input_index = k * in_channels / groups + g + j * dilation;
                            const output_index = k * out_channels + i;
                            grad_weight.data[weight_index] += input.data[input_index] * grad_output.data[output_index];
                        }
                    }
                }
            }
        }

        if (padding_mode === 'zeros') {
            const padded_input = tensor.pad(input, [0, 0, padding, padding], 'constant', 0);
            for (let g = 0; g < groups; g++) {
                for (let i = 0; i < in_channels / groups; i++) {
                    for (let j = 0; j < out_channels; j++) {
                        if (g === j % groups) {
                            for (let k = 0; k < kernel_size; k++) {
                                const weight_index = j * weight.shape[1] * weight.shape[2] + (g + k * groups) * weight.shape[2] + k;
                                const input_index = i * in_channels / groups + g + k * dilation;
                                const output_index = i * out_channels + j;
                                grad_input.data[input_index] += weight.data[weight_index] * grad_output.data[output_index];
                            }
                        }
                    }
                }
            }
        } else {
            // Реализация других режимов заполнения (padding_mode)
        }

        return [grad_input, grad_weight];
    }
}
nn.ReLU = class ReLU extends nn.Module{
    constructor(net = {}){
        super(net);
    }
    forward(x){
        return x.relu();
    }
}

for(let module in nn){
    const ctor = nn[module];
    if(ctor instanceof nn.Module && ctor !== nn.Module)
        nn[module] = function (){
            return new ctor(...arguments);
        }
}
