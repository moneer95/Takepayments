const express = require('express');  // Import Express
const http = require('http'); // Import Node.js core module
const qs = require('querystring');
const crypto = require('crypto');
const httpBuildQuery = require('http-build-query');
const url = require('url');
const session = require('express-session');
const htmlUtils = require('./htmlutils.js');
const gateway = require('./gateway.js').Gateway;
const assert = require('assert');
const cors = require('cors');
const uuid = require('uuid').v4;  // For generating unique session IDs

// Initialize Express app
const app = express();  // This was missing in your code

// Enable CORS and session management
app.use(cors({
  origin: '*', // Allow any origin
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

// Endpoint for handling POST requests to `/init`
app.post('/init', function(req, res) {
    let body = req.body;  // The POST data sent by the frontend

    // Store the payload data in session
    req.session.payload = body;

    // Example: Storing some data from the payload in the session
    req.session.cart = body.cart || [];
    req.session.card = {
        number: body.cardNumber,
        expiryMonth: body.cardExpiryMonth,
        expiryYear: body.cardExpiryYear,
        cvv: body.cardCVV
    };
    req.session.customer = {
        name: body.customerName,
        email: body.customerEmail,
        address: body.customerAddress,
        postCode: body.customerPostCode
    };

    console.log("Session data saved: ", req.session);

    // Proceed with your payment logic (browser info, gateway request, etc.)
    const fields = getInitialFields(req.session.payload, 'https://d44cf4d997d1.ngrok-free.app/', req.connection.remoteAddress);

    gateway.directRequest(fields).then((response) => {
        body = processResponseFields(response, gateway);
        sendResponse(body, res);
    }).catch((error) => {
        console.error(error);
        res.statusCode = 500;
        res.end("Gateway error");
    });
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
