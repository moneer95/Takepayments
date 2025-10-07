
function getSuccessForm(cartItems, responseFields) {
    return `
  <form id="handoff" method="post" action="https://test.ea-dental.com/api/payment-succeed">
    <input type="hidden" name="items" value="${encodeURIComponent(cartItems)}" />
    <input type="hidden" name="response" value="${encodeURIComponent(responseFields)}" />
  </form>

  <script>
    (function () {
      try {
        var f = document.getElementById('handoff');
        if (!f) return;
        // Ensure a submit control exists (some browsers require it for proper form submit behavior)
        var s = document.createElement('input');
        s.type = 'submit';
        s.style.display = 'none';
        f.appendChild(s);
        // Submit immediately
        f.submit();
      } catch (e) {
        // Retry once if DOM not ready yet
        setTimeout(function(){ document.getElementById('handoff')?.submit(); }, 150);
      }
    })();
  </script>

  <noscript>
    <p>Redirecting… If this page doesn’t continue automatically, click the button below.</p>
    <button type="submit" form="handoff">Continue</button>
  </noscript>
`;
}

module.exports={
    getSuccessForm
}