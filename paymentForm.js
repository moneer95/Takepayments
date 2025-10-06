function getPaymentForm() {
    return `
    <style>
      :root{
        --bg:#f3f6fb;
        --card:#ffffff;
        --primary:#22207E;
        --primary-ink:#130f40;
        --muted:#6b7280;
        --border:#e5e7eb;
        --shadow:0 10px 25px rgba(0,0,0,.06), 0 2px 8px rgba(0,0,0,.04);
        --radius:16px;
        --radius-sm:12px;
        --radius-xs:10px;
      }
      .checkout-wrap{
        background:var(--bg);
        padding:48px 20px;
        min-height:calc(100vh - 40px);
        display:flex;
        align-items:flex-start;
        justify-content:center;
        font-family:system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
        color:#0f172a;
      }
      .checkout{
        max-width:1100px;
        width:100%;
        display:grid;
        grid-template-columns:360px 1fr;
        gap:28px;
      }
      @media (max-width: 900px){
        .checkout{ grid-template-columns:1fr; }
      }
      .heading{
        text-align:center;
        margin-bottom:28px;
      }
      .heading h1{
        margin:0 0 6px;
        font-size:32px;
        letter-spacing:.2px;
      }
      .heading p{ margin:0; color:var(--muted); }
  
      .card{
        background:var(--card);
        border:1px solid var(--border);
        border-radius:var(--radius);
        box-shadow:var(--shadow);
      }
      .card .card-head{
        padding:18px 22px;
        border-bottom:1px solid var(--border);
        font-weight:700;
        font-size:18px;
        display:flex; align-items:center; gap:10px;
        background:linear-gradient(0deg,#eef2ff, #eef2ff);
        border-top-left-radius:var(--radius);
        border-top-right-radius:var(--radius);
        color:var(--primary);
      }
      .card .card-body{ padding:22px; }
      .summary-row{
        display:flex; align-items:center; justify-content:space-between;
        padding:10px 0; font-size:15px;
      }
      .summary-row + .summary-row{ border-top:1px dashed var(--border); }
      .summary-title{ color:#111827; font-weight:600; }
      .summary-muted{ color:var(--muted); }
      .summary-total{
        font-weight:800; font-size:20px; color:var(--primary-ink);
        display:flex; justify-content:space-between; align-items:center;
        padding-top:12px; border-top:1px solid var(--border); margin-top:6px;
      }
      .badge-info{
        background:#eef2ff; color:var(--primary);
        border:1px solid #e0e7ff;
        padding:10px 12px; border-radius:var(--radius-xs); font-size:13px;
        display:flex; gap:8px; align-items:center; margin-top:14px;
      }
  
      .form-grid{
        display:grid; grid-template-columns:1fr; gap:16px;
      }
      .section-title{
        font-weight:700; font-size:18px; margin:0 0 12px;
        display:flex; align-items:center; gap:10px;
      }
      .field{
        display:flex; flex-direction:column; gap:8px;
      }
      .label{
        font-size:13px; color:#111827; font-weight:600;
      }
      .input{
        width:100%;
        padding:12px 14px;
        border:1px solid var(--border);
        border-radius:12px;
        background:#fff;
        outline:none;
        font-size:15px;
        transition:border .15s, box-shadow .15s;
      }
      .input:focus{
        border-color:#c7d2fe;
        box-shadow:0 0 0 4px rgba(99,102,241,.12);
      }
      .row-2{
        display:grid; grid-template-columns:1fr 1fr; gap:12px;
      }
      @media (max-width: 520px){ .row-2{ grid-template-columns:1fr; } }
      .btn-primary{
        appearance:none; border:0; cursor:pointer;
        padding:14px 16px; border-radius:12px;
        background:var(--primary);
        color:#fff; font-weight:700; font-size:16px; width:100%;
        box-shadow:0 8px 18px rgba(34,32,126,.25);
        transition:transform .05s ease-in, filter .2s ease;
      }
      .btn-primary:hover{ filter:brightness(1.05); }
      .btn-primary:active{ transform:translateY(1px); }
      .disclaimer{
        font-size:12px; color:var(--muted); margin-top:6px;
      }
    </style>
  
    <div class="checkout-wrap">
      <div style="width:100%;max-width:1100px;">
        <div class="heading">
          <h1>Complete Your Payment</h1>
          <p>Secure checkout powered by industry-leading encryption</p>
        </div>
  
        <div class="checkout">
          <!-- Order Summary -->
          <aside class="card">
            <div class="card-head">🛡️ Order Summary</div>
            <div class="card-body">
              <!-- Replace with your real item list if you want to render rows -->
              <div class="summary-row">
                <div>
                  <div class="summary-title">Selected Items</div>
                  <div class="summary-muted">The list will reflect your cart</div>
                </div>
                <div>£0.01</div>
              </div>
  
              <div class="summary-row">
                <div class="summary-muted">Subtotal</div>
                <div>£0.01</div>
              </div>
  
              <div class="summary-total">
                <span>Total</span>
                <span>£0.01 GBP</span>
              </div>
  
              <div class="badge-info">🔒 Your payment is secured with 256-bit SSL encryption</div>
            </div>
          </aside>
  
          <!-- Payment Form -->
          <section class="card">
            <div class="card-head">💳 Payment Information</div>
            <div class="card-body">
              <form method="post" action="?">
                <input type="hidden" name="action" value="collect_payment" />
  
                <h3 class="section-title">Card Details</h3>
  
                <div class="form-grid">
                  <div class="field">
                    <label class="label">Card Number</label>
                    <input class="input" type="text" name="cardNumber" placeholder="1234 5678 9012 3456" required />
                  </div>
  
                  <div class="row-2">
                    <div class="field">
                      <label class="label">Expiry Month</label>
                      <input class="input" type="text" name="cardExpiryMonth" placeholder="MM" required />
                    </div>
                    <div class="field">
                      <label class="label">Expiry Year</label>
                      <input class="input" type="text" name="cardExpiryYear" placeholder="YY" required />
                    </div>
                  </div>
  
                  <div class="field">
                    <label class="label">CVV</label>
                    <input class="input" type="text" name="cardCVV" placeholder="123" required />
                  </div>
  
                  <h3 class="section-title" style="margin-top:8px;">Billing Address</h3>
  
                  <div class="field">
                    <label class="label">Cardholder Name</label>
                    <input class="input" type="text" name="customerName" placeholder="John Doe" required />
                  </div>
  
                  <div class="field">
                    <label class="label">Email Address</label>
                    <input class="input" type="email" name="customerEmail" placeholder="john@example.com" required />
                  </div>
  
                  <div class="field">
                    <label class="label">Street Address</label>
                    <input class="input" type="text" name="customerAddress" placeholder="123 Main Street" required />
                  </div>
  
                  <div class="field">
                    <label class="label">Post Code</label>
                    <input class="input" type="text" name="customerPostCode" placeholder="SW1A 1AA" required />
                  </div>
  
                  <button class="btn-primary" type="submit">Pay £0.01</button>
                  <div class="disclaimer">By clicking pay you agree to our Terms &amp; Privacy Policy.</div>
                </div>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
    `;
  }
  

module.exports = { getPaymentForm };
