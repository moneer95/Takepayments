const express = require('express');
const qs = require('querystring');
const crypto = require('crypto');
const url = require('url');
const htmlUtils = require('./htmlutils.js');
const gateway = require('./gateway.js').Gateway;
const cors = require('cors');

const app = express();

// Middleware
app.use(cors()); // Enable CORS if needed
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(express.json()); // Parse JSON bodies

// Global variable for 3DS reference
let threeDSRef = null;

// Helper function to check if any key starts with a prefix
function anyKeyStartsWith(haystack, needle) {
  return Object.keys(haystack).some(k => k.startsWith(needle));
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

// Get initial fields for requests
function getInitialFields(pageURL, remoteAddress) {
  const uniqid = crypto.randomBytes(8).toString('hex');
  const redirectURL = pageURL ? `${pageURL}&acs=1` : 'https://takepayments.ea-dental.com/?acs=1';

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
    threeDSRedirectURL: redirectURL
  };
}

// Routes
app.get('/', (req, res) => {
  try {
    const body = htmlUtils.collectBrowserInfo(req);
    sendResponse(res, body);
  } catch (err) {
    console.error('GET Error:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/', async (req, res) => {
  try {
    const post = req.body;

    // Handle browser info submission
    if (anyKeyStartsWith(post, 'browserInfo[')) {
      let fields = getInitialFields('https://d44cf4d997d1.ngrok-free.app/', req.ip);
      
      Object.entries(post).forEach(([k, v]) => {
        if (k.startsWith('browserInfo[') && k.endsWith(']')) {
          const key = k.substring(12, k.length - 1);
          fields[key] = v;
        }
      });

      const response = await gateway.directRequest(fields);
      sendResponse(res, processResponseFields(response));

    // Handle 3DS response
    } else if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
      let reqFields = {
        action: 'SALE',
        merchantID: getInitialFields().merchantID,
        threeDSRef: threeDSRef,
        type: 1, 
        threeDSResponse: Object.entries(post)
          .map(([k, v]) => `[${k}]__EQUAL__SIGN__${v}`)
          .join('&')
      };

      const response = await gateway.directRequest(reqFields);
      sendResponse(res, processResponseFields(response));
    } else {
      res.status(400).send('Invalid request format');
    }
  } catch (error) {
    console.error('POST Error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Helper function to send responses
function sendResponse(res, body) {
  res.status(200)
    .type('html')
    .send(htmlUtils.getWrapHTML(body));
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

// Start server
const PORT = 8012;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});