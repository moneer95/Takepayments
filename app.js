const express = require('express');
const qs = require('querystring');
const crypto = require('crypto');
const url = require('url');
const htmlUtils = require('./htmlutils.js');
const gateway = require('./gateway.js').Gateway;
const cors = require('cors');

const app = express();

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

// Helper function to check if any key starts with a prefix
function anyKeyStartsWith(haystack, needle) {
  return Object.keys(haystack).some(k => k.startsWith(needle));
}

// Helper function to process the gateway's response fields
function processResponseFields(responseFields) {
  switch (responseFields["responseCode"]) {
    case "65802":
      threeDSRef = responseFields["threeDSRef"];
      return htmlUtils.showFrameForThreeDS(responseFields);
    case "0":
      return "<p>Thank you for your payment.</p>";
    default:
      return `<p>Payment failed: ${responseFields["responseMessage"]} (code ${responseFields["responseCode"]})</p>`;
  }
}

// Helper function to send response
function sendResponse(body, res) {
  res.status(200).send(htmlUtils.getWrapHTML(body));
}

// Function to get initial fields for the request
function getInitialFields(pageURL, remoteAddress) {
  const uniqid = Math.random().toString(36).substring(2, 12);
  const correctUrl = pageURL ? `${pageURL}?acs=1` : `https://takepayments.ea-dental.com/?acs=1`;

  return {
    merchantID: "278346",
    action: "SALE",
    type: 1,
    transactionUnique: uniqid,
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
    threeDSRedirectURL: correctUrl,
  };
}

// Route for GET requests
app.get('/', (req, res) => {
  const body = htmlUtils.collectBrowserInfo(req);
  sendResponse(body, res);
});

// Route for POST requests
app.post('/', (req, res) => {
  let body = '';
  
  req.on('data', (data) => {
    body += data;
    if (body.length > 1e6) req.connection.destroy();
  });

  req.on('end', () => {
    try {
      const post = qs.parse(body);

      if (anyKeyStartsWith(post, 'browserInfo[')) {
        handleBrowserInfo(post, res);
      } else if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
        handleThreeDSResponse(post, res);
      } else {
        res.status(400).send('Invalid request');
      }
    } catch (error) {
      console.error('Error processing request:', error);
      res.status(500).send('Internal Server Error');
    }
  });
});

// Handle browser info requests
function handleBrowserInfo(post, res) {
  let fields = getInitialFields('https://takepayments.ea-dental.com/', req.ip);
  
  Object.entries(post).forEach(([k, v]) => {
    if (k.startsWith('browserInfo[') && k.endsWith(']')) {
      const key = k.substring(12, k.length - 1);
      fields[key] = v;
    }
  });

  gateway.directRequest(fields)
    .then(response => sendResponse(processResponseFields(response), res))
    .catch(error => {
      console.error('Gateway error:', error);
      res.status(502).send('Bad Gateway');
    });
}

// Handle 3DS responses
function handleThreeDSResponse(post, res) {
  let reqFields = {
    action: 'SALE',
    merchantID: getInitialFields().merchantID,
    threeDSRef: threeDSRef,
    threeDSResponse: Object.entries(post)
      .map(([k, v]) => `[${k}]__EQUAL__SIGN__${v}`)
      .join('&')
  };

  gateway.directRequest(reqFields)
    .then(response => sendResponse(processResponseFields(response), res))
    .catch(error => {
      console.error('3DS processing error:', error);
      res.status(502).send('3DS Processing Failed');
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

// Start the server
const PORT = 8012;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});