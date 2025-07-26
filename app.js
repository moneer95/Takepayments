const express = require('express');
const qs = require('querystring');
const crypto = require('crypto');
const url = require('url');
const htmlUtils = require('./htmlutils.js');
const gateway = require('./gateway.js').Gateway;
const assert = require('assert');
const cors = require('cors');
const session = require('express-session');
const uuid = require('uuid').v4;

const app = express();

// Enable CORS and session management
app.use(cors({
  origin: 'https://test.ea-dental.com', // Allow any origin
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Use express JSON parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let globalTimes = 0;

// Route for handling all requests
app.all('*', (req, res) => {
  const getParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
  let body = '';

  // Log the request URL for debugging purposes
  console.log('Request URL:', req.url);

  if (req.method === 'GET') {
    // Collect browser information and process the response for GET requests
    body = htmlUtils.collectBrowserInfo(req);
    sendResponse(body, res);
  } else if (req.method === 'POST') {
    req.on('data', (data) => {
      body += data;

      // Too much POST data, disconnect
      if (body.length > 1e6) request.connection.destroy();
    });

    req.on('end', () => {
      const post = qs.parse(body);

      // Collect browser information to present to the gateway
      if (anyKeyStartsWith(post, 'browserInfo[')) {
        let fields = getInitialFields('https://takepayments.ea-dental.com/', '127.0.0.1');
        for (const [k, v] of Object.entries(post)) {
          fields[k.substring(12, k.length - 13)] = v;
        }

        gateway.directRequest(fields).then((response) => {
          body = processResponseFields(response, gateway);
          sendResponse(body, res);
        }).catch((error) => {
          console.error(error);
        });
      } else if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
        let reqFields = {
          action: 'SALE',
          merchantID: getInitialFields(null, null).merchantID,
          threeDSRef: global.threeDSRef,
          threeDSResponse: '',
        };

        for (const [k, v] of Object.entries(post)) {
          reqFields.threeDSResponse += `[${k}]__EQUAL__SIGN__${v}&`;
        }

        reqFields.threeDSResponse = reqFields.threeDSResponse.slice(0, -1);

        gateway.directRequest(reqFields).then((response) => {
          body = processResponseFields(response, gateway);
          sendResponse(body, res);
        }).catch((error) => {
          console.error(error);
        });
      }
    });
  }
});

// Helper function to check if any key starts with a specific needle
function anyKeyStartsWith(haystack, needle) {
  for (const [k, v] of Object.entries(haystack)) {
    if (k.indexOf(needle) === 0) {  // Replaced regex with indexOf
      return true;
    }
  }
  return false;
}

// Helper function to process the gateway's response fields
function processResponseFields(responseFields, gateway) {
  switch (responseFields["responseCode"]) {
    case "65802":
      global.threeDSRef = responseFields["threeDSRef"];
      return htmlUtils.showFrameForThreeDS(responseFields);
    case "0":
      return "<p>Thank you for your payment.</p>";
    default:
      return `<p>Failed to take payment: message=${responseFields["responseMessage"]} code=${responseFields["responseCode"]}</p>`;
  }
}

// Helper function to send response
function sendResponse(body, res) {
  res.status(200).send(htmlUtils.getWrapHTML(body));
}

// Function to get initial fields for the request
function getInitialFields(pageURL, remoteAddress) {
  const uniqid = Math.random().toString(36).substr(2, 10);
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
    remoteAddress: remoteAddress,
    merchantCategoryCode: 5411,
    threeDSVersion: "2",
    threeDSRedirectURL: `${pageURL}&acs=1`,
  };
}

// Start the server
app.listen(8012, () => {
  console.log('Server is running on port 8012');
});
