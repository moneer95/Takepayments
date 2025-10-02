// server.js — JSON-ready, no globals, 3DS ref passed via hidden field

const http = require('http');
const qs = require('querystring');
const url = require('url');

const htmlUtils = require('./htmlutils.js'); // uses collectBrowserInfo(req), getWrapHTML()
const { Gateway: gateway } = require('./gateway.js');

// ----------------- helpers -----------------

function anyKeyStartsWith(haystack, needle) {
  for (const [k] of Object.entries(haystack)) {
    if (k.startsWith(needle)) return true;
  }
  return false;
}

function sendResponse(body, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.write(htmlUtils.getWrapHTML(body));
  res.end();
}

// Build a transaction payload from the incoming POST body (JSON or form)
// Only assign if present in the POST (so you can choose what to send from the front end)
function buildGatewayFields(req, post) {
  const uniqid = Math.random().toString(36).substr(2, 10);
  const remoteAddress = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1')
    .toString()
    .split(',')[0]
    .trim();

  const fields = {
    merchantID: "278346",
    action: "SALE",
    type: 1,
    transactionUnique: uniqid,
    countryCode: 826,
    currencyCode: 826,
    remoteAddress,
    merchantCategoryCode: 5411,
    threeDSVersion: "2",
    threeDSRedirectURL: "https://gateway.example.com/&acs=1",
  };

  // Assign from your JSON/form payload if provided
  // (You said “no need for validation” — keeping this literal/straight-through)
  if (post.amount !== undefined) fields.amount = post.amount;
  if (post.cardNumber) fields.cardNumber = String(post.cardNumber).replace(/\s+/g, '');
  if (post.cardExpiryMonth) fields.cardExpiryMonth = post.cardExpiryMonth;
  if (post.cardExpiryYear) fields.cardExpiryYear = post.cardExpiryYear;
  if (post.cardCVV) fields.cardCVV = post.cardCVV;

  if (post.customerName) fields.customerName = post.customerName;
  if (post.customerEmail) fields.customerEmail = post.customerEmail;
  if (post.customerAddress) fields.customerAddress = post.customerAddress;
  if (post.customerPostCode) fields.customerPostCode = post.customerPostCode;
  if (post.orderRef) fields.orderRef = post.orderRef;

  // If you also send custom fields like cart, you can include them here if your gateway expects them.

  return fields;
}

// Show/continue 3DS by posting to ACS. We pass threeDSRef via a hidden field (NO globals).
function showFrameForThreeDS(responseFields) {
  const style = responseFields['threeDSRequest[threeDSMethodData]'] ? ' display: none;' : '';
  const formField = {};

  for (const [k, v] of Object.entries(responseFields)) {
    if (k.startsWith('threeDSRequest[')) {
      const formKey = k.substr(15, k.length - 16);
      formField[formKey] = v;
    }
  }

  // Carry continuation ref in the form (so the next POST includes it)
  if (responseFields['threeDSRef']) {
    formField['threeDSRef'] = responseFields['threeDSRef'];
  }

  return silentPost(responseFields['threeDSURL'], formField, '_self', style);
}

// Simple auto-submitting form
function silentPost(actionUrl, fields, target = '_self', extraIframeStyle = '') {
  let inputs = '';
  for (const [k, v] of Object.entries(fields)) {
    const safeVal = String(v).replace(/"/g, '&quot;');
    inputs += `<input type="hidden" name="${k}" value="${safeVal}" />\n`;
  }

  // If the ACS might render a challenge, you can optionally show an iframe wrapper (optional)
  const maybeIframe =
    extraIframeStyle
      ? `<iframe name="threeds_acs" style="height:420px; width:420px;${extraIframeStyle}"></iframe>\n`
      : '';

  return `
    ${maybeIframe}
    <form id="silentPost" action="${actionUrl}" method="post" target="${target}">
      ${inputs}
      <input type="submit" value="Continue" />
    </form>
    <script>window.setTimeout(function(){ document.getElementById('silentPost').submit(); }, 0);</script>
  `;
}

function processResponseFields(responseFields) {
  switch (responseFields["responseCode"]) {
    case "65802":
      // Challenge/continuation needed
      return showFrameForThreeDS(responseFields);
    case "0":
      return "<p>Thank you for your payment.</p>";
    default:
      return `<p>Failed to take payment: message=${responseFields["responseMessage"]} code=${responseFields["responseCode"]}</p>`;
  }
}

// ----------------- server -----------------

const server = http.createServer(function (req, res) {
  const getParams = url.parse(req.url, true).query;

  if (req.method !== 'POST') {
    // Step 0: return HTML that auto-posts browser info (as in your original flow)
    const body = htmlUtils.collectBrowserInfo(req);
    sendResponse(body, res);
    return;
  }

  // POST:
  let body = '';

  req.on('data', function (data) {
    body += data;
    if (body.length > 1e6) {
      try { req.connection.destroy(); } catch (_) {}
    }
  });

  req.on('end', function () {
    let post;
    // Accept JSON or x-www-form-urlencoded
    try {
      post = JSON.parse(body || '{}');
    } catch (_) {
      post = qs.parse(body);
    }

    // Branch A: Initial POST (browser info present) -> send to gateway
    if (anyKeyStartsWith(post, 'browserInfo[')) {
      // Build your SALE fields straight from the front-end payload
      const fields = buildGatewayFields(req, post);

      // Also pass browserInfo[...] into fields (as your original code did)
      for (const [k, v] of Object.entries(post)) {
        if (k.startsWith('browserInfo[')) {
          fields[k.substr(12, k.length - 13)] = v;
        }
      }

      gateway.directRequest(fields)
        .then((response) => {
          const out = processResponseFields(response);
          sendResponse(out, res);
        })
        .catch((error) => {
          console.error(error);
          sendResponse('<p>Payment error.</p>', res);
        });

      return;
    }

    // Branch B: Continuation POST from ACS (no threeDSResponse[...] yet) -> include threeDSRef from form
    if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
      const reqFields = {
        action: 'SALE',
        merchantID: "100856",
        threeDSRef: post.threeDSRef || '', // <-- carried forward via hidden field
        threeDSResponse: '',
      };

      for (const [k, v] of Object.entries(post)) {
        reqFields.threeDSResponse += '[' + k + ']' + '__EQUAL__SIGN__' + v + '&';
      }
      // Remove trailing &
      if (reqFields.threeDSResponse.endsWith('&')) {
        reqFields.threeDSResponse = reqFields.threeDSResponse.slice(0, -1);
      }

      gateway.directRequest(reqFields)
        .then((response) => {
          const out = processResponseFields(response);
          sendResponse(out, res);
        })
        .catch((error) => {
          console.error(error);
          sendResponse('<p>Payment error.</p>', res);
        });

      return;
    }

    // If you have a third branch to catch explicit threeDSResponse[...] arrays, keep it the same as your original
    // (Your original snippet didn’t show that specific branch’s handling.)
  });
});

server.listen(8012, () => {
  console.log('Server listening on 8012');
});
