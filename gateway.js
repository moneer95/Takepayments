const httpBuildQuery = require('http-build-query');
const axios = require('axios');
const crypto = require('crypto');
const qs = require('querystring');

class Gateway {

    RC_SUCCESS = 0; // Transaction successful
    RC_DO_NOT_HONOR = 5; // Transaction declined
    RC_NO_REASON_TO_DECLINE = 85; // Verification successful

    RC_3DS_AUTHENTICATION_REQUIRED = 0x1010A; // 3DS Authentication Required

    //	Gateway Hosted API Endpoint
    static hostedUrl = 'https://gw1.tponlinepayments.com/paymentform/';

    // Gateway Direct API Endpoint
    static directUrl = "https://gw1.tponlinepayments.com/direct/";

    // Merchant Account Id or Alias
    static merchantID = '119837';

    // Password for above Merchant Account
    static merchantPwd = null;

    // Secret for above Merchant Account
    static merchantSecret = '9GXwHNVC87VqsqNM';

    // Proxy URL if required (eg. 'https://www.proxy.com:3128')
    static proxyUrl = null;

    /**
     * Send request to Gateway using HTTP Direct API.
     *
     * The method will send a request to the Gateway using the HTTP Direct API.
     *
     * The request will use the following Gateway properties unless alternative
     * values are provided in the request;
     *   + 'directUrl'		- Gateway Direct API Endpoint
     *   + 'merchantID'		- Merchant Account Id or Alias
     *   + 'merchantPwd'	- Merchant Account Password (or null)
     *   + 'merchantSecret'	- Merchant Account Secret (or null)
     *
     * The method will sign the request and also call
     * verifySignature() to check the signature on any response.
     *
     * The method will throw an exception if it is unable to send the request
     * or receive the response.
     *
     * The method does not attempt to validate any request fields.
     *
     * The method will attempt to send the request using the PHP cURL extension
     * or failing that the  PHP http stream wrappers. If neither are available
     * then an exception will be thrown.
     *
     * @param	{object}	request	request data
     * @param	{object}	options	options (or null)
     *
     * @throws	invalid request data
     * @throws	communications failure
     */
    static directRequest(request, options = null) {

        if (typeof(request) != 'object') {
            throw new TypeError('request must be an object');
        }

        let requestSettings = {};
        this.prepareRequest(request, options, requestSettings);

        // Sign the request
        if (requestSettings['secret']) {
            request['signature'] = this.sign(request, requestSettings['secret']);
        }

        const config = {
            method: 'post',
            url: requestSettings['directUrl'],
            data: qs.stringify(request).replace(/__EQUAL__SIGN__/g, '=').replace('&threeDSResponse=', '&threeDSResponse'),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        };

        let rtn = new Promise((resolve, reject) => {
            axios(config)
                .then((response) => {
                    let responseFields = qs.parse(response.data);
                    this.verifyResponse(responseFields, requestSettings['secret']);
                    resolve(responseFields);
                })
                .catch((error) => {
                    reject(error);
                });
        });

        return rtn;

    }

    /**
     * Send request to Gateway using HTTP Hosted API.
     *
     * The method will send a request to the Gateway using the HTTP Hosted API.
     *
     * The request will use the following Gateway properties unless alternative
     * values are provided in the request;
     *   + 'hostedUrl'		- Gateway Hosted API Endpoint
     *   + 'merchantID'		- Merchant Account Id or Alias
     *   + 'merchantPwd'	- Merchant Account Password (or null)
     *   + 'merchantSecret'	- Merchant Account Secret (or null)
     *
     * The method accepts the following options;
     *   + 'formAttrs'		- HTML form attributes string
     *   + 'submitAttrs'	- HTML submit button attributes string
     *   + 'submitImage'	- URL of image to use as the Submit button
     *   + 'submitHtml'		- HTML to show on the Submit button
     *   + 'submitText'		- Text to show on the Submit button
     *
     * 'submitImage', 'submitHtml' and 'submitText' are mutually exclusive
     * options and will be checked for in that order. If none are provided
     * the submitText='Pay Now' is assumed.
     *
     * The method will sign the request, to allow for submit
     * button images etc. partial signing will be used.
     *
     * The method returns the HTML fragment that needs including in order to
     * send the request.
     *
     * The method will throw an exception if it is unable to send the request.
     *
     * The method does not attempt to validate any request fields.
     *
     * If the request doesn't contain a 'redirectURL' element then one will be
     * added which redirects the response to the current script.
     *
     *
     * @param	{array}	request	request data
     * @param	{array}	options	options (or null)
     * @return	{string}			request HTML form.
     *
     * @throws	if there's invalid request data
     */
    static hostedRequest(request, options = {}) {
        if (typeof(request) != 'object') {
            throw new TypeError('request must be an object');
        }

        let requestSettings = {};
        this.prepareRequest(request, options, requestSettings);

        if (!('redirectURL' in request)) {
            throw new Error("redirectURL not set in request and unable to set from environment");
        }

        if (requestSettings['secret']) {
            request['signature'] = this.sign(request, requestSettings['secret'], true);
        }

        let ret = '<form method="post" ' +
            (('formAttrs' in options) ? options['formAttrs'] : '') +
            ' action="' + htmlentities(requestSettings['hostedUrl']) + "\">\n";

        for (const [name, value] of Object.entries(request)) {
            ret += fieldToHtml(name, value);
        }

        if ('submitAttrs' in options) {
            ret += options['submitAttrs'];
        }

        if ('submitImage' in options) {
            ret += '<input ' +
                ('submitAttrs' in options) ? options['submitAttrs'] : '' +
                ' type="image" src="' + htmlentities(options['submitImage']) + "\">\n";
        } else if ('submitHtml' in options) {
            ret += '<button type="submit" ' +
                (('submitAttrs' in options) ? options['submitAttrs'] : '') +
                ">" + options['submitHtml'] + "</button>\n";
        } else {
            ret += '<input ';
            ret += (('submitAttrs' in options) ? options['submitAttrs'] : '');
            ret += ' type="submit" value="' + (('submitText' in options) ? htmlentities(options['submitText']) : 'Pay Now') + "\">\n";
        }

        ret += "</form>\n";
        return ret;
    }

    /**
     * Prepare a request for sending to the Gateway.
     *
     * The method will extract the following configuration properties from the
     * request if they are present;
     *   + 'merchantSecret'	- Merchant Account Secret (or null)
     *   + 'directUrl'		- Gateway Direct API Endpoint
     *   + 'hostedUrl'		- Gateway Hosted API Endpoint
     *
     * The method will insert the following configuration properties into the
     * request if they are not already present;
     *   + 'merchantID'		- Merchant Account Id or Alias
     *   + 'merchantPwd'	- Merchant Account Password (or null)
     *
     * The method will throw if the request doesn't contain an
     * 'action' element or a 'merchantID' element (and none could be inserted).
     *
     * The method does not attempt to validate any request fields.
     *
     * request	request data (input & return)
     * @param	{object}	options			options (or null)
     * @param	{string}	secret			any extracted 'merchantSecret' (return)
     * @param	{object}	requestSettings	any extracted 'directUrl' (return)
     * @throws	If there's invalid request data
     */
    static prepareRequest(request, options = null, requestSettings) {

        if (typeof request != 'object') {
            throw new Error("Request must be an object.");
        }

        if (typeof requestSettings != 'object') {
            throw new Error("requestSettings must be an object.");
        }

        if (!'action' in request) {
            throw new Error("Request must contain an 'action'.");
        }

        // Insert 'merchantID' if doesn't exist and default is available
        if (request['merchantID'] == undefined && this.merchantID != undefined) {
            request['merchantID'] = this.merchantID;
        }

        // Insert 'merchantPwd' if doesn't exist and default is available
        if (request['merchantPwd'] == undefined && this.merchantPwd != undefined) {
            request['merchantPwd'] = this.merchantPwd;
        }

        // A 'merchantID' must be set
        if (request['merchantID'] == undefined) {
            throw 'Merchant ID or Alias must be provided.';
        }

        if ('merchantSecret' in request) {
            requestSettings['secret'] = request['merchantSecret'];
            delete(request['merchantSecret']);
        } else {
            requestSettings['secret'] = this.merchantSecret;
        }

        if ('hostedUrl' in request) {
            requestSetting['hostedUrl'] = request['hostedUrl'];
            delete(request['hostedUrl']);
        } else {
            requestSettings['hostedUrl'] = this.hostedUrl;
        }

        if ('directUrl' in request) {
            requestSettings['directUrl'] = request['directUrl'];
            delete(request['directUrl']);
        } else {
            requestSettings['directUrl'] = this.directUrl;
        }

        // Remove items we don't want to send in the request
        // (they may be there if a previous response is sent)
        const keysToRemove = [
            'responseCode',
            'responseMessage',
            'responseStatus',
            'state',
            'signature',
            'merchantAlias',
            'merchantID2'
        ];

        keysToRemove.forEach(k => delete request[k]);
    }

    /**
     * Verify the any response.
     *
     * This method will verify that the response is present, contains a response
     * code and is correctly signed.
     *
     * If the response is invalid then an exception will be thrown.
     *
     * Any signature is removed from the passed response.
     *
     * @param	{object}	data		reference to the response to verify
     * @param	{string}	secret		secret to use in signing
     * @return	{boolean}				true if signature verifies
     */
    static verifyResponse(response, secret = null) {
        if (typeof(response) != 'object') {
            throw new TypeError('response variable must be an object');
        }

        if (!response || !('responseCode' in response)) {
            throw new Error('Invalid response from Payment Gateway');
        }

        if (!secret) {
            secret = this.merchantSecret;
        }

        let fields = null;
        let signature = null;

        if ('signature' in response) {
            signature = response['signature'];
            delete(response['signature']);

            if (secret && signature && (signature.indexOf('|') != -1)) {
                [signature, fields] = signature.split('|');
            }
        }

        // We display three suitable different exception messages to help show
        // secret mismatches between ourselves and the Gateway without giving
        // too much away if the messages are displayed to the Cardholder.
        if (!secret && signature) {
            // Signature present when not expected (Gateway has a secret but we don't)
            throw new Error('Incorrectly signed response from Payment Gateway (1)');
        } else if (secret && !signature) {
            // Signature missing when one expected (We have a secret but the Gateway doesn't)
            throw new Error('Incorrectly signed response from Payment Gateway (2)');
        } else if (secret && this.sign(response, secret, fields) !== signature) {
            // Signature mismatch
            throw new Error('Incorrectly signed response from Payment Gateway');
        }

        return true;
    }

    /**
     * Sign the given array of data.
     *
     * This method will return the correct signature for the data array.
     *
     * If the secret is not provided then the static secret is used.
     *
     * The partial parameter is used to indicate that the signature should
     * be marked as 'partial' and can take three possible value types as
     * follows;
     *   + boolean	- sign with all $data fields
     *   + string	- comma separated list of $data field names to sign
     *   + array	- array of $data field names to sign
     *
     * @param	{object}	data		data to sign
     * @param	{string}	secret		secret to use in signing
     * @param	{any}		partial		used when signature is only some keys
     * @return	{string}	signature
     */
    static sign(data, secret, partial = false) {

        // Support signing only a subset of the data fields
        if (partial) {
            if (typeof partial === 'string') {
                partial = partial.split(',');
            }

            if (typeof partial == 'array') {

                for (const key of Object.keys(data)) {
                    if (!key in partial) {
                        delete(data[key]);
                    }
                }
            }
            partial = Object.keys(data).join(',');
        }

        // httpbuildquery removes * characters, so replace them with a placeholder, then
        // replace the placeholder with %2A (*) before calculating the signature.

        const orderedFields = {};
        Object.keys(data).sort(phpCompatibleSort).forEach(function(key) {
            if (typeof(data[key]) == 'string') {
                orderedFields[key] = data[key].replace(/\*/g, 'STAR-httpbuildquery-removes-STAR');
            } else {
                orderedFields[key] = data[key];
            }
        });

        let body = httpBuildQuery(orderedFields);
        body = body.replace('&threeDSResponse=', '&threeDSResponse');
        body = body.replace(/__EQUAL__SIGN__/g, '=');
        body = body.replace(/STAR\-httpbuildquery\-removes\-STAR/g, '%2A');
        body = body.replace(/%0D%0A|%0A%0D|%0D/ig, '%0A');

        const hash = crypto.createHash('sha512');
        hash.update(body);
        hash.update(secret);

        return hash.digest('hex');
    }

    /**
     * Collect browser device information.
     *
     * The method will return a self submitting HTML form designed to provided
     * the browser device details in the following integration fields;
     *   + 'deviceChannel'			- Fixed value 'browser',
     *   + 'deviceIdentity'			- Browser's UserAgent string
     *   + 'deviceTimeZone'			- Browser's timezone
     *   + 'deviceCapabilities'		- Browser's capabilities
     *   + 'deviceScreenResolution'	- Browser's screen resolution (widthxheightxcolour-depth)
     *   + 'deviceAcceptContent'	- Browser's accepted content types
     *   + 'deviceAcceptEncoding'	- Browser's accepted encoding methods
     *   + 'deviceAcceptLanguage'	- Browser's accepted languages
     *   + 'deviceAcceptCharset'	- Browser's accepted character sets
     *
     * The above fields will be submitted as child elements of a 'browserInfo'
     * parent field.
     *
     * The method accepts the following options;
     *   + 'formAttrs'		- HTML form attributes string
     *   + 'formData'		- associative array of additional post data
     *
     *
     * The method returns the HTML fragment that needs including in order to
     * render the HTML form.
     *
     * The browser must suport JavaScript in order to obtain the details and
     * submit the form.
     *
     * @param	array	$options	options (or null)
     * @return	string				request HTML form.
     *
     * @throws	InvalidArgumentException	invalid request data
     */
    static collectBrowserInfo(req, options = {}) {

        let http_user_agent = htmlentities(req.headers['user-agent']);
        let http_accept = htmlentities(req.headers['accept']);
        let http_accept_encoding = htmlentities(req.headers['accept-encoding']);
        let http_accept_language = htmlentities(req.headers['accept-language']);


        let form_attrs = 'id="collectBrowserInfo" method="post" action="?"';

        if ('formAttrs' in options) {
            form_attrs += options['formAttrs'];
        }

        const device_data = {
            'deviceChannel': 'browser',
            'deviceIdentity': http_user_agent,
            'deviceTimeZone': '0',
            'deviceCapabilities': '',
            'deviceScreenResolution': '1x1x1',
            'deviceAcceptContent': http_accept,
            'deviceAcceptEncoding': http_accept_encoding,
            'deviceAcceptLanguage': http_accept_language,
            'deviceAcceptCharset': '',
            'deviceOperatingSystem': 'win',
            'deviceType': 'desktop',
        };

        let form_fields = fieldToHtml('browserInfo', device_data);

        if ('formData' in options) {
            for (const [name, value] of Object.entries(options['formData'])) {
                form_fields += fieldToHtml(name, value);
            }
        }

        ret = `
			<form ${form_attrs}>
			${form_fields}
			</form>
			<script>
				var screen_width = (window && window.screen ? window.screen.width : '0');
				var screen_height = (window && window.screen ? window.screen.height : '0');
				var screen_depth = (window && window.screen ? window.screen.colorDepth : '0');
				var identity = (window && window.navigator ? window.navigator.userAgent : '');
				var language = (window && window.navigator ? (window.navigator.language ? window.navigator.language : window.navigator.browserLanguage) : '');
				var timezone = (new Date()).getTimezoneOffset();
				var java = (window && window.navigator ? navigator.javaEnabled() : false);
				var charset = null;
				var os = 'win';
				var type = 'desktop';
				var fields = document.forms.collectBrowserInfo.elements;
				fields['browserInfo[deviceIdentity]'].value = identity;
				fields['browserInfo[deviceTimeZone]'].value = timezone;
				fields['browserInfo[deviceCapabilities]'].value = 'javascript' + (java ? ',java' : '');
				fields['browserInfo[deviceAcceptLanguage]'].value = language;
				fields['browserInfo[deviceScreenResolution]'].value = screen_width + 'x' + screen_height + 'x' + screen_depth;
				fields['browserInfo[deviceAcceptCharset]'].value = charset;
				fields['browserInfo[deviceOperatingSystem]'].value = os;
				fields['browserInfo[deviceType]'].value = type;
				window.setTimeout('document.forms.collectBrowserInfo.submit()', 0);
			</script>`;

        return ret;
    }
}

/**
 * Return the field name and value as HTML input tags.
 *
 * The method will return a string containing one or more HTML <input
 * type="hidden"> tags which can be used to store the name and value.
 *
 * @param	string		$name		field name
 * @param	mixed		$value		field value
 * @return	string					HTML containing <INPUT> tags
 */
function fieldToHtml(name, value) {
    ret = '';
    if (typeof value === "object" && !Array.isArray(value)) {
        Object.entries(value).forEach(([nestedKey, nestedValue]) => {
            ret += fieldToHtml(`${name}[${nestedKey}]`, nestedValue);
        });
    } else {
        // Convert all applicable characters or none printable characters to HTML entities
        value = ordEntities(htmlentities(value));
        ret = `<input type="hidden" name="${name}" value="${value}" />\n`;
    }

    return ret;
}

/**
 * Replace all characters below or equal to 0x1f
 * with &# ; escaped equivalent.
 * E.g. /t becomes &#9;
 *
 * (0x00 to 0x1f consists of whitespace and control characters)
 */
function ordEntities(str) {
    return str.replace(/[(\x00-\x1f)]/g,
        match => {
            return '&#' + match.codePointAt(0) + ';';
        });
}

// https://stackoverflow.com/a/57448862
function htmlentities(str) {
    if (typeof str == 'number') {
        return str.toString();
    }

    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag]));
}

/**
 * Exclusively used in signature calculation.
 *
 * Signatures need to be calculated in a way that's consistent with PHP.
 * PHP's functions to handle URL encoding will convert `'a[a]': 'value'`
 * into `'a' : {'a': 'value}. Therefore when we sort,  `key[nestedKey]`
 * is of equal ordinal value to `key`.
 */
function phpCompatibleSort(a, b) {

    let pos = 0;
    let rtn;
    let foundSqr = false;

    do {
        // codePointAt helpfully returns undefined if pos > length
        achr = a.codePointAt(pos);
        bchr = b.codePointAt(pos);

        if (achr == undefined) { //We don't need to check b at all.
            return -1
        }
        if (bchr == undefined) {
            return 1
        }

        // Swap [ for 0.
        if (achr == '['.codePointAt(0)) {
            achr = '0'.codePointAt(0);
            foundSqr = true;
        }
        if (bchr == '['.codePointAt(0)) {
            bchr = '0'.codePointAt(0);
            foundSqr = true;
        }

        rtn = achr - bchr;
        pos++;

    } while (rtn == 0 && foundSqr == false)
    // return 0 if we've found a [, PHP doesn't sort nested arrays

    return rtn;
}

exports.Gateway = Gateway;
exports.forTest = {};
exports.forTest.ordEntities = ordEntities;