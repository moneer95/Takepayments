const express = require('express');
const qs = require('querystring');
const crypto = require('crypto');
const url = require('url');
const htmlUtils = require('./htmlutils.js');
const gateway = require('./gateway.js').Gateway;
const cors = require('cors');

// PM2-compatible logging setup
const debug = 'VERBOSE_DEBUG' ? console.log : () => {};
const verboseDebug = 'VERBOSE_DEBUG' ? console.log : () => {};

const app = express();

// Add request ID for tracking
app.use((req, res, next) => {
  req.requestId = crypto.randomBytes(4).toString('hex');
  debug(`[${req.requestId}] ${req.method} ${req.url}`);
  next();
});

// Enable CORS
app.use(cors({
  origin: 'https://test.ea-dental.com',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Middleware for parsing request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global variable for 3DS reference
let threeDSRef = null;

// Helper functions with PM2 logging
function anyKeyStartsWith(haystack, needle) {
  const result = Object.keys(haystack).some(k => k.startsWith(needle));
  verboseDebug(`[${this.req?.requestId || 'SYSTEM'}] anyKeyStartsWith result:`, result);
  return result;
}

function processResponseFields(responseFields, req) {
  debug(`[${req.requestId}] Processing response code: ${responseFields["responseCode"]}`);
  
  switch (responseFields["responseCode"]) {
    case "65802":
      threeDSRef = responseFields["threeDSRef"];
      debug(`[${req.requestId}] 3DS Auth Required. Ref: ${threeDSRef}`);
      return htmlUtils.showFrameForThreeDS(responseFields);
    case "0":
      debug(`[${req.requestId}] Payment Successful`);
      return "<p>Thank you for your payment.</p>";
    default:
      debug(`[${req.requestId}] Payment Failed. Code: ${responseFields["responseCode"]}`);
      return `<p>Payment failed: ${responseFields["responseMessage"]} (code ${responseFields["responseCode"]})</p>`;
  }
}

// Routes
app.get('/', (req, res) => {
  try {
    const body = htmlUtils.collectBrowserInfo(req);
    verboseDebug(`[${req.requestId}] Browser info:`, body);
    sendResponse(body, res, req);
  } catch (err) {
    console.error(`[${req.requestId}] GET Error:`, err);
    res.status(500).send('Internal Server Error');
  }
});

// Enhanced POST handler
app.post('/', (req, res) => {
  let body = '';
  const requestId = req.requestId;
  
  debug(`[${requestId}] Starting POST processing`);
  
  req.on('data', (data) => {
    body += data;
    if (body.length > 1e6) {
      debug(`[${requestId}] Request body too large (${body.length} bytes)`);
      req.connection.destroy();
      return;
    }
  });

  req.on('end', () => {
    debug(`[${requestId}] Received complete POST body (${body.length} bytes)`);
    verboseDebug(`[${requestId}] Raw POST body:`, body);

    try {
      const post = qs.parse(body);
      verboseDebug(`[${requestId}] Parsed POST data:`, post);

      if (!post || Object.keys(post).length === 0) {
        debug(`[${requestId}] Empty POST data received`);
        return res.status(400).json({error: "Empty POST data"});
      }

      if (anyKeyStartsWith.call({req}, post, 'browserInfo[')) {
        debug(`[${requestId}] Processing browser info submission`);
        handleBrowserInfo(post, req, res);
      } else if (anyKeyStartsWith.call({req}, post, 'threeDSResponse[')) {
        debug(`[${requestId}] Processing 3DS response`);
        handleThreeDSResponse(post, req, res);
      } else {
        debug(`[${requestId}] Unknown POST data format`);
        res.status(400).json({error: "Invalid request format"});
      }
    } catch (error) {
      console.error(`[${requestId}] POST Processing Error:`, error);
      res.status(500).json({error: "Internal server error", details: error.message});
    }
  });

  req.on('error', (err) => {
    console.error(`[${requestId}] POST Request Error:`, err);
    res.status(500).json({error: "Request processing error", details: err.message});
  });
});

// Enhanced browser info handler
function handleBrowserInfo(post, req, res) {
  const requestId = req.requestId;
  
  try {
    debug(`[${requestId}] Building browser info request`);
    
    let fields = getInitialFields('https://takepayments.ea-dental.com/', req.ip);
    verboseDebug(`[${requestId}] Initial fields:`, fields);
    
    // Process browser info fields
    Object.entries(post).forEach(([k, v]) => {
      if (k.startsWith('browserInfo[') && k.endsWith(']')) {
        const key = k.substring(12, k.length - 1);
        fields[key] = v;
      }
    });

    debug(`[${requestId}] Sending to payment gateway`);
    verboseDebug(`[${requestId}] Final request fields:`, fields);
    
    gateway.directRequest(fields)
      .then(response => {
        debug(`[${requestId}] Received gateway response`);
        verboseDebug(`[${requestId}] Gateway response:`, response);
        
        const processed = processResponseFields(response, req);
        sendResponse(processed, res, req);
      })
      .catch(error => {
        console.error(`[${requestId}] Gateway request failed:`, error);
        res.status(502).json({
          error: "Payment gateway error",
          details: error.message
        });
      });
  } catch (err) {
    console.error(`[${requestId}] BrowserInfo processing failed:`, err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message
    });
  }
}



function handleThreeDSResponse(post, req, res) {
  try {
    let reqFields = {
      action: 'SALE',
      merchantID: getInitialFields().merchantID,
      threeDSRef: threeDSRef,
      threeDSResponse: Object.entries(post)
        .map(([k, v]) => `[${k}]__EQUAL__SIGN__${v}`)
        .join('&')
    };

    debug(`[${req.requestId}] Sending 3DS verification`);
    gateway.directRequest(reqFields)
      .then(response => {
        verboseDebug(`[${req.requestId}] 3DS response:`, response);
        sendResponse(processResponseFields(response, req), res, req);
      })
      .catch(error => {
        console.error(`[${req.requestId}] 3DS Error:`, error);
        res.status(502).send('3DS Processing Failed');
      });
  } catch (err) {
    console.error(`[${req.requestId}] 3DS Handler Error:`, err);
    res.status(500).send('Internal Server Error');
  }
}

// Utility functions
function sendResponse(body, res, req) {
  verboseDebug(`[${req.requestId}] Sending response`);
  res.status(200).send(htmlUtils.getWrapHTML(body));
}

function getInitialFields(pageURL, remoteAddress) {
  const fields = {
    merchantID: "278346",
    action: "SALE",
    type: 1,
    transactionUnique: crypto.randomBytes(8).toString('hex'),
    countryCode: 826,
    currencyCode: 826,
    amount: 1,
    cardNumber: "4058888012110947",
    cardExpiryMonth: 1,
    cardExpiryYear: 30,
    cardCVV: "726",
    customerName: "Test Customer",
    customerEmail: "test@testcustomer.com",
    customerAddress: "16 Test Street",
    customerPostCode: "TE15 5ST",
    orderRef: "Test purchase",
    remoteAddress: remoteAddress || "127.0.0.1",
    merchantCategoryCode: 5411,
    threeDSVersion: "2",
    threeDSRedirectURL: pageURL ? `${pageURL}?acs=1` : `https://takepayments.ea-dental.com/?acs=1`,
  };

  verboseDebug('Generated fields:', fields);
  return fields;
}

// Error handling
app.use((err, req, res, next) => {
  const requestId = req.requestId || 'unknown';
  console.error(`[${requestId}] Unhandled Application Error:`, err);
  
  res.status(500).json({
    error: "Internal server error",
    requestId: requestId,
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = 8012;
app.listen(PORT, () => {
  console.log(`
  Server running on port ${PORT}
  
  PM2 Debugging Options:
  1. Normal mode: pm2 start app.js
  2. Debug mode: pm2 start app.js --env DEBUG
  3. Verbose mode: pm2 start app.js --env VERBOSE_DEBUG
  
  Logs can be viewed with:
  pm2 logs app --lines 1000
  `);
});