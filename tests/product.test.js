import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { $folder } from '../sources/server/index.js';
import { $server } from '../sources/server/server.js';

const PRODUCT_CLASS = '../$server/$folder/$file/$product/class.js';
const PRODUCT_TEMPLATE = '../$server/$folder/$file/$product/template.product';
const BID_CLASS = '../$server/$folder/$file/$bid/class.js';

async function loadDefault(rel) {
    const url = new URL(rel, import.meta.url);
    const mod = await import(url);
    return mod.default;
}

function readJson(rel) {
    const text = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
    return JSON.parse(text);
}

describe('$product type', () => {
    it('class.js exports FIELDS with catalog card fields', async () => {
        const def = await loadDefault(PRODUCT_CLASS);
        assert.equal(def.icon, 'carbon:product');
        assert.equal(def.label, 'Продукт');
        assert.ok(Array.isArray(def.FIELDS));
        const ids = def.FIELDS.map(f => f.id);
        assert.deepEqual(ids, ['label', 'price', 'description']);
    });

    it('template.product is valid JSON with card fields', () => {
        const data = readJson(PRODUCT_TEMPLATE);
        assert.equal(typeof data.label, 'string');
        for (const id of ['label', 'price', 'description'])
            assert.ok(id in data, 'template missing: ' + id);
        assert.equal(data.orderForm, undefined);
        assert.equal(data.includes, undefined);
    });
});

describe('$product registration', () => {
    it('$product type folder is resolvable under $file', async () => {
        globalThis.WORK = new $server();
        const product = await WORK.$folder.find_item('$product', (item) => item.id?.[0] === '$');
        assert.ok(product, '$product type folder not found');
        assert.equal(product.id, '$product');
    });
});

describe('MARKET/PAAS product path', () => {
    it('parsePathSteps splits ~//product into [~, empty, product]', () => {
        assert.deepEqual($folder.parsePathSteps('~//product'), ['~', '', 'product']);
    });
});

describe('$bid schema', () => {
    it('class.js FIELDS keep bid contract ids', async () => {
        const def = await loadDefault(BID_CLASS);
        assert.ok(Array.isArray(def.FIELDS));
        const ids = def.FIELDS.map(f => f.id);
        assert.deepEqual(ids, ['status', 'product', 'input']);
        const status = def.FIELDS.find(f => f.id === 'status');
        assert.deepEqual(status.options, ['', 'draft', 'submitted']);
        const product = def.FIELDS.find(f => f.id === 'product');
        assert.equal(product.type, 'object');
        const input = def.FIELDS.find(f => f.id === 'input');
        assert.equal(input.type, 'form');
        const domain = input.fields?.find(f => f.id === 'domainName');
        assert.ok(domain, 'input.domainName missing');
        assert.equal(domain.label, 'Имя домена');
    });
});
