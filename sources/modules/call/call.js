export class RTCCaller extends EventTarget {
    static CALL_SOUND_PATH = '/sources/modules/call/call.mp3';
    static AWAIT_SOUND_PATH = '/sources/modules/call/await.mp3';
    static current_call = null;
    static SETTINGS_KEY = 'RTCCaller.settings';
    get settings() {
        const def = { audioEnabled: true, videoEnabled: true };
        try {
            const value = localStorage.getItem(RTCCaller.SETTINGS_KEY);
            if (!value) return def;
            return { ...def, ...JSON.parse(value) };
        }
        catch (err) {
            return { ...def };
        }
    }
    set settings(settings) {
        localStorage.setItem(RTCCaller.SETTINGS_KEY, JSON.stringify(settings));
        this.dispatchEvent(new Event('settings-changed'));
        this.setTracks();
    }
    get audioEnabled() {
        return this.settings?.audioEnabled && !!RTCCaller.audioStream;
    }
    set audioEnabled(val) {
        const settings = this.settings;
        settings.audioEnabled = !!val;
        if (RTCCaller.audioStream) {
            const [track] = RTCCaller.audioStream.getAudioTracks();
            track.enabled = settings.audioEnabled;
        }
        this.settings = settings;
    };
    get videoEnabled() {
        return this.settings?.videoEnabled && !!RTCCaller.videoStream;
    };
    set videoEnabled(val) {
        const settings = this.settings;
        settings.videoEnabled = !!val;
        if (RTCCaller.videoStream) {
            const [track] = RTCCaller.videoStream.getVideoTracks();
            track.enabled = settings.videoEnabled;
        }
        this.settings = settings;
    };
    callForm = null;
    connectors = [];
    constructor(context, users, selfUser, isMain = false) {
        super();
        this.isMain = isMain;
        this.callContext = context;
        this.connectors = users.map(m => new PeerConnector(m));
        this.user = selfUser;
        if (this.isMain) {
            this.mainUser = this.user;
            this.renderer = new VideoRenderer();
            this.audioMixer = new AudioMixer();
            this.connectors.forEach(c => {
                const otherConnectors = this.connectors.filter(_c => _c !== c);
                c.addEventListener('changed', () => {
                    c.tracks.forEach(t => {
                        if (t.kind === 'audio') {
                            this.audioMixer.addTrack(t);
                            otherConnectors.forEach(oc => {
                                oc.audioMixer.addTrack(t);
                            });
                        }
                    })
                });
            });
            this.recorder = new Recorder(
                [
                    this.renderer.stream.getVideoTracks()[0],
                    this.audioMixer.stream.getAudioTracks()[0]
                ],
                this.callContext,
                users
            );
        }
        else {
            this.mainUser = users[0];
        }
        if (this.connectors?.length) {
            this.connected = new Promise(async (resolve, reject) => {
                this.addEventListener('destroy', () => {
                    reject('caller destroyed');
                }, { once: true });
                resolve(await Promise.any(this.connectors.map(c => c.connected)));
                RTCCaller.stopSound();
                this.recorder?.start();
            });
        }
        else {
            this.connected = true;
            this.recorder?.start();
        }
    }
    static initialization = null;
    static async initCall(call_info, isMain = false) {
        if (this.initialization) {
            return this.initialization;
        }
        return this.initialization = new Promise(async (resolve, reject) => {
            try {
                const callContext = await WORK.get_item(call_info.context);
                if (!callContext) {
                    throw new Error(`callContext not found "${call_info.context}"`,);
                }
                const receivers = call_info.receivers;
                if (!isMain) {
                    receivers.unshift(call_info.user);
                }
                const users = await Promise.all(receivers.map(uid => WORK.get_$user(uid)));
                const selfIdx = users.findIndex(u => u.id === WORK.uid);
                let selfUser;
                if (selfIdx > -1) {
                    [selfUser] = users.splice(selfIdx, 1);
                }
                else {
                    selfUser = await WORK.get_$user(WORK.uid);
                }
                const caller = new RTCCaller(callContext, users, selfUser, isMain);
                this.current_call = caller;
                WORK.top.addEventListener('beforeunload', this.on_beforeunload);
                WORK.top.addEventListener('unload', RTCCaller.on_unload);
                resolve(this.current_call);
            }
            catch (err) {
                console.warn(err);
                reject(err);
            }
        });
    }
    async setTracks() {
        if (this.isMain) {
            await RTCCaller.requestAudioStream();
            await RTCCaller.requestVideoStream();
            this.sendAudioState(this.audioEnabled);
            this.sendVideoState(this.videoEnabled);
            const audioTrack = RTCCaller.audioStream.getAudioTracks()[0];
            if (this.audioEnabled) {
                this.audioMixer.addTrack(audioTrack);
            }
            await Promise.all(this.connectors.map(async (connector) => {
                const [videoTrack] = this.renderer.stream.getVideoTracks();
                connector.sendTrack(videoTrack);
                connector.audioMixer.addTrack(audioTrack);
            }));
        }
        else {
            await Promise.all(this.connectors.map(async (connector) => {
                const audioStream = this.settings.audioEnabled && await RTCCaller.requestAudioStream();
                if (audioStream) {
                    const [track] = audioStream.getAudioTracks();
                    connector.audioMixer.addTrack(track);
                    this.sendAudioState(true);
                }
                else {
                    this.sendAudioState(false);
                }
                if (RTCCaller.screenStream) {
                    const [track] = RTCCaller.screenStream.getVideoTracks();
                    connector.sendTrack(track);
                    this.sendVideoState(true);
                }
                else if (this.settings.videoEnabled) {
                    const videoStream = await RTCCaller.requestVideoStream();
                    if (videoStream) {
                        const [track] = videoStream.getVideoTracks();
                        connector.sendTrack(track);
                        this.sendVideoState(true);
                    }
                    else {
                        this.sendVideoState(false);
                    }
                }
                else {
                    this.sendVideoState(false);
                }
            }));
        }
    }
    sendVideoState(value) {
        this.connectors.forEach(c => c.sendMessage({ type: 'video-changed', value }));
    }
    sendAudioState(value) {
        this.connectors.forEach(c => c.sendMessage({ type: 'audio-changed', value }));
    }
    async showCallForm() {
        let explorer = Array.prototype.find.call(WORK.top.document.body.children, el => el.begin_call)
        if (explorer) {
            this.callForm = await explorer?.begin_call();
        }
        else if (!this.callForm) {
            const dialog = ODA.createElement('dialog');
            dialog.style.padding = '0px';
            dialog.style.margin = '0px';
            dialog.style.border = 'none';
            dialog.style.outline = 'none';
            dialog.style.width = '100%';
            dialog.style.height = '100%';
            dialog.style.maxWidth = '100%';
            dialog.style.maxHeight = '100%';
            dialog.style.minWidth = '100%';
            dialog.style.minHight = '100%';
            WORK.top.document.body.appendChild(dialog);

            this.callForm = ODA.createElement('call-form');
            this.callForm.style.width = '100%';
            this.callForm.style.height = '100%';
            dialog.appendChild(this.callForm);

            dialog.oncancel = async (e) => {
                e.preventDefault();
                await RTCCaller.endCall();
                dialog.close();
            }
            dialog.onclose = () => {
                this.callForm = null;
                dialog.remove();
            }
            dialog.showModal();
            // WORK.showModal(this.callForm, { width: '100%', height: '100%' });
        }

        const connectors = [...this.connectors];

        if (this.isMain) {
            const selfConnector = new (class {
                user = RTCCaller.current_call.user;
                get videoEnabled() {
                    return RTCCaller.current_call.videoEnabled;
                }
                get audioEnabled() {
                    return RTCCaller.current_call.audioEnabled;
                }
                get tracks() {
                    return [
                        (RTCCaller.screenStream || RTCCaller.videoStream)?.getVideoTracks()[0]
                    ].filter(Boolean)
                }
            });
            connectors.unshift(selfConnector);
        }

        this.callForm.connectors = connectors;
        return this.callForm;
    }
    static async onmessage(message) {
        console.log('onmessage', message);
        await this.initialization;
        if (RTCCaller.current_call && RTCCaller.current_call.callContext?.short !== message.context) {
            this.busy(message);
            return;
        }
        console.log('onmessage reason', message.type);
        switch (message.type) {
            case 'offer': {
                await this.on_offer(message);
            } break;
            case 'answer': {
                await this.on_answer(message);
            } break;
            case 'timeout':
            case 'hang':
            case 'busy':
            case 'cancel': {
                this.on_cancel(message);
            } break;
            case 'end_call': {
                await this.on_end_call(message);
            } break;
        }
    }
    static async busy(message) {
        const callContext = await WORK.get_item(message.context);
        await RTCCaller.sendMessage(
            callContext,
            {
                user: WORK.uid,
                type: 'busy',
                context: callContext?.short,
                receivers: [message.user]
            }
        );
    }
    static async on_offer(message) {
        if (!message.descriptions) {
            throw new Error('no descriptions init in offer message');
        }
        let type = message.silent ? 'answer' : 'cancel';
        if (!message.silent) {
            this.playSound(this.CALL_SOUND_PATH, true);
            type = await this.showAnswerDialog(message);
            this.stopSound();
        }
        console.log('answerDialogResult = ', type);
        switch (type) {
            case 'answer': {
                const caller = await this.initCall({
                    ...message,
                    receivers: []
                });
                const connector = caller.getConnector(message.user);
                if (!connector) {
                    throw new Error(`no connector for "${message.user}"`);
                }
                const description = message.descriptions.find(d => d.uid === WORK.uid);
                await connector.setOffer(description.offer);
                await connector.addCandidates(description.candidates);
                await caller.setTracks();
                await caller.sendAnswer(message.user);
                await caller.showCallForm();
            } break;
            case 'cancel': {
                const callContext = await WORK.get_item(message.context);
                await RTCCaller.sendMessage(
                    callContext,
                    {
                        user: WORK.uid,
                        type,
                        context: callContext?.short,
                        receivers: [message.user]
                    }
                );
            } break;
            case 'handled-in-other-tab': { } break;
        }
        this.offerWasSeen = false;
    }
    static async on_cancel(message) {
        if (!RTCCaller.current_call) {
            if (this.currentAnswerDialog) {
                this.currentAnswerDialog.domParent.close('end_call');
            }
            return;
        }
        RTCCaller.current_call.removeConnector(message.user);
        if (RTCCaller.current_call.connectors.length === 0) {
            RTCCaller.current_call.destroy();
        }
    }

    static async on_answer(message) {
        if (!RTCCaller.current_call) {
            return;
        }
        if (!message.answer) {
            throw new Error('no answer init in answer message');
        }
        const connector = RTCCaller.current_call.getConnector(message.user);
        if (!connector) {
            throw new Error(`no connector for "${message.user}"`);
        }
        await connector.setAnswer(message.answer);
        await connector.addCandidates(message.candidates);
    }

    static async on_end_call(message) {
        if (!RTCCaller.current_call) {
            if (this.currentAnswerDialog) {
                this.currentAnswerDialog.domParent.close('end_call');
            }
            return;
        }
        const allConnectors = [...RTCCaller.current_call.connectors];
        for (const c of allConnectors) {
            RTCCaller.current_call.removeConnector(c.user.id);
        }
        if (RTCCaller.current_call.connectors.length === 0) {
            RTCCaller.current_call.destroy();
        }
    }

    static async sendMessage(callContext, signalMessage) {
        console.log('sendMessage', signalMessage);
        let file = new File([JSON.stringify(signalMessage)], 'phone.call', { type: "application/json" });
        let params = { receivers: signalMessage.receivers };
        await callContext.save_file(file, params);
    }

    static currentAnswerDialog = null;
    static answerDialogResult = null;

    static async showAnswerDialog(message) {
        return this.answerDialogResult ??= new Promise(async (resolve) => {
            const dialog = this.currentAnswerDialog = ODA.createElement('oda-call-answer');
            dialog.user = await WORK.get_$user(message.user);

            let result = 'cancel';
            try {
                result = await WORK.showDialog(dialog, {
                    iconSize: 48, style: "border-radius: 32px;",
                    OK: { icon: 'communication:call', result: 'answer', round: true, style: "margin: 16px;", success: true },
                    CANCEL: { icon: 'communication:call-end', error: true, round: true, style: "margin: 16px;" }
                })
            }
            catch (err) {
                result = 'cancel';
            }
            this.currentAnswerDialog = null;
            this.answerDialogResult = null;
            this.broadcastChannel.postMessage({
                type: 'call-handled'
            });
            resolve(result);
        })
    }
    static on_beforeunload(e) {
        if (RTCCaller.current_call) {
            e.preventDefault();
        }
    }
    static on_unload() {
        if (RTCCaller.current_call) {
            RTCCaller.current_call.endCall();
        }
    }
    static async startCall(context, receivers) {
        const caller = await this.initCall({ user: WORK.uid, context: context.short, receivers }, true);
        await caller.setTracks();
        caller.sendOffers(receivers);
        this.playSound(this.AWAIT_SOUND_PATH, true);
        caller.showCallForm();
    }
    static async startRecord(context) {
        const caller = await this.initCall({ user: WORK.uid, context: context.short, receivers: [] }, true);
        await caller.setTracks();
        await caller.showCallForm();
        caller.callForm.recdMode = true;
        caller.callForm.connect = true;
    }
    static async endCall() {
        await this.initialization;
        if (this.current_call.connectors?.length > 0) {
            await RTCCaller.sendMessage(
                this.current_call.callContext,
                {
                    user: WORK.uid,
                    context: this.current_call.callContext.short,
                    type: 'end_call',
                    receivers: this.current_call.connectors.map(c => c.user.id)
                }
            )
            for (const c of this.current_call.connectors) {
                this.current_call.removeConnector(c.user.id);
            }
        }
        this.current_call.destroy();
    }
    static async hang() {
        if (!this.current_call?.callContext) return;
        await RTCCaller.sendMessage(
            this.current_call.callContext,
            {
                user: WORK.uid,
                context: this.current_call.callContext.short,
                type: 'hang',
                receivers: this.current_call.connectors.map(c => c.user.id)
            }
        )
        for (const c of this.current_call.connectors) {
            this.current_call.removeConnector(c.user.id);
        }
        this.current_call.destroy();
    }

    async sendOffers(receivers) {
        const descriptions = await Promise.all(this.connectors.map(async connector => {
            if (connector.pc.localDescription) return null;
            connector.createDataChannel('signals');
            return {
                uid: connector.user.id,
                offer: await connector.createOffer(),
                candidates: await connector.candidates
            }
        }));
        return RTCCaller.sendMessage(
            this.callContext,
            {
                user: WORK.uid,
                context: this.callContext?.short,
                type: 'offer',
                receivers,

                descriptions
            }
        )
    }

    async sendAnswer(uid) {
        const connector = this.getConnector(uid);
        connector.pc.ondatachannel = (event) => {
            connector.dataChannel = event.channel;
            connector.setupDataChannel();
        }
        await RTCCaller.sendMessage(
            this.callContext,
            {
                user: WORK.uid,
                type: 'answer',
                context: this.callContext?.short,
                receivers: [uid],

                answer: await connector.createAnswer(),
                candidates: await connector.candidates
            }
        );
    }

    removeConnector(uid) {
        const idx = this.connectors.findIndex(c => c.user.id === uid);
        if (idx !== -1) {
            const [connector] = this.connectors.splice(idx, 1);
            connector.pc.getTransceivers().forEach(transceiver => {
                connector.pc.removeTrack(transceiver.sender);
                transceiver.stop();
            });
            connector.pc.close();
            connector.audioMixer.stop();
            connector.pc.dispatchEvent(new Event('connectionstatechange'));
            return connector;
        }
    }

    getConnector(uid) {
        const connector = this.connectors.find(c => c.user.id === uid);
        if (!connector) {
            throw new Error(`no connector for "${uid}"`);
        }
        return connector;
    }

    static async showCallerDialog(context, users) {
        let $item = await context.$owner;
        if (users.length == 1) {
            return [...users];
        }
        let tree = ODA.createElement('item-tree', {
            items: users, checkMode: 'binary', hideRoots: 1, style: 'padding: 16px;',
            execute($user) {
                if (this.checkedItems.includes($user))
                    this.checkedItems.remove($user);
                else
                    this.checkedItems.add($user);
            }
        });
        await WORK.showDialog(tree, {
            $item,
            iconSize: 48,
            enable: false,
            style: `max-width: 100%; max-height: 100%;${ODA.states.mobileMode ? 'min-width: 100%; min-height: 100%;' : 'border-radius: 32px;'}`,
            TITLE: { label: 'Выберите участников', style: 'align-items: center;' },
            OK: {
                icon: 'communication:call', round: true, style: "margin: 16px;",
                disabled: {
                    $attr: true,
                    get() {
                        return !tree.checkedItems.length
                    }
                },
                success: {
                    $attr: true,
                    get() {
                        return !!tree.checkedItems.length
                    }
                }
            },
            CANCEL: { icon: 'communication:call-end', round: true, error: true, style: "margin: 16px;" },
        });
        return tree.checkedItems;
    }

    static #audioStream;
    static get audioStream() {
        return this.#audioStream
    }
    static set audioStream(val) {
        this.#audioStream = val;
        if (!this.#audioStream && this.current_call?.videoEnabled) {
            this.current_call.audioEnabled = false;
        }
    }

    static #videoStream;
    static get videoStream() {
        return this.#videoStream
    }
    static set videoStream(val) {
        this.#videoStream = val;
        if (!this.#videoStream && this.current_call?.audioEnabled) {
            this.current_call.audioEnabled = false;
        }
    }

    static #screenStream;
    static get screenStream() {
        return this.#screenStream
    }
    static set screenStream(val) {
        this.#screenStream = val;
        this.current_call?.dispatchEvent(new Event('screen-canst-changed'));
    }
    static async requestAudioStream() {
        if (RTCCaller.audioStream) {
            return RTCCaller.audioStream;
        }
        else {
            try {
                return RTCCaller.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            }
            catch (err) {
                alert('вы закрыли доступ к микрофону, собеседники вас не услышат');
                console.warn(err);
            }
        }
    }
    static async requestVideoStream() {
        if (RTCCaller.videoStream) {
            return RTCCaller.videoStream;
        }
        else {
            try {
                return RTCCaller.videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

            }
            catch (err) {
                alert('вы закрыли доступ к камере, собеседники вас не увидят');
                console.warn(err);
            }
        }
    }
    static async requestScreenStream() {
        if (RTCCaller.screenStream) {
            return RTCCaller.screenStream;
        }
        else {
            try {
                    return RTCCaller.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

            }
            catch (err) {
                alert('вы закрыли доступ к экрану, по этому трансляция невозможна');
                console.warn(err);
            }
        }
    }
    static #stopAllStreams() {
        [
            this.#audioStream,
            this.#videoStream,
            this.#screenStream
        ].forEach(s => {
            s?.getTracks().forEach(t => { t.enabled = false; t.stop() });
        });
        this.#audioStream = undefined;
        this.#videoStream = undefined;
        this.#screenStream = undefined;
    }
    static audioCtx = new AudioContext();
    static #audioBuffers = Object.create(null);
    static async getAudioBuffer(path) {
        if (this.#audioBuffers[path]) {
            return this.#audioBuffers[path];
        }
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        return this.#audioBuffers[path] = this.audioCtx.decodeAudioData(arrayBuffer);
    }
    static currentAudioSource = null;
    static async playSound(soundPath, loop = false) {
        try {
            if (this.currentAudioSource) {
                await this.stopSound();
            }
            this.currentAudioSource = new Promise(async (resolve, reject) => {
                const source = this.audioCtx.createBufferSource();
                source.buffer = await this.getAudioBuffer(soundPath);
                source.connect(this.audioCtx.destination);
                source.loop = loop;
                if (!loop) {
                    source.onended = () => {
                        this.stopSound();
                    }
                }
                source.start();
                resolve(source);
            });
            await this.currentAudioSource;
        }
        catch (err) {
            console.warn(`error on play sound "${soundPath}"\n`, err);
        }
    }
    static async stopSound() {
        if (!this.currentAudioSource) return;
        const source = await this.currentAudioSource;
        source.stop();
        source.disconnect();
        this.currentAudioSource = null;
    }
    static offerWasSeen = false;
    static broadcastChannel;
    static async init() {
        this.registerBroadcastChannel();
        this.broadcastChannel.postMessage({
            type: 'caller-ready'
        });
    }
    static registerBroadcastChannel() {
        if (WORK.top === window) {
            if (this.broadcastChannel) return this.broadcastChannel;
            const channel = new BroadcastChannel('RTCCaller-channel');
            channel.addEventListener('message', async (event) => {
                console.log('broadcastChannel message', event.data);
                switch (event.data.type) {
                    case 'phone.call': {
                        console.log('call from sw', event.data);
                        const message = event.data.message;
                        const logFile = await WORK.get_item(message.log);
                        const logFileData = await logFile.load();
                        const callInfo = JSON.parse(logFileData);
                        callInfo.silent = true;
                        this.onmessage(callInfo);
                    } break;
                    case 'call-handled': {
                        if (this.currentAnswerDialog) {
                            this.currentAnswerDialog.domParent.close('handled-in-other-tab');
                        }
                    } break;
                    case 'offer-was-seen': {
                        this.offerWasSeen = true;
                    } break;
                }
            });
            return this.broadcastChannel = channel;
        }
    }
    destroy() {
        RTCCaller.stopSound();
        WORK.top.removeEventListener('beforeunload', RTCCaller.on_beforeunload);
        WORK.top.removeEventListener('unload', RTCCaller.on_unload);
        this.dispatchEvent(new Event('destroy'));
        if (this.renderer) {
            this.renderer.stop();
            this.renderer = null;
        }
        if (this.audioMixer) {
            this.audioMixer.stop();
            this.audioMixer = null;
        }
        if (this.recorder) {
            this.recorder.stop();
            this.recorder = null;
        }
        if (this.callForm) {
            this.callForm.recdMode = false;
            this.callForm.connect = false;
        }
        let formController = Array.prototype.find.call(WORK.top.document.body.children, el => el.begin_call);
        if (formController) {
            formController.showCall = false;
        }
        else if (this.callForm) {
            this.callForm.domParent.close();
            this.callForm = null;
        }
        this.answerDialogResult = null;
        for (const c of [...this.connectors]) {
            this.removeConnector(c.user.id);
        }
        RTCCaller.#stopAllStreams();

        RTCCaller.initialization = undefined;
        RTCCaller.current_call = undefined;
    }
}
class PeerConnector extends EventTarget {
    dataChannel = null;
    tracks = [];
    connected;
    #videoEnabled = false;
    get videoEnabled() {
        return this.#videoEnabled;
    }
    set videoEnabled(val) {
        this.#videoEnabled = val;
        this.fireChanged();
    }
    #audioEnabled = false;
    get audioEnabled() {
        return this.#audioEnabled;
    }
    set audioEnabled(val) {
        this.#audioEnabled = val;
        this.fireChanged();
    }
    constructor(user) {
        super();
        this.user = user;
        this.audioMixer = new AudioMixer();
        this.pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.sipnet.ru:3478' },
                { urls: 'stun:stun.odant.org' },
                {
                    urls: 'turn:stun.odant.org:3478',
                    username: 'odant',
                    credential: 'lkhjasdf8967'
                }
            ]
        });
        this.pc.addEventListener('connectionstatechange', (e) => console.log('connectionstatechange to', this.pc.connectionState, e));
        this.pc.addEventListener('track', (e) => {
            console.log('pc on track', e);
            const idx = this.tracks.findIndex(t => t.id === e.track.id);
            if (idx !== -1) {
                this.tracks.splice(idx, 1, e.track);
            }
            else {
                this.tracks.push(e.track);
            }
            this.fireChanged();
        });
        this.candidates = new Promise((resolve) => {
            const candidates = [];
            this.pc.addEventListener('icecandidate', (event) => {
                if (event.candidate) {
                    if (this.dataChannel?.readyState === 'open') {
                        if (candidates.length !== 0) {
                            this.dataChannel.send(JSON.stringify({
                                type: 'ice-candidate',
                                candidates
                            }));
                            candidates.splice(0, candidates.length);
                        }
                        console.log('iceCandidates send with dataChannel');
                        this.dataChannel.send(JSON.stringify({
                            type: 'ice-candidate',
                            candidates: [event.candidate]
                        }));
                        return;
                    }
                    candidates.push(event.candidate);
                    setTimeout(() => {
                        resolve(candidates);
                    }, 1000);
                }
            });
        });
        this.sendTrack(this.audioMixer.stream.getAudioTracks()[0]);
        this.connected = new Promise((resolve, reject) => {
            const fn = () => {
                if (this.pc.connectionState === 'connected') {
                    this.pc.removeEventListener('connectionstatechange', fn);
                    return resolve(true);
                }
                if (this.pc.connectionState === 'failed') {
                    this.pc.removeEventListener('connectionstatechange', fn);
                    return reject(false);
                }
            };
            this.pc.addEventListener('connectionstatechange', fn);
        });
        this.pc.addEventListener('negotiationneeded', this.sendRenegotiateOffer);
    }
    async createOffer() {
        const offer = await this.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await this.pc.setLocalDescription(offer);
        return offer;
    }
    async createAnswer() {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        return answer;
    }

    async setOffer(offer) {
        return this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    }

    async setAnswer(answer) {
        return this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    sendRenegotiateOffer = async () => {
        if (this.pc.connectionState !== 'connected') return;
        console.log('sendRenegotiateOffer');
        const offer = await this.createOffer();
        this.sendMessage({
            type: 'renegotiate-offer',
            offer
        });
    }
    async on_renegotiateOffer(offer) {
        console.log('on_renegotiateOffer');
        await this.setOffer(offer);
        const answer = await this.createAnswer();
        this.sendMessage({
            type: 'renegotiate-answer',
            answer
        });
    }
    async on_renegotiateAnswer(answer) {
        console.log('on_renegotiateOffer');
        await this.setAnswer(answer);
    }

    addCandidates(candidates) {
        if (!candidates) return;
        return Promise.all(candidates.map(c => this.pc.addIceCandidate(new RTCIceCandidate(c))));
    }

    createDataChannel(label, options = {}) {
        if (this.dataChannel) return;
        options.ordered ??= true;
        options.maxRetransmits ??= 16;
        this.dataChannel = this.pc.createDataChannel(label, options);
        this.setupDataChannel();
    }
    setupDataChannel() {
        if (!this.dataChannel) return;
        this.dataChannel.onopen = () => {
            console.log('🎉 DataChannel ОТКРЫТ! Можно общаться!');
            console.log('candidates:', this.candidates);
            this.sendMessage({ type: 'connected' });
        };

        this.dataChannel.onclose = () => {
            console.log('DataChannel закрыт');
        };

        this.dataChannel.onerror = (error) => {
            console.log(`❌ Ошибка DataChannel:`, error);
        };

        this.dataChannel.onmessage = (event) => {
            const data = JSON.parse(event.data);
            // console.log('dataChannel message', data);
            switch (data.type) {
                case 'ice-candidate': {
                    console.log('receive ice-candidates from dataChannel');
                    this.addCandidates(data.candidates);
                } break;
                case 'video-changed': {
                    this.videoEnabled = data.value;
                } break;
                case 'audio-changed': {
                    this.audioEnabled = data.value;
                } break;
                case 'connected': {
                    this.sendMessage({ type: 'video-changed', value: RTCCaller.current_call.videoEnabled });
                    this.sendMessage({ type: 'audio-changed', value: RTCCaller.current_call.audioEnabled });
                } break;
                case 'renegotiate-offer': {
                    this.on_renegotiateOffer(data.offer);
                } break;
                case 'renegotiate-answer': {
                    this.on_renegotiateAnswer(data.answer);
                } break;
                default:
                    break;
            }
        };
    }
    sendMessage(message) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') return console.warn('dataChannel not connected');
        this.dataChannel.send(JSON.stringify(message));
    }
    fireChanged() {
        this.dispatchEvent(new Event('changed'));
    }
    sendTrack(track) {
        const sender = this.pc.getSenders().find(s => s.track?.kind === track.kind);
        if (sender) {
            sender.replaceTrack(track);
        }
        else {
            this.pc.addTrack(track);
        }
    }
}
class VideoRenderer {
    WIDTH = 1920;
    HEIGHT = 1080;
    FRAMERATE = 60;
    active = false;
    sources = [];
    #currentTask;
    constructor(config = {}) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = config.width ?? this.WIDTH;
        this.canvas.height = config.height ?? this.HEIGHT;
        this.ctx = this.canvas.getContext('2d');
        this.framerate = config.framerate ?? this.FRAMERATE;
        this.stream = this.canvas.captureStream(0);
        this.stream.getVideoTracks()[0].requestFrame();
    }
    stop() {
        this.active = false;
        clearTimeout(this.#currentTask);
    }
    start() {
        this.stop();
        this.active = true;
        this.composeFrames();
    }
    composeFrames() {
        if (!this.active) return;
        clearTimeout(this.#currentTask);
        requestAnimationFrame(async () => {
            try {
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.strokeStyle = '#fff';
                this.ctx.fillStyle = '#fff';
                for (const src of this.sources) {
                    await src.toCanvas(this.ctx);
                }
            }
            catch (err) {
                console.warn('error on render', err);
            }
            this.stream.getVideoTracks()[0].requestFrame();
            this.#currentTask = setTimeout(() => {
                this.composeFrames();
            }, 1000 / this.framerate);
        });
    }
}
class AudioMixer {
    sources = new Map();
    get stream() {
        return this.destination.stream;
    }
    constructor() {
        this.audioContext = new AudioContext();
        this.destination = this.audioContext.createMediaStreamDestination();
        const silenceSource = this.audioContext.createConstantSource();
        silenceSource.offset.value = 0;
        silenceSource.connect(this.destination);
        silenceSource.start();
    }
    addTrack(track) {
        if (this.sources.has(track.id)) return;
        const trackStream = new MediaStream([track]);
        const source = this.audioContext.createMediaStreamSource(trackStream);
        source.connect(this.destination);
        this.sources.set(track.id, { source });
    }
    removeTrack(id) {
        const node = this.sources.get(id);
        if (node) {
            node.source.disconnect();
            node.gainNode.disconnect();
            this.sources.delete(id);
        }
    }
    stop() {
        this.audioContext.close();
    }
}
class Recorder {
    static RATE = 1000;
    constructor(tracks, context, users) {
        this.id = `call_record.webm`;
        this.users = users;
        this.context = context;
        this.recording = false;
        const contentType = 'video/webm;codecs=vp8,opus';
        this.stream = new MediaStream(tracks);
        this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: contentType });
        this.mediaRecorder.ondataavailable = (e) => {
            if (!this.recording) return;
            this.context.writeToStream(e.data, { filename: this.id, contentType });
        };
        this.mediaRecorder.onerror = (e) => {
            console.warn('recorder error:', e);
            if (!this.recording) return;
            this.recording = false;
            this.context.closeWriteStream({ filename: this.id , receivers: [...users.map(u => u.id)] });
        }
        this.mediaRecorder.onstop = (e) => {
            if (!this.recording) return;
            this.recording = false;
            this.context.closeWriteStream({ filename: this.id, receivers: [...users.map(u => u.id)] });
        }
    }
    start() {
        this.mediaRecorder.start(Recorder.RATE);
        this.recording = true;
        console.warn('recorder start:', this);
    }
    stop() {
        this.mediaRecorder.stop();
    }
}
ODA({is: 'call-form',
    imports: 'oda//app-layout.js, /oda//toggle.js, ~/lib//tree.js',
    template: /*html*/`
        <style>
            :host{
                @apply --flex;
                @apply --vertical;
                background-color: black;
                overflow: hidden;
            }
            .tools{
                align-items: center;
                padding: 8px;
                justify-content: center;
                .buttons{
                    gap: 8px;
                    justify-content: center;
                }
                .stop{
                    position: absolute;
                    right: 16px;
                    bottom: 16px;
                }
            }
        </style>
        <call-screen flex :connectors :connected></call-screen>
        <div header horizontal class="tools">
            <div class="clock">3:15</div>
            <div class="buttons" horizontal flex>
                <oda-button :icon="videoEnabled ? 'carbon:video' : 'carbon:video-off'" shadow round @click="toggleVideo" :success="videoEnabled" :disabled="screenCasting"></oda-button>
                <oda-button :icon="audioEnabled ? 'carbon:microphone' : 'carbon:microphone-off'" shadow round @click="toggleAudio" :success="audioEnabled"></oda-button>
                <oda-toggle ::toggled="screenCasting" size="32" checked-label="screen" unchecked-label="video"></oda-toggle>
            </div>
            <oda-button class="stop" @tap="end_call" shadow icon-size="48" round error :icon="recdMode ? 'carbon:stop-filled-alt' : 'communication:call-end'"></oda-button>

        </div>
    `,
    recdMode: false,
    get screen(){
        return this.$('call-screen');
    },
    connectors: [],
    connected: false,
    videoEnabled: {
        $def: false,
        get() {
            return !!RTCCaller.current_call?.videoEnabled;
        }
    },
    audioEnabled: {
        $def: false,
        get() {
            return !!RTCCaller.current_call?.audioEnabled;
        }
    },
    screenCasting: {
        $def: false,
        async set(n) {
            if (n) {
                const stream = await RTCCaller.requestScreenStream();
                if (stream) {
                    const [track] = stream.getVideoTracks();
                    track.addEventListener('ended', () => this.screenCasting = false, { once: true });
                }
                else {
                    this.screenCasting = false;
                }
            }
            else if(RTCCaller.screenStream) {
                RTCCaller.screenStream.getTracks().forEach(t => { t.enabled = false; t.stop() });
                RTCCaller.screenStream = null;
            }
            RTCCaller.current_call.setTracks();
        }
    },
    end_call() {
        if (this.connected && (!this.recdMode && !confirm('End call?'))) return;
        if (RTCCaller.current_call?.isMain) {
            RTCCaller.endCall();
        }
        else {
            RTCCaller.hang();
        }
        this.connectors = [];
    },
    on_settingsChanged: {
        get() {
            return (e) => {
                this.videoEnabled = !!RTCCaller.current_call?.videoEnabled;
                this.audioEnabled = !!RTCCaller.current_call?.audioEnabled;
            }
        }
    },
    async toggleVideo() {
        if (this.screenCasting) return;
        if (!RTCCaller.current_call.videoEnabled) {
            const videoStream = await RTCCaller.requestVideoStream();
            RTCCaller.current_call.videoEnabled = !!videoStream;
        } else {
            RTCCaller.current_call.videoEnabled = false;
        }
        console.log('toggleVideo');
    },
    async toggleAudio() {
        if (!RTCCaller.current_call.audioEnabled) {
            const audioStream = await RTCCaller.requestAudioStream();
            RTCCaller.current_call.audioEnabled = !!audioStream;
        } else {
            RTCCaller.current_call.audioEnabled = false;
        }
        console.log('toggleAudio');
    },
    iconSize: 24,
    get left_buttons() {
        return [
            {
                icon: 'communication:call-end',
                click: (e) => {
                    if (confirm('End call?')) {
                        RTCCaller.endCall();
                    }
                },
                style: 'border-radius: 50%;',
                error: true,
            }
        ]
    },
    async attached() {
        RTCCaller.current_call.addEventListener('settings-changed', this.on_settingsChanged);
        try {
            this.connected = await RTCCaller.current_call.connected;
        }
        catch (err) {
            console.warn(err);
         }
    },
    detached() {
        if(RTCCaller.current_call){
            RTCCaller.current_call.removeEventListener('settings-changed', this.on_settingsChanged);
        }
        this.connected = false;
        this.screenCasting = false;
    },
});
ODA({
    is: 'call-user-video-card',
    template: /*html*/`
        <style>
            :host{
                @apply --flex;
                @apply --horizontal;
                position: relative;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                border: 1px solid white;
                cursor: pointer;
                max-height: stretch;
                border-radius: 2px;
                background: black;
                aspect-ratio: 4/3;
                transition: width, height, .2s;
                item-icon{
                   pointer-events: none;
                }
                oda-icon{
                    position: absolute;
                    margin: 4px;
                }
                video{
                    width: 100%;
                    height: 100%;
                }
                label{
                    position: absolute;
                    bottom: 0px;
                    margin: 0 auto;
                    text-align: center;
                    font-size: var(--font-size, 100%);
                }
                video{
                    width: 100%;
                    height: 100%;
                }
            }

        </style>
        <item-icon ~if="!allowVideo" :$item="user" :icon-size></item-icon>
        <oda-icon ~if="!allowAudio" id="mic_icon" fill="white" icon="carbon:microphone-off" style="top: 0; left: 0;"></oda-icon>
        <oda-icon ~if="orators.some(o => o.user.id === connector.user.id)" fill="white" icon="carbon:group-presentation" style="top: 0; right: 0;"></oda-icon>
        <video ~if="allowVideo" autoplay></video>
        <label>{{user?.label || 'unknown'}}</label>
        <audio ~if="allowAudio" hidden></audio>
    `,
    iconSize: 64,
    online: {
        $attr: true,
        $def: false,
    },
    connector: {
        set(n, o) {
            if (o) {
                this.user = null;
                if (o.pc) {
                    o.removeEventListener('changed', this.updateTracks);
                }
                else {
                    RTCCaller.current_call.removeEventListener('screen-canst-changed', this.updateTracks);
                    RTCCaller.current_call.removeEventListener('settings-changed', this.updateTracks);
                }
            }
            if (n) {
                this.user = n.user;
                if (n.pc) {
                    n.addEventListener('changed', this.updateTracks);
                }
                else {
                    RTCCaller.current_call.addEventListener('screen-canst-changed', this.updateTracks);
                    RTCCaller.current_call.addEventListener('settings-changed', this.updateTracks);
                }
            }
            this.updateTracks();
        }
    },
    user: null,
    allowVideo: false,
    allowAudio: false,
    get updateTracks() {
        return () => {
            if (this.connector) {
                if (this.connector.user.id === WORK.uid) {
                    this.allowVideo = RTCCaller.current_call?.videoEnabled || RTCCaller.screenStream;
                    this.allowAudio = this.connector?.audioEnabled !== false;
                }
                else {
                    this.allowVideo = this.connector?.videoEnabled !== false && this.connector?.tracks.some(t => t.kind === 'video');
                    this.allowAudio = this.connector?.audioEnabled !== false && this.connector?.tracks.some(t => t.kind === 'audio');
                }

                this.async(() => {
                    if (this.connector?.tracks) {
                        this.connector.tracks.forEach(track => {
                            const element = this.$(track.kind);
                            if (!element) return;
                            if (element.srcObject?.getTracks().some(t => t.id === track.id)) {
                                element.play();
                            }
                            else {
                                element.addEventListener('loadedmetadata', () => {
                                    element.play().catch(err => console.warn(`${track.kind} play error`, err));
                                }, { once: true });
                                element.srcObject = new MediaStream([track]);
                            }
                        });
                    }
                }, 300);
            }
            else {
                const video = this.$('video');
                if (video) video.paused = true;
                const audio = this.$('audio');
                if (audio) audio.paused = true;
                this.allowVideo = false;
                this.allowAudio = false;
            }
        }
    },
    $listeners: {
        resize() {
            this.style.setProperty('--font-size', `${this.offsetHeight * 0.05}px`);
        }
    },
    get video() {
        return this.allowVideo && this.$('video');
    },
    get label() {
        return this.$('label');
    },
    get icon() {
        return this.$('item-icon');
    },
    get micIcon() {
        return !this.allowAudio && this.$('#mic_icon');
    },
    async toCanvas(ctx) {
        const w = this.offsetWidth;
        const h = this.offsetHeight;
        const x = this.offsetLeft;
        const y = this.offsetTop;
        const style = getComputedStyle(this);
        if (style.backgroundColor) {
            ctx.save();
            ctx.fillStyle = style.backgroundColor;
            ctx.fillRect(x, y, w, h);
            ctx.restore();
        }
        if (this.video) {
            const scale = Math.min(w / this.video.videoWidth, h / this.video.videoHeight);
            const video_w = this.video.videoWidth * scale;
            const video_h = this.video.videoHeight * scale;
            const video_x = x + Math.round(((w - video_w) / 2));
            const video_y = y + Math.round(((h - video_h) / 2));
            ctx.drawImage(this.video, video_x, video_y, video_w, video_h);
        }
        if (this.icon) {
            const iconImage = await this.icon.image;
            if (iconImage) {
                const icon_x = x + this.icon.offsetLeft;
                const icon_y = y + this.icon.offsetTop;
                const icon_width = this.icon.offsetWidth;
                const icon_height = this.icon.offsetWidth;
                ctx.save();
                ctx.beginPath();
                ctx.arc(icon_x + icon_width / 2, icon_y + icon_height / 2, icon_height / 2, 0, 2 * Math.PI);
                ctx.clip();
                ctx.drawImage(iconImage, icon_x, icon_y, icon_width, icon_height);
                ctx.restore();
            }
        }
        if (this.micIcon) {
            const iconImage = await this.micIcon.image;
            if (iconImage) {
                const icon_x = x + this.micIcon.offsetLeft;
                const icon_y = y + this.micIcon.offsetTop;
                const icon_width = this.micIcon.offsetWidth;
                const icon_height = this.micIcon.offsetWidth;
                ctx.drawImage(iconImage, icon_x, icon_y, icon_width, icon_height);
            }
        }
        if (this.label) {
            const labelImage = await WORK.renderText(this.label);
            if (labelImage) {
                const label_x = x + this.label.offsetLeft;
                const label_y = y + this.label.offsetTop;
                ctx.drawImage(labelImage, label_x, label_y);
            }
        }
        ctx.strokeRect(x, y, w, h);
    },
});

ODA({
    is: 'oda-call-answer',
    template:/*html*/`
        <style>
            :host{
                @apply --vertical;
                @apply --rainbow;
                @apply -- flex;
                align-items: center;
                justify-content: center;
                padding: 32px;
            }
        </style>
        <call-user-card :$item="user" @click.stop></call-user-card>
    `,
    attached() {
        this.timeout = setTimeout(() => {
            this.domParent.close('timeout');
        }, 60000)
    },
    detached() {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
    },
    user: null,
});
ODA({is: 'call-user-node', imports: '/oda//icon.js',
    template: /*html*/`
        <style>
            :host{
                @apply --flex;
                @apply --horizontal;
                align-items: center;
                border-radius: 16px;
            }
            :host([checked]){
                @apply --selected;
            }
        </style>
        <item-node :$item icon-size="48" @tap.stop style="pointer-events: none;"></item-node>
    `,
    get $item() {
        return this.$for?.item;
    },
    checked: {
        $attr: true,
        $def: false,
        async set(n) {
            if (n !== undefined) {

                if (n) {
                    this.$pdp.checkedItems.add(this.$item);
                }
                else {
                    this.$pdp.checkedItems.remove(this.$item);
                }
                //реактивность не срабатывает
                this.$pdp.checkedItems = [...this.$pdp.checkedItems];
            }
        }
    },
    $listeners: {
        click() {
            this.checked = !this.checked;
        }
    }
});
ODA({is: 'call-user-card', imports: '/oda//icon.js',
    template: /*html*/`
        <style>
            :host{
                width: min-content;
                @apply --vertical;
                @apply --light;
                @apply --shadow;
                align-items: center;
                border-radius: 32px;
                padding: 8px;
            }
        </style>
        <item-icon :$item :icon-size @tap.stop style="pointer-events: none;"></item-icon>
        <div style="text-align: center;">{{$item?.label}}</div>
    `,
    $item: null,
    iconSize: 128,
});
ODA({is: 'call-screen',
    template: /* html */ `
        <style>
            :host{
                background: black;
                padding: 8px;
                @apply --horizontal;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                align-content: center;
            }
            :host(:not([connected])){
                @apply --rainbow;
            }
            .screen{
                background: black;
                @apply --flex;
                @apply --horizontal;
                aspect-ratio: 16/9;
                overflow: hidden;
                padding: 8px;
                gap: 8px;
                position: relative;
                max-width: calc(1920px - 16px);
                max-height: calc(1080px - 16px);
                min-width: calc(1920px - 16px);
                min-height: calc(1080px - 16px);
            }
            video{
                background: black;
                aspect-ratio: 16/9;
                padding: 8px;
                max-height: stretch;
                width: stretch;
            }
            #grid{
                align-content: {{orators.length?'start':'center'}} !important;
            }
            {{''}}
        </style>
        <div ~if="RTCCaller.current_call.isMain" class="screen" horizontal>
            <call-grid id="grid" ~if="connectors?.length > 1" :connectors ::orators></call-grid>
            <call-grid ~show="orators.length" flex :connectors="orators" style="min-width: 85%; pointer-events: none;"></call-grid>
        </div>
        <video ~if="!RTCCaller.current_call.isMain"></video>
    `,
    orators: [],
    connected:{
        $attr: true,
        $def: false
    },
    screen: {
        get() {
            return this.$('.screen');
        }
    },
    connectors: {
        set(n) {
            if (n?.length) {
                if (!RTCCaller.current_call.isMain) {
                    this.async(() => {
                        if (this.connectors) {
                            const video = this.$('video');
                            video.addEventListener('loadedmetadata', async () => {
                                video.play();
                            });
                            video.addEventListener('resize', async (e) => {
                                const settings = video.srcObject.getVideoTracks()[0].getSettings();
                                if (video.width && settings.width !== video.width) {
                                    await video.load();
                                    video.play();
                                }
                            });
                            video.srcObject = new MediaStream(this.connectors[0].tracks);
                        }
                    }, 300)
                }
                else if (n.length === 1) {
                    this.orators = [n[0]];
                }
            }
        }
    },
    attached() {
        if (RTCCaller.current_call.isMain) {
            this.async(() => {
                const grids = this.$$('call-grid');
                RTCCaller.current_call.renderer.sources.push(...grids);
                // RTCCaller.current_call.renderer.canvas.width = this.screen.offsetWidth;
                // RTCCaller.current_call.renderer.canvas.height = this.screen.offsetHeight;
                RTCCaller.current_call.renderer.start();
            }, 1000);
        }
    },
    showCanvas() {
        WORK.showModal(RTCCaller.current_call.renderer.canvas);
    },
    $listeners: {
        resize() {
            if (!this.screen || !RTCCaller.current_call?.renderer) return;
            requestAnimationFrame(() => {
                const scale = Math.min(this.offsetWidth / (RTCCaller.current_call.renderer.canvas.width + 32), this.offsetHeight / (RTCCaller.current_call.renderer.canvas.height + 32));
                this.screen.style.transform = `scale(${scale})`;
            });
        }
    }
})
ODA({is: 'call-grid',
    template:/* html */`
        <style>
            :host{
                flex-wrap: wrap;
                overflow: hidden;
                gap: 1px;
                align-items: center;
                align-content: center;
                justify-content: center;
                @apply --horizontal;
                @apply --flex;
                call-user-video-card{
                    height: {{H}}px;
                    width: {{W}}px;
                }
            }
        </style>
        <call-user-video-card :success="orators.includes($for.item)" no-flex ~for="connectors" :icon-size="H/2" :connector="$for.item" @tap="toggleOrator($for.item)"></call-user-video-card>
    `,
    toggleOrator(user){
        if(this.orators.includes(user))
            this.orators.remove(user);
        else
            this.orators.add(user);
        this.domParent.render();
    },
    get rows(){
        let oh = this.offsetHeight;
        let oW = this.offsetWidth;
        let rows = 0;
        while(++rows < oh){
            let h = oh / rows;
            const len = Math.ceil(this.connectors.length / rows);
            let w = h / 3 * 4;
            const maxW = w * len;
            if(maxW > oW && maxW - oW > w)
                continue;
            break;
        }
        return rows;
    },
    get colls(){
        return Math.ceil(this.connectors.length / this.rows);
    },
    get W(){
        return (this.clientWidth / this.colls - 6);
    },
    get H(){
        //return (this.W / 4 * 3 - 4);
        return (this.clientHeight / this.rows - 6);
    },
    connectors: [],
    orators: [],
    $listeners:{
        resize(){
            this.debounce('resize', ()=>{
                this.rows = undefined;
            })
        }
    },
    async toCanvas(ctx){
        let cards = this.$$('call-user-video-card')
        for(let card of cards){
            await card.toCanvas(ctx)
        }
    },
    attached() {
        this.orators = [];
    }
})