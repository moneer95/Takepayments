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
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 15 * 60 * 1000, // 15 minutes
    sameSite: 'none'
  }
}));

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
    case "65802":
      // Store 3DS reference in session
      req.session.threeDSRef = responseFields["threeDSRef"];
      req.session.save(); // Explicitly save session
      return htmlUtils.showFrameForThreeDS(responseFields);
    case "0":
      // Success — make a POST request
      try {
        fetch("https://ea-dental.com/api/payment-succeed", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            cart: req.session.paymentDetails.cart,
            response: responseFields
          })
        })  
        .then(res => {
          if (!res.ok) throw new Error("Failed to notify server.");
          // Redirect after success
          window.location.href = "https://ea-dental.com/success";
        })
        .catch(err => {
          alert("Payment succeeded, but server notify failed: " + err.message);
        });
        window.location.href = "https://ea-dental.com/success";
        return `<p>Payment succeeded. Confirmation sent.</p>`;
      } catch (err) {
        return `<p>Payment succeeded, but failed to notify: ${err.message}</p>`;
      }

      ;
    default:
      return `<p>Failed to take payment: message=${responseFields["responseMessage"]} code=${responseFields["responseCode"]}</p>`;
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
    // "redirectURL ": "https://ea-dental.com/success",
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

  // Collect browser information
  if (anyKeyStartsWith(post, 'browserInfo[')) {
    let fields = getInitialFieldsFromSession(
      req,
      'https://takepayments.ea-dental.com/',
      req.ip
    );

    for ([k, v] of Object.entries(post)) {
      fields[k.substr(12, k.length - 13)] = v;
    }

    gateway.directRequest(fields).then((response) => {
      // Pass req to processResponseFields to access session
      const body = processResponseFields(req, response);
      sendResponse(res, body);
    }).catch((error) => {
      console.error(error);
      res.status(500).send('Internal Server Error');
    });
  }
  // Handle 3DS response
  else if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
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

    gateway.directRequest(reqFields).then((response) => {
      // Pass req to processResponseFields to access session
      const body = processResponseFields(req, response);
      sendResponse(res, body);

      // Clear sensitive data after successful payment
      if (response.responseCode === "0") {
        delete req.session.paymentDetails;
        // delete req.session.threeDSRef;
      }
    }).catch((error) => {
      console.error(error);
      res.status(500).send('Internal Server Error');
    });
  } else {
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
  console.log(`Server running on port ${PORT}`);
  console.log('Payment init endpoint: POST /init');
  console.log('Session-based 3DS reference storage enabled');
});