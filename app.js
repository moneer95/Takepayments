const express = require('express');
const qs = require('querystring');
const crypto = require('crypto');
const session = require('express-session');
const url = require('url');
const htmlUtils = require('./htmlutils.js');
const gateway = require('./gateway.js').Gateway;
const cors = require('cors')

const app = express();
const PORT = 8012;

app.set('trust proxy', 1);

// Enable CORS and session management
app.use(cors({
  origin: 'https://test.ea-dental.com', // Allow any origin
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


// Configure session middleware
app.use(session({
  secret: 'GACp0xq7o0LXokGC9U9uYKeR3OCXWABfPutwyc55zQ', // Change this to a strong secret
  resave: true,
  saveUninitialized: false,
  cookie: {
    secure: true, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 15 * 60 * 1000, // 15 minutes
    sameSite: 'none',
    domain: '.ea-dental.com'

  }
}));

app.use((req, res, next) => {
  console.log("---- SESSION DEBUG ----");
  console.log("Time:", new Date().toISOString());
  console.log("Session ID:", req.sessionID);
  console.log("Session data:", req.session);
  console.log("Cookie header:", req.headers.cookie);
  console.log("-----------------------");
  next();
});


// Helper function to check if any key starts with a prefix
function anyKeyStartsWith(haystack, needle) {
  for ([k, v] of Object.entries(haystack)) {
    if (k.startsWith(needle)) {
      return true;
    }
  }
  return false;
}

// Process gateway responses - now uses session for threeDSRef
function processResponseFields(req, responseFields) {
  switch (responseFields["responseCode"]) {
    case "65802": {
      // DO NOT overwrite an existing ref – prevents double flow
      if (!req.session.threeDSRef) {
        req.session.threeDSRef = responseFields["threeDSRef"];
        req.session.state = 'threeDSPending';
        req.session.save(()=>{});
        console.log("Stored threeDSRef (first time).");
      } else {
        console.log("threeDSRef already present – duplicate 65802 ignored.");
      }
      return htmlUtils.showFrameForThreeDS(responseFields);
    }

    case "0": {
      (async () => {
        try {
          const notifyRes = await fetch("https://test.ea-dental.com/api/payment-succeed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cart: req.session?.paymentDetails?.cart ?? [],
              response: responseFields
            })
          });
          if (!notifyRes.ok) {
            const txt = await notifyRes.text().catch(() => "");
            throw new Error(`Notify ${notifyRes.status} ${notifyRes.statusText} ${txt}`);
          }
        } catch (err) {
          console.error("Notify failed:", err);
        }
      })();

      const successUrl = "https://test.ea-dental.com/success";
      return `
        <div style="font-family:system-ui;margin:2rem;">
          <h2>Payment succeeded</h2>
          <p>Redirecting to confirmation… If you’re not redirected, <a href="${successUrl}">click here</a>.</p>
        </div>
        <script>(function(){ location.replace('${successUrl}'); })();</script>
      `;
    }

    default: {
      const msg = responseFields["responseMessage"] || "Unknown error";
      return `
        <div style="font-family:system-ui;margin:2rem;">
          <h2>Payment failed</h2>
          <p>Message: ${msg}</p>
        </div>
      `;
    }
  }
}




// Send response helper
function sendResponse(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.write(htmlUtils.getWrapHTML(body));
  res.end();
}

// Get initial fields using session data
function getInitialFieldsFromSession(req, pageURL, remoteAddress) {
  // Reuse per-attempt id
  const uniqid = req.session.txnUnique || (req.session.txnUnique = Math.random().toString(36).slice(2, 12));

  const correctUrl = pageURL
    ? `${pageURL}${pageURL.includes('?') ? '&' : '?'}acs=1`
    : `https://takepayments.ea-dental.com/?acs=1`;

  // Calculate total amount from cart items
  let totalAmount = 0;
  if (req.session.paymentDetails?.cart) {
    for (const item of req.session.paymentDetails.cart) {
      totalAmount += (item.price || 0) * (item.quantity || 0);
    }
  }
  if (!totalAmount || totalAmount <= 0) {
    // Defensive guard – don’t ever send zero to gateway
    throw new Error('Cart total must be greater than 0');
  }

  return {
    merchantID: "278346",
    action: "SALE",
    type: 1,
    transactionUnique: uniqid,
    countryCode: 826,
    currencyCode: 826,
    amount: Math.round(totalAmount * 100),
    cardNumber: req.session.paymentDetails?.cardNumber || "",
    cardExpiryMonth: req.session.paymentDetails?.cardExpiryMonth || 1,
    cardExpiryYear: req.session.paymentDetails?.cardExpiryYear || 30,
    cardCVV: req.session.paymentDetails?.cardCVV || "",
    customerName: req.session.paymentDetails?.customerName || "",
    customerEmail: req.session.paymentDetails?.customerEmail || "",
    customerAddress: req.session.paymentDetails?.customerAddress || "",
    customerPostCode: req.session.paymentDetails?.customerPostCode || "",
    orderRef: "Online Payment",
    remoteAddress,
    merchantCategoryCode: 5411,
    threeDSVersion: "2",
    threeDSRedirectURL: correctUrl
  };
}


// Middleware to handle raw POST body for non-JSON endpoints
app.use((req, res, next) => {
  if (req.method === 'POST' && req.headers['content-type'] !== 'application/json') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.connection.destroy();
      }
    });
    req.on('end', () => {
      req.rawBody = body;
      req.parsedBody = qs.parse(body);
      next();
    });
  } else {
    next();
  }
});

// Parse JSON bodies for /init endpoint
app.use(express.json());

app.post('/init', (req, res) => {
  try {
    // Validate required fields
    if (!req.body.cardNumber || !req.body.cardExpiryMonth || !req.body.cardExpiryYear || !req.body.cardCVV) {
      return res.status(400).json({ error: 'Missing required card details' });
    }

    // One transactionUnique per attempt
    if (!req.session.txnUnique) {
      req.session.txnUnique = Math.random().toString(36).slice(2, 12);
    }

    // Store payment details in session
    req.session.paymentDetails = {
      cart: req.body.cart || [],
      cardNumber: req.body.cardNumber,
      cardExpiryMonth: req.body.cardExpiryMonth,
      cardExpiryYear: req.body.cardExpiryYear,
      cardCVV: req.body.cardCVV,
      customerName: req.body.customerName || "",
      customerEmail: req.body.customerEmail || "",
      customerAddress: req.body.customerAddress || "",
      customerPostCode: req.body.customerPostCode || ""
    };

    // new state
    req.session.state = 'init';
    // ensure no stale ref
    // delete req.session.threeDSRef;

    // Save session before sending response
    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Failed to save session' });
      }
      const body = htmlUtils.collectBrowserInfo(req);
      res.set('Content-Type', 'text/html');
      res.send(htmlUtils.getWrapHTML(body));
    });
  } catch (error) {
    console.error('Init error:', error);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// Existing endpoints
app.get('/', (req, res) => {
  const body = htmlUtils.collectBrowserInfo(req);
  sendResponse(res, body);
});




function isBrowserInfo(post) {
  return anyKeyStartsWith(post, 'browserInfo[');
}
function isThreeDSMethod(post) {
  // silent device fingerprint ping from ACS
  return 'threeDSMethodData' in post;
}
function isThreeDSChallenge(post) {
  // actual result of 3DS challenge
  return 'cres' in post || 'PaRes' in post || anyKeyStartsWith(post, 'threeDSResponse[');
}





app.post('/', (req, res) => {
  const post = req.parsedBody || {};

  // --- DEBUG (keep) ---
  console.log('POST / hit', {
    time: new Date().toISOString(),
    sid: req.sessionID,
    keys: Object.keys(post),
    state: req.session?.state,
    has3DSRef: !!req.session?.threeDSRef
  });

  // 1) Initial browser info → first SALE (expect 65802)
  if (isBrowserInfo(post)) {
    // idempotency: if we already moved past this, ignore
    if (req.session.state === 'threeDSPending' || req.session.state === 'done') {
      console.log('Duplicate browser-info POST ignored. state=', req.session.state);
      return res.status(200).send('OK');
    }

    let fields;
    try {
      fields = getInitialFieldsFromSession(
        req,
        'https://takepayments.ea-dental.com/',
        req.ip
      );
    } catch (e) {
      console.error('Building fields failed:', e);
      return res.status(400).send(String(e.message || e));
    }

    // merge browser info
    for (const [k, v] of Object.entries(post)) {
      fields[k.substr(12, k.length - 13)] = v; // strip 'browserInfo[' and trailing ']'
    }

    console.log('Calling gateway (browser-info hop)', {
      txn: req.session.txnUnique,
      amount: fields.amount,
      state: req.session.state
    });

    return gateway.directRequest(fields).then((response) => {
      const body = processResponseFields(req, response);
      sendResponse(res, body);
    }).catch((error) => {
      console.error(error);
      res.status(500).send('Internal Server Error');
    });
  }

  // 2) 3DS Method ping – DO NOT call gateway, just ack
  if (isThreeDSMethod(post)) {
    console.log('3DS METHOD ping received – ignoring (no gateway call).');
    return res.status(204).end(); // or tiny HTML: res.send('<!doctype html><title>ok</title>')
  }

  // 3) 3DS Challenge result – final SALE with threeDSRef
  if (isThreeDSChallenge(post)) {
    console.log("3DS CHALLENGE RESULT received", { state: req.session.state, hasRef: !!req.session.threeDSRef });

    if (req.session.state === 'done') {
      console.log('Duplicate 3DS callback ignored.');
      return res.status(200).send('OK');
    }
    if (!req.session.threeDSRef) {
      console.error('Missing threeDSRef in session for challenge result');
      return res.status(400).send('Missing 3DS reference');
    }

    let reqFields = {
      action: 'SALE',
      merchantID: "278346",
      threeDSRef: req.session.threeDSRef,
      threeDSResponse: ''
    };

    if ('cres' in post) {
      // 3DS v2
      reqFields.threeDSResponse = '[cres]__EQUAL__SIGN__' + post.cres;
    } else if ('PaRes' in post) {
      // 3DS v1
      reqFields.threeDSResponse = '[PaRes]__EQUAL__SIGN__' + post.PaRes;
    } else if (anyKeyStartsWith(post, 'threeDSResponse[')) {
      // namespaced shape
      for (const [k, v] of Object.entries(post)) {
        reqFields.threeDSResponse += '[' + k + ']' + '__EQUAL__SIGN__' + v + '&';
      }
      reqFields.threeDSResponse = reqFields.threeDSResponse.slice(0, -1);
    } else {
      console.error('Unrecognized challenge shape', Object.keys(post));
      return res.status(400).send('Invalid 3DS result');
    }

    console.log('Calling gateway (3DS hop)', {
      txn: req.session.txnUnique,
      has3DSRef: !!req.session.threeDSRef,
      state: req.session.state
    });

    return gateway.directRequest(reqFields).then((response) => {
      console.log('3DS final gateway response', { code: response.responseCode, msg: response.responseMessage });

      const body = processResponseFields(req, response);
      sendResponse(res, body);

      if (response.responseCode === "0") {
        req.session.state = 'done';
        delete req.session.paymentDetails;
        delete req.session.threeDSRef;
        delete req.session.txnUnique;
        req.session.save(()=>{});
      }
    }).catch((error) => {
      console.error('3DS final error', error);
      res.status(500).send('Internal Server Error');
    });
  }

  // 4) Everything else
  console.log('Unknown POST keys:', Object.keys(post));
  return res.status(400).send('Invalid request format');
});






// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

// Add session debugging middleware
app.use((req, res, next) => {
  console.log('Session ID:', req.sessionID);
  console.log('Session data:', req.session);
  next();
});


// Start server
app.listen(PORT, () => {
  console.log(`Server running on port nn ${PORT}`);
  console.log('Payment init endpoint: POST /init');
  console.log('Session-based 3DS reference storage enabled');
});