const express = require('express');
const qs = require('querystring');
const crypto = require('crypto');
const url = require('url');
const htmlUtils = require('./htmlutils.js');
const gateway = require('./gateway.js').Gateway;

const app = express();
const PORT = 8012;

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

// Get initial fields (identical to your working version)
function getInitialFields(pageURL, remoteAddress) {
  let uniqid = Math.random().toString(36).substr(2, 10);
  
  // Correctly format the URL with `?` if there are no parameters yet or `&` if parameters already exist
  const correctUrl = pageURL ? `${pageURL}${pageURL.includes('?') ? '&' : '?'}acs=1` : `https://takepayments.ea-dental.com/?acs=1`;


  return {
    "merchantID": "278346",
    "action": "SALE",
    "type": 1,
    "transactionUnique": uniqid,
    "countryCode": 826,
    "currencyCode": 826,
    "amount": 1,
    "cardNumber": "4658601850430010",
    "cardExpiryMonth": 5,
    "cardExpiryYear": 27,
    "cardCVV": "452",
    "customerName": "Test Customer",
    "customerEmail": "test@testcustomer.com",
    "customerAddress": "16 Test Street",
    "customerPostCode": "TE15 5ST",
    "orderRef": "Test purchase",
    "remoteAddress": remoteAddress,
    "merchantCategoryCode": 5411,
    "threeDSVersion": "2",
    "threeDSRedirectURL": correctUrl
  };
}

// Middleware to handle raw POST body
app.use((req, res, next) => {
  if (req.method === 'POST') {
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

// Routes
app.get('/', (req, res) => {
  const body = htmlUtils.collectBrowserInfo(req);
  sendResponse(res, body);
});

app.post('/', (req, res) => {
  const post = req.parsedBody;

  // Collect browser information
  if (anyKeyStartsWith(post, 'browserInfo[')) {
    let fields = getInitialFields('https://takepayments.ea-dental.com/', req.ip);
    
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
      merchantID: getInitialFields(null, null).merchantID,
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
  console.log('Using identical logic to HTTP server version');
  console.log('Initial fields structure:');
  console.log(getInitialFields('https://test.com', '127.0.0.1'));
});