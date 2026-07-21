export default {
    async execute(params = {}, post) {
        const P = await globalThis.loadHost('offering-paas');
        const body = typeof post === 'string' ? P.safeParse(post) : (post || params);
        const proposal = body?.proposal || body;
        const to = proposal?.contactEmail;
        if (!to)
            return { ok: false, reason: 'no contactEmail' };

        const { mailer } = await globalThis.loadHost('mail');
        if (!mailer)
            return { ok: false, stub: true, reason: 'mail not configured' };

        await mailer.sendMail({
            from: process.env.WORK_MAIL_FROM || 'noreply@odant.org',
            to,
            subject: `WORK PaaS готов: ${proposal.fqdn || proposal.subdomain}`,
            text: `Ваша платформа доступна: ${proposal.url || proposal.fqdn}\n\nТариф: ${proposal.planId}`,
        });
        return { ok: true, to };
    },
};
