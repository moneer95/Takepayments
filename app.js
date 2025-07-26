const express = require('express'); // Import Express
const qs = require('querystring'); // Import Node.js querystring module
const crypto = require('crypto'); // Import Node.js core crypto module
const httpBuildQuery = require('http-build-query'); // Import http-build-query module
const url = require('url'); // Import Node.js URL module
const htmlUtils = require('./htmlutils.js'); // Import your HTML utilities
const gateway = require('./gateway.js').Gateway; // Import your payment gateway
const assert = require('assert'); // Import assertion module
const uuid = require('uuid').v4; // For generating unique session IDs
const cors = require('cors'); // CORS support
const session = require('express-session'); // Session management for Express

// Initialize Express app
const app = express();

// Enable CORS and session management
app.use(cors({
  origin: 'https://test.ea-dental.com',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(session({
  genid: () => uuid(),
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: 'none' }
}));

// Endpoint for handling POST requests to /init
app.post('/init', function(req, res) {
    let body = req.body; // The POST data sent by the frontend

    // Check for browser info before initiating the gateway request
    if (anyKeyStartsWith(body, 'browserInfo[')) {
        let fields = getInitialFields(req.session.payload, 'https://d44cf4d997d1.ngrok-free.app/', req.connection.remoteAddress);

        // Merge incoming browser info into the fields
        for ([k, v] of Object.entries(body)) {
            fields[k.substr(12, k.length - 13)] = v; // Strip 'browserInfo[' and ']' from keys
        }

        gateway.directRequest(fields).then((response) => {
            body = processResponseFields(response, gateway);
            sendResponse(body, res);
        }).catch((error) => {
            console.error(error);
        });

    } else if (anyKeyStartsWith(body, 'threeDSResponse[')) {
        // Process 3DS response after challenge
        let reqFields = {
            action: 'SALE',
            merchantID: getInitialFields(null, null).merchantID,
            threeDSRef: global.threeDSRef,
            threeDSResponse: '',
        };

        // Build the response string
        for ([k, v] of Object.entries(body)) {
            reqFields.threeDSResponse += '[' + k + ']' + '__EQUAL__SIGN__' + v + '&';
        }
        
        // Remove the last & for good measure
        reqFields.threeDSResponse = reqFields.threeDSResponse.substr(0, reqFields.threeDSResponse.length - 1);

        gateway.directRequest(reqFields).then((response) => {
            body = processResponseFields(response, gateway);
            sendResponse(body, res);
        }).catch((error) => {
            console.error(error);
        });

    } else {
        // If the incoming request is not browser info or 3DS response, handle it normally
        console.log('Unexpected POST data:', body);
        res.status(400).send('Invalid data');
    }
});

// Helper function to check for matching keys
function anyKeyStartsWith(haystack, needle) {
    for ([k, v] of Object.entries(haystack)) {
        if (k.startsWith(needle)) {
            return true;
        }
    }
    return false;
}

// Process response from gateway
function processResponseFields(responseFields, gateway) {
    switch (responseFields["responseCode"]) {
        case "65802":
            global.threeDSRef = responseFields["threeDSRef"];
            return htmlUtils.showFrameForThreeDS(responseFields);
        case "0":
            return "<p>Thank you for your payment.</p>";
        default:
            return "<p>Failed to take payment: message=" + responseFields["responseMessage"] + " code=" + responseFields["responseCode"] + "</p>";
    }
}

// Send response back to the client
function sendResponse(body, res) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write(htmlUtils.getWrapHTML(body));
    res.end();
}

// This provides placeholder data for demonstration purposes only.
function getInitialFields(payload, pageURL, remoteAddress) {
    let uniqid = Math.random().toString(36).substr(2, 10);

    // Extract details from the payload
    const {
        cart,
        cardNumber,
        cardExpiryMonth,
        cardExpiryYear,
        cardCVV,
        customerName,
        customerEmail,
        customerAddress,
        customerPostCode,
    } = payload;

    // Calculate the total amount from the cart
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100;

    return {
        "merchantID": "278346",  // Replace with your actual merchant ID
        "action": "SALE",
        "type": 1,
        "transactionUnique": uniqid,
        "countryCode": 826,
        "currencyCode": 826,
        "amount": total || 1, // Amount in cents (e.g., $1.00 becomes 100)
        "cardNumber": cardNumber,
        "cardExpiryMonth": cardExpiryMonth,
        "cardExpiryYear": cardExpiryYear,
        "cardCVV": cardCVV,
        "customerName": customerName,
        "customerEmail": customerEmail,
        "customerAddress": customerAddress,
        "customerPostCode": customerPostCode,
        "orderRef": "Test purchase", // You can modify this as needed
        "remoteAddress": remoteAddress,
        "merchantCategoryCode": 5411, // This is the MCC code for retail
        "threeDSVersion": "2", // Specify the version of 3D Secure
        "threeDSRedirectURL": pageURL + "&acs=1", // Redirect URL after authentication
    };
}

// Start the server
app.listen(8012, () => {
    console.log('🚀 Server listening on port 8012');
});
