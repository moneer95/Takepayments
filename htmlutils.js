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
         <form id="collectBrowserInfo" method="post" action="https://takepayments.ea-dental.com">
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

// htmlutils.js

exports.showFrameForThreeDS = function showFrameForThreeDS(responseFields) {
	// PSP field names (adjust if yours differ)
	const acsURL =
	  responseFields['threeDSURL'] ||
	  responseFields['acsURL'] ||
	  responseFields['acsUrl'];
  
	// Method fields may be nested or top-level depending on gateway
	const threeDSMethodURL =
	  responseFields['threeDSMethodURL'] ||
	  responseFields['threeDSMethodUrl'] ||
	  responseFields['threeDSRequest[threeDSMethodURL]'];
  
	const threeDSMethodData =
	  responseFields['threeDSMethodData'] ||
	  responseFields['threeDSRequest[threeDSMethodData]'];
  
	// Collect challenge fields (e.g., creq, and others) from threeDSRequest[...]
	const challengeFields = {};
	for (const [k, v] of Object.entries(responseFields || {})) {
	  if (k.startsWith('threeDSRequest[')) {
		const key = k.slice('threeDSRequest['.length, -1);
		challengeFields[key] = v;
	  }
	}
	// Echo threeDSRef if provided (some PSPs require it)
	if (responseFields['threeDSRef']) {
	  challengeFields['threeDSRef'] = responseFields['threeDSRef'];
	}
  
	const challengeInputs = Object.entries(challengeFields)
	  .map(([k, v]) => `<input type="hidden" name="${escapeAttr(k)}" value="${escapeAttr(String(v))}" />`)
	  .join('\n');
  
	const hasMethod = Boolean(threeDSMethodURL && threeDSMethodData);
	const methodBlock = hasMethod ? `
	  <!-- Hidden 3DS Method ping -->
	  <iframe name="threeDSMethodFrame" style="display:none;width:0;height:0;border:0;"></iframe>
	  <form id="methodForm" target="threeDSMethodFrame" method="POST" action="${escapeAttr(threeDSMethodURL)}" style="display:none;">
		<input type="hidden" name="threeDSMethodData" value="${escapeAttr(threeDSMethodData)}" />
	  </form>
	` : ``;
  
	return `<!doctype html>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
	body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin:0; }
	.wrap { max-width: 720px; margin: 48px auto; padding: 0 16px; text-align: center; }
	iframe.challenge { width: 100%; height: 560px; border: 0; background: #fafafa; border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,.06); }
	.note { color: #666; font-size: 14px; margin-top: 12px; }
  </style>
  
  <div class="wrap">
	<h2>Verifying your payment…</h2>
	<p class="note">Please don’t close this window.</p>
  
	<!-- Visible ACS challenge frame -->
	<iframe class="challenge" name="threeDSChallengeFrame" id="threeDSChallengeFrame" title="3-D Secure Challenge"></iframe>
  
	${methodBlock}
  
	<!-- Primary: challenge to iframe -->
	<form id="challengeFormIframe" target="threeDSChallengeFrame" method="POST" action="${escapeAttr(acsURL || '')}" style="display:none;">
	  ${challengeInputs}
	</form>
  
	<!-- Fallback: challenge in top window if iframe is blocked -->
	<form id="challengeFormTop" target="_self" method="POST" action="${escapeAttr(acsURL || '')}" style="display:none;">
	  ${challengeInputs}
	</form>
  </div>
  
  <script>
  (function () {
	// 1) Kick the issuer's 3DS Method ping (silent)
	try { var mf = document.getElementById('methodForm'); if (mf) mf.submit(); } catch (e) {}
  
	// 2) Submit challenge to iframe
	var iframe = document.getElementById('threeDSChallengeFrame');
	var iframeLoaded = false;
	try { iframe.addEventListener('load', function(){ iframeLoaded = true; }, { once: true }); } catch(e){}
  
	try { document.getElementById('challengeFormIframe').submit(); } catch (e) {}
  
	// 3) Fallback: if ACS blocks iframing (no onload), post in top window
	setTimeout(function () {
	  if (!iframeLoaded) {
		try { document.getElementById('challengeFormTop').submit(); } catch (e) {}
	  }
	}, 1200);
  })();
  </script>`;
  };
  
  // helper
  function escapeAttr(s) {
	return String(s)
	  .replace(/&/g, '&amp;')
	  .replace(/"/g, '&quot;')
	  .replace(/</g, '&lt;')
	  .replace(/>/g, '&gt;');
  }
  