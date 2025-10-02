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
  resave: false,
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
      req.session.threeDSRef = responseFields["threeDSRef"];
      req.session.save(() => console.log("threeDSRef saved to session"));
      return htmlUtils.showFrameForThreeDS(responseFields); // new UI below
    }
    case "0": {
      (async () => {
        try {
          const notifyRes = await fetch("https://test.ea-dental.com/api/payment-succeed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cart: req.session?.paymentDetails?.cart ?? [], response: responseFields })
          });
          if (!notifyRes.ok) throw new Error(`Notify ${notifyRes.status} ${notifyRes.statusText}`);
        } catch (err) { console.error("Notify failed:", err); }
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
  console.log("Body received:", req.body);
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
  const body = htmlUtils.collectBrowserInfo(req);
  sendResponse(res, body);
});

app.post('/', (req, res) => {
  const post = req.parsedBody || {};

  // 1) Browser info hop
  if (anyKeyStartsWith(post, 'browserInfo[')) {
    console.log("BROWSER INFO RECEIVED");
    console.log("Parsed post:", post);
    console.log("Session data before gateway call:", req.session);

    let fields = getInitialFieldsFromSession(
      req,
      'https://takepayments.ea-dental.com/',
      req.ip
    );
    for (const [k, v] of Object.entries(post)) {
      fields[k.substr(12, k.length - 13)] = v;
    }

    return gateway.directRequest(fields)
      .then((response) => sendResponse(res, processResponseFields(req, response)))
      .catch((error) => { console.error(error); res.status(500).send('Internal Server Error'); });
  }

  // ✅ 2) 3-DS Method ping (issuer’s hidden iframe callback) — respond SILENTLY
  if ('threeDSMethodData' in post) {
    console.log("3DS METHOD PING RECEIVED");
    console.log("Parsed post:", post);
    console.log("threeDSRef (should exist or come soon):", req.session.threeDSRef);
    return res.status(204).end();           // <-- THIS is the line you asked about
  }

  // 3) Final 3-DS result (challenge result)
  if ('cres' in post || 'PaRes' in post || anyKeyStartsWith(post, 'threeDSResponse[')) {
    console.log("3DS RESPONSE RECEIVED");
    console.log("Parsed post:", post);
    console.log("threeDSRef from session:", req.session.threeDSRef);

    if (!req.session.threeDSRef) {
      console.error('No 3DS reference found in session');
      return res.status(400).send('Missing 3DS reference');
    }

    const reqFields = { action: 'SALE', merchantID: "278346", threeDSRef: req.session.threeDSRef, threeDSResponse: '' };
    for (const [k, v] of Object.entries(post)) {
      reqFields.threeDSResponse += `[${k}]__EQUAL__SIGN__${v}&`;
    }
    reqFields.threeDSResponse = reqFields.threeDSResponse.slice(0, -1);

    return gateway.directRequest(reqFields)
      .then((response) => {
        sendResponse(res, processResponseFields(req, response));
        if (response.responseCode === "0") delete req.session.paymentDetails;
      })
      .catch((error) => { console.error(error); res.status(500).send('Internal Server Error'); });
  }

  // Fallback
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