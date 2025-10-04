const qs = require('querystring');


async function parseCartItems(req) {
    return new Promise((resolve) => {
        if (req.method !== 'POST') return resolve(undefined);

        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });

        req.once('end', () => {
            console.log('Raw body:', body);
            const ct = (req.headers['content-type'] || '').toLowerCase();

            try {
                // JSON: axios.post(..., { items }) or fetch with JSON body
                if (ct.includes('application/json')) {
                    const data = JSON.parse(body || '{}');
                    // return items if present, else the whole object
                    return resolve(data.items ?? data);
                }

                // Form-URL-Encoded: HTML <form method="post">
                if (ct.includes('application/x-www-form-urlencoded')) {
                    const parsed = qs.parse(body);
                    console.log('Parsed form:', parsed);

                    if (parsed.items) {
                        // items sent as a JSON string in a hidden field
                        try {
                            const items = JSON.parse(parsed.items);
                            console.log('Decoded items array:', items);
                            return resolve(items);
                        } catch {
                            // not JSON, just return the raw string
                            return resolve(parsed.items);
                        }
                    }

                    // Support repeated inputs: items[]=a&items[]=b
                    if (parsed['items[]']) {
                        const arr = Array.isArray(parsed['items[]'])
                            ? parsed['items[]']
                            : [parsed['items[]']];
                        return resolve(arr);
                    }

                    // Nothing specific; return whole parsed object
                    return resolve(parsed);
                }

                // Unknown content type
                return resolve(undefined);
            } catch (err) {
                console.error('Parse error:', err.message);
                return resolve(undefined);
            }
        });

        req.once('error', (err) => {
            console.error('Request error:', err.message);
            resolve(undefined);
        });
    });
}

module.exports = {
    parseCartItems
}