import '../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildGenApiPayload,
    collectGenApiResultUrls,
} from '../sources/host/gen-api.js';

describe('gen-api', () => {
    it('buildGenApiPayload merges data and metadata defaults', () => {
        const metadata = {
            prompt: { placeholder: 'x' },
            aspect_ratio: { value: '16:9', items: ['16:9', '1:1'] },
            output_format: { value: 'jpeg', items: ['jpeg', 'png'] },
        };
        const payload = buildGenApiPayload(metadata, { prompt: 'кот', aspect_ratio: '1:1' });
        assert.equal(payload.prompt, 'кот');
        assert.equal(payload.aspect_ratio, '1:1');
        assert.equal(payload.output_format, 'jpeg');
    });

    it('collectGenApiResultUrls reads result and full_response', () => {
        const urls = collectGenApiResultUrls({
            result: ['https://cdn.example/a.jpg'],
            full_response: [{ url: 'https://cdn.example/b.jpg' }],
        });
        assert.deepEqual(urls, [
            'https://cdn.example/a.jpg',
            'https://cdn.example/b.jpg',
        ]);
    });
});
