export {
    PAK_PRODUCT,
    AI_PLATFORM,
    VENDOR_CONTACTS,
    FEDERAL_DISTRICTS,
    SLA_TIERS,
    SEAT_VOLUME_DISCOUNTS,
    calculateSeatVolumeDiscount,
    calculateOrderQuote,
    FRANCHISE_PROGRAM,
    REGIONS_CATALOG,
    PARTNER_TRAINING_TRACKS,
    calculateRegionPartnerQuota,
    calculateFranchiseFee,
    calculatePartnerDiscount,
    calculatePartnerEconomics,
} from './catalog.js';
export { LICENSE_PROTOCOL, loadOrCreateAuthorityKeys, canonicalLicenseString, signCertificate, verifyCertificate } from './crypto.js';
export { LicenseStore } from './store.js';
export { YooKassaService } from './yookassa.js';
export { SupportBotsHub } from './bots.js';
export { LicenseServerAiAgent } from './agent.js';
export { createLicenseServerApp } from './server.js';
