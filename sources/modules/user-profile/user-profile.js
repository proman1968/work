const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
ODA({ is: 'user-profile', imports: 'oda//otp.js',
    template:/* html */`
    <style>
        :host {
            overflow: auto;
            @apply --light;
            @apply --vertical;
            @apply --flex;
            padding: max(8px, var(--safe-top, 0px)) max(12px, var(--safe-right, 0px)) max(16px, var(--safe-bottom, 0px)) max(12px, var(--safe-left, 0px));
            box-sizing: border-box;
        }
        input {
            border: 1px solid gray;
            padding: 8px;
            border-radius: 8px;
            font-size: large;
            width: 100%;
            box-sizing: border-box;
        }
        button {
            min-height: 44px;
            padding: 8px 14px;
            border-radius: 8px;
            font-size: medium;
            cursor: pointer;
            max-width: 100%;
            box-sizing: border-box;
        }
        legend {
            font-size: large;
        }
        .photo {
            background-color: {{photoColor}};
        }
        .profile-wrap {
            gap: 14px;
            width: min(360px, 100%);
            align-self: center;
            margin: 0 auto auto auto;
            box-sizing: border-box;
        }
        .token-row {
            gap: 8px;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            border: 1px solid gray;
            border-radius: 8px;
            padding: 6px 8px;
        }
    </style>
    <div no-flex vertical class="profile-wrap">
        <div ~if="pendingInvite?.valid" style="padding:10px 12px;border-radius:8px;border:1px solid #10b981;background:rgba(16,185,129,0.1);font-size:small;line-height:1.4;text-align:center;">
            <b>Приглашение:</b> {{pendingInvite.pointLabel}} → <b>{{pendingInvite.placeLabel}}</b>
        </div>
        <div vertical style="gap: 16px; align-items: center;">
            <div class="photo" vertical style="padding: 16px; border-radius: 50%;">
                <oda-icon :icon="photoIcon" round @tap="loadPhoto" style="border-radius: 50%; fill: white; color: white;" icon-size="180"></oda-icon>
            </div>
            <input id="name" placeholder="Имя" ::value="params.name" name="name">
            <input id="surname" placeholder="Фамилия" ::value="params.surname" name="surname">
            <input id="patronymic" placeholder="Отчество" ::value="params.patronymic" name="patronymic">
            <input id="email" :disabled="isLogin || showCode" placeholder="Email" ::value="params.email" type="email" name="email" :error="!correctEmail" :success="correctEmail">
            <oda-otp-input ~if="showCode" center @complete="_onCode"></oda-otp-input>
            <button ~if="state.label && !showCode" center horizontal :disabled="!correctEmail" flex raised :class="state.class" @tap.stop.prevent="register_start" style="gap: 8px;align-items: center;">
                <span>{{state.label}}</span>
                <oda-icon ~if="state.icon" :icon="state.icon"></oda-icon>
            </button>
            <div ~if="isLogin && state?.name === 'ok' && !showCode" vertical style="gap: 8px; width: 100%; border-top: 1px solid rgba(128,128,128,.3); padding-top: 12px; margin-top: 4px;">
                <div style="font-size: medium; font-weight: 600; text-align: center;">Подключения</div>
                <button center horizontal flex @tap.stop.prevent="mcp_token" title="Один токен для внешних ИИ-клиентов (MCP) и расширения WORK Chrome Bridge">
                    <span>Токен для подключения</span>
                </button>
                <div style="font-size: small; text-align: center; opacity: 0.75; line-height: 1.35;">
                    Этот же токен вместе с адресом WORK вводится в расширении <b>WORK Chrome Bridge</b> и MCP-клиентах.
                </div>
                <button center horizontal flex @tap.stop.prevent="mcp_list" title="Список токенов: срок жизни, последнее использование, отзыв по одному">
                    <span>Список токенов…</span>
                </button>
                <div ~if="mcpList" vertical style="gap: 8px; width: 100%;">
                    <div ~if="!mcpList.length" style="font-size: small; text-align: center;">токенов нет</div>
                    <div ~for="mcpList" horizontal style="gap: 8px; align-items: center; justify-content: space-between; border: 1px solid gray; border-radius: 8px; padding: 4px 8px;">
                        <span flex>{{$for.item.label}}{{$for.item.role ? ' (' + $for.item.role + ')' : ''}}</span>
                        <span no-flex style="font-size: small;">{{$for.item.expired ? 'истёк' : 'до ' + fmtDate($for.item.expires)}} · был{{fmtDate($for.item.lastUsed)}}</span>
                        <button no-flex style="height: 32px; font-size: medium;" @tap.stop.prevent="mcp_revoke_one($for.item.id)">Отозвать</button>
                    </div>
                </div>
                <button center horizontal flex @tap.stop.prevent="mcp_revoke">
                    <span>Отозвать все токены</span>
                </button>
            </div>
    </div>
        <div flex style="text-align: center;" ~html="state.legend"></div>
        <div flex style="text-align: center;" :error="!!error" @tap="fill_code">{{text}}</div>
    </div>
    `,
    error: null,
    text: '',
    get state(){
        if(!this.isRegistered || this.error)
            return {
                name: 'unregistered',
                label: 'Register KEY',
                legend: 'Для входа в систему необходимо зарегистрировать ключ безопасности. <p>Ключ будет создан на Вашем устройстве, и привязан к адресу электронной почты.',
                class: 'success-invert'
            }
        if(!this.isLogin)
            return {
                name: 'need-check',
                label: 'Check KEY',
                legend: 'Вы не вошли в систему, требуется проверка ключа.',
                class: 'error-invert'
            }
        if(this.isChanged)
            return {
                name: 'changed',
                label: 'Update KEY',
                legend: 'Профиль изменен, требуется обновление ключа.',
                class: 'info-invert'
            }
        return {
            name: 'ok',
            label: 'logout',
            legend: 'Ваш uid: ' + WORK.uid,
            class: 'info-invert',
            icon: 'games:exit-door'
        }
    },
    get user_label() {
        return ((this.params.surname || '') + ' ' + (this.params.name || '') + ' ' + (this.params.patronymic || '')).trim() || this.params.email;
    },
    get photoIcon() {
        if (this.params.icon)
            return this.params.icon;
        if (!this.user_label)
            return 'image:photo-camera';
        let label = this.user_label.split(' ');
        label = label.map(s => s[0].toUpperCase()).join('')
        return '@:' + label;
    },
    get photoColor() {
        return Promise.resolve(this.uid).then(id => {
            let hash = 0;
            for (let i = 0; i < id.length; i++) {
                hash = id.charCodeAt(i) + ((hash << 5) - hash);
            }
            // Преобразуем хэш в HEX цвет
            let color = '#';
            for (let i = 0; i < 3; i++) {
                const value = (hash >> (i * 8)) & 0xFF;
                color += value.toString(16).padStart(2, '0');
            }
            return (this.photoColor = color);
        })
    },
    async loadPhoto(e) {
        const el = ODA.createElement('crop-image')
        const cameraClickButton = {
            icon: 'bootstrap:camera-fill',
        };
        cameraClickButton.tap = (e) => {
            if (el.cropMode) {
                e.currentTarget.icon = e.currentTarget.host.BUTTONS[0].icon = 'bootstrap:camera-fill';
                el.startTracking();
            }
            else {
                e.currentTarget.icon = e.currentTarget.host.BUTTONS[0].icon = 'bootstrap:camera-reels-fill';
                el.stopTracking();
            }
        }
        const result = await WORK.showDialog(el, { TITLE: { label: 'Crop photo' }, BUTTONS: [cameraClickButton] });
        if (result) {
            this.params.icon = el.croppedBase64;
        }
    },
    fill_code() {
        const otp = this.$('oda-otp-input');
        if (otp && this.text.length === otp.length)
            otp.value = this.text;
    },
    get isRegistered() {
        return !!this.credentials?.uid;
    },
    get isLogin(){
        return !!WORK.uid && this.credentials?.uid === WORK.uid;
    },
    get isChanged() {
        for(let key in this.params){
            if(this.credentials?.[key] !== this.params[key])
                return true;
        }
        return false;
    },

    attached() {
        this.credentials = this.workSecure.getItem('credentials');
        this._loadPendingInvite();
    },
    pendingInvite: null,
    pendingInviteToken: '',
    async _loadPendingInvite() {
        try {
            const urlTok = new URLSearchParams(window.location.search || '').get('invite') || '';
            const tok = urlTok || sessionStorage.getItem('work.pendingInviteToken') || '';
            if (!tok)
                return;
            if (urlTok)
                sessionStorage.setItem('work.pendingInviteToken', urlTok);
            this.pendingInviteToken = tok;
            const info = await WORK.fetch('/', 'invite_info', {}, { token: tok });
            if (info?.valid) {
                this.pendingInvite = info;
                if (info.channel === 'email' && info.recipient && !this.params.email)
                    this.params.email = info.recipient;
            }
        }
        catch { /* ignore */ }
    },
    credentials: {
        $def: null,
        set(n) {
            if (n) {
                this.params = Object.assign(this.params, n);
            }
        }
    },
    get correctEmail() {
        this.uid = undefined;
        this.photoColor = undefined;
        let email = this.params.email;
        if (!email || typeof email !== 'string') return false;
        const trimmed = email.trim().toLowerCase();
        // Базовая проверка длины и наличия @
        if (trimmed.length > 254 || !trimmed.includes('@')) return false;
        return emailRegex.test(trimmed);
    },
    params: {
        name: '',
        surname: '',
        patronymic: '',
        email: '',
        icon: '',
        get label(){
            return ((this.surname || '') + ' ' + (this.name || '') + ' ' + (this.patronymic || '')).trim() || this.email;
        }
    },
    get uid() {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.params.email)).then(hashBuffer => {
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            const userId = hashHex.slice(0, 16);
            return userId.toUpperCase();
        })
    },
    reg: null,
    showCode: false,
    mcpList: null,
    fmtDate(ms) {
        return ms ? new Date(ms).toLocaleDateString() : '—';
    },
    /** Список токенов MCP: подпись, срок жизни, последнее использование; каждый можно отозвать отдельно. */
    async mcp_list() {
        this.mcpList = this.mcpList ? null : await WORK.fetch('/', 'mcp_token_list', {}, {});
    },
    async mcp_revoke_one(id) {
        try {
            await WORK.showConfirm('Отозвать этот токен? Подключённый клиент перестанет работать.');
        }
        catch { return; }
        try {
            await WORK.fetch('/', 'mcp_token_revoke', {}, { id });
            this.mcpList = await WORK.fetch('/', 'mcp_token_list', {}, {});
        }
        catch (e) {
            this.text = e.message;
        }
    },
    get workSecure() {
        return ODA.LocalStorage.create('work-secure');
    },
    /** Токен подключения (MCP и WORK Chrome Bridge): выпускается вошедшим пользователем, показывается один раз. */
    async mcp_token() {
        try {
            await WORK.showConfirm('Выпустить персональный токен для подключения (WORK Chrome Bridge, OpenCode, Claude Code…)? Он даёт доступ к WORK с вашими правами и покажется один раз.');
        }
        catch { return; }
        try {
            const r = await WORK.fetch('/', 'mcp_token_create', {}, { label: 'Подключение (MCP / Chrome)' });
            if (this.mcpList)
                this.mcpList = await WORK.fetch('/', 'mcp_token_list', {}, {});
            if (typeof WORK.showModal === 'function') {
                const dlg = ODA.createComponent('user-token', {
                    token: r.token,
                    origin: location.origin,
                });
                try {
                    await WORK.showModal(dlg, {
                        TITLE: { label: 'Токен подключения' },
                        allowClose: true,
                        BUTTONS: [],
                    });
                }
                catch { /* закрыли окно */ }
            }
            else {
                prompt('Токен подключения — скопируйте, повторно он не показывается.\nАдрес сервера: ' + location.origin + '\nАдрес MCP: ' + location.origin + '/mcp', r.token);
            }
        }
        catch (e) {
            this.text = e.message;
        }
    },
    async mcp_revoke() {
        try {
            await WORK.showConfirm('Отозвать все токены подключения? Подключённые внешние клиенты и Chrome Bridge перестанут работать.');
        }
        catch { return; }
        try {
            const r = await WORK.fetch('/', 'mcp_token_revoke', {}, { all: true });
            if (this.mcpList)
                this.mcpList = await WORK.fetch('/', 'mcp_token_list', {}, {});
            this.text = 'Токенов отозвано: ' + (r?.revoked ?? 0);
        }
        catch (e) {
            this.text = e.message;
        }
    },
    async register_start(e) {
        this.params.uid = await this.uid;
        switch (this.state?.name) {
            case 'ok': {
                await WORK.showConfirm('Выйти из учётной записи?');
                await WORK.removeCurrentPushSubscription?.();
                await WORK.fetch("/", 'user_exit', {}, this.params);
                this.params.uid = undefined;
                WORK.uid = '';
                WORK.USER = undefined;
                WORK.credentials = this.workSecure.setItem('credentials', this.params);
                this.workSecure.setItem('KEY', null);

                location.reload();
            } break;
            case 'need-check': {
                this.check();
            } break;
            case 'changed':
            case 'unregistered': {
                try {
                    const regPayload = { ...this.params, ...(this.pendingInviteToken ? { inviteToken: this.pendingInviteToken } : {}) };
                    const res = await WORK.fetch("/", 'user_register_start', {}, regPayload);
                    if (res && typeof res === 'object' && res.autoCode) {
                        this.text = res.message || 'Идет процесс регистрации ключа безопасности...';
                        await this._onCode({ detail: { value: res.autoCode } });
                        break;
                    }
                    this.text = typeof res === 'string' ? res : (res?.message || '');
                    this.showCode = true;
                }
                catch (e) {
                    this.text = e.message;
                }
            } break;
        }
        this.error = null;
        return true;
    },
    async _onCode(e) {
        try {
            this.text = "Идет процесс регистрации ключа безопасности...";
            this.showCode = false;
            let code = await e.detail.value;

            // 1. Проверяем код и получаем challenge
            let options = await WORK.fetch("/", 'user_register_process', { code }, this.params);

            // 2. Создаем ключи
            const keyPair = await window.crypto.subtle.generateKey({
                name: "RSASSA-PKCS1-v1_5", // Для подписи
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256"
            },
                true, // можно экспортировать
                ["sign", "verify"] // использование
            )
            let publicKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
            this.params.publicKey = WORK.arrayBufferToBase64(publicKey);
            this.workSecure.clientId ??= Date.now();
            this.params.time ??= this.workSecure.clientId;
            // 3. Подписываем challenge
            let signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, keyPair.privateKey, new TextEncoder().encode(options.challenge));
            signature = WORK.arrayBufferToBase64(signature);
            const finishPayload = { signature, credentials: this.params, ...(this.pendingInviteToken ? { inviteToken: this.pendingInviteToken } : {}) };
            const resp = await WORK.fetch("/", 'user_register_finish', {}, finishPayload);
            if (this.pendingInviteToken) {
                try { sessionStorage.removeItem('work.pendingInviteToken'); } catch { /* ignore */ }
                this.pendingInviteToken = '';
                this.pendingInvite = null;
                try {
                    const u = new URL(window.location.href);
                    if (u.searchParams.has('invite')) {
                        u.searchParams.delete('invite');
                        history.replaceState(null, '', u.pathname + u.search + u.hash);
                    }
                } catch { /* ignore */ }
            }
            this.workSecure.setItem('credentials', this.params);
            let privateKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
            privateKey = WORK.arrayBufferToBase64(privateKey);
            this.workSecure.setItem('KEY', privateKey);
            await this.check();
            this.credentials = this.params;
            this.isLogin = undefined;
        }
        catch (e) {
            this.text = e.message;
        }
    },
    check() {
        return WORK.login().then(res => {
            this.error = null;
            this.text = res;
        }).catch(e => {
            this.error = e;
            this.text = e.message;
        });
    }
})

ODA({is: 'crop-image',
    template:/* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --dark;
            }
            .frame {
                position: absolute;
                cursor: grab;
                border: {{frameBorder}}px solid var(--error-color);
                display: {{frameDisplay}};
                left: {{frameX}}px;
                top: {{frameY}}px;
                width: {{frameSize}}px;
                height: {{frameSize}}px;
            }{}
        </style>
        <video ~if="!cropMode" @loadedmetadata="_onloadedmetadata" style="width: 300px;"></video>
        <div ~if="cropMode && src" class="vertical">
            <div class="vertical" style="position: relative;">
                <img width="300" :src @load="_onload" @error="_onerror"/>
                <div class="frame" @pointerdown="_dragPointerDown"></div>
            </div>
            <div horizontal>
                <input flex type="range" id="size" name="size" :min="minFrameSize" :max="maxFrameSize" :value="frameSize" step="2" style="margin: 8px;" @input="_onInput"/>
            </div>
        </div>
    `,
    cropMode: false,
    src: '',
    frameDisplay: 'none',
    frameBorder: 2,
    frameX: 0,
    frameY: 0,
    frameSize: 0,
    minX: 0,
    minY: 0,
    minFrameSize: 32,
    maxFrameSize: 0,
    maxW: 0,
    maxH: 0,
    userStream: null,
    croppedBase64: '',
    videoTrack: null,
    imageCapture: null,
    get imageElement() {
        return this.$('img');
    },
    attached() {
        this.startTracking();
    },
    detached() {
        if (this.userStream)
            this.userStream.getTracks().forEach(track => track.stop());
    },
    startTracking() {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(async stream => {
                this.cropMode = false;
                this.userStream = stream;
                const track = stream.getVideoTracks()[0];
                this.async(() => {
                    this.$('video').srcObject = new MediaStream([track]);
                }, 100);
                this.videoTrack = track;
                this.imageCapture = new ImageCapture(track);
                this.src = '';
            })
            .catch(err => console.error('Ошибка камеры:', err))
    },
    stopTracking() {
        this.imageCapture.takePhoto()
            .then(async blob => {
                this.cropMode = true;
                this.src = await blobToBase64(blob);
            })
            .catch(err => console.error('Ошибка фото:', err))
            .finally(e => {
                this.userStream.getTracks().forEach(track => track.stop());
            });
    },
    _onloadedmetadata(e) {
        e.target.play();
    },
    _onload(e) {
        const imgEl = e.currentTarget;
        this.maxFrameSize = Math.min(imgEl.offsetWidth, imgEl.offsetHeight);

        this.frameSize = Math.floor(this.maxFrameSize * 0.9);
        this.frameX = Math.floor((imgEl.offsetWidth  - this.frameSize) / 2);
        this.frameY = Math.floor((imgEl.offsetHeight - this.frameSize) / 2);
        this.frameDisplay = 'block';

        this.maxW = imgEl.offsetWidth  - this.frameSize - this.frameBorder * 2;
        this.maxH = imgEl.offsetHeight - this.frameSize - this.frameBorder * 2;

        this.cropImage();
    },
    _onerror(e) {
        console.error('An error occurred while loading the image.', e);
    },
    _onInput(e) {
        const d = (this.frameSize - +e.currentTarget.value) / 2;
        if (!!d) {
            this.frameX += d;
            this.frameY += d;
            this.frameSize -= 2 * d;

            const imgEl = this.imageElement;
            this.maxW = imgEl.offsetWidth  - this.frameSize - this.frameBorder * 2;
            this.maxH = imgEl.offsetHeight - this.frameSize - this.frameBorder * 2;
            this.cropImage();
        }
    },
    _dragPointerDown(e) {
        e.preventDefault();

        let clientX = e.clientX;
        let clientY = e.clientY;

        const move = (e) => {
            e.preventDefault();
            const newX = this.frameX - (clientX - e.clientX);
            const newY = this.frameY - (clientY - e.clientY);

            if ((newX >= this.minX) && (newX <= this.maxW)) {
                this.frameX = newX;
                clientX = e.clientX;
            }
            if ((newY >= this.minY) && (newY <= this.maxH)) {
                this.frameY = newY;
                clientY = e.clientY;
            }
        }

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', () => {
            this.cropImage();
            window.removeEventListener('pointermove', move, { once: true });
        }, { once: true });
    },
    cropImage() {
        const imgEl = this.imageElement;

        const naturalSize = Math.min(imgEl.naturalWidth, imgEl.naturalHeight);
        const koef = naturalSize / this.maxFrameSize;

        const canvas = document.createElement('canvas'); // Get the canvas element
        canvas.width = this.frameSize;
        canvas.height = this.frameSize;

        const ctx = canvas.getContext('2d');

        ctx.drawImage(
            imgEl,
            this.frameX * koef, this.frameY * koef, this.frameSize * koef, this.frameSize * koef, // Source clipping
            0, 0, this.frameSize, this.frameSize          // Destination placement
        );

        // Get the new Base64 data URL from the canvas
        this.croppedBase64 = canvas.toDataURL('image/png'); // Can specify 'image/jpeg' for smaller size
    }
})
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            // Extract the Base64 part from the data URL (e.g., data:image/png;base64,...)
            const base64String = reader.result
            resolve(base64String);
        };
        // Reads the Blob and returns a data URL
        reader.readAsDataURL(blob);
    });
}
