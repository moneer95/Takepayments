const http = require('http'); // Import Node.js core module
const qs = require('querystring');
const crypto = require('crypto');
const httpBuildQuery = require('http-build-query');
const url = require('url');
const htmlUtils = require('./htmlutils.js');
const gateway = require('./gateway.js').Gateway;
const assert = require('assert');
const cors = require('cors');

// Allow all origins (disabling CORS restrictions)
app.use(cors({
  origin: '*', // Allow any origin
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


var server = http.createServer(function(req, res) { // Create web server
    let body = '';
    global.times = 0;

    if (req.method !== 'POST') {
        // For GET request, send browser info form
        body = htmlUtils.collectBrowserInfo(req);
        sendResponse(body, res);
    } else {
        req.on('data', function(data) {
            body += data;

            // Too much POST data,
            if (body.length > 1e6)
                request.connection.destroy();
        });

        req.on('end', function() {
            let post;
            try {
                post = JSON.parse(body);  // Parse the incoming JSON payload
            } catch (e) {
                console.error("Error parsing JSON", e);
                res.statusCode = 400;
                res.end("Invalid JSON payload");
                return;
            }

            // Collect browser information step - to present to the gateway
            if (anyKeyStartsWith(post, 'browserInfo[')) {
                let fields = getInitialFields(post, 'https://takepayments.ea-dental.com/', '127.0.0.1');
                for ([k, v] of Object.entries(post)) {
                    fields[k.substr(12, k.length - 13)] = v;
                }

                gateway.directRequest(fields).then((response) => {
                    body = processResponseFields(response, gateway);
                    sendResponse(body, res);
                }).catch((error) => {
                    console.error(error);
                    res.statusCode = 500;
                    res.end("Gateway error");
                });
            } 
            // Check if it's the 3DS challenge response submission
            else if (anyKeyStartsWith(post, 'threeDSResponse[')) {
                let reqFields = {
                    action: 'SALE',
                    merchantID: getInitialFields(post, null, null).merchantID,
                    threeDSRef: global.threeDSRef,
                    threeDSResponse: '',
                };

                for ([k, v] of Object.entries(post)) {
                    reqFields.threeDSResponse += '[' + k + ']' + '__EQUAL__SIGN__' + v + '&';
                }
                reqFields.threeDSResponse = reqFields.threeDSResponse.substr(0, reqFields.threeDSResponse.length - 1);
                gateway.directRequest(reqFields).then((response) => {
                    body = processResponseFields(response, gateway);
                    sendResponse(body, res);
                }).catch((error) => {
                    console.error(error);
                    res.statusCode = 500;
                    res.end("Gateway error");
                });
            }
        });
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

server.listen(8012);

// This provides placeholder data for demonstration purposes only.
function getInitialFields(payload, pageURL, remoteAddress) {
    // Generate a unique transaction ID
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
        "cardNumber": '4058888012110947',
        "cardExpiryMonth": 1,
        "cardExpiryYear": 30,
        "cardCVV": 726,
        "customerName": 'monir',
        "customerEmail": 'mnyrskyk@gmail.com',
        "customerAddress": 'customerAddress',
        "customerPostCode": '0000000',
        "orderRef": "Test purchase", // You can modify this as needed
        "remoteAddress": remoteAddress,
        "merchantCategoryCode": 5411, // This is the MCC code for retail
        "threeDSVersion": "2", // Specify the version of 3D Secure
        "threeDSRedirectURL": pageURL + "&acs=1", // Redirect URL after authentication
    };
}
