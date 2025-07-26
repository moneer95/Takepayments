exports.collectBrowserInfo = function(req) {

  const Entities = require('html-entities').Html5Entities
  const entities = new Entities();

  http_user_agent = entities.encode(req.headers['user-agent']);
  http_accept = entities.encode(req.headers['accept']);
  http_accept_encoding = entities.encode(req.headers['accept-encoding']);
  http_accept_language = entities.encode(req.headers['accept-language']);
  device_accept_charset =  null;
  device_operating_system = 'win';
  device_type = 'desktop';

  return (`
         <form id="collectBrowserInfo" method="post" action="?">
<input type="hidden" name="browserInfo[deviceChannel]" value="browser" />
<input type="hidden" name="browserInfo[deviceIdentity]" value="${http_user_agent}" />
<input type="hidden" name="browserInfo[deviceTimeZone]" value="0" />
<input type="hidden" name="browserInfo[deviceCapabilities]" value="" />
<input type="hidden" name="browserInfo[deviceScreenResolution]" value="1x1x1" />
<input type="hidden" name="browserInfo[deviceAcceptContent]" value="${http_accept}" />
<input type="hidden" name="browserInfo[deviceAcceptEncoding]" value="${http_accept_encoding}" />
<input type="hidden" name="browserInfo[deviceAcceptLanguage]" value="${http_accept_language}" />
<input type="hidden" name="browserInfo[deviceAcceptCharset]" value="${device_accept_charset}" />
<input type="hidden" name="browserInfo[deviceOperatingSystem]" value="${device_operating_system}" />
<input type="hidden" name="browserInfo[deviceType]" value="${device_type}" />

</form>
<script>
var screen_width = (window && window.screen ? window.screen.width : '0');
var screen_height = (window && window.screen ? window.screen.height : '0');
var screen_depth = (window && window.screen ? window.screen.colorDepth : '0');
var identity = (window && window.navigator ? window.navigator.userAgent : '');
var language = (window && window.navigator ? (window.navigator.language ? window.navigator.language : window.navigator.browserLanguage) : '');
var timezone = (new Date()).getTimezoneOffset();
var java = (window && window.navigator ? navigator.javaEnabled() : false);
var charset = '';
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
</script>
`);
}


exports.getPageUrl = function(req) {
	// WARNING - THIS CODE WILL DEPEND ON YOUR DEPLOYMENT CONFIGURATION
	// This is providing the URL that's used in the html for the form, so it needs to be correct for
	// the public/external view of your application, the other side of any reverse proxy.

	// HTTP_X_FORWARDED_SERVER is provided by Apache when acting as reverse proxy. This is correct for rackup and Apache.
	if (req.headers['x-forwarded-server']) {
		return "https://" + req.headers["x-forwarded-server"] + // Assume default port.
		req.url.replace(/acs=1/, "")
	}

	return (req.headers["SERVER_PORT"] == "443" ? "https://" : "https://") +
		req.headers["SERVER_NAME"] +
		(req.headers["SERVER_PORT"] != "80" ? ":" + req.headers["SERVER_PORT"] : "") +
		req.headers["REQUEST_URI"].replace(/acs=1&?/, "")
}


exports.getWrapHTML = function(content) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-type" content="text/html;charset=UTF-8" />
  </head>
  <body>` + "\n\n" + content +
    `  </body>
</html>`;
}

exports.showFrameForThreeDS = function (responseFields) {
	// Send a request to the ACS server by POSTing a form with the target set as the IFrame.
	// The form is hidden for threeDSMethodData requests (frictionless) and visible when the ACS
	// server may show a challenge to the user.
	style = responseFields['threeDSRequest[threeDSMethodData]'] ? ' display: none;' : '';
	rtn = '<iframe name="threeds_acs" style="height:420px; width:420px;"' + style + '"></iframe>\n\n';

	// We could extract each key by name, however in the interests of facilitating forward
	// compatibility, we pass through every field in the threeDSRequest array.
	formField = {};
	for ([k, v] of Object.entries(responseFields)) {
		if (k.startsWith('threeDSRequest[')) {
			let formKey = k.substr(15, k.length - 16);
			formField[formKey] = v;
		}

		formField['threeDSRef'] = global.threeDSRef;
	}

	return silentPost(responseFields['threeDSURL'], formField, '_self');
}

// TODO copied from the other one!
silentPost = function(url, fields, target = '_self') {
	fieldsStr = ""
	for ([k, v] of Object.entries(fields)) {
		fieldsStr += `<input type="text" name="${k}" value="${v}" /> \n`;
	}

	return `
			<form id="silentPost" action="${url}" method="post" target="${target}">
				${fieldsStr}
				<input type="submit" value="Continue">
			</form>
			<script>
				window.setTimeout('document.forms.silentPost.submit()', 0);
			</script>
		`;
}