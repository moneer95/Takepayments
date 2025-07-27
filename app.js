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

// Enable CORS and session management
app.use(cors({
  origin: 'https://test.ea-dental.com', // Allow any origin
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Configure session middleware
app.use(session({
  secret: 'your-secret-key', // Change this to a strong secret
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, httpOnly: true } // Set secure:true in production with HTTPS
}));

// Global variable for 3DS reference
let threeDSRef = null;

// Helper function to check if any key starts with a prefix
function anyKeyStartsWith(haystack, needle) {
  for ([k, v] of Object.entries(haystack)) {
    if (k.startsWith(needle)) {
      return true;
    }
  }
  return false;
}

// Process gateway responses
function processResponseFields(responseFields) {
  switch (responseFields["responseCode"]) {
    case "65802":
      threeDSRef = responseFields["threeDSRef"];
      return htmlUtils.showFrameForThreeDS(responseFields);
    case "0":
      return "<p>Thank you for your payment.</p>";
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
function getInitialFieldsFromSession(session, pageURL, remoteAddress) {
  let uniqid = Math.random().toString(36).substr(2, 10);
  
  // Correctly format the URL with `?` if there are no parameters yet or `&` if parameters already exist
  const correctUrl = pageURL ? `${pageURL}${pageURL.includes('?') ? '&' : '?'}acs=1` : `https://takepayments.ea-dental.com/?acs=1`;

  // Calculate total amount from cart items
  let totalAmount = 0;
  if (session.paymentDetails?.cart) {
    session.paymentDetails.cart.forEach(item => {
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
    "amount": totalAmount * 100, // Use calculated amount or default
    "cardNumber": session.paymentDetails?.cardNumber || "3456787654589686",
    "cardExpiryMonth": session.paymentDetails?.cardExpiryMonth || 1,
    "cardExpiryYear": session.paymentDetails?.cardExpiryYear || 30,
    "cardCVV": session.paymentDetails?.cardCVV || "726",
    "customerName": session.paymentDetails?.customerName || "Test Customer",
    "customerEmail": session.paymentDetails?.customerEmail || "test@testcustomer.com",
    "customerAddress": session.paymentDetails?.customerAddress || "16 Test Street",
    "customerPostCode": session.paymentDetails?.customerPostCode || "TE15 5ST",
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
    // Store payment details in session
    req.session.paymentDetails = {
      cart: req.body.cart,
      cardNumber: req.body.cardNumber,
      cardExpiryMonth: req.body.cardExpiryMonth,
      cardExpiryYear: req.body.cardExpiryYear,
      cardCVV: req.body.cardCVV,
      customerName: req.body.customerName,
      customerEmail: req.body.customerEmail,
      customerAddress: req.body.customerAddress,
      customerPostCode: req.body.customerPostCode
    };
    
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
      req.session, 
      'https://takepayments.ea-dental.com/', 
      req.ip
    );
    
    for ([k, v] of Object.entries(post)) {
      fields[k.substr(12, k.length - 13)] = v;
    }

    gateway.directRequest(fields).then((response) => {
      const body = processResponseFields(response);
      sendResponse(res, body);
    }).catch((error) => {
      console.error(error);
      res.status(500).send('Internal Server Error');
    });
  } 
  // Handle 3DS response
  else if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
    let reqFields = {
      action: 'SALE',
      merchantID: "278346", // Use merchant ID directly
      threeDSRef: threeDSRef,
      threeDSResponse: '',
    };

    for ([k, v] of Object.entries(post)) {
      reqFields.threeDSResponse += '[' + k + ']' + '__EQUAL__SIGN__' + v + '&';
    }
    
    reqFields.threeDSResponse = reqFields.threeDSResponse.substr(0, reqFields.threeDSResponse.length - 1);
    
    gateway.directRequest(reqFields).then((response) => {
      const body = processResponseFields(response);
      sendResponse(res, body);
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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Payment init endpoint: POST /init');
});