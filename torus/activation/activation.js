export class Activation{
    static sigmoid(discrete_steps = 0, max = 6){
        if (!discrete_steps){
            return function (tensor, target){
                let out = torus.get_out(tensor, 'sigmoid');
                if (!out){
                    out = torus.from(new Float64Array(tensor.size))._shape(tensor)._src(tensor)._label('sigmoid: ' + tensor.shape);
                    torus.set_out(tensor, out, 'sigmoid');
                    out._fwd = ()=>{
                        for (let i = 0; i < tensor.size; i++){
                            const x = tensor.data[i];
                            out.data[i] = 1 / (1 + Math.exp(-x));
                        }
                        return out;
                    }
                    out._back = ()=>{
                        for (let i = 0; i < tensor.size; i++){
                            const y = out.data[i];
                            tensor.grad.data[i] += out.grad.data[i] * y * (1 - y);
                        }
                    }
                }
                return out._fwd();
            }
        }

        const sigm_table_size = discrete_steps;
        const sigm_step = max * 2 / sigm_table_size;
        this.sigm_table ??= (()=>{
                    const table = new Float64Array(sigm_table_size);
                    let x;
                    for (let i = 0; i < sigm_table_size; i++){
                        x = i * sigm_step - max;
                        table[i] = 1 / (1 + Math.exp(-x));
                    }
                    return table;
                })();

        let code = `let out = torus.get_out(tensor, 'sigmoid');
if (!out){
    if (!torus.sigm_table)
        torus.sigm_table = (()=>{
            const table = new Float64Array(${sigm_table_size});
            let x;
            for (let i = 0; i < ${sigm_table_size}; i++){
                x = i * ${sigm_step} - ${max};
                table[i] = 1 / (1 + Math.exp(-x));
            }
            return table;
        })();
    out = torus.from(new Float64Array(tensor.size))._shape(tensor)._src(tensor)._label('sigmoid: ' + tensor.shape);
    torus.set_out(tensor, out, 'sigmoid');
    out._fwd = ()=>{
        const size = tensor.size;
        const data = tensor.data;
        const o_data = out.data;
        for (let i = 0; i < size; i++){
            const x = data[i];
            if (x < ${-max})
                o_data[i] = 0;
            else if (x >= ${max})
                o_data[i] = 1;
            else
                o_data[i] = torus.sigm_table[Math.trunc((x + ${max}) / ${sigm_step})];
        }
        return out;
    }
    out._back = ()=>{
        const size = tensor.size;
        const grad = tensor.grad.data;
        const o_grad = out.grad.data;
        const o_data = out.data;
        for (let i = 0; i < size; i++){
            const y = o_data[i];
            grad[i] += o_grad[i] * y * (1 - y);
        }
    }
}
return out._fwd();
`;

         return new Function ('tensor', code);
    }
}