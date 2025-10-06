function getPaymentForm() {
    return `
    <style>
      /* Layout + reset */
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin:0; padding:0; }
      body { background:#f3f6fb; color:#0f172a; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
  
      :root{
        --bg:#f3f6fb;
        --card:#fff;
        --primary:#22207E;
        --muted:#6b7280;
        --border:#e5e7eb;
        --shadow:0 10px 25px rgba(0,0,0,.06), 0 2px 8px rgba(0,0,0,.04);
        --radius:16px;
      }
  
      /* Header */
      .site-header{
        background:#fff;
        border-bottom:1px solid var(--border);
        position:sticky; top:0; z-index:10;
      }
      .header-inner{
        max-width:1100px; margin:0 auto; padding:14px 20px;
        display:flex; align-items:center; gap:12px;
      }
      .brand{
        display:flex; align-items:center; gap:12px; text-decoration:none;
      }
      .brand img{ height:36px; width:auto; display:block; }
      .brand span{ font-weight:800; letter-spacing:.2px; color:#111827; }
  
      /* Wrapper */
      .wrap { padding:28px 16px 56px; }
      .container { max-width:1100px; margin:0 auto; }
  
      .heading{ text-align:center; margin:0 0 24px; }
      .heading h1{ margin:0 0 6px; font-size:28px; }
      .heading p{ margin:0; color:var(--muted); font-size:14px; }
  
      /* Grid */
      .checkout {
        display:grid; grid-template-columns:360px 1fr; gap:24px;
        align-items:start;
      }
      @media (max-width: 920px){
        .checkout { grid-template-columns:1fr; }
      }
  
      /* Cards */
      .card{
        background:var(--card);
        border:1px solid var(--border);
        border-radius:var(--radius);
        box-shadow:var(--shadow);
        overflow:hidden;
      }
      .card-head{
        padding:16px 18px; background:#eef2ff; color:var(--primary);
        font-weight:700; font-size:16px;
        border-bottom:1px solid var(--border);
      }
      .card-body{ padding:18px; }
  
      /* Order summary */
      .summary-row{
        display:flex; justify-content:space-between; align-items:flex-start;
        gap:12px; padding:10px 0; font-size:15px; word-break:break-word;
      }
      .summary-row + .summary-row{ border-top:1px dashed var(--border); }
      .summary-title{ font-weight:600; color:#111827; }
      .summary-muted{ color:var(--muted); font-size:13px; }
      .summary-total{
        margin-top:8px; padding-top:12px; border-top:1px solid var(--border);
        display:flex; justify-content:space-between; font-weight:800; font-size:18px;
      }
      .badge-info{
        margin-top:14px; background:#eef2ff; color:var(--primary);
        border:1px solid #e0e7ff; padding:10px 12px; border-radius:12px; font-size:13px;
      }
  
      /* Form */
      form { width:100%; }
      .section-title{ margin:0 0 12px; font-size:16px; font-weight:700; color:#111827; }
      .grid{ display:grid; gap:14px; }
      .row-2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      @media (max-width:520px){ .row-2{ grid-template-columns:1fr; } }
  
      .field{ display:flex; flex-direction:column; gap:8px; }
      .label{ font-size:13px; font-weight:600; color:#111827; }
      .input{
        appearance:none; width:100%; max-width:100%;
        padding:12px 14px; border:1px solid var(--border); border-radius:12px;
        background:#fff; outline:none; font-size:16px; /* 16px avoids iOS zoom */
        transition:border .15s, box-shadow .15s;
        min-height:44px; /* touch target */
      }
      .input:focus{ border-color:#c7d2fe; box-shadow:0 0 0 4px rgba(99,102,241,.12); }
  
      .btn{
        width:100%; border:0; border-radius:12px; cursor:pointer;
        padding:14px 16px; font-weight:800; font-size:16px;
        background:var(--primary); color:#fff;
        box-shadow:0 8px 18px rgba(34,32,126,.25);
        transition:filter .15s, transform .05s;
      }
      .btn:hover{ filter:brightness(1.05); }
      .btn:active{ transform:translateY(1px); }
      .disclaimer{ font-size:12px; color:var(--muted); margin-top:6px; }
  
      /* Ensure no overflow on tiny screens */
      .card, .header-inner, .container { min-width:0; }
      input, button { min-width:0; }
    </style>
  
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="/">
          <img src="https://ea-dental.com/imgs/logo.png" alt="Brand Logo" />
          <span>EA Dental</span>
        </a>
      </div>
    </header>
  
    <div class="wrap">
      <div class="container">
        <div class="heading">
          <h1>Complete Your Payment</h1>
          <p>Secure checkout powered by industry-leading encryption</p>
        </div>
  
        <div class="checkout">
          <!-- Order Summary -->
          <aside class="card">
            <div class="card-head">Order Summary</div>
            <div class="card-body">
              <div class="summary-row">
                <div>
                  <div class="summary-title">ORE1 / LDS1 Gold Bundle (test)</div>
                  <div class="summary-muted">Quantity: 1</div>
                </div>
                <div>£0.01</div>
              </div>
  
              <div class="summary-row">
                <div class="summary-muted">Subtotal</div>
                <div>£0.01</div>
              </div>
  
              <div class="summary-total">
                <span>Total</span><span>£0.01 GBP</span>
              </div>
  
              <div class="badge-info">🔒 Your payment is secured with 256-bit SSL encryption</div>
            </div>
          </aside>
  
          <!-- Payment Form -->
          <section class="card">
            <div class="card-head">Payment Information</div>
            <div class="card-body">
              <form method="post" action="?">
                <input type="hidden" name="action" value="collect_payment" />
  
                <h3 class="section-title">Card Details</h3>
                <div class="grid">
                  <div class="field">
                    <label class="label" for="cardNumber">Card Number</label>
                    <input class="input" id="cardNumber" type="text" name="cardNumber" placeholder="1234 5678 9012 3456" required />
                  </div>
  
                  <div class="row-2">
                    <div class="field">
                      <label class="label" for="cardExpiryMonth">Expiry Month</label>
                      <input class="input" id="cardExpiryMonth" type="text" name="cardExpiryMonth" placeholder="MM" required />
                    </div>
                    <div class="field">
                      <label class="label" for="cardExpiryYear">Expiry Year</label>
                      <input class="input" id="cardExpiryYear" type="text" name="cardExpiryYear" placeholder="YY" required />
                    </div>
                  </div>
  
                  <div class="field">
                    <label class="label" for="cardCVV">CVV</label>
                    <input class="input" id="cardCVV" type="text" name="cardCVV" placeholder="123" required />
                  </div>
  
                  <h3 class="section-title">Billing Address</h3>
  
                  <div class="field">
                    <label class="label" for="customerName">Cardholder Name</label>
                    <input class="input" id="customerName" type="text" name="customerName" placeholder="John Doe" required />
                  </div>
  
                  <div class="field">
                    <label class="label" for="customerEmail">Email Address</label>
                    <input class="input" id="customerEmail" type="email" name="customerEmail" placeholder="john@example.com" required />
                  </div>
  
                  <div class="field">
                    <label class="label" for="customerAddress">Street Address</label>
                    <input class="input" id="customerAddress" type="text" name="customerAddress" placeholder="123 Main Street" required />
                  </div>
  
                  <div class="field">
                    <label class="label" for="customerPostCode">Post Code</label>
                    <input class="input" id="customerPostCode" type="text" name="customerPostCode" placeholder="SW1A 1AA" required />
                  </div>
  
                  <button class="btn" type="submit">Pay £0.01</button>
                  <div class="disclaimer">By clicking pay you agree to our Terms &amp; Privacy Policy.</div>
                </div>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>`;
  }
  

module.exports = { getPaymentForm };
