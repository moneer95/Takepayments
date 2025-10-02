const express = require('express');
const qs = require('querystring');
const crypto = require('crypto');
const session = require('express-session');
const url = require('url');
const htmlUtils = require('./htmlutils.js');
const gateway = require('./gateway.js').Gateway;
const cors = require('cors');

const app = express();
const PORT = 8012;

app.set('trust proxy', 1);

// ===== LOG HELPERS (safe, non-invasive) =====
function maskCard(num = "") {
  const s = String(num || "");
  if (s.length < 10) return "***";
  return s.slice(0, 6) + "******" + s.slice(-4);
}
function maskEmail(e = "") {
  const [u, d] = String(e || "").split("@");
  if (!d) return e;
  return (u ? u[0] : "") + "***@" + d;
}
function redact(obj) {
  try {
    const clone = JSON.parse(JSON.stringify(obj || {}));
    const S = new Set(["cardNumber","cardCVV","cvv","pan","password","authorization"]);
    for (const k of Object.keys(clone)) {
      const v = clone[k];
      if (S.has(k)) clone[k] = "***";
      if (k.toLowerCase().includes("email")) clone[k] = maskEmail(v);
      if (k.toLowerCase().includes("cardnumber") || k.toLowerCase() === "pan") clone[k] = maskCard(v);
    }
    return clone;
  } catch {
    return obj;
  }
}
function logKV(title, kv) {
  try {
    console.log(title, JSON.stringify(kv, null, 2));
  } catch {
    console.log(title, kv);
  }
}

// ===== Enable CORS (kept for any XHR you still do) =====
app.use(cors({
  origin: 'https://test.ea-dental.com',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ===== Session middleware (tightened) =====
// NOTE: For production, use a persistent store (e.g., Redis) instead of the default MemoryStore.
app.use(session({
  secret: 'GACp0xq7o0LXokGC9U9uYKeR3OCXWABfPutwyc55zQ',
  resave: false,               // was true
  saveUninitialized: false,    // was false (keep)
  rolling: true,               // refresh expiry on each response
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
    domain: '.ea-dental.com',
    maxAge: 15 * 60 * 1000
  }
}));

// ===== Request-line + latency logger =====
app.use((req, res, next) => {
  req._t0 = process.hrtime.bigint();
  console.log(`➡️  ${req.method} ${req.originalUrl}`);
  console.log("   headers:", {
    origin: req.headers.origin,
    referer: req.headers.referer,
    'content-type': req.headers['content-type'],
    cookie: !!req.headers.cookie ? "present" : "none",
    xfp: req.headers['x-forwarded-proto']
  });
  res.on('finish', () => {
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - req._t0) / 1e6;
    console.log(`⬅️  ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms.toFixed(1)}ms)`);
  });
  next();
});

// ===== Session debug =====
app.use((req, res, next) => {
  console.log("---- SESSION DEBUG ----");
  console.log("Time:", new Date().toISOString());
  console.log("Session ID:", req.sessionID);
  console.log("Session data:", req.session);
  console.log("Cookie header:", req.headers.cookie);
  console.log("-----------------------");
  next();
});

// ===== Helpers =====
function anyKeyStartsWith(haystack, needle) {
  for (const [k, v] of Object.entries(haystack || {})) {
    if (k.startsWith(needle)) return true;
  }
  return false;
}

function processResponseFields(req, responseFields) {
  logKV("🔎 processResponseFields →", {
    code: responseFields["responseCode"],
    msg: responseFields["responseMessage"],
    hasThreeDSRef: !!responseFields["threeDSRef"]
  });

  switch (responseFields["responseCode"]) {
    case "65802": {
      // Store 3DS reference in session
      console.log("   storing threeDSRef into session");
      req.session.threeDSRef = responseFields["threeDSRef"];
      req.session.save(() => console.log("   session saved with threeDSRef"));
      // Return ACS iframe/page from utils
      return htmlUtils.showFrameForThreeDS(responseFields);
    }

    case "0": {
      console.log("   final success (responseCode 0)");
      // Fire-and-forget notify
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
        <script>location.replace('${successUrl}');</script>
      `;
    }

    default: {
      const msg = responseFields["responseMessage"] || "Unknown error";
      console.warn("   non-success code:", responseFields["responseCode"], msg);
      return `
        <div style="font-family:system-ui;margin:2rem;">
          <h2>Payment failed</h2>
          <p>Message: ${msg}</p>
        </div>
      `;
    }
  }
}

function sendResponse(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.write(htmlUtils.getWrapHTML(body));
  res.end();
}

function getInitialFieldsFromSession(req, pageURL, remoteAddress) {
  const uniqid = Math.random().toString(36).substr(2, 10);
  const correctUrl = pageURL
    ? `${pageURL}${pageURL.includes('?') ? '&' : '?'}acs=1`
    : `https://takepayments.ea-dental.com/?acs=1`;

  // Total amount
  let totalAmount = 0;
  if (req.session.paymentDetails?.cart) {
    req.session.paymentDetails.cart.forEach(item => {
      totalAmount += (Number(item.price) || 0) * (Number(item.quantity) || 0);
    });
  }

  logKV("🧮 building initial fields", {
    uniqid,
    totalAmount,
    ip: remoteAddress,
    redirect: correctUrl,
    customerEmail: maskEmail(req.session.paymentDetails?.customerEmail),
  });

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
    remoteAddress: remoteAddress,
    merchantCategoryCode: 5411,
    threeDSVersion: "2",
    threeDSRedirectURL: correctUrl
  };
}

// ===== Body parsers =====
// Capture non-JSON (forms) into req.parsedBody
app.use((req, res, next) => {
  if (req.method === 'POST' && req.headers['content-type'] && !req.headers['content-type'].includes('application/json')) {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) req.connection.destroy();
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

// JSON
app.use(express.json());

// ===== /init — now accepts top-level form POST and redirects to '/' =====
app.post('/init', (req, res) => {
  console.log("INIT CALLED");

  // Accept JSON or a form field "__json"
  let body;
  if (req.is('application/json')) {
    body = req.body || {};
  } else if (req.parsedBody && typeof req.parsedBody.__json === 'string') {
    try {
      body = JSON.parse(req.parsedBody.__json);
    } catch (e) {
      console.error("Failed to parse __json:", e);
      return res.status(400).send('Bad payload');
    }
  } else {
    // fallback to urlencoded fields directly (not recommended for card data)
    body = req.parsedBody || {};
  }

  logKV("Body received:", redact(body));
  console.log("Before saving session:", req.session);

  try {
    // Validate required card fields
    if (!body.cardNumber || !body.cardExpiryMonth || !body.cardExpiryYear || !body.cardCVV) {
      return res.status(400).send('Missing required card details');
    }

    // Store payment details in session
    req.session.paymentDetails = {
      cart: body.cart || [],
      cardNumber: body.cardNumber,
      cardExpiryMonth: body.cardExpiryMonth,
      cardExpiryYear: body.cardExpiryYear,
      cardCVV: body.cardCVV,
      customerName: body.customerName || "",
      customerEmail: body.customerEmail || "",
      customerAddress: body.customerAddress || "",
      customerPostCode: body.customerPostCode || ""
    };

    // Save then redirect (top-level navigation keeps cookie reliably)
    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).send('Failed to save session');
      }
      console.log("Session saved successfully:", req.session);
      return res.redirect(302, '/'); // go render the browser-info page
    });

  } catch (error) {
    console.error('Init error:', error);
    res.status(500).send('Payment initialization failed');
  }
});

// ===== Root: serve browser-info page (auto-posts to POST /) =====
app.get('/', (req, res) => {
  console.log("GET /", { query: req.query, hasCookie: !!req.headers.cookie });
  const body = htmlUtils.collectBrowserInfo(req);
  sendResponse(res, body);
});

// ===== POST '/' — explicit 3DS branching =====
app.post('/', (req, res) => {
  const post = req.parsedBody || {};

  // Snapshot log
  logKV("POST / payload keys", Object.keys(post));
  console.log("   has browserInfo? ", anyKeyStartsWith(post, 'browserInfo['));
  console.log("   has threeDSMethodData? ", 'threeDSMethodData' in post);
  console.log("   has cres? ", 'cres' in post);
  console.log("   has PaRes? ", 'PaRes' in post);
  console.log("   has threeDSResponse[...]", anyKeyStartsWith(post, 'threeDSResponse['));
  console.log("   session.threeDSRef present? ", !!req.session.threeDSRef);

  // 1) Browser info hop
  if (anyKeyStartsWith(post, 'browserInfo[')) {
    console.log("BROWSER INFO RECEIVED");
    logKV("Parsed post:", redact(post));
    console.log("Session data before gateway call:", req.session);

    let fields = getInitialFieldsFromSession(
      req,
      'https://takepayments.ea-dental.com/',
      req.ip
    );

    for (const [k, v] of Object.entries(post)) {
      fields[k.substr(12, k.length - 13)] = v; // strip "browserInfo[...]" brackets
    }

    console.log("➡️ gateway.directRequest (browser-info)");
    logKV("  fields", {
      action: fields.action,
      amount: fields.amount,
      transactionUnique: fields.transactionUnique,
      customerEmail: maskEmail(fields.customerEmail),
      threeDSRedirectURL: fields.threeDSRedirectURL
    });

    gateway.directRequest(fields).then((response) => {
      logKV("⬅️ gateway response (browser-info)", {
        code: response.responseCode,
        msg: response.responseMessage,
        threeDSRef: response.threeDSRef ? "[present]" : "[none]"
      });

      const body = processResponseFields(req, response);
      sendResponse(res, body);
    }).catch((error) => {
      console.error("❌ gateway error (browser-info):", error && (error.stack || error));
      res.status(500).send('Internal Server Error');
    });

    return;
  }

  // 2) threeDSMethodData (issuer method ping) — DO NOT final the transaction here
  if ('threeDSMethodData' in post) {
    console.log("3DS METHOD PING RECEIVED");
    logKV("Parsed post:", redact(post));
    console.log("threeDSRef (should already exist OR follow soon):", req.session.threeDSRef);
  
    // Important: respond with no content so the hidden iframe doesn't replace the page.
    return res.status(204).end();
  
    // Alternative if you prefer 200:
    // res.set('Content-Type','text/html');
    // return res.end('<!doctype html><title></title>');
  }


  // 3) Final 3DS result (cres / PaRes)
  if ('cres' in post || 'PaRes' in post || anyKeyStartsWith(post, 'threeDSResponse[')) {
    console.log("3DS RESPONSE RECEIVED (final)");
    logKV("Parsed post:", redact(post));
    console.log("threeDSRef from session:", req.session.threeDSRef);

    if (!req.session.threeDSRef) {
      console.error('No 3DS reference found in session');
      return res.status(400).send('Missing 3DS reference');
    }

    const reqFields = {
      action: 'SALE',
      merchantID: "278346",
      threeDSRef: req.session.threeDSRef,
      threeDSResponse: ''
    };

    // Gateway expects "threeDSResponse" kv-encoding
    for (const [k, v] of Object.entries(post)) {
      reqFields.threeDSResponse += `[${k}]__EQUAL__SIGN__${v}&`;
    }
    reqFields.threeDSResponse = reqFields.threeDSResponse.slice(0, -1);

    console.log("➡️ gateway.directRequest (3DS-final)");
    logKV("  reqFields", {
      action: reqFields.action,
      hasThreeDSRef: !!reqFields.threeDSRef,
      threeDSResponseLength: (reqFields.threeDSResponse || '').length,
      threeDSResponsePreview: String(reqFields.threeDSResponse || '').slice(0, 60) + "…"
    });

    gateway.directRequest(reqFields).then((response) => {
      logKV("⬅️ gateway response (3DS-final)", {
        code: response.responseCode,
        msg: response.responseMessage
      });

      const body = processResponseFields(req, response);
      sendResponse(res, body);

      if (response.responseCode === "0") {
        console.log("Clearing session paymentDetails after success");
        delete req.session.paymentDetails;
        // Optionally clear threeDSRef too:
        // delete req.session.threeDSRef;
      }
    }).catch((error) => {
      console.error("❌ gateway error (3DS-final):", error && (error.stack || error));
      res.status(500).send('Internal Server Error');
    });

    return;
  }

  // Fallback
  console.log("POST / fell into 'Invalid request format' branch");
  res.status(400).send('Invalid request format');
});

// ===== Error handling =====
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

// ===== Session tail debug =====
app.use((req, res, next) => {
  console.log('Session ID:', req.sessionID);
  console.log('Session data:', req.session);
  next();
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Payment init endpoint: POST /init (accepts JSON or __json form field)');
  console.log('Top-level redirect to / establishes cookie first-party');
  console.log('Explicit 3DS branching in POST /');
});
