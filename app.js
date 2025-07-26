const express = require('express');
const qs = require('querystring');
const crypto = require('crypto');
const url = require('url');
const htmlUtils = require('./htmlUtils.js');
const gateway = require('./gateway.js').Gateway;
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

// Get complete initial fields with all mandatory fields
function getCompleteInitialFields(pageURL, remoteAddress) {
  return {
    merchantID: "278346",
    action: "SALE",
    type: 1, // Transaction type (1 for SALE)
    transactionUnique: crypto.randomBytes(8).toString('hex'), // Unique transaction ID
    countryCode: 826, // UK country code
    currencyCode: 826, // GBP currency code
    amount: 1, // Amount in smallest currency unit (e.g. pence)
    cardNumber: "4058888012110947", // Test card number
    cardExpiryMonth: 1, // Expiry month
    cardExpiryYear: 30, // Expiry year (2-digit)
    cardCVV: "726", // Card security code
    customerName: "Test Customer",
    customerEmail: "test@testcustomer.com",
    customerAddress: "16 Test Street",
    customerPostCode: "TE15 5ST",
    orderRef: "Test purchase",
    // 3DSv2 specific fields
    remoteAddress: remoteAddress || req.ip || "127.0.0.1",
    merchantCategoryCode: 5411, // MCC for grocery stores/supermarkets
    threeDSVersion: "2",
    threeDSRedirectURL: `${pageURL}&acs=1` ,
    // Additional recommended fields
    deviceChannel: "browser",
    deviceIdentity: req.headers['user-agent'] || "Unknown",
    deviceTimeZone: "0",
    deviceAcceptLanguage: req.headers['accept-language'] || "en-GB"
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

    if (anyKeyStartsWith(post, 'browserInfo[')) {
      // Handle initial browser info submission
      let fields = getCompleteInitialFields('https://your-ngrok-url.ngrok-free.app/', req.ip);
      
      // Merge browser info fields
      Object.entries(post).forEach(([k, v]) => {
        if (k.startsWith('browserInfo[') && k.endsWith(']')) {
          const key = k.substring(12, k.length - 1);
          fields[key] = v;
        }
      });

      console.log("Sending to gateway with fields:", fields); // Debug log
      const response = await gateway.directRequest(fields);
      sendResponse(res, processResponseFields(response));

    } else if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
      // Handle 3DS response
      let reqFields = {
        ...getCompleteInitialFields(), // Include all base fields
        threeDSRef: threeDSRef,
        threeDSResponse: Object.entries(post)
          .map(([k, v]) => `[${k}]__EQUAL__SIGN__${v}`)
          .join('&')
      };

      console.log("Sending 3DS response to gateway:", reqFields); // Debug log
      const response = await gateway.directRequest(reqFields);
      sendResponse(res, processResponseFields(response));
    } else {
      res.status(400).send('Invalid request format');
    }
  } catch (error) {
    console.error('POST Error:', error);
    res.status(500).json({ 
      error: 'Payment processing failed',
      details: error.message,
      code: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// Helper function to send responses
function sendResponse(res, body) {
  res.status(200)
    .type('html')
    .send(htmlUtils.getWrapHTML(body));
}

// Start server
const PORT = 8012;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Ensure all mandatory fields are included in requests:');
  console.log('- merchantID, type, cardNumber, cardExpiryMonth, cardExpiryYear, cardCVV');
  console.log('- amount, currencyCode, countryCode');
  console.log('- For 3DS: threeDSVersion, threeDSRedirectURL');
});