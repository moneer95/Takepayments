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

// ===== Enable CORS and session management =====
app.use(cors({
  origin: 'https://test.ea-dental.com', // Allow any origin
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ===== Session middleware =====
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

// ===== Request-line + latency logger (no behavior change) =====
app.use((req, res, next) => {
  req._t0 = process.hrtime.bigint();
  console.log(`➡️  ${req.method} ${req.originalUrl}`);
  console.log("   headers:", {
    origin: req.headers.origin,
    referer: req.headers.referer,
    'content-type': req.headers['content-type'],
    cookie: !!req.headers.cookie ? "present" : "none"
  });
  res.on('finish', () => {
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - req._t0) / 1e6;
    console.log(`⬅️  ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms.toFixed(1)}ms)`);
  });
  next();
});

// ===== Session debug (kept) =====
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
  // LOG ENTRY
  logKV("🔎 processResponseFields →", {
    code: responseFields["responseCode"],
    msg: responseFields["responseMessage"],
    hasThreeDSRef: !!responseFields["threeDSRef"]
  });

  switch (responseFields["responseCode"]) {
    case "65802":
      console.log("   storing threeDSRef into session");
      // Store 3DS reference in session
      req.session.threeDSRef = responseFields["threeDSRef"];
      req.session.save(() => console.log("   session saved with threeDSRef"));
      return htmlUtils.showFrameForThreeDS(responseFields);
    case "0": {
      console.log("   final success (responseCode 0)");
      // Fire-and-forget notify; don't block the redirect
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

      // Return HTML that redirects in the browser
      const successUrl = "https://test.ea-dental.com/success";
      return `
        <div style="font-family:system-ui;margin:2rem;">
          <h2>Payment succeeded</h2>
          <p>Redirecting to confirmation… If you’re not redirected, <a href="${successUrl}">click here</a>.</p>
        </div>
        <script>
          (function(){ location.replace('${successUrl}'); })();
        </script>
      `;
    }

    default: {
      console.warn("   non-success code:", responseFields["responseCode"], responseFields["responseMessage"]);
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
  let uniqid = Math.random().toString(36).substr(2, 10);

  // Correctly format the URL
  const correctUrl = pageURL ? `${pageURL}${pageURL.includes('?') ? '&' : '?'}acs=1` : `https://takepayments.ea-dental.com/?acs=1`;

  // Calculate total amount from cart items
  let totalAmount = 0;
  if (req.session.paymentDetails?.cart) {
    req.session.paymentDetails.cart.forEach(item => {
      totalAmount += item.price * item.quantity;
    });
  }

  // LOG BUILD
  logKV("🧮 building initial fields", {
    uniqid,
    totalAmount,
    ip: remoteAddress,
    redirect: correctUrl,
    customerEmail: maskEmail(req.session.paymentDetails?.customerEmail),
  });

  return {
    "merchantID": "278346",
    "action": "SALE",
    "type": 1,
    "transactionUnique": uniqid,
    "countryCode": 826,
    "currencyCode": 826,
    "amount":  totalAmount * 100,
    "cardNumber": req.session.paymentDetails?.cardNumber || "",
    "cardExpiryMonth": req.session.paymentDetails?.cardExpiryMonth || 1,
    "cardExpiryYear": req.session.paymentDetails?.cardExpiryYear || 30,
    "cardCVV": req.session.paymentDetails?.cardCVV || "",
    "customerName": req.session.paymentDetails?.customerName || "",
    "customerEmail": req.session.paymentDetails?.customerEmail || "",
    "customerAddress": req.session.paymentDetails?.customerAddress || "",
    "customerPostCode": req.session.paymentDetails?.customerPostCode || "",
    // "redirectURL ": "https://test.ea-dental.com/success",
    "orderRef": "Online Payment",
    "remoteAddress": remoteAddress,
    "merchantCategoryCode": 5411,
    "threeDSVersion": "2",
    "threeDSRedirectURL": correctUrl
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

// New endpoint for payment initialization
app.post('/init', (req, res) => {

  console.log("INIT CALLED");
  logKV("Body received:", redact(req.body));
  console.log("Before saving session:", req.session);

  try {
    // Validate required fields
    if (!req.body.cardNumber || !req.body.cardExpiryMonth || !req.body.cardExpiryYear || !req.body.cardCVV) {
      return res.status(400).json({ error: 'Missing required card details' });
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

    // Clear any previous 3DS reference
    // delete req.session.threeDSRef;

    // Save session before sending response
    req.session.save(err => {
      console.log("Session saved successfully:", req.session);
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Failed to save session' });
      }

      // Generate browser info form
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
  console.log("GET /", { query: req.query, hasCookie: !!req.headers.cookie });
  const body = htmlUtils.collectBrowserInfo(req);
  sendResponse(res, body);
});

app.post('/', (req, res) => {
  const post = req.parsedBody || {};

  // payload shape snapshot (visibility only)
  logKV("POST / payload keys", Object.keys(post));
  console.log("   has browserInfo? ", anyKeyStartsWith(post, 'browserInfo['));
  console.log("   has threeDSMethodData? ", 'threeDSMethodData' in post);
  console.log("   has cres? ", 'cres' in post);
  console.log("   has PaRes? ", 'PaRes' in post);
  console.log("   has threeDSResponse[...]", anyKeyStartsWith(post, 'threeDSResponse['));
  console.log("   session.threeDSRef present? ", !!req.session.threeDSRef);

  // Collect browser information
  if (anyKeyStartsWith(post, 'browserInfo[')) {

    console.log("BROWSER INFO RECEIVED");
    logKV("Parsed post:", redact(post));
    console.log("Session data before gateway call:", req.session);

    let fields = getInitialFieldsFromSession(
      req,
      'https://takepayments.ea-dental.com/',
      req.ip
    );

    for ([k, v] of Object.entries(post)) {
      fields[k.substr(12, k.length - 13)] = v;
    }

    // gateway call log (browser-info hop)
    console.log("➡️ gateway.directRequest (browser-info)");
    logKV("  fields", {
      action: fields.action,
      amount: fields.amount,
      transactionUnique: fields.transactionUnique,
      customerEmail: maskEmail(fields.customerEmail),
      threeDSRedirectURL: fields.threeDSRedirectURL
    });

    gateway.directRequest(fields).then((response) => {
      // response log
      logKV("⬅️ gateway response (browser-info)", {
        code: response.responseCode,
        msg: response.responseMessage,
        threeDSRef: response.threeDSRef ? "[present]" : "[none]"
      });

      // Pass req to processResponseFields to access session
      const body = processResponseFields(req, response);
      sendResponse(res, body);
    }).catch((error) => {
      console.error("❌ gateway error (browser-info):", error && (error.stack || error));
      res.status(500).send('Internal Server Error');
    });
  }
  // Handle 3DS response
  else if (!anyKeyStartsWith(post, 'threeDSResponse[')) {

    console.log("3DS RESPONSE RECEIVED");
    logKV("Parsed post:", redact(post));
    console.log("threeDSRef from session:", req.session.threeDSRef);

    // Validate session has 3DS reference
    if (!req.session.threeDSRef) {
      console.error('No 3DS reference found in session');
      return res.status(400).send('Missing 3DS reference');
    }

    let reqFields = {
      action: 'SALE',
      merchantID: "278346",
      threeDSRef: req.session.threeDSRef, // Use from session
      threeDSResponse: '',
    };

    for ([k, v] of Object.entries(post)) {
      reqFields.threeDSResponse += '[' + k + ']' + '__EQUAL__SIGN__' + v + '&';
    }

    reqFields.threeDSResponse = reqFields.threeDSResponse.substr(0, reqFields.threeDSResponse.length - 1);

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

      // Pass req to processResponseFields to access session
      const body = processResponseFields(req, response);
      sendResponse(res, body);

      // Clear sensitive data after successful payment
      if (response.responseCode === "0") {
        console.log("Clearing session paymentDetails after success");
        delete req.session.paymentDetails;
        // delete req.session.threeDSRef;
      }
    }).catch((error) => {
      console.error("❌ gateway error (3DS-final):", error && (error.stack || error));
      res.status(500).send('Internal Server Error');
    });
  } else {
    console.log("POST / fell into 'Invalid request format' branch");
    res.status(400).send('Invalid request format');
  }
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

