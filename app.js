const http = require('http'); // Import Node.js core module
const qs = require('querystring');

const crypto = require('crypto');
const httpBuildQuery = require('http-build-query');
const url = require('url');
const htmlUtils = require('./htmlutils.js');

const gateway = require('./gateway.js').Gateway;
const assert = require('assert');

// Session storage for production (replace with Redis/database in production)
const sessions = new Map();

// Session management functions
function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function getSession(req) {
    const cookies = parseCookies(req);
    const sessionId = cookies.sessionId;
    console.log('Getting session for ID:', sessionId, 'Available sessions:', Array.from(sessions.keys()));
    if (!sessionId || !sessions.has(sessionId)) {
        return null;
    }
    return sessions.get(sessionId);
}

function createSession(res, data = {}) {
    const sessionId = generateSessionId();
    sessions.set(sessionId, data);
    console.log('Created session:', sessionId, 'with data:', data);
    setCookie(res, 'sessionId', sessionId, { maxAge: 900, httpOnly: true, secure: true, sameSite: 'None' });
    return sessionId;
}

function updateSession(req, res, data) {
    const cookies = parseCookies(req);
    const sessionId = cookies.sessionId;
    if (sessionId && sessions.has(sessionId)) {
        sessions.set(sessionId, { ...sessions.get(sessionId), ...data });
    } else {
        createSession(res, data);
    }
}

function clearSession(req, res) {
    const cookies = parseCookies(req);
    const sessionId = cookies.sessionId;
    if (sessionId) {
        sessions.delete(sessionId);
        clearCookie(res, 'sessionId');
    }
}

// Cookie helper functions
function parseCookies(req) {
    const header = req.headers.cookie || '';
    return header.split(';').reduce((acc, part) => {
        const [k, v] = part.split('=');
        if (k && v) acc[k.trim()] = decodeURIComponent(v.trim());
        return acc;
    }, {});
}

function setCookie(res, name, value, { maxAge = 900, path = '/', secure = true, httpOnly = true, sameSite = 'None' } = {}) {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        `Max-Age=${maxAge}`,
        `Path=${path}`,
        secure ? 'Secure' : '',
        httpOnly ? 'HttpOnly' : '',
        sameSite ? `SameSite=${sameSite}` : ''
    ].filter(Boolean);
    const existing = res.getHeader('Set-Cookie');
    const next = existing ? (Array.isArray(existing) ? existing.concat(parts.join('; ')) : [existing, parts.join('; ')]) : parts.join('; ');
    res.setHeader('Set-Cookie', next);
}

function clearCookie(res, name) {
    setCookie(res, name, '', { maxAge: 0 });
}

var server = http.createServer(function(req, res) { //create web server
    const getParams = url.parse(req.url, true).query;
    let body = '';

    
    // collect chunks
    req.on('data', chunk => {
      body += chunk.toString();
    });

    // finished receiving
    req.on('end', () => {
      try {
        const data = JSON.parse(body); // parse JSON body

        if (data.items) {
          console.log("✅ Items received:", data.items);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, items: data.items }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "No items found in request body" }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });



    if (req.method != 'POST') {
      const url = new URL("https://takepayments.ea-dental.com" + req.url)
      const cartItems = url.searchParams.get('items')
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
                const session = getSession(req);
                console.log('Browser info session:', session);
                if (!session || !session.paymentData) {
                    console.log('Session expired or no payment data');
                    return sendResponse('<p>Session expired. Please try again.</p>', res);
                }
                
                let fields = getInitialFields('https://takepayments.ea-dental.com/', '127.0.0.1', session.paymentData);
                for ([k, v] of Object.entries(post)) {
                    fields[k.substr(12, k.length - 13)] = v;
                }

                gateway.directRequest(fields).then((response) => {
                    if (response.responseCode === "0") {
                        clearSession(req, res);
                    }
                    body = processResponseFields(response, gateway, req, res);
                    sendResponse(body, res);
                }).catch((error) => {
                    console.error(error);
                    sendResponse('<p>Payment processing error. Please try again.</p>', res);
                });
                // Gateway responds with result from ACS - potentially featuring a
                // challenge. Extract the method data, and pass back complete with
                // threeDSRef previously provided to acknowledge the challenge.
                // Also catches any continuation challenges and continues to post
                // until we ultimately receive an auth code
            } else if (post.action === 'collect_payment') {
                // Store payment data in session and redirect to browser info collection
                console.log('Storing payment data:', post);
                updateSession(req, res, { paymentData: post });
                body = htmlUtils.collectBrowserInfo(req);
                sendResponse(body, res);
            } else if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
                const session = getSession(req);
                if (!session || !session.threeDSRef) {
                    return sendResponse('<p>Session expired. Please try again.</p>', res);
                }
                
                let reqFields = {
                    action: 'SALE',
                    merchantID: process.env.GATEWAY_MERCHANT_ID || '278346',
                    threeDSRef: session.threeDSRef,
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
                    if (response.responseCode === "0") {
                        clearSession(req, res);
                    }
                    body = processResponseFields(response, gateway, req, res);
                    sendResponse(body, res);
                }).catch((error) => {
                    console.error(error);
                    sendResponse('<p>Payment processing error. Please try again.</p>', res);
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
function processResponseFields(responseFields, gateway, req, res) {
    switch (responseFields["responseCode"]) {
        case "65802":
            // Store threeDSRef in session
            updateSession(req, res, { threeDSRef: responseFields["threeDSRef"] });
            return htmlUtils.showFrameForThreeDS(responseFields);
        case "0":
            return "<p>Thank you for your payment.</p>"
        default:
            return "<p>Failed to take payment: message=" + responseFields["responseMessage"] + " code=" + responseFields["responseCode"] + "</p>"
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
                <input type="text" name="cardNumber" placeholder="1234567890123456" required />
            </p>
            <p>
                <label>Expiry Month:</label><br>
                <input type="text" name="cardExpiryMonth" placeholder="MM" required />
            </p>
            <p>
                <label>Expiry Year:</label><br>
                <input type="text" name="cardExpiryYear" placeholder="YY" required />
            </p>
            <p>
                <label>CVV:</label><br>
                <input type="text" name="cardCVV" placeholder="123" required />
            </p>
            <p>
                <label>Customer Name:</label><br>
                <input type="text" name="customerName" placeholder="John Doe" required />
            </p>
            <p>
                <label>Customer Email:</label><br>
                <input type="email" name="customerEmail" placeholder="john@example.com" required />
            </p>
            <p>
                <label>Customer Address:</label><br>
                <input type="text" name="customerAddress" placeholder="123 Main Street" required />
            </p>
            <p>
                <label>Customer Post Code:</label><br>
                <input type="text" name="customerPostCode" placeholder="SW1A 1AA" required />
            </p>
            <p>
                <label>Amount (in pence):</label><br>
                <input type="number" name="amount" placeholder="1000" required />
            </p>
            <p>
                <button type="submit">Pay Now</button>
            </p>
        </form>
    `;
}

// This provides data from form for production use
function getInitialFields(pageURL, remoteAddress, paymentData = {}) {
    let uniqid = Math.random().toString(36).substr(2, 10)

    return {
        "merchantID": process.env.GATEWAY_MERCHANT_ID || "278346",
        "merchantSecret": process.env.GATEWAY_MERCHANT_SECRET || "5CZ4T3pdVLUN011UrKFD",
        "action": "SALE",
        "type": 1,
        "transactionUnique": uniqid,
        "countryCode": 826,
        "currencyCode": 826,
        "amount": Number(paymentData.amount) || 1000,
        "cardNumber": paymentData.cardNumber || "",
        "cardExpiryMonth": Number(paymentData.cardExpiryMonth) || 0,
        "cardExpiryYear": Number(paymentData.cardExpiryYear) || 0,
        "cardCVV": paymentData.cardCVV || "",
        "customerName": paymentData.customerName || "",
        "customerEmail": paymentData.customerEmail || "",
        "customerAddress": paymentData.customerAddress || "",
        "customerPostCode": paymentData.customerPostCode || "",
        "orderRef": "Online Purchase",

        // The following fields are mandatory for 3DSv2 direct integration only
        "remoteAddress": remoteAddress,

        "merchantCategoryCode": Number(process.env.GATEWAY_MCC || 5411),
        "threeDSVersion": "2",
        "threeDSRedirectURL": pageURL + "&acs=1"
    }
}