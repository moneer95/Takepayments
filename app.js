const http = require('http');
const qs = require('querystring');
const url = require('url');
const { Gateway } = require('./gateway');
const htmlUtils = require('./htmlutils');

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

function json(res, status, data) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(data));
}

function sendHtml(res, body) {
	res.writeHead(200, { 'Content-Type': 'text/html' });
	res.end(htmlUtils.getWrapHTML(body));
}

function mapFrontendPayloadToGateway(payload, { pageURL, remoteAddress }) {
	const transactionUnique = Math.random().toString(36).substr(2, 10);
	const amountMinorUnits = resolveAmountFromCart(payload.cart);
	return {
		action: 'SALE',
		merchantID: '278346',
		merchantPwd: null,
		merchantSecret: "5CZ4T3pdVLUN011UrKFD",
		type: 1,
		transactionUnique,
		countryCode: 826,
		currencyCode: 826,
		amount: amountMinorUnits,
		cardNumber: payload.cardNumber,
		cardExpiryMonth: Number(payload.cardExpiryMonth),
		cardExpiryYear: Number(payload.cardExpiryYear),
		cardCVV: payload.cardCVV,
		customerName: payload.customerName,
		customerEmail: payload.customerEmail,
		customerAddress: payload.customerAddress,
		customerPostCode: payload.customerPostCode,
		orderRef: 'Checkout purchase',
		remoteAddress,
		merchantCategoryCode: Number(process.env.GATEWAY_MCC || 5411),
		threeDSVersion: '2',
		threeDSRedirectURL: pageURL + (pageURL.includes('?') ? '&' : '?') + 'acs=1'
	};
}

function resolveAmountFromCart(cart) {
	if (!Array.isArray(cart) || cart.length === 0) return 0;
	let total = 0;
	for (const item of cart) {
		const price = Number(item.price || 0);
		const qty = Number(item.quantity || 1);
		total += price * qty;
	}
	return Math.round(total * 100);
}

function anyKeyStartsWith(haystack, needle) {
	for ([k, v] of Object.entries(haystack)) {
		if (k.startsWith(needle)) return true;
	}
	return false;
}

const server = http.createServer(async (req, res) => {
	const parsedUrl = url.parse(req.url, true);
	const method = req.method || 'GET';
	const isRoot = parsedUrl.pathname === '/' || parsedUrl.pathname === '';

	if (!isRoot) {
		res.statusCode = 404;
		return res.end('Not Found');
	}

	// Step 1: On GET, return browser info collector form with embedded payload
	if (method === 'GET') {
		// Get payload from query params or return form to collect it
		const payload = parsedUrl.query.payload ? JSON.parse(decodeURIComponent(parsedUrl.query.payload)) : {};
		
		// If no payload, return a form to collect it
		if (!payload.cart || payload.cart.length === 0) {
			const collectPayloadHtml = `
				<form id="collectPayload" method="post" action="?">
					<input type="hidden" name="action" value="collect_payload" />
					<p>Please provide payment details...</p>
					<input type="text" name="cardNumber" placeholder="Card Number" required />
					<input type="text" name="cardExpiryMonth" placeholder="MM" required />
					<input type="text" name="cardExpiryYear" placeholder="YY" required />
					<input type="text" name="cardCVV" placeholder="CVV" required />
					<input type="text" name="customerName" placeholder="Name" required />
					<input type="email" name="customerEmail" placeholder="Email" required />
					<input type="text" name="customerAddress" placeholder="Address" required />
					<input type="text" name="customerPostCode" placeholder="Post Code" required />
					<input type="hidden" name="cart" value='[]' />
					<button type="submit">Continue to Payment</button>
				</form>
			`;
			return sendHtml(res, collectPayloadHtml);
		}
		
		// Store payload in cookie and return browser info form
		setCookie(res, '__payload', JSON.stringify(payload), { maxAge: 300, httpOnly: true, secure: true, sameSite: 'None' });
		const body = htmlUtils.collectBrowserInfo(req);
		return sendHtml(res, body);
	}

	// Read POST body (either JSON from frontend, or form-encoded from ACS/browser-info)
	let raw = '';
	req.on('data', chunk => {
		raw += chunk;
		if (raw.length > 1e7) req.destroy();
	});
	req.on('end', async () => {
		const contentType = (req.headers['content-type'] || '').toLowerCase();
		let post = {};
		try {
			if (contentType.includes('application/json')) {
				post = JSON.parse(raw || '{}');
			} else {
				post = qs.parse(raw || '');
			}
		} catch (e) {
			return json(res, 400, { error: 'Invalid request body' });
		}

		// Case A: Browser info collection step posts back (hidden inputs browserInfo[...])
		if (anyKeyStartsWith(post, 'browserInfo[')) {
			const pageURL = `https://${req.headers.host}${parsedUrl.pathname}`;
			const remoteAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
			const cookies = parseCookies(req);

			// If frontend JSON was already posted earlier, it should be in a cookie (short-lived)
			let payload = {};
			if (cookies.__payload) {
				try { payload = JSON.parse(cookies.__payload); } catch {}
			}

			const fields = mapFrontendPayloadToGateway(payload, { pageURL, remoteAddress });
			for ([k, v] of Object.entries(post)) {
				// Strip "browserInfo[" prefix and trailing "]" to flatten keys
				const inner = k.substr(12, k.length - 13);
				fields[inner] = v;
			}

			try {
				const response = await Gateway.directRequest(fields);
				if (response.responseCode === '65802' && response.threeDSRef) {
					setCookie(res, 'threeDSRef', response.threeDSRef);
					return sendHtml(res, htmlUtils.showFrameForThreeDS(response));
				}
				if (response.responseCode === '0') {
					clearCookie(res, 'threeDSRef');
					return sendHtml(res, '<p>Thank you for your payment.</p>');
				}
				return sendHtml(res, `<p>Failed to take payment: message=${response.responseMessage} code=${response.responseCode}</p>`);
			} catch (err) {
				return sendHtml(res, `<p>Failed to take payment.</p>`);
			}
		}

		// Case B: Frontend JSON payload initial request
		if (contentType.includes('application/json')) {
			// Store payload briefly in a cookie to reuse after browser-info step
			setCookie(res, '__payload', JSON.stringify(post), { maxAge: 300, httpOnly: true, secure: true, sameSite: 'None' });
			// Return browser info collection form directly
			const body = htmlUtils.collectBrowserInfo(req);
			return sendHtml(res, body);
		}

		// Case C: ACS posts back fields (NOT starting with threeDSResponse[, then build threeDSResponse)
		if (!anyKeyStartsWith(post, 'threeDSResponse[')) {
			const cookies = parseCookies(req);
			const reqFields = {
				action: 'SALE',
				merchantID: process.env.GATEWAY_MERCHANT_ID || Gateway.merchantID,
				merchantPwd: process.env.GATEWAY_MERCHANT_PWD || Gateway.merchantPwd,
				merchantSecret: process.env.GATEWAY_MERCHANT_SECRET || Gateway.merchantSecret,
				threeDSRef: cookies.threeDSRef || '',
				threeDSResponse: ''
			};
			for (const [k, v] of Object.entries(post)) {
				reqFields.threeDSResponse += '[' + k + ']__EQUAL__SIGN__' + v + '&';
			}
			reqFields.threeDSResponse = reqFields.threeDSResponse.slice(0, -1);

			try {
				const response = await Gateway.directRequest(reqFields);
				if (response.responseCode === '65802' && response.threeDSRef) setCookie(res, 'threeDSRef', response.threeDSRef);
				if (response.responseCode === '0') clearCookie(res, 'threeDSRef');
				if (response.responseCode === '0') return sendHtml(res, '<p>Thank you for your payment.</p>');
				return sendHtml(res, htmlUtils.showFrameForThreeDS(response));
			} catch (err) {
				return sendHtml(res, `<p>Failed to take payment.</p>`);
			}
		}

		// Fallback
		return sendHtml(res, '<p>Unexpected request.</p>');
	});
});

const PORT = process.env.PORT || 8012;
server.listen(PORT, () => {
	console.log(`Payment server listening on :${PORT}`);
});


