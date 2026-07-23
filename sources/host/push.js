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
    if (!params.user?.uid) {
        throw new Error('No user id on store_push_subscription');
    }
    const subscription = params.post;
    const subscriptions = await loadPushSubscriptions(params.user.uid);
    const idx = subscriptions.findIndex(s => s.endpoint === subscription.endpoint);
    if (idx > -1) {
        Object.assign(subscriptions[idx], subscription);
    } else {
        subscriptions.push(subscription);
    }
    await savePushSubscriptions(params.user.uid, subscriptions);
    return true;
}

export async function removePushSubscription(params) {
    const subscription = params.post;
    const subscriptions = await loadPushSubscriptions(params.user.uid);
    const idx = subscriptions.findIndex(s => s.endpoint === subscription.endpoint);
    if (idx > -1) {
        subscriptions.splice(idx, 1);
        await savePushSubscriptions(params.user.uid, subscriptions);
    }
    return true;
}

export async function sendPushNotification(params, removeFn) {
    const receivers = params.receivers.map(r => r.id);
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
                    toRemove.push({ user: { uid }, post: s });
                }
            }
        }));
    }));
    for (const o of toRemove) {
        await removeFn(o);
    }
    return true;
}
