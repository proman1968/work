import {nn} from '../neuro-module/neuro-module.js';
export const gpt = {};
gpt.HeadAttantion = class HeadAttantion extends nn.Module{
    constructor(props){
        super(props);
        this.div_k = this.props.d_attantion ** .5;
    }
    __init__(){
        let d_model = this.d_model;
        let d_attantion = this.d_attantion;
        this.Wq = tensor.rand([d_model, d_attantion]).p._label('Wq');
        this.Wk = tensor.rand([d_model, d_attantion]).p._label('Wk');
        this.Wv = tensor.rand([d_model, d_attantion]).p._label('Wv');
    }
    forward(input, hidden, mask){
        let Q = torus.einsum('.le, ea->.la', [input, this.Wq]);
        let K = torus.einsum('.le, ea->.la', [hidden || input, this.Wk]);
        let V = torus.einsum('.le, ea->.la', [hidden || input, this.Wv]);
        let scores = torus.einsum('.ia, .ja->.ij', [Q, K]);

        scores = scores.div(this.div_k);
        if(mask)
            scores = scores.masked_fill(mask, 0, -Infinity);

        let softmax = scores.softmax(-1);

        let Z = torus.einsum('.ij, .jd -> .id', [softmax, V]);
        return Z;
    }
}
gpt.Attantion = class Attantion extends nn.Module{
    constructor(props){
        super(props);
    }
    __init__(){
        this.headsArray = nn.List(this.heads, (_, i) => new gpt.HeadAttantion(this));
        this.Wo = tensor.rand([this.d_attantion * this.heads, this.d_model]).p._label('Wo');
    }
    forward(input, hidden, mask){
        let outputs = this.headsArray.map(head=>head(input, hidden, mask));
        let output = torus.concat(outputs, -1);
        output = torus.einsum('.lh, he->.le', [output, this.Wo]);
        return output;
    }
}
gpt.EncoderLayer = class EncoderLayer extends nn.Module{
    constructor(props){
        super(props);
    }
    __init__(){
        this.self_attantion = new gpt.Attantion(this);
        this.ff = tensor.rand([this.d_model, this.d_model]).p._label('att feed');
        this.rms = new nn.RMSNorm(this);
    }
    forward(input){
        let output = this.self_attantion(input);
        output = this.feed(output, input);
        return output;
    }
    feed(output, input){
        output = output.plus(input);
        output = torus.einsum('.la, ab->.lb', [output, this.ff]);
        output = this.rms(output);
        return output;
    }
}
gpt.Encoder = class Encoder extends nn.Module{
    constructor(props){
        super(props);
    }
    __init__(){
        this.layersArray = nn.List(this.layers, (_, i) => new gpt.EncoderLayer(this));
    }
    forward(input){
        let output = input;
        for(let layer of this.layersArray)
            output = layer(output);
        return output;
    }
}
gpt.DecoderLayer = class DecoderLayer extends nn.Module{
    constructor(props){
        super(props);
    }
    __init__(){
        this.self_attantion = new gpt.Attantion(this);
        this.cross_attantion = new gpt.Attantion(this);
        this.ff = tensor.rand([this.d_model, this.d_model]).p;
        this.rms = new nn.RMSNorm(this.d_model);
    }
    forward(input, hidden){
        let output = this.self_attantion(input, undefined, this.props.main.mask);
        output = this.cross_attantion(output, hidden);
        output = this.feed(output, input);
        return output;
    }
    feed(output, input){
        output = output.plus(input);
        output = torus.einsum('.la, ab->.lb', [output, this.ff]);
        output = this.rms(output);
        return output;
    }
}
gpt.Decoder = class Decoder extends nn.Module{
    constructor(props){
        super(props);
        this.start = tensor.ones(this.d_model);
    }
    __init__(){
        this.layersArray = nn.List(this.layers, (_, i) => new gpt.DecoderLayer(this));
    }
    *forward(hidden){
        let size = this.content_size;
        let dim = this.d_model;
        this.input = this.props.main.input;
        this.input.set(this.start);
        let output = this.input;

        let idx = 1;
        while(idx < size && this.input){
            for(let layer of this.layersArray)
                output = layer(output, hidden);
            let emb = output.slice(-1, -1, ':');
            emb = emb.view(dim);
            this.input.set(emb, idx * this.d_model);
            idx++;
            yield emb;
        }
    }
}
gpt.SinusoidalPositionalEncoding = class SinusoidalPositionalEncoding extends nn.Module{
    constructor(props = {}){
        super(props, {d_model: 256, max_len: 5000});
        // Создаем матрицу позиционного кодирования
        let position = tensor.arange(0, this.max_len).unsqueeze(1);

        // Вычисляем делитель
        let div_term = tensor.arange(0, this.d_model, 2);

        div_term = div_term.mul(-Math.log(10000.0) / this.d_model);

        let mul = position.mul(div_term);
        let sin  = mul.sin();
        let cos  = mul.cos();
        // sin.unsqueeze(2);
        // cos.unsqueeze(2);
        // this.pe = torus.concat([sin, cos], -1);
        this.pe = torus.stack([sin, cos], -1)._label('sin & cos');
        this.pe._shape(this.max_len, this.d_model);
    }
    forward(x){
        let slice = this.pe.slice(':' + x.shape[0]);
        return x.plus(slice);
    }
}