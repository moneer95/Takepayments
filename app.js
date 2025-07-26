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

app.post('/', (req, res) => {
  let body = '';
  
  req.on('data', (data) => {
    body += data;
    if (body.length > 1e6) {
      debug(`[${req.requestId}] Request too large`);
      req.connection.destroy();
    }
  });

  req.on('end', () => {
    try {
      const post = qs.parse(body);
      verboseDebug(`[${req.requestId}] POST data:`, post);

      if (anyKeyStartsWith.call({req}, post, 'browserInfo[')) {
        handleBrowserInfo(post, req, res);
      } else if (!anyKeyStartsWith.call({req}, post, 'threeDSResponse[')) {
        handleThreeDSResponse(post, req, res);
      } else {
        res.status(400).send('Invalid request');
      }
    } catch (error) {
      console.error(`[${req.requestId}] POST Error:`, error);
      res.status(500).send('Internal Server Error');
    }
  });
});

// Handler functions
function handleBrowserInfo(post, req, res) {
  try {
    let fields = getInitialFields('https://takepayments.ea-dental.com/', req.ip);
    verboseDebug(`[${req.requestId}] Initial fields:`, fields);
    
    Object.entries(post).forEach(([k, v]) => {
      if (k.startsWith('browserInfo[') && k.endsWith(']')) {
        const key = k.substring(12, k.length - 1);
        fields[key] = v;
      }
    });

    debug(`[${req.requestId}] Sending to gateway`);
    gateway.directRequest(fields)
      .then(response => {
        verboseDebug(`[${req.requestId}] Gateway response:`, response);
        sendResponse(processResponseFields(response, req), res, req);
      })
      .catch(error => {
        console.error(`[${req.requestId}] Gateway error:`, error);
        res.status(502).send('Bad Gateway');
      });
  } catch (err) {
    console.error(`[${req.requestId}] BrowserInfo Error:`, err);
    res.status(500).send('Internal Server Error');
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
  console.error(`[${req.requestId}] Unhandled Error:`, err);
  res.status(500).send('Internal Server Error');
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