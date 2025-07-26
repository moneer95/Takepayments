// app.js
const express      = require('express');
const session      = require('express-session');
const bodyParser   = require('body-parser');
const cors         = require('cors');
const http         = require('http');
const url          = require('url');
const { v4: uuid } = require('uuid');

const htmlUtils = require('./htmlutils.js');
const { Gateway } = require('./gateway.js');

const app = express();

// ─── 1) Middlewares ────────────────────────────────────────────────────────────
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(cors({
  origin: 'https://test.ea-dental.com',  // your Next.js front‑end
  credentials: true
}));

app.use(session({
  genid: () => uuid(),
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: 'none' }
}));

// ─── 2) Init route: stash cart & card, return browser-info form ───────────────
app.post('/init', (req, res) => {
  console.log('🟢 [INIT] Received /init POST with body:', req.body);

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
    req.session.cart = typeof cart === 'string' ? JSON.parse(cart) : cart;
  } catch (e) {
    console.warn('⚠️ [INIT] Invalid cart JSON', e);
    req.session.cart = [];
  }
  console.log('🟢 [INIT] Session cart now:', req.session.cart);

  // 2.2 Stash card and customer details
  req.session.card = {
    number:      cardNumber,
    expiryMonth: Number(cardExpiryMonth),
    expiryYear:  Number(cardExpiryYear),
    cvv:         cardCVV
  };
  req.session.customer = {
    name:     customerName,
    email:    customerEmail,
    address:  customerAddress,
    postCode: customerPostCode
  };
  console.log('🟢 [INIT] Session card now:', req.session.card);
  console.log('🟢 [INIT] Session customer now:', req.session.customer);

  // 2.3 Kick off browser‑info step
  const body = htmlUtils.collectBrowserInfo(req);
  console.log('🟢 [INIT] Sending browser‑info form HTML');
  res.send(htmlUtils.getWrapHTML(body));
});

// ─── 3) Browser‑info page (GET /) ───────────────────────────────────────────────
app.get('/', (req, res) => {
  console.log(`🟡 [GET /] Rendering browser‑info for URL ${req.url}`);
  const params = url.parse(req.url, true).query;

  if (params.cart) {
    try { req.session.cart = JSON.parse(params.cart) }
    catch (e) { console.warn('⚠️ [GET /] Invalid cart JSON', e) }
  }
  if (params.cardNumber) {
    req.session.card = {
      number:      params.cardNumber,
      expiryMonth: Number(params.cardExpiryMonth),
      expiryYear:  Number(params.cardExpiryYear),
      cvv:         params.cardCVV
    };
  }
  console.log('🟡 [GET /] Session cart:', req.session.cart);
  console.log('🟡 [GET /] Session card:', req.session.card);

  const body = htmlUtils.collectBrowserInfo(req);
  res.send(htmlUtils.getWrapHTML(body));
});

// ─── 4) 3DS POST handler (POST /) ───────────────────────────────────────────────
app.post('/', (req, res) => {
  console.log(`🔵 [POST /] Received body:`, req.body);
  const post = req.body;

  // Step 1: browser‑info response
  if (anyKeyStartsWith(post, 'browserInfo[')) {
    console.log('🔵 [3DS] Step 1: browserInfo detected');
    const fields = getInitialFields(req, 'https://gateway.example.com/', req.ip);
    Object.entries(post).forEach(([k, v]) => {
      fields[k.slice(12, -1)] = v;
    });
    console.log('🔵 [3DS] Step 1 fields:', fields);

    return Gateway.directRequest(fields)
      .then(response => {
        console.log('🔵 [3DS] Step 1 response:', response);
        const body = processResponseFields(response, req);
        res.send(htmlUtils.getWrapHTML(body));
      })
      .catch(err => {
        console.error('🔴 [3DS] Step 1 error:', err);
        res.status(500).send('Gateway error');
      });
  }

  // Step 2: challenge response
  if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
    console.log('🔵 [3DS] Step 2: challenge response');
    const reqFields = {
      action:         'SALE',
      merchantID:     getInitialFields(req).merchantID,
      threeDSRef:     req.session.threeDSRef,
      threeDSResponse: Object.entries(post)
        .map(([k, v]) => `[${k}]__EQUAL__SIGN__${v}`)
        .join('&')
    };
    console.log('🔵 [3DS] Step 2 fields:', reqFields);

    return Gateway.directRequest(reqFields)
      .then(response => {
        console.log('🔵 [3DS] Step 2 response:', response);
        const body = processResponseFields(response, req);
        res.send(htmlUtils.getWrapHTML(body));
      })
      .catch(err => {
        console.error('🔴 [3DS] Step 2 error:', err);
        res.status(500).send('Gateway error');
      });
  }

  // If neither, just 404
  res.status(404).send('Not found');
});

// ─── 5) Helpers ────────────────────────────────────────────────────────────────
function anyKeyStartsWith(haystack, needle) {
  return Object.keys(haystack).some(k => k.startsWith(needle));
}

function processResponseFields(fields, req) {
  console.log('🟢 [processResponseFields] responseCode=', fields.responseCode);
  switch (fields.responseCode) {
    case '65802':
      console.log('🟢 [3DS] Storing threeDSRef:', fields.threeDSRef);
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
  const totalAmountPence = cart.reduce((sum, item) =>
    sum + (item.price * item.quantity), 0) * 100;

  const fields = {
    merchantID:         '278346',
    action:             'SALE',
    type:               1,
    transactionUnique:  uuid(),
    countryCode:        826,
    currencyCode:       826,
    amount:             totalAmountPence || 1,
    cardNumber:         card.number       || '4012001037141112',
    cardExpiryMonth:    card.expiryMonth  || 12,
    cardExpiryYear:     card.expiryYear   || 20,
    cardCVV:            card.cvv          || '083',
    customerName:       req.session.customer?.name    || 'Test Customer',
    customerEmail:      req.session.customer?.email   || 'test@test.com',
    customerAddress:    req.session.customer?.address || '16 Test Street',
    customerPostCode:   req.session.customer?.postCode|| 'TE15 5ST',
    orderRef:           'Test purchase',
    remoteAddress,
    merchantCategoryCode: 5411,
    threeDSVersion:     '2',
    threeDSRedirectURL: (pageURL || '') + '&acs=1'
  };

  console.log('🟢 [getInitialFields] returning:', fields);
  return fields;
}

// ─── 6) Launch server ─────────────────────────────────────────────────────────
const server = http.createServer(app);
server.listen(8012, () => {
  console.log('🚀 Takepayments app listening on port 8012');
});
