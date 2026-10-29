/**
 * Хранилище лицензионного сервера work.odant.org:
 *  - Реестр выпущенных лицензий ПАК (вечные 5 мест + 1 год включённой поддержки + срочные годовые расширения);
 *  - Заказы и платежи ЮKassa;
 *  - Привязки клиентских чатов (MAX, Telegram, VK) по коду привязки или номеру лицензии;
 *  - Тикеты техподдержки с расчётом SLA времени реакции и лимитов обращений по уровням Start / Business / Enterprise.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
    PAK_PRODUCT,
    SLA_TIERS,
    calculateOrderQuote,
    REGIONS_CATALOG,
    PARTNER_TRAINING_TRACKS,
    calculateFranchiseFee,
    calculatePartnerDiscount,
} from './catalog.js';
import { loadOrCreateAuthorityKeys, signCertificate } from './crypto.js';

const ONE_YEAR_MS = 365 * 24 * 3600_000;

export class LicenseStore {
    constructor({ dataDir = './data' } = {}) {
        this.dataDir = dataDir;
        fs.mkdirSync(this.dataDir, { recursive: true });
        this.stateFile = path.join(this.dataDir, 'store.json');
        this.keyFile = path.join(this.dataDir, 'authority-key.json');
        this.authorityKeys = loadOrCreateAuthorityKeys(this.keyFile);

        this.state = {
            licenses: {},
            orders: {},
            tickets: {},
            botBindings: {},
            partners: {},
            certificates: {},
        };
        this._load();
    }

    _load() {
        if (!fs.existsSync(this.stateFile))
            return;
        try {
            const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            if (raw && typeof raw === 'object') {
                this.state.licenses = raw.licenses || {};
                this.state.orders = raw.orders || {};
                this.state.tickets = raw.tickets || {};
                this.state.botBindings = raw.botBindings || {};
                this.state.partners = raw.partners || {};
                this.state.certificates = raw.certificates || {};
            }
        }
        catch { /* начинаем с чистого состояния */ }
    }

    _save() {
        const tmp = `${this.stateFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
        fs.renameSync(tmp, this.stateFile);
    }

    /**
     * Зарегистрировать или обновить базовую лицензию ПАК (5 вечных мест + 1 год включённой поддержки).
     * Если лицензию выдаёт региональный партнёр (partnerId) — фиксируется партнёр-интегратор,
     * привязка оборудования и годовая гарантия на оборудование от партнёра (1 год).
     */
    issueOrUpdateLicense({
        licenseId,
        hwid = '',
        nodeFingerprint = '',
        customer = {},
        partnerId = '',
        hardwareWarrantyYears = 1,
        partnerAddons = {},
        baseSeats = PAK_PRODUCT.baseSeats,
        includedSupportTier = PAK_PRODUCT.includedSupportTier,
    } = {}) {
        const now = Date.now();
        let existing = licenseId ? this.state.licenses[licenseId] : null;
        if (!existing && hwid) {
            existing = Object.values(this.state.licenses).find(l => l.hardware?.hwid === hwid) || null;
        }

        const partner = partnerId ? this.state.partners[partnerId] : (existing?.partner?.partnerId ? this.state.partners[existing.partner.partnerId] : null);
        const warrantyYears = Math.max(1, Number(hardwareWarrantyYears ?? 1));

        const id = existing?.licenseId || licenseId || ('WORK-PAK-' + crypto.randomBytes(4).toString('hex').toUpperCase());
        const issuedAt = existing?.issuedAt || now;
        const bindCode = existing?.support?.bindCode || ('BIND-' + crypto.randomBytes(3).toString('hex').toUpperCase());

        const record = {
            licenseId: id,
            issuedAt,
            updatedAt: now,
            issuer: 'work.odant.org',
            customer: {
                name: customer.name || existing?.customer?.name || 'Организация ПАК WORK',
                inn: customer.inn || existing?.customer?.inn || '',
                email: customer.email || existing?.customer?.email || '',
                phone: customer.phone || existing?.customer?.phone || '',
            },
            hardware: {
                hwid: hwid || existing?.hardware?.hwid || ('PAK-' + crypto.randomBytes(6).toString('hex').toUpperCase()),
                nodeFingerprint: nodeFingerprint || existing?.hardware?.nodeFingerprint || '',
                sku: PAK_PRODUCT.sku,
                cpu: PAK_PRODUCT.hardware.cpu,
                ramGb: PAK_PRODUCT.hardware.ramGb,
                ssdTb: PAK_PRODUCT.hardware.ssdTb,
                warrantyYears,
                warrantyUntil: existing?.hardware?.warrantyUntil || (issuedAt + warrantyYears * ONE_YEAR_MS),
                warrantyProvider: partner ? partner.companyName : (existing?.hardware?.warrantyProvider || 'Партнёр-интегратор WORK'),
            },
            partner: partner ? {
                partnerId: partner.partnerId,
                companyName: partner.companyName,
                regionCode: partner.regionCode,
                regionName: partner.regionName,
                hardwareWarrantyYears: warrantyYears,
                hardwareWarrantyUntil: issuedAt + warrantyYears * ONE_YEAR_MS,
                addons: {
                    nasBackup: Boolean(partnerAddons.nasBackup ?? existing?.partner?.addons?.nasBackup),
                    inferenceHardware: Boolean(partnerAddons.inferenceHardware ?? existing?.partner?.addons?.inferenceHardware),
                    partnerModelApiUrl: String(partnerAddons.partnerModelApiUrl ?? existing?.partner?.addons?.partnerModelApiUrl ?? ''),
                    techSupportContract: Boolean(partnerAddons.techSupportContract ?? existing?.partner?.addons?.techSupportContract ?? true),
                    agentTrainingSkills: Boolean(partnerAddons.agentTrainingSkills ?? existing?.partner?.addons?.agentTrainingSkills),
                },
            } : (existing?.partner || null),
            baseSeats: Number(baseSeats ?? existing?.baseSeats ?? PAK_PRODUCT.baseSeats),
            perpetualBase: true,
            addonSubscriptions: Array.isArray(existing?.addonSubscriptions) ? existing.addonSubscriptions : [],
            support: {
                tier: existing?.support?.tier || includedSupportTier || 'business',
                includedUntil: existing?.support?.includedUntil || (issuedAt + ONE_YEAR_MS),
                ticketsUsed: Number(existing?.support?.ticketsUsed || 0),
                bindCode,
            },
        };

        const signed = signCertificate(record, this.authorityKeys);
        this.state.licenses[id] = signed;
        this._save();
        return this.getLicenseSummary(id);
    }

    /**
     * Выдача и привязка лицензии ПАК непосредственно региональным партнёром
     * (партнёр сам закупает оборудование, устанавливает стек, привязывает HWID и даёт 1 год гарантии на железо).
     */
    partnerIssueLicense({
        partnerId,
        hwid = '',
        nodeFingerprint = '',
        customer = {},
        hardwareWarrantyYears = 1,
        partnerAddons = {},
        recordSaleAmountRub = PAK_PRODUCT.basePriceRub,
    } = {}) {
        const p = this.state.partners[partnerId];
        if (!p)
            throw new Error(`Партнёр ${partnerId} не найден`);
        const licSummary = this.issueOrUpdateLicense({
            hwid,
            nodeFingerprint,
            customer,
            partnerId: p.partnerId,
            hardwareWarrantyYears,
            partnerAddons,
        });
        p.issuedLicenses ??= [];
        if (!p.issuedLicenses.includes(licSummary.licenseId)) {
            p.issuedLicenses.push(licSummary.licenseId);
        }
        if (Number(recordSaleAmountRub) > 0) {
            this.recordPartnerSale(p.partnerId, Number(recordSaleAmountRub));
        }
        this._save();
        return {
            license: this.getLicenseSummary(licSummary.licenseId),
            partner: this.getPartnerSummary(p.partnerId),
        };
    }

    /**
     * Добавить срочную годовую подписку на дополнительные пользовательские места (после оплаты ЮKassa).
     */
    grantAddonSubscription(licenseId, { tier = 'business', seats = 1, years = 1, orderId = '', paymentId = '' } = {}) {
        let lic = this.state.licenses[licenseId];
        if (!lic) {
            this.issueOrUpdateLicense({ licenseId });
            lic = this.state.licenses[licenseId];
        }
        const now = Date.now();
        const tierKey = String(tier || 'business').toLowerCase();
        const tierSpec = SLA_TIERS[tierKey] || SLA_TIERS.business;
        const seatsCount = Math.max(0, Number(seats || 0));
        const yearsCount = Math.max(1, Number(years || 1));

        if (seatsCount > 0) {
            // Ищем, не была ли уже выдана подписка по этому orderId (идемпотентность webhook ЮKassa)
            const already = (lic.addonSubscriptions || []).find(s => orderId && s.orderId === orderId);
            if (!already) {
                lic.addonSubscriptions.push({
                    id: 'SUB-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
                    tier: tierSpec.id,
                    seats: seatsCount,
                    years: yearsCount,
                    issuedAt: now,
                    expiresAt: now + yearsCount * ONE_YEAR_MS,
                    orderId: String(orderId || ''),
                    paymentId: String(paymentId || ''),
                    status: 'active',
                });
            }
        }

        // Повышаем активный уровень поддержки, если докуплен более высокий тариф
        const rank = { start: 1, business: 2, enterprise: 3 };
        if ((rank[tierSpec.id] || 0) > (rank[lic.support?.tier] || 0)) {
            lic.support.tier = tierSpec.id;
        }
        lic.updatedAt = now;
        const signed = signCertificate(lic, this.authorityKeys);
        this.state.licenses[licenseId] = signed;
        this._save();
        return this.getLicenseSummary(licenseId);
    }

    /**
     * Получить развёрнутую сводку по лицензии (с расчётом активных мест, SLA и квоты обращений).
     */
    getLicenseSummary(licenseIdOrCode, now = Date.now()) {
        const lic = this.findLicense(licenseIdOrCode);
        if (!lic)
            return null;

        const baseSeats = Number(lic.baseSeats ?? PAK_PRODUCT.baseSeats);
        const baseSupportUntil = Number(lic.support?.includedUntil || (lic.issuedAt + ONE_YEAR_MS));
        const baseSupportActive = baseSupportUntil > now;

        let addonSeats = 0;
        let highestTier = baseSupportActive ? (lic.support?.tier || 'business') : null;
        let ticketsQuota = baseSupportActive
            ? baseSeats * (SLA_TIERS[lic.support?.tier || 'business']?.ticketsLimitPerSeatYear || 48)
            : 0;

        const rank = { start: 1, business: 2, enterprise: 3 };
        const activeAddons = [];

        for (const sub of (lic.addonSubscriptions || [])) {
            if (sub.status === 'active' && Number(sub.expiresAt) > now && Number(sub.seats) > 0) {
                const tSpec = SLA_TIERS[sub.tier] || SLA_TIERS.start;
                addonSeats += Number(sub.seats);
                ticketsQuota += Number(sub.seats) * tSpec.ticketsLimitPerSeatYear;
                if (!highestTier || (rank[tSpec.id] || 0) > (rank[highestTier] || 0))
                    highestTier = tSpec.id;
                activeAddons.push({ ...sub, tierName: tSpec.name });
            }
        }

        const effectiveTier = SLA_TIERS[highestTier || lic.support?.tier || 'start'] || SLA_TIERS.start;
        if (ticketsQuota === 0)
            ticketsQuota = baseSeats * SLA_TIERS.start.ticketsLimitPerSeatYear;

        const ticketsUsed = Number(lic.support?.ticketsUsed || 0);

        return {
            licenseId: lic.licenseId,
            issuedAt: lic.issuedAt,
            updatedAt: lic.updatedAt,
            customer: lic.customer,
            hardware: lic.hardware,
            partner: lic.partner || null,
            baseSeats,
            perpetualBase: true,
            addonSeats,
            totalSeats: baseSeats + addonSeats,
            baseSupportUntil,
            baseSupportActive,
            activeAddons,
            support: {
                active: baseSupportActive || activeAddons.length > 0,
                tier: effectiveTier.id,
                tierName: effectiveTier.name,
                reactionMinutes: effectiveTier.reactionMinutes,
                reactionLabel: effectiveTier.reactionLabel,
                scheduleLabel: effectiveTier.scheduleLabel,
                ticketsQuota,
                ticketsUsed,
                ticketsRemaining: Math.max(0, ticketsQuota - ticketsUsed),
                bindCode: lic.support?.bindCode || '',
            },
            certificate: lic,
        };
    }

    /**
     * Найти лицензию по licenseId, HWID или коду привязки бота (bindCode).
     */
    findLicense(query) {
        const q = String(query || '').trim();
        if (!q)
            return null;
        if (this.state.licenses[q])
            return this.state.licenses[q];
        const upper = q.toUpperCase();
        for (const lic of Object.values(this.state.licenses)) {
            if (
                lic.licenseId.toUpperCase() === upper
                || lic.hardware?.hwid?.toUpperCase() === upper
                || lic.support?.bindCode?.toUpperCase() === upper
            ) {
                return lic;
            }
        }
        return null;
    }

    listLicenses() {
        return Object.keys(this.state.licenses).map(id => this.getLicenseSummary(id));
    }

    /**
     * Создать заказ на покупку ПАК и/или дополнительных годовых лицензий.
     */
    createOrder({
        licenseId = '',
        hwid = '',
        nodeFingerprint = '',
        includeBasePak = false,
        tier = 'business',
        addonSeats = 0,
        years = 1,
        customer = {},
        partnerId = '',
        returnUrl = '',
    } = {}) {
        const quote = calculateOrderQuote({ includeBasePak, tier, addonSeats, years });
        if (quote.totalAmountRub <= 0)
            throw new Error('Сумма заказа должна быть больше 0 ₽');

        let targetLic = this.findLicense(licenseId || hwid);
        if (!targetLic) {
            targetLic = this.issueOrUpdateLicense({
                licenseId: licenseId || undefined,
                hwid,
                nodeFingerprint,
                customer,
            });
        }

        const partner = partnerId ? this.getPartnerSummary(partnerId) : null;
        const partnerDiscountPercent = partner ? partner.discountPercent : 0;
        const partnerMarginRub = partner ? Math.round(quote.totalAmountRub * (partnerDiscountPercent / 100)) : 0;

        const orderId = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        const order = {
            orderId,
            licenseId: targetLic.licenseId,
            partnerId: partner ? partner.partnerId : '',
            partnerDiscountPercent,
            partnerMarginRub,
            includeBasePak: quote.includeBasePak,
            tier: quote.tier,
            tierName: quote.tierName,
            addonSeats: quote.addonSeats,
            years: quote.years,
            amountRub: quote.totalAmountRub,
            items: quote.items,
            customer: {
                name: customer.name || targetLic.customer?.name || 'Организация WORK',
                inn: customer.inn || targetLic.customer?.inn || '',
                email: customer.email || targetLic.customer?.email || 'billing@odant.org',
                phone: customer.phone || targetLic.customer?.phone || '',
            },
            status: 'pending',
            paymentId: '',
            confirmationUrl: '',
            returnUrl: returnUrl || 'https://work.odant.org',
            createdAt: Date.now(),
            paidAt: null,
        };

        this.state.orders[orderId] = order;
        this._save();
        return order;
    }

    getOrder(orderId) {
        return this.state.orders[orderId] || null;
    }

    findOrderByPaymentId(paymentId) {
        if (!paymentId)
            return null;
        return Object.values(this.state.orders).find(o => o.paymentId === paymentId) || null;
    }

    updateOrder(orderId, patch = {}) {
        const ord = this.state.orders[orderId];
        if (!ord)
            return null;
        Object.assign(ord, patch);
        this._save();
        return ord;
    }

    /**
     * Отметить заказ как оплаченный и выпустить/продлить лицензию.
     */
    completePaidOrder(orderId, { paymentId = '' } = {}) {
        const ord = this.state.orders[orderId];
        if (!ord)
            throw new Error(`Заказ ${orderId} не найден`);
        if (ord.status === 'paid') {
            return {
                order: ord,
                license: this.getLicenseSummary(ord.licenseId),
                alreadyProcessed: true,
            };
        }
        ord.status = 'paid';
        ord.paidAt = Date.now();
        if (paymentId)
            ord.paymentId = paymentId;

        const license = this.grantAddonSubscription(ord.licenseId, {
            tier: ord.tier,
            seats: ord.addonSeats,
            years: ord.years,
            orderId: ord.orderId,
            paymentId: ord.paymentId,
        });
        let partner = null;
        if (ord.partnerId && this.state.partners[ord.partnerId]) {
            partner = this.recordPartnerSale(ord.partnerId, ord.amountRub);
        }
        this._save();
        return { order: ord, license, partner, alreadyProcessed: false };
    }

    /**
     * Привязать чат мессенджера (MAX, Telegram, VK) к лицензии ПАК.
     */
    bindBotChat({ channel, chatId, userName = '', codeOrLicenseId }) {
        const lic = this.findLicense(codeOrLicenseId);
        if (!lic)
            throw new Error('Лицензия или код привязки не найден. Проверьте код в разделе «Лицензия ПАК» вашего сервера WORK.');
        const key = `${String(channel).toLowerCase()}:${String(chatId)}`;
        this.state.botBindings[key] = {
            channel: String(channel).toLowerCase(),
            chatId: String(chatId),
            userName: String(userName || ''),
            licenseId: lic.licenseId,
            boundAt: Date.now(),
        };
        this._save();
        return this.getLicenseSummary(lic.licenseId);
    }

    getBoundLicenseForChat(channel, chatId) {
        const key = `${String(channel).toLowerCase()}:${String(chatId)}`;
        const binding = this.state.botBindings[key];
        if (!binding?.licenseId)
            return null;
        return this.getLicenseSummary(binding.licenseId);
    }

    getBindingsForLicense(licenseId) {
        return Object.values(this.state.botBindings).filter(b => b.licenseId === licenseId);
    }

    /**
     * Создать обращение (тикет) в техподдержку из MAX, Telegram, VK или веб-панели
     * с автоматическим контролем квоты обращений и SLA времени реакции по тарифу (Start / Business / Enterprise).
     */
    createSupportTicket({
        licenseId,
        channel = 'telegram',
        chatId = '',
        userName = 'Клиент',
        text = '',
    }) {
        const summary = this.getLicenseSummary(licenseId);
        if (!summary)
            throw new Error('Лицензия ПАК не найдена');

        if (summary.support.ticketsRemaining <= 0) {
            throw new Error(
                `Исчерпан годовой лимит обращений по тарифу ${summary.support.tierName} `
                + `(${summary.support.ticketsUsed}/${summary.support.ticketsQuota}). `
                + `Для увеличения лимита и ускорения реакции перейдите на тариф Business или Enterprise на https://work.odant.org`
            );
        }

        const rawLic = this.state.licenses[summary.licenseId];
        rawLic.support.ticketsUsed = Number(rawLic.support?.ticketsUsed || 0) + 1;

        const now = Date.now();
        const reactionMinutes = summary.support.reactionMinutes;
        const slaDeadlineAt = now + reactionMinutes * 60_000;
        const ticketId = 'TCK-' + Object.keys(this.state.tickets).length.toString().padStart(4, '0') + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

        const ticket = {
            ticketId,
            licenseId: summary.licenseId,
            customerName: summary.customer?.name || 'Клиент ПАК WORK',
            channel: String(channel).toLowerCase(),
            chatId: String(chatId),
            userName: String(userName),
            tier: summary.support.tier,
            tierName: summary.support.tierName,
            reactionMinutes,
            reactionLabel: summary.support.reactionLabel,
            slaDeadlineAt,
            status: 'open',
            createdAt: now,
            firstReplyAt: null,
            slaMet: null,
            messages: [
                {
                    from: 'client',
                    author: userName,
                    text: String(text || '').trim(),
                    time: now,
                },
            ],
        };

        this.state.tickets[ticketId] = ticket;
        this._save();
        return {
            ticket,
            license: this.getLicenseSummary(summary.licenseId),
        };
    }

    /**
     * Ответить на тикет от лица инженера поддержки (и зафиксировать выполнение SLA времени реакции).
     */
    replyToTicket(ticketId, { engineerName = 'Инженер поддержки ODANT', text = '' } = {}) {
        const t = this.state.tickets[ticketId];
        if (!t)
            throw new Error(`Тикет ${ticketId} не найден`);
        const now = Date.now();
        if (!t.firstReplyAt) {
            t.firstReplyAt = now;
            t.slaMet = now <= t.slaDeadlineAt;
        }
        t.status = 'answered';
        t.messages.push({
            from: 'support',
            author: engineerName,
            text: String(text || '').trim(),
            time: now,
        });
        this._save();
        return t;
    }

    listTickets({ licenseId = '' } = {}) {
        const all = Object.values(this.state.tickets).sort((a, b) => b.createdAt - a.createdAt);
        if (licenseId)
            return all.filter(t => t.licenseId === licenseId);
        return all;
    }

    /**
     * Получить статус квоты партнёров по региону (макс. число партнёров пропорционально населению).
     */
    getRegionPartnerQuotaStatus(regionCode = 'RU-SVE', customPopulationMillions = null) {
        const info = calculateFranchiseFee(regionCode, customPopulationMillions);
        const existingInRegion = Object.values(this.state.partners).filter(
            p => p.regionCode === info.regionCode && p.status !== 'revoked'
        );
        return {
            ...info,
            activePartnersCount: existingInRegion.length,
            availablePartnerSlots: Math.max(0, info.maxPartnersQuota - existingInRegion.length),
        };
    }

    /**
     * Зарегистрировать регионального партнёра-франчайзи с контролем региональной квоты (по населению)
     * и расчётом фиксированного паушального взноса (пропорционально экономике региона).
     */
    registerPartner({
        partnerId = '',
        companyName = '',
        inn = '',
        regionCode = 'RU-SVE',
        populationMillions = null,
        email = '',
        phone = '',
        contactPerson = '',
        annualSalesRub = 0,
    } = {}) {
        if (!companyName)
            throw new Error('Укажите наименование компании-партнёра');

        const quotaStatus = this.getRegionPartnerQuotaStatus(regionCode, populationMillions);
        const existing = partnerId ? this.state.partners[partnerId] : null;

        if (!existing && quotaStatus.availablePartnerSlots <= 0) {
            throw new Error(
                `В регионе «${quotaStatus.regionName}» исчерпана квота партнёров `
                + `(${quotaStatus.activePartnersCount} из ${quotaStatus.maxPartnersQuota}, `
                + `пропорционально населению ${quotaStatus.populationMillions} млн чел.)`
            );
        }

        const id = existing?.partnerId || partnerId || ('PRT-' + quotaStatus.regionCode.replace(/^RU-/, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase());
        const discountInfo = calculatePartnerDiscount(annualSalesRub ?? existing?.annualSalesRub ?? 0);
        const now = Date.now();

        const partner = {
            partnerId: id,
            companyName: String(companyName).trim(),
            inn: String(inn || existing?.inn || '').trim(),
            regionCode: quotaStatus.regionCode,
            regionName: quotaStatus.regionName,
            district: quotaStatus.district,
            populationMillions: quotaStatus.populationMillions,
            maxRegionPartnersQuota: quotaStatus.maxPartnersQuota,
            economicIndex: quotaStatus.economicIndex,
            franchiseFeeRub: quotaStatus.franchiseFeeRub,
            email: String(email || existing?.email || '').trim(),
            phone: String(phone || existing?.phone || '').trim(),
            contactPerson: String(contactPerson || existing?.contactPerson || '').trim(),
            annualSalesRub: discountInfo.annualSalesRub,
            discountPercent: discountInfo.discountPercent,
            statusLevel: discountInfo.statusLevel,
            certifiedSpecialists: Array.isArray(existing?.certifiedSpecialists) ? existing.certifiedSpecialists : [],
            certifiedStatus: Boolean(existing?.certifiedStatus),
            status: existing?.status || 'active',
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };

        this.state.partners[id] = partner;
        this._save();
        return this.getPartnerSummary(id);
    }

    /**
     * Зафиксировать продажу партнёра и пересчитать партнёрскую скидку (от 10% до 50% пропорционально годовому объёму).
     */
    recordPartnerSale(partnerId, saleAmountRub = 0) {
        const p = this.state.partners[partnerId];
        if (!p)
            throw new Error(`Партнёр ${partnerId} не найден`);
        const added = Math.max(0, Number(saleAmountRub || 0));
        const newSales = Number(p.annualSalesRub || 0) + added;
        const discountInfo = calculatePartnerDiscount(newSales);
        p.annualSalesRub = discountInfo.annualSalesRub;
        p.discountPercent = discountInfo.discountPercent;
        p.statusLevel = discountInfo.statusLevel;
        p.updatedAt = Date.now();
        this._save();
        return this.getPartnerSummary(partnerId);
    }

    /**
     * Провести аттестацию и выпустить сертификат специалиста партнёра по программе обучения WORK.
     */
    certifyPartnerSpecialist({
        partnerId,
        specialistName = '',
        email = '',
        trackId = 'pak-ai-engineer',
        score = 100,
    } = {}) {
        const p = this.state.partners[partnerId];
        if (!p)
            throw new Error(`Партнёр ${partnerId} не найден`);
        if (!specialistName)
            throw new Error('Укажите ФИО аттестуемого специалиста');

        const track = PARTNER_TRAINING_TRACKS.find(t => t.id === trackId || t.code === trackId);
        if (!track)
            throw new Error(`Учебный курс ${trackId} не найден в программе обучения`);

        const numericScore = Number(score ?? 0);
        if (numericScore < track.passScore) {
            throw new Error(
                `Балл аттестации (${numericScore}) ниже проходного порога (${track.passScore}) для курса «${track.title}»`
            );
        }

        const certId = `${track.code}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now = Date.now();
        const cert = {
            certificateId: certId,
            partnerId: p.partnerId,
            companyName: p.companyName,
            regionCode: p.regionCode,
            specialistName: String(specialistName).trim(),
            email: String(email || '').trim(),
            trackId: track.id,
            trackCode: track.code,
            trackTitle: track.title,
            hours: track.hours,
            score: numericScore,
            issuedAt: now,
            validUntil: now + 2 * ONE_YEAR_MS,
        };

        this.state.certificates[certId] = cert;
        p.certifiedSpecialists ??= [];
        p.certifiedSpecialists.push(cert);

        // Проверяем, закрыты ли все обязательные треки для статуса сертифицированного франчайзи
        const requiredTrackIds = PARTNER_TRAINING_TRACKS.filter(t => t.requiredForFranchise).map(t => t.id);
        const passedTrackIds = new Set(p.certifiedSpecialists.map(c => c.trackId));
        p.certifiedStatus = requiredTrackIds.every(reqId => passedTrackIds.has(reqId));
        p.updatedAt = now;

        this._save();
        return {
            certificate: cert,
            partner: this.getPartnerSummary(p.partnerId),
        };
    }

    getPartnerSummary(partnerId) {
        const p = this.state.partners[partnerId];
        if (!p)
            return null;
        const discountInfo = calculatePartnerDiscount(p.annualSalesRub);
        const regionQuota = this.getRegionPartnerQuotaStatus(p.regionCode, p.populationMillions);
        return {
            ...p,
            discountPercent: discountInfo.discountPercent,
            statusLevel: discountInfo.statusLevel,
            nextTargetSalesRub: discountInfo.nextTargetSalesRub,
            regionQuota: {
                populationMillions: regionQuota.populationMillions,
                maxPartnersQuota: regionQuota.maxPartnersQuota,
                activePartnersCount: regionQuota.activePartnersCount,
                availablePartnerSlots: regionQuota.availablePartnerSlots,
            },
        };
    }

    listPartners({ regionCode = '' } = {}) {
        const list = Object.keys(this.state.partners).map(id => this.getPartnerSummary(id));
        if (regionCode)
            return list.filter(p => p.regionCode === regionCode);
        return list;
    }

    listRegionsWithQuotas() {
        return REGIONS_CATALOG.map(r => this.getRegionPartnerQuotaStatus(r.code));
    }
}
