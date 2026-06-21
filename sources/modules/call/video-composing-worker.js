/**@type {OffscreenCanvas} */
let canvas;
/**@type {OffscreenCanvasRenderingContext2D?} */
let ctx;
let columns = 0;
let rows = 0;
let width = 0;
let height = 0;
let gap = 0;
let framesCount = 0;
let currentRequestAnimationFrame = 0;
self.onmessage = function (event) {
    const { type, ...data } = event.data;
    switch (type) {
        case 'init': {
            ({ width, height, gap } = data);
            canvas = data.offscreen;
            ctx = canvas.getContext('2d');
        } break;
        case 'clear': {
            clear();
        } break;
        case 'compose_frames': {
            const { frames } = data;
            calcGrid(frames)
            drawCompositeFrame(frames);
        } break;
        default:
            break;
    }
}
/**@param {VideoFrame[]} frames*/
function calcGrid(frames) {
    if (framesCount === frames.length) return;
    framesCount = frames.length;
    columns = Math.ceil(Math.sqrt(framesCount));
    rows = Math.max(Math.ceil(framesCount / columns), columns);
}
function clear() {
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}
/**@param {VideoFrame[]} frames*/
function drawCompositeFrame(frames) {
    cancelAnimationFrame(currentRequestAnimationFrame);
    currentRequestAnimationFrame = requestAnimationFrame(async () => {
        if (!ctx) return;
        clear();
        if (!frames?.length) return;
        let column = 0;
        let row = 0;
        const w = Math.ceil(width / columns);
        const h = Math.ceil(height / rows);
        const _w = w - gap;
        const _h = h - gap;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 4;
        const current_rows = Math.ceil(frames.length / columns);
        const free_rows = rows - current_rows;
        const init_y = free_rows > 0 ? (free_rows * h) / 2 : 0;
        for (const frame of frames) {
            let _w_ = 0, _h_ = 0;
            const ratio = (frame.displayWidth || w) / (frame.displayHeight || h);
            if (ratio > 1) {
                _w_ = _w;
                _h_ = _h / ratio;
            }
            else {
                _w_ = _w * ratio;
                _h_ = _h;
            }
            const x = column * w + ((_w - _w_) / 2);
            const y = init_y + row * h + ((_h - _h_) / 2);
            ctx.drawImage(frame, x, y, _w_, _h_);
            ctx.strokeRect(x, y, _w_, _h_);
            frame.close();
            ++column;
            if (column === columns) {
                column = 0;
                ++row;
            }
        }
    });
}