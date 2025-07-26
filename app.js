// app.js
const express      = require('express');
const session      = require('express-session');
const bodyParser   = require('body-parser');
const cors         = require('cors');
const http         = require('http');
const { URL }      = require('url');
const { v4: uuid } = require('uuid');

const htmlUtils = require('./htmlutils.js');
const { Gateway } = require('./gateway.js');

const app = express();

const corsOptions = {
  origin:        'https://test.ea-dental.com',  // your Next.js origin
  credentials:   true,                          // allow cookies
  methods:       ['GET','POST','OPTIONS'],      // allowed methods
  allowedHeaders:['Content-Type','Authorization'] // if you need auth too
};

// enable CORS for all routes
app.use(cors(corsOptions));

// explicitly handle preflight across the board
app.options('*', cors(corsOptions));

// right after `const app = express();`
app.use((req, res, next) => {
  console.log(`➡️  [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});


// ─── 1) Middlewares ────────────────────────────────────────────────────────────
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());


app.use(session({
  genid: () => uuid(),
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: 'none' }
}));

// ─── 2) POST /init ─ stash cart/card, return browser‑info form ────────────────
app.post('/init', (req, res) => {
  console.log('🟢 [INIT] /init body:', req.body);
  const {
    cart, cardNumber, cardExpiryMonth,
    cardExpiryYear, cardCVV,
    customerName, customerEmail,
    customerAddress, customerPostCode
  } = req.body;

  // stash cart
  try { req.session.cart = typeof cart === 'string' ? JSON.parse(cart) : cart }
  catch (e) {
    console.warn('⚠️ [INIT] bad cart JSON', e);
    req.session.cart = [];
  }
  console.log('🟢 [INIT] session.cart =', req.session.cart);

  // stash card + customer
  req.session.card = { number: cardNumber, expiryMonth: +cardExpiryMonth, expiryYear: +cardExpiryYear, cvv: cardCVV };
  req.session.customer = { name: customerName, email: customerEmail, address: customerAddress, postCode: customerPostCode };
  console.log('🟢 [INIT] session.card =', req.session.card);
  console.log('🟢 [INIT] session.customer =', req.session.customer);

  // return the hidden browser‑info form
  const body = htmlUtils.collectBrowserInfo(req);
  console.log('🟢 [INIT] sending browser‑info form');
  res.send(htmlUtils.getWrapHTML(body));
});

// ─── 3) GET / ─ render browser‑info form if someone hits /directly ─────────────
app.get('/', (req, res) => {
  console.log('🟡 [GET /] url:', req.url);
  // optional: allow ?cart=... or ?cardNumber=...
  const q = new URL(req.protocol + '://' + req.get('host') + req.originalUrl).searchParams;
  if (q.has('cart')) {
    try { req.session.cart = JSON.parse(q.get('cart')) } 
    catch (e) { console.warn('⚠️ [GET /] bad cart JSON', e) }
  }
  if (q.has('cardNumber')) {
    req.session.card = {
      number:      q.get('cardNumber'),
      expiryMonth: +q.get('cardExpiryMonth'),
      expiryYear:  +q.get('cardExpiryYear'),
      cvv:         q.get('cardCVV')
    };
  }
  console.log('🟡 [GET /] session.cart =', req.session.cart);
  console.log('🟡 [GET /] session.card =', req.session.card);

  const body = htmlUtils.collectBrowserInfo(req);
  res.send(htmlUtils.getWrapHTML(body));
});

// ─── 4) POST / ─ your 3DS step‑1 & step‑2 flow ────────────────────────────────
app.post('/', (req, res) => {
  console.log('🔵 [POST /] body=', req.body);
  const post = req.body;

  // Step 1: browser‑info submission
  if (anyKeyStartsWith(post, 'browserInfo[')) {
    console.log('🔵 [3DS] step 1');
    const fields = getInitialFields(req, 'https://gateway.example.com/', req.ip);
    Object.entries(post).forEach(([k,v]) => {
      fields[k.slice(12, -1)] = v;
    });
    console.log('🔵 [3DS] fields1=', fields);
    return Gateway.directRequest(fields)
      .then(r => {
        console.log('🔵 [3DS] resp1=', r);
        res.send(htmlUtils.getWrapHTML(processResponseFields(r, req)));
      })
      .catch(err => {
        console.error('🔴 [3DS] err1=', err);
        res.status(500).send('Gateway error');
      });
  }

  // Step 2: challenge response
  if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
    console.log('🔵 [3DS] step 2');
    const reqFields = {
      action:         'SALE',
      merchantID:     getInitialFields(req).merchantID,
      threeDSRef:     req.session.threeDSRef,
      threeDSResponse: Object.entries(post)
        .map(([k,v])=>`[${k}]__EQUAL__SIGN__${v}`)
        .join('&')
    };
    console.log('🔵 [3DS] fields2=', reqFields);
    return Gateway.directRequest(reqFields)
      .then(r => {
        console.log('🔵 [3DS] resp2=', r);
        res.send(htmlUtils.getWrapHTML(processResponseFields(r, req)));
      })
      .catch(err => {
        console.error('🔴 [3DS] err2=', err);
        res.status(500).send('Gateway error');
      });
  }

  // nothing matched
  res.status(404).send('Not Found');
});

// ─── 5) Helpers ────────────────────────────────────────────────────────────────
function anyKeyStartsWith(hay, needle) {
  return Object.keys(hay).some(k => k.startsWith(needle));
}

function processResponseFields(fields, req) {
  console.log('🟢 [procFields] code=', fields.responseCode);
  switch(fields.responseCode) {
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
  const total = cart.reduce((s,i)=>s + i.price*i.quantity,0)*100;
  const data = {
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
  console.log('🟢 [initFields]=', data);
  return data;
}

// ─── 6) Launch ────────────────────────────────────────────────────────────────
http.createServer(app).listen(8012,()=>console.log('🚀 listening on 8012'));
