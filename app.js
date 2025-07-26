// app.js
const express      = require('express');
const session      = require('express-session');
const bodyParser   = require('body-parser');
const http         = require('http');
const { v4: uuid } = require('uuid');

const htmlUtils = require('./htmlutils.js');
const { Gateway } = require('./gateway.js');

const app = express();

// at the very top of app.js, before any routes:
const cors = require('cors');

app.use(cors({
  origin: 'https://test.ea-dental.com',
  credentials: true,
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));


// ─── 1) Body parsing & sessions ───────────────────────────────────────────────
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({
  genid: () => uuid(),
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: 'none' }
}));

// ─── 2) POST /init — stash cart & card, render browser‑info form ─────────────
app.post('/init', (req, res) => {
  console.log('🟢 [INIT] /init body:', req.body);
  const {
    cart,
    cardNumber, cardExpiryMonth, cardExpiryYear, cardCVV,
    customerName, customerEmail, customerAddress, customerPostCode
  } = req.body;

  // 2.1 stash cart
  try {
    req.session.cart = typeof cart === 'string' ? JSON.parse(cart) : cart;
  } catch (e) {
    console.warn('⚠️ [INIT] bad cart JSON', e);
    req.session.cart = [];
  }
  console.log('🟢 [INIT] session.cart =', req.session.cart);

  // 2.2 stash card + customer
  req.session.card = {
    number:      cardNumber,
    expiryMonth: +cardExpiryMonth,
    expiryYear:  +cardExpiryYear,
    cvv:         cardCVV
  };
  req.session.customer = {
    name:     customerName,
    email:    customerEmail,
    address:  customerAddress,
    postCode: customerPostCode
  };
  console.log('🟢 [INIT] session.card =', req.session.card);
  console.log('🟢 [INIT] session.customer =', req.session.customer);

  // 2.3 render the hidden browser‑info form
  const formHtml = htmlUtils.getWrapHTML(htmlUtils.collectBrowserInfo(req));
  console.log('🟢 [INIT] formHtml:', formHtml); // Log the HTML form content
  res.send(formHtml);
});

// ─── 3) GET / — also render browser‑info if someone hits the root directly ─────
app.get('/', (req, res) => {
  console.log('🟡 [GET /] URL:', req.originalUrl);
  // (Optional) allow passing cart/card via querystring here if you still want
  const formHtml = htmlUtils.getWrapHTML(htmlUtils.collectBrowserInfo(req));
  res.send(formHtml);
});

// ─── 4) POST / — your two‑step 3DS flow ───────────────────────────────────────
app.post('/', (req, res) => {
  console.log('🔵 [POST /] body=', req.body);
  const post = req.body;

  // Step 1: browser‑info submission
  if (anyKeyStartsWith(post, 'browserInfo[')) {
    console.log('🔵 [3DS] step 1 detected');
    const fields = getInitialFields(req, 'https://takepayments.ea-dental.com/', req.ip);
    Object.entries(post).forEach(([k, v]) => {
      fields[k.slice(12, -1)] = v;
    });
    console.log('🔵 [3DS] fields1=', fields);
    return Gateway.directRequest(fields)
      .then(r => {
        console.log('🔵 [3DS] resp1=', r);
        const html = htmlUtils.getWrapHTML(processResponseFields(r, req));
        res.send(html);
      })
      .catch(err => {
        console.error('🔴 [3DS] err1=', err);
        res.status(500).send('Gateway error');
      });
  }

  // Step 2: challenge response
  if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
    console.log('🔵 [3DS] step 2 challenge');
    const reqFields = {
      action:          'SALE',
      merchantID:      getInitialFields(req).merchantID,
      threeDSRef:      req.session.threeDSRef,
      threeDSRexsponse: Object.entries(post)
        .map(([k, v]) => `[${k}]__EQUAL__SIGN__${v}`)
        .join('&')
    };
    console.log('🔵 [3DS] fields2=', reqFields);
    return Gateway.directRequest(reqFields)
      .then(r => {
        console.log('🔵 [3DS] resp2=', r);
        const html = htmlUtils.getWrapHTML(processResponseFields(r, req));
        res.send(html);
      })
      .catch(err => {
        console.error('🔴 [3DS] err2=', err);
        res.status(500).send('Gateway error');
      });
  }

  // neither step matched
  res.status(404).send('Not Found');
});

// ─── 5) Helpers ────────────────────────────────────────────────────────────────
function anyKeyStartsWith(obj, needle) {
  return Object.keys(obj).some(k => k.startsWith(needle));
}

function processResponseFields(fields, req) {
  console.log('🟢 [processResponseFields] code=', fields.responseCode);
  switch (fields.responseCode) {
    case '65802':
      console.log('🟢 [3DS] storing threeDSRef=', fields.threeDSRef);
      req.session.threeDSRef = fields.threeDSRef;
      return htmlUtils.showFrameForThreeDS(fields);
    case '0':
      return '<p>Thank you for your payment.</p>';
    default:
      return `<p>Failed: ${fields.responseMessage} (${fields.responseCode})</p>`;
  }
}

function getInitialFields(req, pageURL, remoteAddr) {
  const cart = req.session.cart || [];
  const card = req.session.card || {};
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100;

  const f = {
    merchantID:         '278346',
    action:             'SALE',
    type:               1,
    transactionUnique:  uuid(),
    countryCode:        826,
    currencyCode:       826,
    amount:             total || 1,
    cardNumber:         card.number     || '4012001037141112',
    cardExpiryMonth:    card.expiryMonth|| 12,
    cardExpiryYear:     card.expiryYear || 20,
    cardCVV:            card.cvv        || '083',
    customerName:       req.session.customer?.name    || 'Test Customer',
    customerEmail:      req.session.customer?.email   || 'test@test.com',
    customerAddress:    req.session.customer?.address || '16 Test Street',
    customerPostCode:   req.session.customer?.postCode|| 'TE15 5ST',
    orderRef:           'Test purchase',
    remoteAddress:      remoteAddr,
    merchantCategoryCode: 5411,
    threeDSVersion:     '2',
    threeDSRedirectURL: (pageURL||'') + '&acs=1'
  };
  console.log('🟢 [getInitialFields]=', f);
  return f;
}

// ─── 6) GET /test — simple test route returning HTML ───────────────────────────
app.get('/test', (req, res) => {
  console.log('🟡 [GET /test] Test route hit');
  
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Test Page</title>
      </head>
      <body>
        <h1>Welcome to the Test Page</h1>
        <p>This is a simple test route to check if the server is working correctly.</p>
      </body>
    </html>
  `;
  
  // Send the HTML content as the response
  res.send(htmlContent);
});


// ─── 6) Launch server ─────────────────────────────────────────────────────────
http.createServer(app).listen(8012, () => {
  console.log('🚀 Takepayments listening on port 8012');
});
