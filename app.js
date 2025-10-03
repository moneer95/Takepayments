const http = require('http'); // Import Node.js core module
const qs = require('querystring');

const crypto = require('crypto');
const httpBuildQuery = require('http-build-query');
const url = require('url');
const htmlUtils = require('./htmlutils.js');

const gateway = require('./gateway.js').Gateway;
const assert = require('assert');
// const merchantSecret = 'pass';

var server = http.createServer(function(req, res) { //create web server
    const getParams = url.parse(req.url, true).query;
    let body = '';
    global.times = 0;

    if (req.method != 'POST') {
        // Return a form to collect payment details
        body = getPaymentForm();
        sendResponse(body, res);
    } else {
        body = '';

        req.on('data', function(data) {
            body += data;

            // Too much POST data,
            if (body.length > 1e6)
                request.connection.destroy();
        });

        req.on('end', function() {
            var post = qs.parse(body);

            // Collect browser information step - to present to the gateway
            if (anyKeyStartsWith(post, 'browserInfo[')) {
                let fields = getInitialFields('https://takepayments.ea-dental.com/', '127.0.0.1', global.paymentData);
                for ([k, v] of Object.entries(post)) {
                    fields[k.substr(12, k.length - 13)] = v;
                }

                gateway.directRequest(fields).then((response) => {
                    body = processResponseFields(response, gateway);
                    sendResponse(body, res);
                }).catch((error) => {
                    console.error(error);
                });
                // Gateway responds with result from ACS - potentially featuring a
                // challenge. Extract the method data, and pass back complete with
                // threeDSRef previously provided to acknowledge the challenge.
                // Also catches any continuation challenges and continues to post
                // until we ultimately receive an auth code
            } else if (post.action === 'collect_payment') {
                // Store payment data and redirect to browser info collection
                global.paymentData = post;
                body = htmlUtils.collectBrowserInfo(req);
                sendResponse(body, res);
            } else if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
                let reqFields = {
                    action: 'SALE',
                    merchantID: getInitialFields(null, null).merchantID,
                    threeDSRef: global.threeDSRef,
                    threeDSResponse: '',
                };

                for ([k, v] of Object.entries(post)) {
                    // http-build-query rightly converts subsequent = signs
                    // but the gateway is expecting them to form nested
                    // arrays. Due to this, we substitue them here and
                    // replace later on.
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
            }
        });
    }
});

/*
	anyKeyStartsWith

	Helper function to find matching keys in an object
*/
function anyKeyStartsWith(haystack, needle) {
    for ([k, v] of Object.entries(haystack)) {
        if (k.startsWith(needle)) {
            return true;
        }
    }

    return false;
}

/*
	processResponseFields

	Helper function to monitor and act upon differing
	gateway responses
*/
function processResponseFields(responseFields, gateway) {
    switch (responseFields["responseCode"]) {
        case "65802":
            // TODO - Please change this to local session storage
            global.threeDSRef = responseFields["threeDSRef"];
            return htmlUtils.showFrameForThreeDS(responseFields);
        case "0":
            return "<p>Thank you for your payment.</p>"
        default:
            return "<p>Failed to take payment: message=" + responseFields["responseMessage"] + " code=" + responseFields["responseCode"] + "</p>" //HTMLEntities.new.encode TODO
    }
}

/*
	sendResponse

	Helper function to wrap sending information
	steps to the browser
*/
function sendResponse(body, res) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write(htmlUtils.getWrapHTML(body));
    res.end();
}

server.listen(8012);

// Payment form to collect card details
function getPaymentForm() {
    return `
        <form method="post" action="?">
            <input type="hidden" name="action" value="collect_payment" />
            <h2>Payment Details</h2>
            <p>
                <label>Card Number:</label><br>
                <input type="text" name="cardNumber" value="4012001037141112" required />
            </p>
            <p>
                <label>Expiry Month:</label><br>
                <input type="text" name="cardExpiryMonth" value="12" required />
            </p>
            <p>
                <label>Expiry Year:</label><br>
                <input type="text" name="cardExpiryYear" value="30" required />
            </p>
            <p>
                <label>CVV:</label><br>
                <input type="text" name="cardCVV" value="083" required />
            </p>
            <p>
                <label>Customer Name:</label><br>
                <input type="text" name="customerName" value="Test Customer" required />
            </p>
            <p>
                <label>Customer Email:</label><br>
                <input type="email" name="customerEmail" value="test@testcustomer.com" required />
            </p>
            <p>
                <label>Customer Address:</label><br>
                <input type="text" name="customerAddress" value="16 Test Street" required />
            </p>
            <p>
                <label>Customer Post Code:</label><br>
                <input type="text" name="customerPostCode" value="TE15 5ST" required />
            </p>
            <p>
                <label>Amount (in pence):</label><br>
                <input type="number" name="amount" value="1001" required />
            </p>
            <p>
                <button type="submit">Pay Now</button>
            </p>
        </form>
    `;
}

// This provides data from form or defaults for demonstration purposes only.
function getInitialFields(pageURL, remoteAddress, paymentData = {}) {
    let uniqid = Math.random().toString(36).substr(2, 10)

    return {
        "merchantID": "278346",
        "action": "SALE",
        "type": 1,
        "transactionUnique": uniqid,
        "countryCode": 826,
        "currencyCode": 826,
        "amount": 10,
        "cardNumber": paymentData.cardNumber || "4012001037141112",
        "cardExpiryMonth": Number(paymentData.cardExpiryMonth) || 12,
        "cardExpiryYear": Number(paymentData.cardExpiryYear) || 30,
        "cardCVV": paymentData.cardCVV || "083",
        "customerName": paymentData.customerName || "Test Customer",
        "customerEmail": paymentData.customerEmail || "test@testcustomer.com",
        "customerAddress": paymentData.customerAddress || "16 Test Street",
        "customerPostCode": paymentData.customerPostCode || "TE15 5ST",
        "orderRef": "Test purchase",

        // The following fields are mandatory for 3DSv2 direct integration only
        "remoteAddress": remoteAddress,

        "merchantCategoryCode": 5411,
        "threeDSVersion": "2",
        "threeDSRedirectURL": pageURL + "&acs=1"
    }
}