import * as fs from 'node:fs';
import webPush from 'web-push';

function getPushSubscriptionsPath(uid) {
    return `./USERS/${uid}/$user/#system/push_subscriptions.json`;
}

export async function loadPushSubscriptions(uid) {
    const path = getPushSubscriptionsPath(uid);
    try {
        return JSON.parse(await fs.promises.readFile(path, { encoding: 'utf-8' }));
    }
    catch {
        return [];
    }
}

export async function savePushSubscriptions(uid, subscriptions) {
    const path = getPushSubscriptionsPath(uid);
    await fs.promises.mkdir(path.split('/').slice(0, -1).join('/'), { recursive: true });
    await fs.promises.writeFile(path, JSON.stringify(subscriptions), { encoding: 'utf-8' });
}

export async function getPublicVapid(vapidKeys) {
    return vapidKeys.publicKey;
}

export async function storePushSubscription(params) {
    if (!params.session?.uid) {
        throw new Error('No user id on store_push_subscription');
    }
    const subscription = params.post;
    const subscriptions = await loadPushSubscriptions(params.session.uid);
    const idx = subscriptions.findIndex(s => s.endpoint === subscription.endpoint);
    if (idx > -1) {
        Object.assign(subscriptions[idx], subscription);
    } else {
        subscriptions.push(subscription);
    }
    await savePushSubscriptions(params.session.uid, subscriptions);
    return true;
}

export async function removePushSubscription(params) {
    const subscription = params.post;
    const subscriptions = await loadPushSubscriptions(params.session.uid);
    const idx = subscriptions.findIndex(s => s.endpoint === subscription.endpoint);
    if (idx > -1) {
        subscriptions.splice(idx, 1);
        await savePushSubscriptions(params.session.uid, subscriptions);
    }
    return true;
}

export async function sendPushNotification(params, removeFn) {
    let receivers;
    if (typeof params.receivers === 'string') {
        receivers = params.receivers.split(',').map(s => s.trim()).filter(Boolean);
    }
    else if (Array.isArray(params.receivers)) {
        receivers = params.receivers.map(r => r.id || r);
    }
    const toRemove = [];
    const message = params.message ? JSON.stringify(params.message) : params.post;
    await Promise.all(receivers.map(async uid => {
        const subscriptions = await loadPushSubscriptions(uid);
        return Promise.all(subscriptions.map(async s => {
            try {
                await webPush.sendNotification(s, message);
            }
            catch (err) {
                console.warn(err);
                if ([410, 403].includes(err.statusCode)) {
                    toRemove.push({ session: { uid }, post: s });
                }
            }
        }));
    }));
    for (const o of toRemove) {
        await removeFn(o);
    }
    return true;
}
