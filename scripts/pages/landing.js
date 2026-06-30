(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { RATE } = window.BRX.config;
  const { refs } = window.BRX.ui;
  const { format, toNumber, currentRate } = window.BRX.utils;
  let activeSide = "buy";
  let editing = false;

  function renderLanding(scrollTarget = null) {
    refs.app.innerHTML = `
      <div class="landing">
        <section class="hero">
          <div class="hero-copy">
            <div class="badge">P2P USDT / KES Exchange</div>
            <h1>Buy & Sell USDT with <span class="accent">Kenyan Shillings.</span></h1>
            <p class="hero-text">Trade directly with verified users, protected by BRX escrow and settled through a clean internal ledger. Deposits and withdrawals start with USDT BEP20 on BNB Smart Chain.</p>
            <div class="hero-actions">
              <a class="primary-button large" href="#/register">Get started</a>
              <a class="secondary-button large" href="#/login">Sign in</a>
            </div>

            <section class="calculator-card" aria-label="Live rate P2P calculator">
              <div class="card-top">
                <p class="eyebrow">Live rate calculator</p>
                <span class="rate-note">1 USDT = <strong id="rateText">${format(RATE)} KES</strong></span>
              </div>
              <div class="segmented">
                <button class="active" type="button" data-side="buy">Buy USDT</button>
                <button type="button" data-side="sell">Sell USDT</button>
              </div>
              <div class="trade-inputs">
                <label class="input-box">
                  <span id="payLabel">Pay</span>
                  <input id="kesInput" value="10000" inputmode="decimal" />
                  <b>KES</b>
                </label>
                <label class="input-box">
                  <span id="receiveLabel">Receive</span>
                  <input id="usdtInput" value="76.98" inputmode="decimal" />
                  <b>USDT</b>
                </label>
              </div>
              <div class="payment-row"><strong>Live market pricing</strong><span>M-Pesa, bank transfer</span></div>
              <a class="primary-button full" href="#/register">Start trading free -></a>
            </section>
          </div>

          <div class="phone-wrap" aria-label="BRX app preview">
            <section class="phone-shell">
              <div class="phone-status"><span>3:33</span><span>5G 82%</span></div>
              <div class="phone-user"><span class="avatar">B</span><strong>verified trader</strong><span class="muted">BRX</span></div>
              <article class="phone-card">
                <small>Total wallet balance</small>
                <strong>500.00 <span class="muted">USDT</span></strong>
                <div class="phone-actions"><button>Buy</button><button>Sell</button><button>Deposit</button><button>Withdraw</button></div>
              </article>
              <article class="phone-card">
                <small>Live index rate</small>
                <strong>129.90 <span class="muted">KES</span></strong>
                <p class="muted">Per USDT marketplace index</p>
              </article>
              <div class="bottom-tabs"><span>M</span><span>A</span><span>W</span></div>
            </section>
          </div>
        </section>

        <section class="section" id="features">
          <div class="section-head"><div><p class="eyebrow">Features</p><h2>Simple enough to trust. Strong enough to operate.</h2></div></div>
          <div class="feature-grid">
            <article class="feature-card"><h3>Custodial USDT wallet</h3><p>BRX controls deposit and withdrawal wallets while users trade from internal balances.</p></article>
            <article class="feature-card"><h3>Database escrow</h3><p>Seller USDT moves from available to locked when a buyer opens a trade.</p></article>
            <article class="feature-card"><h3>Manual KYC</h3><p>Admin review unlocks higher limits, merchant ads, and full withdrawals.</p></article>
          </div>
        </section>

        <section class="section" id="how-it-works">
          <div class="section-head"><div><p class="eyebrow">How it works</p><h2>Start trading in minutes</h2></div><a class="primary-button" href="#/register">Get started</a></div>
          <div class="steps-grid">
            <article class="step-card"><span>01</span><h3>Create account</h3><p>Sign up with email and verify your account.</p></article>
            <article class="step-card"><span>02</span><h3>Browse market</h3><p>Compare KES rates from BRX traders.</p></article>
            <article class="step-card"><span>03</span><h3>Pay seller</h3><p>Send KES outside BRX using M-Pesa or bank.</p></article>
            <article class="step-card"><span>04</span><h3>Receive USDT</h3><p>Seller confirms and escrow releases internally.</p></article>
          </div>
        </section>
      </div>
    `;
    bindCalculator();
    if (scrollTarget) window.setTimeout(() => document.querySelector(`#${scrollTarget}`)?.scrollIntoView(), 40);
  }

  function bindCalculator() {
    const sideButtons = document.querySelectorAll("[data-side]");
    const kesInput = document.querySelector("#kesInput");
    const usdtInput = document.querySelector("#usdtInput");
    const payLabel = document.querySelector("#payLabel");
    const receiveLabel = document.querySelector("#receiveLabel");
    const rateText = document.querySelector("#rateText");

    function updateFromKes() {
      if (editing) return;
      editing = true;
      usdtInput.value = format(toNumber(kesInput.value) / currentRate(activeSide), 2);
      editing = false;
    }

    function updateFromUsdt() {
      if (editing) return;
      editing = true;
      kesInput.value = format(toNumber(usdtInput.value) * currentRate(activeSide), 2);
      editing = false;
    }

    function setSide(side) {
      activeSide = side;
      sideButtons.forEach((button) => button.classList.toggle("active", button.dataset.side === side));
      payLabel.textContent = side === "buy" ? "Pay" : "Receive";
      receiveLabel.textContent = side === "buy" ? "Receive" : "Sell";
      rateText.textContent = `${format(currentRate(activeSide))} KES`;
      updateFromKes();
    }

    sideButtons.forEach((button) => button.addEventListener("click", () => setSide(button.dataset.side)));
    kesInput.addEventListener("input", updateFromKes);
    usdtInput.addEventListener("input", updateFromUsdt);
    updateFromKes();
  }

  window.BRX.pages.renderLanding = renderLanding;
})();
