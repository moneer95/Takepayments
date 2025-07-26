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
  origin: 'https://test.ea-dental.com',
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

  // 2.3 Kick off browser-info
  const body = htmlUtils.collectBrowserInfo(req);
  console.log('🟢 [INIT] Sending browser-info form HTML');
  res.send(htmlUtils.getWrapHTML(body));
});

// ─── 3) Browser-info GET handler for any other non-POST ───────────────────────
app.all('(.*)', (req, res, next) => {
  if (req.method !== 'POST') {
    console.log(`🟡 [ALL/*] ${req.method} ${req.url} — rendering browser-info`);
    const params = url.parse(req.url, true).query;

    if (params.cart) {
      try { req.session.cart = JSON.parse(params.cart) }
      catch (e) { console.warn('⚠️ [ALL/*] Invalid cart JSON', e) }
    }
    if (params.cardNumber) {
      req.session.card = {
        number:      params.cardNumber,
        expiryMonth: Number(params.cardExpiryMonth),
        expiryYear:  Number(params.cardExpiryYear),
        cvv:         params.cardCVV
      };
    }
    console.log('🟡 [ALL/*] Session cart:', req.session.cart);
    console.log('🟡 [ALL/*] Session card:', req.session.card);

    const body = htmlUtils.collectBrowserInfo(req);
    return res.send(htmlUtils.getWrapHTML(body));
  }
  next();
});

// ─── 4) POST handler — your existing 3DS flow ─────────────────────────────────
app.post('*', (req, res) => {
  console.log(`🔵 [3DS POST] Received POST to ${req.url} with body:`, req.body);
  const post = req.body;

  // Step 1: browser-info response
  if (anyKeyStartsWith(post, 'browserInfo[')) {
    console.log('🔵 [3DS] Detected browserInfo fields, step 1');
    const fields = getInitialFields(req, 'https://gateway.example.com/', req.ip);
    for (let [k, v] of Object.entries(post)) {
      fields[k.slice(12, -1)] = v;
    }
    console.log('🔵 [3DS] Gateway request fields (step 1):', fields);

    return Gateway.directRequest(fields)
      .then(response => {
        console.log('🔵 [3DS] Gateway response (step 1):', response);
        const body = processResponseFields(response, req);
        res.send(htmlUtils.getWrapHTML(body));
      })
      .catch(err => {
        console.error('🔴 [3DS] Gateway error (step 1):', err);
        res.status(500).send('Gateway error');
      });
  }

  // Step 2: handling the 3DS challenge response
  if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
    console.log('🔵 [3DS] Handling challenge response, step 2');
    const reqFields = {
      action:        'SALE',
      merchantID:    getInitialFields(req).merchantID,
      threeDSRef:    req.session.threeDSRef,
      threeDSResponse: Object.entries(post)
        .map(([k, v]) => `[${k}]__EQUAL__SIGN__${v}`)
        .join('&')
    };
    console.log('🔵 [3DS] Gateway request fields (step 2):', reqFields);

    return Gateway.directRequest(reqFields)
      .then(response => {
        console.log('🔵 [3DS] Gateway response (step 2):', response);
        const body = processResponseFields(response, req);
        res.send(htmlUtils.getWrapHTML(body));
      })
      .catch(err => {
        console.error('🔴 [3DS] Gateway error (step 2):', err);
        res.status(500).send('Gateway error');
      });
  }
});

// ─── 5) Helpers ────────────────────────────────────────────────────────────────
function anyKeyStartsWith(haystack, needle) {
  return Object.keys(haystack).some(k => k.startsWith(needle));
}

function processResponseFields(fields, req) {
  console.log('🟢 [processResponseFields] code=', fields.responseCode);
  switch (fields.responseCode) {
    case '65802':
      console.log('🟢 [3DS] Storing threeDSRef in session:', fields.threeDSRef);
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
  const totalAmountPence = cart.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100;

  const fields = {
    merchantID:        '278346',
    action:            'SALE',
    type:              1,
    transactionUnique: uuid(),
    countryCode:       826,
    currencyCode:      826,
    amount:            totalAmountPence || 1,
    cardNumber:        card.number       || '4012001037141112',
    cardExpiryMonth:   card.expiryMonth  || 12,
    cardExpiryYear:    card.expiryYear   || 20,
    cardCVV:           card.cvv          || '083',
    customerName:      req.session.customer?.name    || 'Test Customer',
    customerEmail:     req.session.customer?.email   || 'test@test.com',
    customerAddress:   req.session.customer?.address || '16 Test Street',
    customerPostCode:  req.session.customer?.postCode|| 'TE15 5ST',
    orderRef:          'Test purchase',
    remoteAddress,
    merchantCategoryCode: 5411,
    threeDSVersion:    '2',
    threeDSRedirectURL:(pageURL||'') + '&acs=1'
  };

  console.log('🟢 [getInitialFields] returning:', fields);
  return fields;
}

// ─── 6) Launch server ─────────────────────────────────────────────────────────
const server = http.createServer(app);
server.listen(8012, () => {
  console.log('🚀 Takepayments app listening on port 8012');
});
