ODA({is: 'oda-tabs', imports: 'oda//button',
    template: /*html*/`
        <style>
            :host{
                overflow: hidden;
                max-width: 100%;
                max-height: 100%;
                align-items: center;
                min-width: 48px;
                min-height: 32px;
            }
            .arrow {
                border-radius: 50%;
                padding: 0;
                @apply --shadow;    
                transform: scale(.7);            
            }
            #scroller{
                position: relative;
                overflow: hidden; 
                align-items: center; 
                flex-wrap: nowrap;
            }
            #scroller::-webkit-scrollbar {
                width: 3px;
                height: 3px;
            }
            :host([selected]) {
                outline: 2px solid var(--accent-color);
            }
            div[role="tabpanel"] {
                outline: none;  /* скрываем черную рамку при фокусе */
            }
        </style>
        <oda-button 
            ~if="__scrollSize > __scrollerWidth" 
            :disabled="__scrollPos === 0" 
            no-flex 
            :rotate="iconRotate" 
            class="arrow" 
            :icon-size
            icon="icons:chevron-left" 
            @tap="step(-1)">
        </oda-button>
        <div role="tabpanel" flex
            aria-label="Tabs" 
            :direction="direction === 'vertical' ? 'horizontal' : 'vertical'" 
            style="overflow: hidden" 
            tabindex="0" 

            @keydown>
            <div style="overflow-x: auto"></div>
            <div id="scroller" 
                @resize="_onResize" 
                @scroll="_onScroll" 
                :direction 
                @mousewheel.passive 
                @dragover>
                <oda-tabs-tab 
                    role="tab" 
                    :aria-selected="$for.index === focusedIndex"  
                    :selected="$for.index === selectedIndex && selectedIndex !== focusedIndex"
                    :draggable="allowDrag" 
                    ~for="items" 
                    :item="$for.item" 
                    :index="$for.index">
                </oda-tabs-tab>  
                <div flex></div>
                <div style="overflow: hidden; justify-self: end;"  :direction>
                    <oda-button :icon-size="iconSize * 1.2" style="margin: 8px;"
                        role="button" 
                        ~for="buttons" 
                        ~props="$for.item">
                    </oda-button> 
                </div>
            </div>

        </div>

        <oda-button 
            ~if="__scrollSize > __scrollerWidth" 
            :disabled="__scrollPos >= (__scrollSize - __scrollerWidth)"  
            no-flex 
            :rotate="iconRotate" 
            class="arrow" 
            :icon-size
            icon="icons:chevron-right"  
            @tap="step(1)">
        </oda-button>
        <oda-button 
            :icon-size 
            no-flex 
            :rotate="iconRotate" 
            style="padding: 6px" 
            ~if="items?.some(i => typeof i.close === 'function')"  
            icon="icons:close" 
            title="close all tabs" 
            @tap="closeAll">
        </oda-button>
    `,
    get _directionStyle() {
        return `flex-direction: ${this.align === 'right' || this.align === 'bottom' ? 'row-reverse' : 'row'}`;
    },
    buttons: [],
    _onResize() {
        this.__is_vertical = undefined;
    },

    _onScroll() {
        this.__is_vertical = undefined;
    },

    attached() {
        requestAnimationFrame(() => {
            this.focusedTab?.scrollIntoView({ 
                inline: 'center', 
                block: 'center' 
            });
        });
    },
    _onDragover(e){

            e.dataTransfer.effectAllowed = "move";
            e.preventDefault();
            let pos = this.__is_vertical?e.clientY:e.clientX;
            let delta = pos - drag.start;
            const rect = e.currentTarget.getBoundingClientRect();
            let start = this.__is_vertical?rect.top:rect.left;
            let end = this.__is_vertical?rect.bottom:rect.right

            if (pos < drag.pointer + start){
                drag.start += this.__scroll((drag.pointer + start - pos)/2);
            }
            else if (pos + drag.item[this.offsetSize] - drag.pointer > end){
                drag.start += this.__scroll((end - (pos + drag.item[this.offsetSize] - drag.pointer))/2);
            }

            let tr = 'translate' + (this.__is_vertical?'Y':'X');
            let drag_start = pos - drag.pointer;
            drag.index = undefined;
            for (let el of drag.item.parentElement.children){
                if (el[REACTOR].sleep) continue;
                let el_pos = this.__is_vertical?el.offsetTop:el.offsetLeft - this.__scrollPos;
                if (el === drag.item)
                    el.style.transform = tr + `(${delta}px)`;
                else if (el_pos < drag.start && el_pos > drag_start - start - drag.item[this.offsetSize] / 2){
                    el.style.transform = tr + `(${drag.item[this.offsetSize]}px)`;
                    drag.index = el.index;
                }
                else if (el_pos > drag.start && el_pos + el[this.offsetSize] / 2 < drag_start - start + drag.item[this.offsetSize]){
                    el.style.transform = tr + `(${-drag.item[this.offsetSize]}px)`;
                    drag.index = el.index;
                }
                else{
                    el.style.transform = ''
                }
            }

    },
    get tabs(){
        return this;
    },
    _onMousewheel (e){
        this.__scroll(e.wheelDelta)
    },
    __scroll(step){
        let move = 0;
        switch (this.direction){
            case 'horizontal':
                move = this.__scroller.scrollLeft;
                this.__scroller.scrollLeft -= step;
                move -= this.__scroller.scrollLeft;
                break;
            case 'vertical':
                move = this.__scroller.scrollTop;
                this.__scroller.scrollTop -= step;
                move -= this.__scroller.scrollTop;
                break;
        }
        return move;
    },
    toHome(){
        this.__scroller.scrollTop = this.__scroller.scrollLeft = 0
    },
    toEnd(){
        this.__scroller.scrollTop = this.__scroller.scrollLeft = 100000000;
    },
    get __scroller(){
        return this.$('#scroller') || undefined;
    },
    get __scrollSize(){
        return this.__is_vertical?this.__scroller?.scrollHeight:this.__scroller?.scrollWidth;
    },
    get __scrollPos(){
        return Math.round(this.__is_vertical?this.__scroller?.scrollTop:this.__scroller?.scrollLeft);
    },
    get __scrollerWidth(){
        return this.__is_vertical?this.__scroller?.offsetHeight:this.__scroller?.offsetWidth;
    },
    get __buttonSize(){
        return this.iconSize * .7
    },
    step(stepper = 0) {
        if (!stepper) return;
        this.__scrollPos = undefined; // сбрасываем кэш, что вызовет пересчет beforeTab/afterTab
        const target = stepper < 0 ? this.beforeTab : this.afterTab;
        target?.scrollIntoView({ 
            inline: 'nearest', 
            block: 'nearest' 
        });
        if (Math.abs(stepper) > 1) {
            this.step(stepper + (stepper < 0 ? 1 : -1));
        }
    },
    style:{
        $attr: true,
        get(){
            if (!this.__is_vertical)
                return `height: fit-content`;
            return `width: fit-content`;
        }
    },
    $public: {
        allowDrag: false,
        align: {
            $list: ['left', 'bottom', 'right', 'top'],
            $def: 'bottom',
            set(n){
                if (!this.__scroller) return;
                requestAnimationFrame(() => {
                    for (const el of this.__scroller.children[0].children) {
                        el.render(true);
                    }
                });
            }
        },
        focusedIndex: {  // переименовано с index
            $def: 0,
            $save: true,
            set(n) {
                this.selectedIndex = -1; // сбрасываем селектор при установке фокуса
                this.debounce('focusedIndex', () => {
                    this.focusedTab?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
                });
            }
        },
        iconSize: 24,
        tabRounding: 4,
        maxWidth: 200,
        dimmed: {
            $def: false,
            $save: true,
        },
        defaultIcon: ''
    },
    items: [],
    get focused(){
        return this.items?.[this.focusedIndex];  // переименовано с index
    },
    get beforeTab(){
        let item = this.__scroller?.firstChild?.firstChild;
        let pos = this.__scrollPos - 1;
        do{
            let start = item[this.offsetStart]
            if (start < pos && start + item[this.offsetSize] >= pos)
                return item;
        }
        while(item = item.nextElementSibling)
    },
    get afterTab(){
        let item = this.__scroller?.firstChild?.firstChild;
        let pos = this.__scrollPos + this.__scrollerWidth + 1;
        do{
            let start = item[this.offsetStart]
            if (start <= pos && start + item[this.offsetSize] > pos)
                return item;
        }
        while(item = item.nextElementSibling)
    },
    get focusedTab(){
        return this.__scroller?.firstChild?.children[this.focusedIndex] || null;  // переименовано с index
    },
    get alignSelf() {
        switch (this.align) {
            case 'left':
            case 'top':
                return 'self-start';
            case 'right':
            case 'bottom':
                return 'self-end';
        }
    },
    rotate: {
        $type: Number,
        get() {
            switch (this.align) {
                case 'left':
                    return 270;
                case 'right':
                    return 90;
                case 'top':
                    return 0;
                case 'bottom':
                    return 180;
            }
        }
    },
    get __is_vertical(){
        switch (this.align) {
            case 'left':
            case 'right':
                return true;
        }
        return false;
    },
    direction: {
        $type: String,
        $attr: true,
        get() {
            return this.__is_vertical?'vertical':'horizontal';
        }
    },
    get iconRotate(){
        return this.__is_vertical?90:0;
    },
    async closeAll() {
        await ODA.showConfirm('Close all tabs?');
        this.items.forEach(i => i.close?.());
    },
    get __shapeStyle(){
        switch (this.align){
            case 'top':
                return `max-width: ${this.maxWidth}px;`
            case 'right':
                return `max-height: ${this.maxWidth}px;`
            case 'bottom':
                return `max-width: ${this.maxWidth}px;`
            case 'left':
                return `max-height: ${this.maxWidth}px;`
        }
    },
    get __textFadeAngle(){
        return this.__is_vertical?0:90;
    },
    get offsetSize(){
        return this.__is_vertical?'offsetHeight':'offsetWidth';
    },
    get offsetStart(){
        return this.__is_vertical?'offsetTop':'offsetLeft';
    },
    selectedIndex: -1,
    _onKeydown(e) {
        const currentIndex = this.selectedIndex === -1 ? this.focusedIndex : this.selectedIndex;
        
        switch(e.key) {
            case 'Escape':
                this.selectedIndex = -1;
                requestAnimationFrame(() => {
                    this.focusedTab?.scrollIntoView({ 
                        inline: 'center', 
                        block: 'center' 
                    });
                });
                break;
                
            case '':
            case 'Enter':
                e.preventDefault();
                if(this.focusedIndex === currentIndex)
                    this.dimmed = !this.dimmed; 
                else
                    this.dimmed = false;
                this.focusedIndex = currentIndex;
                  // сбрасываем dimmed при установке фокуса
                break;
            
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                if (currentIndex > 0) {
                    const nextTab = this.__scroller?.firstChild?.children[currentIndex - 1];
                    const pos = nextTab[this.offsetStart];
                    if (pos <= this.__scrollPos) {
                        this.step(-1);
                    }
                    this.selectedIndex = currentIndex - 1;
                }
                break;
            
            case 'ArrowRight':
            case 'ArrowDown':
                e.preventDefault();
                if (currentIndex < this.items.length - 1) {
                    const nextTab = this.__scroller?.firstChild?.children[currentIndex + 1];
                    const pos = nextTab[this.offsetStart] + nextTab[this.offsetSize];
                    if (pos >= this.__scrollPos + this.__scrollerWidth) {
                        this.step(1);
                    }
                    this.selectedIndex = currentIndex + 1;
                }
                break;
            case 'Home':
                e.preventDefault();
                this.focusedIndex = 0;
                break;
            case 'End':
                e.preventDefault();
                this.focusedIndex = this.items.length - 1;
                break;
        }
    },
    _onDragStart(e) {
        const tab = e.target.closest('oda-tabs-tab');
        if (!tab) return;
        e.dataTransfer.setData('text/plain', '');
        e.dataTransfer.setDragImage(document.createElement('img'), 0, 0);
        this.dragTab = tab;
        this.dragTab.$pdp.state = 'info';
    },
    _onDragEnd(e) {
        if (this.dragTab) {
            this.dragTab.$pdp.state = '';
            this.dragTab = null;
        }
    }
})
const drag = {}
ODA({
    is: 'oda-tabs-tab',
    template: /*html*/`
        <style>
            :host{
                @apply --no-flex;
                @apply --horizontal;
                position: relative;
                overflow: hidden;
                min-width: 48px;
                min-height: 32px;
                transition: transform .5s;
            }
            .panel{
                align-items: center;
                padding: 2px;
                white-space: nowrap;
                overflow: hidden;
            }
            :host(:hover)>div{
                opacity: .9;
            }
            :host(:hover) oda-icon{
                scale: .9 !important;
            }
            .close{
                scale: .75;
                border-radius: 50%;
                cursor: pointer;
                padding: 0px;
            }
            .close:hover{
                @apply --active;            
            }
            label{
                overflow: hidden;
                font-size: x-small;
            }
            oda-icon{
                transition: scale .5s;
                scale: .75;
                margin: auto;
                padding: 2px;
            }
        </style>
        <div class="panel" flex :header="focused && !dimmed" :direction @tap="focus" ~style="__shapeStyle">
            <oda-icon :default="defaultIcon" ~if="icon || defaultIcon" :icon  :icon-size></oda-icon>
            <label flex ~if="label" ~html="label" ~style="{'mask-image': \`linear-gradient(\${__textFadeAngle}deg, #000 \${maxWidth * .7}px, transparent)\`}"></label>
            <div ~if="allowClose" style="min-width: 8px; min-height: 8px;">
                <oda-button ~if="allowClose" icon="icons:close" :icon-size="__buttonSize" class="close" @tap.stop="close"></oda-button>
            </div>
        </div>
    `,
    get allowClose(){
        return this.item?.allowClose || this.host.allowClose;
    },
    get defaultIcon()  {
        return this.item?.defaultIcon || this.host.defaultIcon;
    },
    get icon() {
        return this.item?.icon || '';
    },
    get label() {
        return this.item?.label || '';
    },
    get trackDelta(){
        return this.host.__is_vertical?'dy':'dx';
    },
    get trackTranslate(){
        return this.host.__is_vertical?'translateY':'translateX';
    },
    $listeners: {
        dragstart(e) {
            e.dataTransfer.setDragImage(document.createElement('img'), 0, 0);
            e.dataTransfer.effectAllowed = "move";
            drag.item = this;
            drag.item.style.transition = 'none';
            drag.item.style.zIndex = 1;
            drag.item.$pdp.state = 'info';  // Добавляем состояние info
            drag.pointer = this.host.__is_vertical ? e.offsetY : e.offsetX;
            drag.start = this.host.__is_vertical ? e.clientY : e.clientX;
        },
        dragend(e) {
            this.style.transform = '';
            drag.item.style.transition = '';
            drag.item.$pdp.state = '';  // Сбрасываем состояние
            this.style.zIndex = 0;
            for (let el of drag.item.parentElement.children) {
                el.style.transform = '';
            }
        },
        drop(e) {
            let pos = this.host.__is_vertical ? e.clientY : e.clientX + this.host.__scrollPos;
            let idx = 0;
            for (let el of drag.item.parentElement.children) {
                el.style.transform = '';
                pos -= el[this.host.offsetSize];
                if (pos >= 0)
                    idx++;
            }
            this.host.items.splice(this.index, 1);
            this.host.items.splice(idx, 0, this.item);
            if (this.focused) {
                this.host.index = this.host.items.indexOf(this.item);
            }
            this.host.render(); //todo лишний render
        }
    },
    index: -1,
    focus(e) {
        this.host.dimmed = this.host.focusedIndex === this.index && !this.host.dimmed;
        this.host.focusedIndex = this.index;
    },
    focused: {
        get() {
            return this.host.focusedIndex === this.index;
        }
    },
    item: null,
    close(e){
        this.$pdp.tabs.fire('close', this.item);
    }
})


