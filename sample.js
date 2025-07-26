// app.js
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const url = require('url');
const { v4: uuid } = require('uuid');

const htmlUtils = require('./htmlutils.js');
const { Gateway } = require('./gateway.js');

const app = express();

// ─── 1) Middlewares ────────────────────────────────────────────────────────────
// parse both application/x-www-form-urlencoded and application/json bodies
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// enable CORS if your Next.js app is on a different origin
app.use(cors({
    origin: 'http://localhost:3000',  // adjust to your Next.js origin
    credentials: true
}));

// session support
app.use(session({
    genid: () => uuid(),
    secret: process.env.SESSION_SECRET || 'change_me_to_something_secure',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,      // set to true if you serve over HTTPS
        sameSite: 'none'    // for cross-site cookies
    }
}));

// ─── 2) Init route: stash cart & card, return browser-info form ───────────────
app.post('/init', (req, res) => {
    const {
        cart,
        cardNumber,
        cardExpiryMonth,
        cardExpiryYear,
        cardCVV,
        customerName,
        customerEmail,
        customerAddress,
        customerPostCode
    } = req.body;

    // 2.1 Stash cart
    try {
        req.session.cart = typeof cart === 'string'
            ? JSON.parse(cart)
            : cart;
    } catch (e) {
        console.warn('Init: invalid cart JSON', e);
        req.session.cart = [];
    }

    // 2.2 Stash card and customer details
    req.session.card = {
        number: cardNumber,
        expiryMonth: Number(cardExpiryMonth),
        expiryYear: Number(cardExpiryYear),
        cvv: cardCVV
    };
    req.session.customer = {
        name: customerName,
        email: customerEmail,
        address: customerAddress,
        postCode: customerPostCode
    };

    // 2.3 Kick off 3DS browser-info step
    const body = htmlUtils.collectBrowserInfo(req);
    res.send(htmlUtils.getWrapHTML(body));
});

// ─── 3) Browser-info GET handler for any other non-POST ───────────────────────
app.all('*', (req, res, next) => {
    if (req.method !== 'POST') {
        const params = url.parse(req.url, true).query;

        // (Optional) support GET-based stash if you still want that
        if (params.cart) {
            try { req.session.cart = JSON.parse(params.cart) }
            catch (e) { console.warn('Invalid cart JSON', e) }
        }
        if (params.cardNumber) {
            req.session.card = {
                number: params.cardNumber,
                expiryMonth: Number(params.cardExpiryMonth),
                expiryYear: Number(params.cardExpiryYear),
                cvv: params.cardCVV
            };
        }

        const body = htmlUtils.collectBrowserInfo(req);
        return res.send(htmlUtils.getWrapHTML(body));
    }
    next();
});

// ─── 4) POST handler — your existing 3DS flow ─────────────────────────────────
app.post('*', (req, res) => {
    const post = req.body;

    // Step 1: browser-info response
    if (anyKeyStartsWith(post, 'browserInfo[')) {
        const fields = getInitialFields(req, 'https://gateway.example.com/', req.ip);
        for (let [k, v] of Object.entries(post)) {
            fields[k.slice(12, -1)] = v;
        }
        return Gateway.directRequest(fields)
            .then(response => {
                const body = processResponseFields(response, req);
                res.send(htmlUtils.getWrapHTML(body));
            })
            .catch(err => {
                console.error(err);
                res.status(500).send('Gateway error');
            });
    }

    // Step 2: handling the 3DS challenge response
    if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
        const reqFields = {
            action: 'SALE',
            merchantID: getInitialFields(req).merchantID,
            threeDSRef: req.session.threeDSRef,
            threeDSResponse: Object.entries(post)
                .map(([k, v]) => `[${k}]__EQUAL__SIGN__${v}`)
                .join('&')
        };

        return Gateway.directRequest(reqFields)
            .then(response => {
                const body = processResponseFields(response, req);
                res.send(htmlUtils.getWrapHTML(body));
            })
            .catch(err => {
                console.error(err);
                res.status(500).send('Gateway error');
            });
    }
});

// ─── 5) Helpers ────────────────────────────────────────────────────────────────
function anyKeyStartsWith(haystack, needle) {
    return Object.keys(haystack).some(k => k.startsWith(needle));
}

function processResponseFields(fields, req) {
    switch (fields.responseCode) {
        case '65802':
            req.session.threeDSRef = fields.threeDSRef;
            return htmlUtils.showFrameForThreeDS(fields);
        case '0':
            return '<p>Thank you for your payment.</p>';
        default:
            return `<p>Failed to take payment: message=${fields.responseMessage} code=${fields.responseCode}</p>`;
    }
}

function getInitialFields(req, pageURL, remoteAddress) {
    const cart = req.session.cart || [];
    const card = req.session.card || {};
    const totalAmountPence = cart
        .reduce((sum, item) => sum + item.price * item.quantity, 0) * 100;

    return {
        merchantID: '100856',
        action: 'SALE',
        type: 1,
        transactionUnique: uuid(),
        countryCode: 826,
        currencyCode: 826,
        amount: 1,
        cardNumber: card.number || '4012001037141112',
        cardExpiryMonth: card.expiryMonth || 12,
        cardExpiryYear: card.expiryYear || 20,
        cardCVV: card.cvv || '083',
        customerName: req.session.customer?.name || 'Test Customer',
        customerEmail: req.session.customer?.email || 'test@test.com',
        customerAddress: req.session.customer?.address || '16 Test Street',
        customerPostCode: req.session.customer?.postCode || 'TE15 5ST',
        orderRef: 'Test purchase',
        remoteAddress,
        merchantCategoryCode: 5411,
        threeDSVersion: '2',
        threeDSRedirectURL: (pageURL || '') + '&acs=1'
    };
}

// ─── 6) Launch server ─────────────────────────────────────────────────────────
const server = http.createServer(app);
server.listen(8012, () => {
    console.log('Takepayments app listening on port 8012');
});
