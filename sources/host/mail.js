import * as fs from 'node:fs';
import nodemailer from 'nodemailer';

export const mailer = (() => {
    try {
        let data = fs.readFileSync('./#system/mail.json', { encoding: 'utf-8' });
        data = JSON.parse(data);
        return nodemailer.createTransport(data);
    }
    catch (e) {
        console.error(e);
        return null;
    }
})();
